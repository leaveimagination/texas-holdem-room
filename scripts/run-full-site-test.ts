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
import type { ProcessResult } from "./site-test/process-runner";
import {
  EnvironmentStageError,
  HarnessStageError,
  OverallDeadlineError,
  SITE_TEST_HARD_DEADLINE_MS,
  SMOKE_CASE_ID,
  exitCodeForVerdict,
  parseSiteTestArguments,
  type CollectedCaseEvidence,
  type RunFullSiteTestOptions,
  type SiteTestDiagnostics,
  type SiteTestRunContext,
  type SiteTestRunnerDependencies,
  type SiteTestRunResult,
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
  inspectDefaultImage,
  persistDefaultDiagnostics,
  preflightDefaultStack,
  startDefaultStack,
  writeDefaultMetadata
} from "./site-test/runner-defaults";

export * from "./site-test/runner-contracts";
export { injectProductFailureEvidence } from "./site-test/runner-evidence";

export async function runFullSiteTest(
  options: RunFullSiteTestOptions
): Promise<SiteTestRunResult> {
  const { dependencies, selection } = options;
  let context: SiteTestRunContext | undefined;
  let stack: SiteTestStackHandle | undefined;
  let evidence: CollectedCaseEvidence = { cases: [], events: [] };
  let resources: RunResourceRecord[] = [];
  let report: RunReport | undefined;
  let reportDurable = false;
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
    await dependencies.withDeadline(
      SITE_TEST_HARD_DEADLINE_MS,
      async (signal, remainingMs) => {
        context = await dependencies.allocateRun(selection);
        await dependencies.writeMetadata(context, selection);

        try {
          diagnostics.imageId = await dependencies.inspectImage(context, signal);
        } catch (error) {
          throw environmentError(error, "image-inspect");
        }

        try {
          stack = await dependencies.startStack(context, signal);
          resources = resourceRecords(stack.snapshot);
          const appImageId = stack.snapshot.services.find(
            ({ service }) => service === "app"
          )?.imageId;
          if (
            stack.snapshot.imageId !== diagnostics.imageId ||
            appImageId !== diagnostics.imageId
          ) {
            throw new EnvironmentStageError(
              "The started isolated app does not use the immutable image inspected before startup",
              "image-provenance"
            );
          }
        } catch (error) {
          throw environmentError(error, "isolated-stack-start");
        }

        try {
          await dependencies.preflight(
            context,
            stack,
            selection.injectEnvironmentFailure,
            signal
          );
        } catch (error) {
          throw environmentError(error, "preflight");
        }

        if (isolatedCaseIds.length > 0) {
          isolatedCaseIds.forEach((caseId) => attemptedCaseIds.add(caseId));
          const groupResult = await runGroup(
            dependencies,
            context,
            isolatedCaseIds,
            playwrightBudget(remainingMs())
          );
          diagnostics.playwright.push({
            caseIds: isolatedCaseIds,
            result: groupResult
          });
          const collected = await dependencies.collectCaseEvidence(
            context,
            isolatedCaseIds
          );
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
            evidence = await dependencies.injectProductFailure(
              context,
              evidence,
              selection.injectProductFailure
            );
            productInjectionApplied = true;
          }

          report = await dependencies.writeReport(
            reportInput(
              context,
              evidence,
              resources,
              runResults,
              dependencies.now()
            )
          );
          reportDurable = true;
          try {
            await dependencies.validateEvidence(
              context.outputRoot,
              context.knownSecrets,
              "isolated"
            );
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
          attemptedCaseIds.add(SMOKE_CASE_ID);
          const smokeResult = await runGroup(
            dependencies,
            context,
            [SMOKE_CASE_ID],
            playwrightBudget(remainingMs())
          );
          diagnostics.playwright.push({
            caseIds: [SMOKE_CASE_ID],
            result: smokeResult
          });
          const collected = await dependencies.collectCaseEvidence(context, [
            SMOKE_CASE_ID
          ]);
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
            evidence = await dependencies.injectProductFailure(
              context,
              evidence,
              selection.injectProductFailure
            );
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
      }
    );
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
    try {
      evidence = await dependencies.injectProductFailure(
        context,
        evidence,
        selection.injectProductFailure
      );
    } catch (error) {
      markHarnessInconclusive(
        runResults,
        diagnostics,
        `Product failure injection could not be recorded: ${errorMessage(error)}`
      );
    }
  }

  try {
    report = await dependencies.writeReport(
      reportInput(context, evidence, resources, runResults, dependencies.now())
    );
    reportDurable = true;
  } catch (error) {
    markHarnessInconclusive(
      runResults,
      diagnostics,
      `Final report persistence failed: ${errorMessage(error)}`
    );
  }

  if (reportDurable) {
    try {
      await dependencies.validateEvidence(
        context.outputRoot,
        context.knownSecrets,
        "final"
      );
    } catch (error) {
      markHarnessInconclusive(
        runResults,
        diagnostics,
        `Final evidence validation failed: ${errorMessage(error)}`
      );
    }
  }

  if (stack !== undefined) {
    try {
      diagnostics.docker = await stack.collectDiagnostics();
    } catch (error) {
      markHarnessInconclusive(
        runResults,
        diagnostics,
        `Docker diagnostics collection failed: ${errorMessage(error)}`
      );
    }
  }
  try {
    await dependencies.persistDiagnostics(context, diagnostics);
  } catch (error) {
    markHarnessInconclusive(
      runResults,
      diagnostics,
      `Diagnostics persistence failed: ${errorMessage(error)}`
    );
  }
  if (reportDurable) {
    try {
      await dependencies.validateEvidence(
        context.outputRoot,
        context.knownSecrets,
        "finalized-pack"
      );
    } catch (error) {
      markHarnessInconclusive(
        runResults,
        diagnostics,
        `Finalized evidence validation failed: ${errorMessage(error)}`
      );
    }
  }

  if (stack !== undefined && reportDurable) {
    try {
      await stack.stop();
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
    try {
      report = await dependencies.writeReport(
        reportInput(context, evidence, resources, runResults, dependencies.now())
      );
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
  timeoutMs: number
): Promise<ProcessResult> {
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
      timeoutMs
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
    allocateRun: allocateDefaultRun,
    writeMetadata: writeDefaultMetadata,
    inspectImage: inspectDefaultImage,
    startStack: startDefaultStack,
    preflight: preflightDefaultStack,
    runPlaywrightGroup,
    collectCaseEvidence: collectDefaultCaseEvidence,
    injectProductFailure: injectProductFailureEvidence,
    writeReport: writeExperienceReport,
    validateEvidence: async (outputRoot, knownSecrets) =>
      await validateEvidencePack(outputRoot, knownSecrets),
    persistDiagnostics: persistDefaultDiagnostics,
    now: () => new Date().toISOString()
  };
}

async function withHardDeadline<T>(
  timeoutMs: number,
  task: (signal: AbortSignal, remainingMs: () => number) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const remainingMs = () => Math.max(0, timeoutMs - (Date.now() - startedAt));
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort(new OverallDeadlineError(timeoutMs));
      reject(new OverallDeadlineError(timeoutMs));
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([task(controller.signal, remainingMs), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
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
