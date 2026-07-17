import { experienceAttemptIds } from "../case-catalog";
import type { CaseReport } from "../evidence/contracts";
import type { FinishCaseInput } from "../evidence/recorder";
import { ProductAssertionError } from "./experience-test";

export interface AttemptCoordinates {
  runId: string;
  caseId: string;
  attemptId: string;
}

export interface CaseRecorder {
  finishCase(input: FinishCaseInput): Promise<CaseReport>;
}

export interface RunExperienceCaseOptions<Fixture extends object> {
  runId: string;
  caseId: string;
  createFixture(coordinates: AttemptCoordinates): Promise<Fixture>;
  execute(
    coordinates: AttemptCoordinates & { fixture: Fixture }
  ): Promise<FinishCaseInput>;
  recorderFactory(coordinates: AttemptCoordinates): CaseRecorder;
  persistFallbackReport(
    coordinates: AttemptCoordinates,
    input: FinishCaseInput
  ): Promise<CaseReport>;
  disposeFixture(
    fixture: Fixture,
    coordinates: AttemptCoordinates
  ): Promise<void>;
}

export class ExperienceCaseRunError extends Error {
  constructor(
    readonly caseId: string,
    readonly reports: readonly CaseReport[],
    readonly persistenceErrors: readonly unknown[] = []
  ) {
    super(
      persistenceErrors.length > 0
        ? `${caseId} could not persist every declared attempt report`
        : `${caseId} completed with ${reports.filter(({ verdict }) => verdict !== "PASS").length} non-passing attempt(s)`
    );
    this.name = "ExperienceCaseRunError";
  }
}

export async function runExperienceCase<Fixture extends object>(
  options: RunExperienceCaseOptions<Fixture>
): Promise<readonly CaseReport[]> {
  const reports: CaseReport[] = [];
  const persistenceErrors: unknown[] = [];
  const fixtureIdentities = new Set<object>();

  for (const attemptId of experienceAttemptIds(options.caseId)) {
    const coordinates: AttemptCoordinates = {
      runId: options.runId,
      caseId: options.caseId,
      attemptId
    };
    let recorder: CaseRecorder;
    try {
      recorder = options.recorderFactory(coordinates);
    } catch (initializationError) {
      try {
        reports.push(await options.persistFallbackReport(coordinates, classifyAttempt(
          undefined,
          new Error(`Recorder initialization failed: ${errorMessage(initializationError)}`),
          undefined,
          undefined
        )));
      } catch (fallbackPersistenceError) {
        persistenceErrors.push(new AggregateError(
          [initializationError, fallbackPersistenceError],
          `Attempt ${attemptId} recorder initialization and fallback persistence failed: ` +
            `${errorMessage(initializationError)}; ${errorMessage(fallbackPersistenceError)}`
        ));
      }
      continue;
    }
    let fixture: Fixture | undefined;
    let executionError: unknown;
    let disposalError: unknown;
    let finishInput: FinishCaseInput | undefined;

    try {
      fixture = await options.createFixture(coordinates);
      if (fixtureIdentities.has(fixture)) {
        throw new Error(`Attempt ${attemptId} reused a prior fixture instance`);
      }
      fixtureIdentities.add(fixture);
      finishInput = await options.execute({ ...coordinates, fixture });
    } catch (error) {
      executionError = error;
    }

    let durableReport: CaseReport | undefined;
    let preliminaryPersistenceError: unknown;
    try {
      durableReport = await recorder.finishCase(
        classifyAttempt(finishInput, executionError, undefined, undefined)
      );
    } catch (error) {
      preliminaryPersistenceError = error;
    }

    if (!fixture && preliminaryPersistenceError === undefined) {
      if (!durableReport) {
        throw new Error(`Attempt ${attemptId} lost its durable report`);
      }
      reports.push(durableReport);
      continue;
    }

    if (fixture) {
      try {
        await options.disposeFixture(fixture, coordinates);
      } catch (error) {
        disposalError = error;
      }
    }

    const finalInput = classifyAttempt(
      finishInput,
      executionError,
      disposalError,
      preliminaryPersistenceError
    );
    try {
      reports.push(await recorder.finishCase(finalInput));
    } catch (finalPersistenceError) {
      const reportingError = combineErrors(
        preliminaryPersistenceError,
        finalPersistenceError
      );
      try {
        reports.push(await options.persistFallbackReport(
          coordinates,
          classifyAttempt(
            finishInput,
            executionError,
            disposalError,
            reportingError
          )
        ));
      } catch (fallbackPersistenceError) {
        persistenceErrors.push(new AggregateError(
          [
            ...definedErrors(preliminaryPersistenceError),
            finalPersistenceError,
            fallbackPersistenceError
          ],
          `Attempt ${attemptId} final and fallback persistence failed: ` +
            `${errorMessage(finalPersistenceError)}; ${errorMessage(fallbackPersistenceError)}`
        ));
        if (durableReport) {
          reports.push(durableReport);
        }
      }
    }
  }

  if (
    persistenceErrors.length > 0 ||
    reports.length !== experienceAttemptIds(options.caseId).length ||
    reports.some(({ verdict }) => verdict !== "PASS")
  ) {
    throw new ExperienceCaseRunError(options.caseId, reports, persistenceErrors);
  }

  return reports;
}

function classifyAttempt(
  finishInput: FinishCaseInput | undefined,
  executionError: unknown,
  disposalError: unknown,
  reportingError: unknown
): FinishCaseInput {
  if (!executionError && !disposalError && !reportingError && finishInput) {
    return finishInput;
  }

  const harnessFailures = [
    ...(reportingError === undefined
      ? []
      : [{ error: reportingError, stage: "attempt-reporting" }]),
    ...(disposalError === undefined
      ? []
      : [{ error: disposalError, stage: "attempt-cleanup" }])
  ];

  if (!executionError && harnessFailures.length > 0 && finishInput) {
    const summary = harnessFailures.map(({ error }) => errorMessage(error)).join("; ");
    return {
      ...finishInput,
      verdict: "INCONCLUSIVE",
      results: {
        ...finishInput.results,
        harness: {
          status: "inconclusive",
          summary: `Attempt harness finalization failed: ${summary}`,
          evidenceEventIds: []
        }
      },
      failures: [
        ...finishInput.failures,
        ...harnessFailures.map(({ error, stage }) => ({
          code: "HARNESS_RUNTIME_FAILURE",
          summary: errorMessage(error),
          stage,
          evidenceEventIds: []
        }))
      ]
    };
  }

  if (executionError instanceof ProductAssertionError) {
    const context = executionError.context;
    const harnessSummary = harnessFailures
      .map(({ error }) => errorMessage(error))
      .join("; ");
    return {
      verdict: harnessFailures.length > 0 ? "INCONCLUSIVE" : "FAIL",
      results: {
        product: {
          status: "fail",
          summary: executionError.message,
          evidenceEventIds: []
        },
        harness: harnessFailures.length > 0
          ? {
              status: "inconclusive",
              summary: `Attempt harness finalization failed: ${harnessSummary}`,
              evidenceEventIds: []
            }
          : {
              status: "pass",
              summary: "The harness captured an explicit product assertion failure.",
              evidenceEventIds: []
            },
        environment: {
          status: "pass",
          summary: "No environment failure was observed.",
          evidenceEventIds: []
        }
      },
      assertions: [{
        id: context.assertionId,
        outcome: "fail",
        evidenceEventIds: [],
        summary: executionError.message,
        details: {
          actor: context.actor,
          earliestDivergentProjection: context.earliestDivergentProjection,
          measuredValue: context.measuredValue,
          threshold: context.threshold,
          artifactIds: [...context.artifactIds]
        }
      }],
      failures: [
        {
          code: "PRODUCT_ASSERTION_FAILED",
          summary: executionError.message,
          stage: context.assertionId,
          evidenceEventIds: [],
          details: {
            actor: context.actor,
            artifactIds: [...context.artifactIds]
          }
        },
        ...harnessFailures.map(({ error, stage }) => ({
          code: "HARNESS_RUNTIME_FAILURE",
          summary: errorMessage(error),
          stage,
          evidenceEventIds: []
        }))
      ]
    };
  }

  const errors = [executionError, reportingError, disposalError].filter(
    (error): error is NonNullable<typeof error> => error !== undefined
  );
  const summary = errors.map(errorMessage).join("; ") ||
    "The attempt did not produce a finish result.";
  return {
    verdict: "INCONCLUSIVE",
    results: {
      product: {
        status: "inconclusive",
        summary: "Product behavior could not be judged because the harness did not complete.",
        evidenceEventIds: []
      },
      harness: {
        status: "inconclusive",
        summary: `Unexpected browser or runtime failure: ${summary}`,
        evidenceEventIds: []
      },
      environment: {
        status: "pass",
        summary: "No environment failure was observed.",
        evidenceEventIds: []
      }
    },
    assertions: [],
    failures: [{
      code: "HARNESS_RUNTIME_FAILURE",
      summary,
      stage: "attempt-runtime",
      evidenceEventIds: []
    }]
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function combineErrors(...errors: unknown[]): unknown {
  const defined = errors.filter((error) => error !== undefined);
  if (defined.length <= 1) {
    return defined[0];
  }
  return new AggregateError(
    defined,
    defined.map(errorMessage).join("; ")
  );
}

function definedErrors(error: unknown): unknown[] {
  return error === undefined ? [] : [error];
}
