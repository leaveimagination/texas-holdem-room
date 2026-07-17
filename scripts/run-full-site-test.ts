import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { experienceAttemptIds } from "../tests/experience/case-catalog";
import type {
  RunReport,
  RunResourceRecord
} from "../tests/experience/evidence/contracts";
import { writeExperienceReport } from "../tests/experience/evidence/report-writer";
import { validateEvidencePack } from "../tests/experience/evidence/validator";
import { runPlaywrightGroup } from "./site-test/playwright-group";
import type { PlaywrightGroupResult } from "./site-test/playwright-group";
import {
  EnvironmentStageError,
  HarnessStageError,
  OverallDeadlineError,
  SITE_TEST_FINALIZATION_RESERVE_MS,
  SITE_TEST_FINALIZATION_REQUIRED_REMAINING_MS,
  SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS,
  SITE_TEST_HARD_DEADLINE_MS,
  SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS,
  SMOKE_CASE_ID,
  exitCodeForVerdict,
  parseSiteTestArguments,
  type CollectedCaseEvidence,
  type RunFullSiteTestOptions,
  type SiteTestDiagnostics,
  type SiteTestRunContext,
  type SiteTestRunnerDependencies,
  type SiteTestRunResult,
  type SiteTestStageControl,
  type SiteTestStackHandle
} from "./site-test/runner-contracts";
import {
  addCollectionIssues,
  ensureAttemptEvidence,
  environmentError,
  errorMessage,
  injectProductFailureEvidence,
  isRetainedCleanupError,
  markEnvironmentInconclusive,
  markHarnessInconclusive,
  mergeEvidence,
  passingRunResults,
  playwrightBudget,
  reportInput,
  resourceRecords,
  selectedCasesPassed,
  syntheticInconclusiveEvidence
} from "./site-test/runner-evidence";
import {
  allocateDefaultRun,
  collectDefaultCaseEvidence,
  createDefaultStack,
  inspectDefaultBrowserVersion,
  inspectDefaultImage,
  persistDefaultDiagnostics,
  preflightDefaultStack,
  writeDefaultMetadata
} from "./site-test/runner-defaults";

export * from "./site-test/runner-contracts";
export { injectProductFailureEvidence } from "./site-test/runner-evidence";

export async function runFullSiteTest(
  options: RunFullSiteTestOptions
): Promise<SiteTestRunResult> {
  try {
    return await options.dependencies.withDeadline(
      SITE_TEST_HARD_DEADLINE_MS,
      async (signal, remainingMs) =>
        await runFullSiteTestWithinDeadline(options, signal, remainingMs)
    );
  } catch {
    return { exitCode: 2, verdict: "INCONCLUSIVE" };
  }
}

async function runFullSiteTestWithinDeadline(
  options: RunFullSiteTestOptions,
  signal: AbortSignal,
  remainingMs: () => number
): Promise<SiteTestRunResult> {
  const { dependencies, selection } = options;
  let context: SiteTestRunContext | undefined;
  let stack: SiteTestStackHandle | undefined;
  let evidence: CollectedCaseEvidence = { cases: [], events: [] };
  let resources: RunResourceRecord[] = [];
  let report: RunReport | undefined;
  let reportDurable = false;
  let currentFinalReportDurable = false;
  let finalEvidenceValidated = false;
  let diagnosticsComplete = false;
  let diagnosticsDurable = false;
  let finalPackValidated = false;
  let productInjectionApplied = false;
  let failureStage = "runner-initialization";
  let failureSummary = "The runner stopped before a selected case could be judged.";
  const attemptedCaseIds = new Set<string>();
  const diagnostics: SiteTestDiagnostics = { playwright: [], issues: [] };
  const runResults = passingRunResults();
  const isolatedCaseIds = selection.caseIds.filter(
    (caseId) => caseId !== SMOKE_CASE_ID
  );
  const includesSmoke = selection.caseIds.includes(SMOKE_CASE_ID);

  try {
        const allocationControl = requireOperationalBudget(
          signal,
          remainingMs,
          SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.allocation
        );
        context = await dependencies.allocateRun(selection, allocationControl);
        throwIfDeadline(signal);
        const browserControl = requireOperationalBudget(
          signal,
          remainingMs,
          SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.browserVersion
        );
        const chromiumVersion = await dependencies.inspectBrowserVersion(
          context,
          browserControl
        );
        throwIfDeadline(signal);
        const metadataControl = requireOperationalBudget(
          signal,
          remainingMs,
          SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.metadata
        );
        await dependencies.writeMetadata(
          context,
          selection,
          chromiumVersion,
          metadataControl
        );
        throwIfDeadline(signal);

        try {
          const imageControl = requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.imageInspection
          );
          diagnostics.imageId = await dependencies.inspectImage(context, imageControl);
          throwIfDeadline(signal);
        } catch (error) {
          throw environmentError(error, "image-inspect");
        }

        try {
          const stackControl = requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.stackStart
          );
          stack = dependencies.createStack(context);
          const snapshot = await stack.start(stackControl);
          throwIfDeadline(signal);
          resources = resourceRecords(snapshot);
          const appImageId = snapshot.services.find(
            ({ service }) => service === "app"
          )?.imageId;
          if (
            snapshot.imageId !== diagnostics.imageId ||
            appImageId !== diagnostics.imageId
          ) {
            throw new EnvironmentStageError(
              "The started isolated app does not use the immutable image inspected before startup",
              "image-provenance"
            );
          }
        } catch (error) {
          if (stack?.snapshot !== undefined) {
            resources = resourceRecords(stack.snapshot);
          }
          throw environmentError(error, "isolated-stack-start");
        }

        try {
          const preflightControl = requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.preflight
          );
          await dependencies.preflight(
            context,
            stack,
            selection.injectEnvironmentFailure,
            preflightControl
          );
          throwIfDeadline(signal);
        } catch (error) {
          throw environmentError(error, "preflight");
        }

        if (isolatedCaseIds.length > 0) {
          const evidenceControl = requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.playwrightMinimum
          );
          isolatedCaseIds.forEach((caseId) => attemptedCaseIds.add(caseId));
          const groupResult = await runGroup(
            dependencies,
            context,
            isolatedCaseIds,
            playwrightBudget(remainingMs()),
            signal
          );
          throwIfDeadline(signal);
          diagnostics.playwright.push({
            caseIds: isolatedCaseIds,
            result: groupResult
          });
          requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.evidenceCollection
          );
          const collected = await dependencies.collectCaseEvidence(
            context,
            isolatedCaseIds,
            evidenceControl
          );
          throwIfDeadline(signal);
          evidence = mergeEvidence(evidence, collected);
          addCollectionIssues(collected, diagnostics, runResults);
          evidence = ensureAttemptEvidence(
            context,
            evidence,
            isolatedCaseIds,
            runResults,
            "isolated-evidence"
          );

          if (
            selection.injectProductFailure !== undefined &&
            selection.injectProductFailure.caseId !== SMOKE_CASE_ID
          ) {
            const injectionControl = requireOperationalBudget(
              signal,
              remainingMs,
              SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.productFailureEvidence
            );
            evidence = await dependencies.injectProductFailure(
              context,
              evidence,
              selection.injectProductFailure,
              injectionControl
            );
            throwIfDeadline(signal);
            productInjectionApplied = true;
          }

          const partialReportControl = requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.partialReport
          );
          report = await dependencies.writeReport(
            reportInput(
              context,
              evidence,
              resources,
              runResults,
              dependencies.now()
            ),
            partialReportControl
          );
          throwIfDeadline(signal);
          reportDurable = true;
          try {
            const partialValidationControl = requireOperationalBudget(
              signal,
              remainingMs,
              SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.partialValidation
            );
            await dependencies.validateEvidence(
              context.outputRoot,
              context.knownSecrets,
              "isolated",
              partialValidationControl
            );
            throwIfDeadline(signal);
          } catch (error) {
            markHarnessInconclusive(
              runResults,
              diagnostics,
              `Isolated evidence validation failed: ${errorMessage(error)}`
            );
          }
          if (
            groupResult.exitCode !== 0 &&
            selectedCasesPassed(evidence, isolatedCaseIds)
          ) {
            markHarnessInconclusive(
              runResults,
              diagnostics,
              `Playwright exited ${groupResult.exitCode} despite passing isolated reports.`
            );
          }
        }

        const mayRunSmoke =
          includesSmoke &&
          selectedCasesPassed(evidence, isolatedCaseIds) &&
          runResults.harness.status === "pass" &&
          runResults.environment.status === "pass";
        if (mayRunSmoke) {
          const smokeEvidenceControl = requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.playwrightMinimum
          );
          attemptedCaseIds.add(SMOKE_CASE_ID);
          const smokeResult = await runGroup(
            dependencies,
            context,
            [SMOKE_CASE_ID],
            playwrightBudget(remainingMs()),
            signal
          );
          throwIfDeadline(signal);
          diagnostics.playwright.push({
            caseIds: [SMOKE_CASE_ID],
            result: smokeResult
          });
          requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.evidenceCollection
          );
          const collected = await dependencies.collectCaseEvidence(context, [
            SMOKE_CASE_ID
          ], smokeEvidenceControl);
          throwIfDeadline(signal);
          evidence = mergeEvidence(evidence, collected);
          addCollectionIssues(collected, diagnostics, runResults);
          evidence = ensureAttemptEvidence(
            context,
            evidence,
            [SMOKE_CASE_ID],
            runResults,
            "smoke-evidence"
          );
          if (selection.injectProductFailure?.caseId === SMOKE_CASE_ID) {
            const smokeInjectionControl = requireOperationalBudget(
              signal,
              remainingMs,
              SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.productFailureEvidence
            );
            evidence = await dependencies.injectProductFailure(
              context,
              evidence,
              selection.injectProductFailure,
              smokeInjectionControl
            );
            throwIfDeadline(signal);
            productInjectionApplied = true;
          }
          if (
            smokeResult.exitCode !== 0 &&
            selectedCasesPassed(evidence, [SMOKE_CASE_ID])
          ) {
            markHarnessInconclusive(
              runResults,
              diagnostics,
              `Playwright exited ${smokeResult.exitCode} despite a passing smoke report.`
            );
          }
        }
  } catch (error) {
    failureStage =
      error instanceof EnvironmentStageError || error instanceof HarnessStageError
        ? error.stage
        : "runner-runtime";
    failureSummary = errorMessage(error);
    diagnostics.issues.push(failureSummary);
    if (error instanceof EnvironmentStageError) {
      markEnvironmentInconclusive(runResults, failureSummary);
    } else {
      markHarnessInconclusive(runResults, diagnostics, failureSummary, false);
    }
  }

  throwIfDeadline(signal);
  if (context === undefined) {
    return { exitCode: 2, verdict: "INCONCLUSIVE" };
  }

  const attempted = [...attemptedCaseIds];
  if (attempted.length > 0) {
    evidence = ensureAttemptEvidence(
      context,
      evidence,
      attempted,
      runResults,
      failureStage,
      failureSummary
    );
  }
  if (evidence.cases.length === 0) {
    const fallbackCaseId = selection.caseIds[0];
    evidence = mergeEvidence(
      evidence,
      syntheticInconclusiveEvidence(
        context,
        fallbackCaseId,
        experienceAttemptIds(fallbackCaseId)[0],
        failureStage,
        failureSummary,
        runResults.environment.status === "inconclusive"
          ? "environment"
          : "harness"
      )
    );
  }
  if (selection.injectProductFailure !== undefined && !productInjectionApplied) {
    const finalInjectionControl = requireFinalizationBudget(
      signal,
      remainingMs,
      SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.productFailureEvidence,
      SITE_TEST_FINALIZATION_REQUIRED_REMAINING_MS.productFailureEvidence
    );
    try {
      evidence = await dependencies.injectProductFailure(
        context,
        evidence,
        selection.injectProductFailure,
        finalInjectionControl
      );
      throwIfDeadline(signal);
    } catch (error) {
      markHarnessInconclusive(
        runResults,
        diagnostics,
        `Product failure injection could not be recorded: ${errorMessage(error)}`
      );
    }
  }

  reportDurable = false;
  currentFinalReportDurable = false;
  throwIfDeadline(signal);
  const finalReportControl = requireFinalizationBudget(
    signal,
    remainingMs,
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.finalReport,
    SITE_TEST_FINALIZATION_REQUIRED_REMAINING_MS.finalReport
  );
  try {
    report = await dependencies.writeReport(
      reportInput(context, evidence, resources, runResults, dependencies.now()),
      finalReportControl
    );
    reportDurable = true;
    currentFinalReportDurable = true;
    throwIfDeadline(signal);
  } catch (error) {
    markHarnessInconclusive(
      runResults,
      diagnostics,
      `Final report persistence failed: ${errorMessage(error)}`
    );
  }

  if (reportDurable) {
    throwIfDeadline(signal);
    const finalValidationControl = requireFinalizationBudget(
      signal,
      remainingMs,
      SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.finalValidation,
      SITE_TEST_FINALIZATION_REQUIRED_REMAINING_MS.finalValidation
    );
    try {
      await dependencies.validateEvidence(
        context.outputRoot,
        context.knownSecrets,
        "final",
        finalValidationControl
      );
      finalEvidenceValidated = true;
      throwIfDeadline(signal);
    } catch (error) {
      markHarnessInconclusive(
        runResults,
        diagnostics,
        `Final evidence validation failed: ${errorMessage(error)}`
      );
    }
  }

  if (stack !== undefined) {
    throwIfDeadline(signal);
    const diagnosticsControl = requireFinalizationBudget(
      signal,
      remainingMs,
      SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.dockerDiagnostics,
      SITE_TEST_FINALIZATION_REQUIRED_REMAINING_MS.dockerDiagnostics
    );
    try {
      diagnostics.docker = await stack.collectDiagnostics(diagnosticsControl);
      diagnosticsComplete = true;
      throwIfDeadline(signal);
    } catch (error) {
      markHarnessInconclusive(
        runResults,
        diagnostics,
        `Docker diagnostics collection failed: ${errorMessage(error)}`
      );
    }
  } else {
    diagnosticsComplete = true;
  }
  throwIfDeadline(signal);
  const diagnosticsPersistenceControl = requireFinalizationBudget(
    signal,
    remainingMs,
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.diagnosticsPersistence,
    SITE_TEST_FINALIZATION_REQUIRED_REMAINING_MS.diagnosticsPersistence
  );
  try {
    await dependencies.persistDiagnostics(
      context,
      diagnostics,
      diagnosticsPersistenceControl
    );
    diagnosticsDurable = true;
    throwIfDeadline(signal);
  } catch (error) {
    markHarnessInconclusive(
      runResults,
      diagnostics,
      `Diagnostics persistence failed: ${errorMessage(error)}`
    );
  }
  if (reportDurable) {
    throwIfDeadline(signal);
    const finalizedPackControl = requireFinalizationBudget(
      signal,
      remainingMs,
      SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.finalizedPackValidation,
      SITE_TEST_FINALIZATION_REQUIRED_REMAINING_MS.finalizedPackValidation
    );
    try {
      await dependencies.validateEvidence(
        context.outputRoot,
        context.knownSecrets,
        "finalized-pack",
        finalizedPackControl
      );
      finalPackValidated = true;
      throwIfDeadline(signal);
    } catch (error) {
      markHarnessInconclusive(
        runResults,
        diagnostics,
        `Finalized evidence validation failed: ${errorMessage(error)}`
      );
    }
  }

  const cleanupEvidenceDurable =
    currentFinalReportDurable &&
    finalEvidenceValidated &&
    diagnosticsComplete &&
    diagnosticsDurable &&
    finalPackValidated;
  if (stack !== undefined && !cleanupEvidenceDurable) {
    resources = resources.map((resource) => ({
      ...resource,
      cleanupStatus: "retained"
    }));
  }

  if (stack !== undefined && cleanupEvidenceDurable) {
    throwIfDeadline(signal);
    const cleanupControl = requireFinalizationBudget(
      signal,
      remainingMs,
      SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.exactCleanup,
      SITE_TEST_FINALIZATION_REQUIRED_REMAINING_MS.exactCleanup
    );
    try {
      await stack.stop(cleanupControl);
      throwIfDeadline(signal);
      resources = resources.map((resource) => ({
        ...resource,
        cleanupStatus: "cleaned"
      }));
    } catch (error) {
      const retained = isRetainedCleanupError(error);
      resources = resources.map((resource) => ({
        ...resource,
        cleanupStatus: retained ? "retained" : "failed"
      }));
      const summary = `Exact stack cleanup failed: ${errorMessage(error)}`;
      markEnvironmentInconclusive(runResults, summary);
      markHarnessInconclusive(runResults, diagnostics, summary);
    }
  }

  if (reportDurable) {
    throwIfDeadline(signal);
    const cleanupReportControl = requireFinalizationBudget(
      signal,
      remainingMs,
      SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.cleanupStatusReport,
      SITE_TEST_FINALIZATION_REQUIRED_REMAINING_MS.cleanupStatusReport
    );
    try {
      report = await dependencies.writeReport(
        reportInput(context, evidence, resources, runResults, dependencies.now()),
        cleanupReportControl
      );
      throwIfDeadline(signal);
    } catch (error) {
      markHarnessInconclusive(
        runResults,
        diagnostics,
        `Cleanup status persistence failed: ${errorMessage(error)}`
      );
    }
  }

  if (
    report === undefined ||
    (runResults.harness.status !== "pass" &&
      report.results.harness.status === "pass")
  ) {
    return {
      exitCode: 2,
      verdict: "INCONCLUSIVE",
      outputRoot: context.outputRoot,
      report
    };
  }
  return {
    exitCode: exitCodeForVerdict(report.verdict),
    verdict: report.verdict,
    outputRoot: context.outputRoot,
    report
  };
}

async function runGroup(
  dependencies: SiteTestRunnerDependencies,
  context: SiteTestRunContext,
  caseIds: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal
): Promise<PlaywrightGroupResult> {
  try {
    return await dependencies.runPlaywrightGroup({
      rootDirectory: context.rootDirectory,
      runId: context.runId,
      outputRoot: context.outputRoot,
      caseOutputRoot: context.caseOutputRoot,
      caseIds,
      isolatedBaseUrl: context.isolatedBaseUrl,
      redisUrl: context.redisUrl,
      databaseUrl: context.databaseUrl,
      smokeBaseUrl: context.smokeBaseUrl,
      timeoutMs,
      signal,
      knownSecrets: context.knownSecrets
    });
  } catch (error) {
    throw new HarnessStageError(
      `Playwright group ${caseIds.join(",")} failed to execute: ${errorMessage(error)}`,
      `playwright-${caseIds.join("-")}`,
      { cause: error }
    );
  }
}

export function createDefaultSiteTestRunnerDependencies(): SiteTestRunnerDependencies {
  return {
    withDeadline: withHardDeadline,
    allocateRun: async (_selection, control) =>
      await runControlled(control, allocateDefaultRun),
    inspectBrowserVersion: inspectDefaultBrowserVersion,
    writeMetadata: writeDefaultMetadata,
    inspectImage: inspectDefaultImage,
    createStack: createDefaultStack,
    preflight: preflightDefaultStack,
    runPlaywrightGroup,
    collectCaseEvidence: collectDefaultCaseEvidence,
    injectProductFailure: async (context, evidence, injection, control) =>
      await runControlled(control, async () =>
        await injectProductFailureEvidence(context, evidence, injection)
      ),
    writeReport: async (input, control) =>
      await runControlled(control, async () => await writeExperienceReport(input)),
    validateEvidence: async (outputRoot, knownSecrets, _phase, control) =>
      await runControlled(control, async () =>
        await validateEvidencePack(outputRoot, knownSecrets)
      ),
    persistDiagnostics: persistDefaultDiagnostics,
    now: () => new Date().toISOString()
  };
}

async function runControlled<T>(
  control: SiteTestStageControl,
  operation: () => Promise<T>
): Promise<T> {
  control.signal.throwIfAborted();
  const result = await operation();
  control.signal.throwIfAborted();
  return result;
}

async function withHardDeadline<T>(
  timeoutMs: number,
  task: (signal: AbortSignal, remainingMs: () => number) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const remainingMs = () => Math.max(0, timeoutMs - (Date.now() - startedAt));
  let timer: NodeJS.Timeout | undefined;
  let deadlineError: OverallDeadlineError | undefined;
  timer = setTimeout(() => {
    deadlineError = new OverallDeadlineError(timeoutMs);
    controller.abort(deadlineError);
  }, timeoutMs);
  timer.unref?.();
  try {
    const result = await task(controller.signal, remainingMs);
    if (deadlineError !== undefined) {
      throw deadlineError;
    }
    return result;
  } catch (error) {
    if (deadlineError !== undefined) {
      throw deadlineError;
    }
    throw error;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function throwIfDeadline(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  const reason = signal.reason;
  throw reason instanceof OverallDeadlineError
    ? reason
    : new OverallDeadlineError(SITE_TEST_HARD_DEADLINE_MS);
}

function requireOperationalBudget(
  signal: AbortSignal,
  remainingMs: () => number,
  stageBudgetMs: number
): { signal: AbortSignal; timeoutMs: number } {
  throwIfDeadline(signal);
  if (remainingMs() < SITE_TEST_FINALIZATION_RESERVE_MS + stageBudgetMs) {
    throw new OverallDeadlineError(SITE_TEST_HARD_DEADLINE_MS);
  }
  return { signal, timeoutMs: stageBudgetMs };
}

function requireFinalizationBudget(
  signal: AbortSignal,
  remainingMs: () => number,
  stageBudgetMs: number,
  requiredRemainingMs: number
): { signal: AbortSignal; timeoutMs: number } {
  throwIfDeadline(signal);
  if (remainingMs() < requiredRemainingMs) {
    throw new OverallDeadlineError(SITE_TEST_HARD_DEADLINE_MS);
  }
  return { signal, timeoutMs: stageBudgetMs };
}

async function runCli(args: readonly string[]): Promise<number> {
  try {
    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(args),
      dependencies: createDefaultSiteTestRunnerDependencies()
    });
    if (result.outputRoot !== undefined) {
      process.stdout.write(
        `Site experience verdict: ${result.verdict}\nEvidence: ${result.outputRoot}\n`
      );
    }
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`Site experience runner failed: ${errorMessage(error)}\n`);
    return 2;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  process.exitCode = await runCli(process.argv.slice(2));
}
