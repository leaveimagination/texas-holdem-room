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
  StageTimeoutError,
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
  persistDefaultRetainedResources,
  preflightDefaultStack,
  writeDefaultMetadata
} from "./site-test/runner-defaults";

export * from "./site-test/runner-contracts";
export { injectProductFailureEvidence } from "./site-test/runner-evidence";

export async function runFullSiteTest(
  options: RunFullSiteTestOptions
): Promise<SiteTestRunResult> {
  const progress: {
    context?: SiteTestRunContext;
    report?: RunReport;
  } = {};
  try {
    return await options.dependencies.withDeadline(
      SITE_TEST_HARD_DEADLINE_MS,
      async (signal, remainingMs) =>
        await runFullSiteTestWithinDeadline(options, signal, remainingMs, progress)
    );
  } catch {
    return {
      exitCode: 2,
      verdict: "INCONCLUSIVE",
      runId: progress.context?.runId,
      outputRoot: progress.context?.outputRoot,
      report: progress.report
    };
  }
}

async function runFullSiteTestWithinDeadline(
  options: RunFullSiteTestOptions,
  signal: AbortSignal,
  remainingMs: () => number,
  progress: { context?: SiteTestRunContext; report?: RunReport }
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
        context = await runBoundedStage(
          "allocation",
          allocationControl,
          async (control) => await dependencies.allocateRun(selection, control)
        );
        progress.context = context;
        throwIfDeadline(signal);
        const browserControl = requireOperationalBudget(
          signal,
          remainingMs,
          SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.browserVersion
        );
        const chromiumVersion = await runBoundedStage(
          "browser-version",
          browserControl,
          async (control) =>
            await dependencies.inspectBrowserVersion(context!, control)
        );
        throwIfDeadline(signal);
        const metadataControl = requireOperationalBudget(
          signal,
          remainingMs,
          SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.metadata
        );
        await runBoundedStage(
          "metadata",
          metadataControl,
          async (control) =>
            await dependencies.writeMetadata(
              context!,
              selection,
              chromiumVersion,
              control
            )
        );
        throwIfDeadline(signal);

        try {
          const imageControl = requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.imageInspection
          );
          diagnostics.imageId = await runBoundedStage(
            "image-inspect",
            imageControl,
            async (control) => await dependencies.inspectImage(context!, control)
          );
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
          const snapshot = await runBoundedStage(
            "isolated-stack-start",
            stackControl,
            async (control) => await stack!.start(control)
          );
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
          await runBoundedStage(
            "preflight",
            preflightControl,
            async (control) =>
              await dependencies.preflight(
                context!,
                stack!,
                selection.injectEnvironmentFailure,
                control
              )
          );
          throwIfDeadline(signal);
        } catch (error) {
          throw environmentError(error, "preflight");
        }

        if (isolatedCaseIds.length > 0) {
          requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.playwrightMinimum
          );
          isolatedCaseIds.forEach((caseId) => attemptedCaseIds.add(caseId));
          const isolatedPlaywrightControl = {
            signal,
            timeoutMs: playwrightBudget(remainingMs())
          };
          const groupResult = await runBoundedStage(
            "isolated-playwright",
            isolatedPlaywrightControl,
            async (control) =>
              await runGroup(
                dependencies,
                context!,
                isolatedCaseIds,
                control.timeoutMs,
                control.signal
              )
          );
          throwIfDeadline(signal);
          diagnostics.playwright.push({
            caseIds: isolatedCaseIds,
            result: groupResult
          });
          if (groupResult.timedOut) {
            markHarnessInconclusive(
              runResults,
              diagnostics,
              "The isolated Playwright group timed out before a conclusive product verdict."
            );
          }
          const collectionControl = requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.evidenceCollection
          );
          const collected = await runBoundedStage(
            "isolated-evidence-collection",
            collectionControl,
            async (control) =>
              await dependencies.collectCaseEvidence(
                context!,
                isolatedCaseIds,
                control
              )
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
            evidence = await runBoundedStage(
              "isolated-product-failure-evidence",
              injectionControl,
              async (control) =>
                await dependencies.injectProductFailure(
                  context!,
                  evidence,
                  selection.injectProductFailure!,
                  control
                )
            );
            throwIfDeadline(signal);
            productInjectionApplied = true;
          }

          const partialReportControl = requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.partialReport
          );
          report = await runBoundedStage(
            "isolated-partial-report",
            partialReportControl,
            async (control) =>
              await dependencies.writeReport(
                reportInput(
                  context!,
                  evidence,
                  resources,
                  runResults,
                  dependencies.now()
                ),
                control
              )
          );
          throwIfDeadline(signal);
          reportDurable = true;
          progress.report = report;
          try {
            const partialValidationControl = requireOperationalBudget(
              signal,
              remainingMs,
              SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.partialValidation
            );
            await runBoundedStage(
              "isolated-evidence-validation",
              partialValidationControl,
              async (control) =>
                await dependencies.validateEvidence(
                  context!.outputRoot,
                  context!.knownSecrets,
                  "isolated",
                  control
                )
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
              !groupResult.timedOut &&
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
          requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.playwrightMinimum
          );
          attemptedCaseIds.add(SMOKE_CASE_ID);
          const smokePlaywrightControl = {
            signal,
            timeoutMs: playwrightBudget(remainingMs())
          };
          const smokeResult = await runBoundedStage(
            "smoke-playwright",
            smokePlaywrightControl,
            async (control) =>
              await runGroup(
                dependencies,
                context!,
                [SMOKE_CASE_ID],
                control.timeoutMs,
                control.signal
              )
          );
          throwIfDeadline(signal);
          diagnostics.playwright.push({
            caseIds: [SMOKE_CASE_ID],
            result: smokeResult
          });
          if (smokeResult.timedOut) {
            markHarnessInconclusive(
              runResults,
              diagnostics,
              "The smoke Playwright group timed out before a conclusive product verdict."
            );
          }
          const smokeCollectionControl = requireOperationalBudget(
            signal,
            remainingMs,
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.evidenceCollection
          );
          const collected = await runBoundedStage(
            "smoke-evidence-collection",
            smokeCollectionControl,
            async (control) =>
              await dependencies.collectCaseEvidence(
                context!,
                [SMOKE_CASE_ID],
                control
              )
          );
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
            evidence = await runBoundedStage(
              "smoke-product-failure-evidence",
              smokeInjectionControl,
              async (control) =>
                await dependencies.injectProductFailure(
                  context!,
                  evidence,
                  selection.injectProductFailure!,
                  control
                )
            );
            throwIfDeadline(signal);
            productInjectionApplied = true;
          }
          if (
              !smokeResult.timedOut &&
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
    if (error instanceof StageTimeoutError) {
      throw error;
    }
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
      evidence = await runBoundedStage(
        "final-product-failure-evidence",
        finalInjectionControl,
        async (control) =>
          await dependencies.injectProductFailure(
            context!,
            evidence,
            selection.injectProductFailure!,
            control
          )
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
    report = await runBoundedStage(
      "final-report",
      finalReportControl,
      async (control) =>
        await dependencies.writeReport(
          reportInput(
            context!,
            evidence,
            resources,
            runResults,
            dependencies.now()
          ),
          control
        )
    );
    reportDurable = true;
    currentFinalReportDurable = true;
    progress.report = report;
    throwIfDeadline(signal);
  } catch (error) {
    const summary = `Final report persistence failed: ${errorMessage(error)}`;
    markHarnessInconclusive(
      runResults,
      diagnostics,
      summary
    );
    resources = resources.map((resource) => ({
      ...resource,
      cleanupStatus: "retained"
    }));
    const retainedFallbackControl = requireFinalizationBudget(
      signal,
      remainingMs,
      SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.retainedResourceFallback,
      SITE_TEST_FINALIZATION_REQUIRED_REMAINING_MS.retainedResourceFallback
    );
    try {
      await runBoundedStage(
        "retained-resource-fallback",
        retainedFallbackControl,
        async (control) =>
          await dependencies.persistRetainedResources(
            context!,
            resources,
            summary,
            control
          )
      );
      throwIfDeadline(signal);
    } catch (fallbackError) {
      markHarnessInconclusive(
        runResults,
        diagnostics,
        `Retained resource fallback persistence failed: ${errorMessage(fallbackError)}`
      );
    }
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
      await runBoundedStage(
        "final-evidence-validation",
        finalValidationControl,
        async (control) =>
          await dependencies.validateEvidence(
            context!.outputRoot,
            context!.knownSecrets,
            "final",
            control
          )
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
      diagnostics.docker = await runBoundedStage(
        "docker-diagnostics",
        diagnosticsControl,
        async (control) => await stack!.collectDiagnostics(control)
      );
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
    await runBoundedStage(
      "diagnostics-persistence",
      diagnosticsPersistenceControl,
      async (control) =>
        await dependencies.persistDiagnostics(context!, diagnostics, control)
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
      await runBoundedStage(
        "finalized-pack-validation",
        finalizedPackControl,
        async (control) =>
          await dependencies.validateEvidence(
            context!.outputRoot,
            context!.knownSecrets,
            "finalized-pack",
            control
          )
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
      await runBoundedStage(
        "exact-stack-cleanup",
        cleanupControl,
        async (control) => await stack!.stop(control)
      );
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
      report = await runBoundedStage(
        "cleanup-status-report",
        cleanupReportControl,
        async (control) =>
          await dependencies.writeReport(
            reportInput(
              context!,
              evidence,
              resources,
              runResults,
              dependencies.now()
            ),
            control
          )
      );
      progress.report = report;
      throwIfDeadline(signal);
    } catch (error) {
      const summary = `Cleanup status persistence failed: ${errorMessage(error)}`;
      markHarnessInconclusive(
        runResults,
        diagnostics,
        summary
      );
      if (
        resources.some(
          ({ cleanupStatus }) =>
            cleanupStatus === "retained" || cleanupStatus === "failed"
        )
      ) {
        const fallbackControl = requireFinalizationBudget(
          signal,
          remainingMs,
          SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.retainedResourceFallback,
          SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.retainedResourceFallback
        );
        try {
          await runBoundedStage(
            "cleanup-retained-resource-fallback",
            fallbackControl,
            async (control) =>
              await dependencies.persistRetainedResources(
                context!,
                resources,
                summary,
                control
              )
          );
          throwIfDeadline(signal);
        } catch (fallbackError) {
          markHarnessInconclusive(
            runResults,
            diagnostics,
            `Cleanup retained resource fallback persistence failed: ${errorMessage(fallbackError)}`
          );
        }
      }
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
      runId: context.runId,
      outputRoot: context.outputRoot,
      report
    };
  }
  return {
    exitCode: exitCodeForVerdict(report.verdict),
    verdict: report.verdict,
    runId: context.runId,
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
    allocateRun: async (_selection, control) => await allocateDefaultRun(control),
    inspectBrowserVersion: inspectDefaultBrowserVersion,
    writeMetadata: writeDefaultMetadata,
    inspectImage: inspectDefaultImage,
    createStack: createDefaultStack,
    preflight: preflightDefaultStack,
    runPlaywrightGroup,
    collectCaseEvidence: collectDefaultCaseEvidence,
    injectProductFailure: async (context, evidence, injection, control) =>
      await injectProductFailureEvidence(context, evidence, injection, control),
    writeReport: async (input, control) =>
      await writeExperienceReport(input, { signal: control.signal }),
    validateEvidence: async (outputRoot, knownSecrets, _phase, control) =>
      await validateEvidencePack(outputRoot, knownSecrets, {
        signal: control.signal
      }),
    persistDiagnostics: persistDefaultDiagnostics,
    persistRetainedResources: persistDefaultRetainedResources,
    now: () => new Date().toISOString()
  };
}

async function runBoundedStage<T>(
  stageName: string,
  parentControl: SiteTestStageControl,
  operation: (control: SiteTestStageControl) => Promise<T>
): Promise<T> {
  parentControl.signal.throwIfAborted();
  const controller = new AbortController();
  const timeoutError = new StageTimeoutError(parentControl.timeoutMs, stageName);
  const cancellationGraceMs = Math.min(
    2_000,
    Math.max(1, Math.floor(parentControl.timeoutMs / 4))
  );
  const operationBudgetMs = Math.max(
    1,
    parentControl.timeoutMs - cancellationGraceMs
  );
  let stageTimedOut = false;
  const propagateParentAbort = () => {
    controller.abort(parentControl.signal.reason);
  };
  parentControl.signal.addEventListener("abort", propagateParentAbort, {
    once: true
  });
  const cancellationTimer = setTimeout(() => {
    stageTimedOut = true;
    controller.abort(timeoutError);
  }, operationBudgetMs);
  cancellationTimer.unref?.();
  let rejectOnParentAbort: (() => void) | undefined;
  const parentAborted = new Promise<never>((_resolve, reject) => {
    rejectOnParentAbort = () => reject(parentControl.signal.reason);
    parentControl.signal.addEventListener("abort", rejectOnParentAbort, {
      once: true
    });
  });
  let stageDeadlineTimer: NodeJS.Timeout | undefined;
  const stageDeadline = new Promise<never>((_resolve, reject) => {
    stageDeadlineTimer = setTimeout(() => reject(timeoutError), parentControl.timeoutMs);
    stageDeadlineTimer.unref?.();
  });
  const pending = Promise.resolve().then(async () =>
    await operation({
      signal: controller.signal,
      timeoutMs: operationBudgetMs
    })
  );
  void pending.catch(() => undefined);
  try {
    const result = await Promise.race([pending, parentAborted, stageDeadline]);
    if (stageTimedOut) {
      throw timeoutError;
    }
    return result;
  } catch (error) {
    if (stageTimedOut) {
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(cancellationTimer);
    if (stageDeadlineTimer !== undefined) {
      clearTimeout(stageDeadlineTimer);
    }
    parentControl.signal.removeEventListener("abort", propagateParentAbort);
    if (rejectOnParentAbort !== undefined) {
      parentControl.signal.removeEventListener("abort", rejectOnParentAbort);
    }
  }
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
