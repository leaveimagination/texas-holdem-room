import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { experienceAttemptIds } from "../../tests/experience/case-catalog";
import {
  CaseReportSchema,
  EvidenceEventSchema,
  type ArtifactRecord,
  type CaseReport,
  type EvidenceEvent,
  type PlaneResultInput,
  type RunResourceRecord
} from "../../tests/experience/evidence/contracts";
import type { WriteExperienceReportInput } from "../../tests/experience/evidence/report-writer";
import type { DockerSiteTestStackSnapshot } from "./docker-stack";
import {
  EnvironmentStageError,
  OverallDeadlineError,
  SITE_TEST_FINALIZATION_RESERVE_MS,
  SITE_TEST_HARD_DEADLINE_MS,
  type CollectedCaseEvidence,
  type ProductFailureInjection,
  type SiteTestDiagnostics,
  type SiteTestRunContext,
  type SiteTestStageControl
} from "./runner-contracts";

export async function injectProductFailureEvidence(
  context: SiteTestRunContext,
  evidence: CollectedCaseEvidence,
  injection: ProductFailureInjection,
  control?: SiteTestStageControl
): Promise<CollectedCaseEvidence> {
  control?.signal.throwIfAborted();
  const artifactId = `${injection.caseId}-${injection.attemptId}-INJECTED-ARTIFACT`;
  const eventId = `${injection.caseId}-${injection.attemptId}-INJECTED-EVENT`;
  const assertionId = `${injection.caseId}-INJECTED-PRODUCT-FAILURE`;
  const artifactPath = `diagnostics/injected-product-failure-${injection.caseId}-${injection.attemptId}.txt`;
  await mkdir(join(context.outputRoot, "diagnostics"), { recursive: true });
  await writeFile(
    join(context.outputRoot, ...artifactPath.split("/")),
    `Deliberate product failure for harness verification: ${injection.caseId}/${injection.attemptId}\n`,
    { encoding: "utf8", signal: control?.signal }
  );

  const existing = evidence.cases.find(
    ({ caseId, attemptId }) =>
      caseId === injection.caseId && attemptId === injection.attemptId
  );
  const startedAt = existing?.startedAt ?? context.startedAt;
  const targetEvents = evidence.events.filter(
    ({ caseId, attemptId }) =>
      caseId === injection.caseId && attemptId === injection.attemptId
  );
  const event: EvidenceEvent = EvidenceEventSchema.parse({
    id: eventId,
    runId: context.runId,
    caseId: injection.caseId,
    attemptId: injection.attemptId,
    actor: "runner",
    seq: Math.max(0, ...targetEvents.map(({ seq }) => seq)) + 1,
    timestamp: new Date().toISOString(),
    monotonicMs: Math.max(0, ...targetEvents.map(({ monotonicMs }) => monotonicMs)) + 1,
    stage: assertionId,
    type: "injected-product-assertion",
    status: "fail",
    details: { deliberateHarnessVerification: true },
    artifactIds: [artifactId]
  });
  const artifact: ArtifactRecord = {
    id: artifactId,
    path: artifactPath,
    description: "Deliberate product-failure injection evidence",
    kind: "diagnostic",
    mediaType: "text/plain",
    required: true,
    metadata: { deliberateHarnessVerification: true }
  };
  const report: CaseReport = CaseReportSchema.parse({
    schemaVersion: "1.0",
    runId: context.runId,
    caseId: injection.caseId,
    attemptId: injection.attemptId,
    startedAt,
    finishedAt: new Date().toISOString(),
    verdict: "FAIL",
    results: {
      product: {
        status: "fail",
        summary: "A deliberate product assertion failure was injected.",
        evidenceEventIds: [eventId]
      },
      harness: {
        status: "pass",
        summary: "The harness recorded the deliberate product assertion and artifact.",
        evidenceEventIds: [eventId]
      },
      environment: existing?.results.environment ?? {
        status: "pass",
        summary: "The environment remained healthy during injection.",
        evidenceEventIds: []
      }
    },
    assertions: [
      ...(existing?.assertions ?? []),
      {
        id: assertionId,
        outcome: "fail",
        evidenceEventIds: [eventId],
        summary: "Deliberate product failure for harness verification.",
        details: { artifactIds: [artifactId] }
      }
    ],
    failures: [
      ...(existing?.failures ?? []),
      {
        code: "PRODUCT_ASSERTION_FAILED",
        summary: "Deliberate product failure for harness verification.",
        stage: assertionId,
        evidenceEventIds: [eventId],
        details: { artifactIds: [artifactId] }
      }
    ],
    artifacts: [...(existing?.artifacts ?? []), artifact]
  });

  return mergeEvidence(
    {
      cases: evidence.cases.filter(
        ({ caseId, attemptId }) =>
          caseId !== injection.caseId || attemptId !== injection.attemptId
      ),
      events: evidence.events.filter(({ id }) => id !== eventId),
      issues: evidence.issues
    },
    { cases: [report], events: [event] }
  );
}

export function passingRunResults(): WriteExperienceReportInput["runResults"] {
  return {
    product: { status: "pass", summary: "All selected product cases were evaluated." },
    harness: { status: "pass", summary: "The site test harness completed reliably." },
    environment: { status: "pass", summary: "All isolated dependencies were healthy." }
  };
}

export function reportInput(
  context: SiteTestRunContext,
  evidence: CollectedCaseEvidence,
  resources: readonly RunResourceRecord[],
  runResults: WriteExperienceReportInput["runResults"],
  finishedAt: string
): WriteExperienceReportInput {
  return {
    outputRoot: context.outputRoot,
    runId: context.runId,
    startedAt: context.startedAt,
    finishedAt,
    cases: evidence.cases,
    events: evidence.events,
    resources,
    runResults,
    knownSecrets: context.knownSecrets
  };
}

export function mergeEvidence(
  current: CollectedCaseEvidence,
  incoming: CollectedCaseEvidence
): CollectedCaseEvidence {
  const cases = new Map<string, CaseReport>();
  for (const report of [...current.cases, ...incoming.cases]) {
    cases.set(caseKey(report.caseId, report.attemptId), report);
  }
  const events = new Map<string, EvidenceEvent>();
  for (const event of [...current.events, ...incoming.events]) {
    events.set(event.id, event);
  }
  return {
    cases: [...cases.values()],
    events: [...events.values()],
    issues: [...(current.issues ?? []), ...(incoming.issues ?? [])]
  };
}

export function ensureAttemptEvidence(
  context: SiteTestRunContext,
  evidence: CollectedCaseEvidence,
  caseIds: readonly string[],
  runResults: WriteExperienceReportInput["runResults"],
  stage: string,
  summary = "A selected attempt did not produce a durable case report."
): CollectedCaseEvidence {
  let result = evidence;
  for (const caseId of caseIds) {
    for (const attemptId of experienceAttemptIds(caseId)) {
      if (
        result.cases.some(
          (report) => report.caseId === caseId && report.attemptId === attemptId
        )
      ) {
        continue;
      }
      markHarnessInconclusive(runResults, undefined, summary);
      result = mergeEvidence(
        result,
        syntheticInconclusiveEvidence(
          context,
          caseId,
          attemptId,
          stage,
          summary,
          "harness"
        )
      );
    }
  }
  return result;
}

export function syntheticInconclusiveEvidence(
  context: SiteTestRunContext,
  caseId: string,
  attemptId: string,
  stage: string,
  summary: string,
  plane: "harness" | "environment"
): CollectedCaseEvidence {
  const eventId = `${caseId}-${attemptId}-RUNNER-INCONCLUSIVE`;
  const event: EvidenceEvent = {
    id: eventId,
    runId: context.runId,
    caseId,
    attemptId,
    actor: "runner",
    seq: 1,
    timestamp: new Date().toISOString(),
    monotonicMs: 0,
    stage,
    type: "runner-stage-failure",
    status: "inconclusive",
    details: { summary },
    artifactIds: []
  };
  const pass = (message: string): PlaneResultInput => ({ status: "pass", summary: message });
  const inconclusive = (message: string): PlaneResultInput => ({
    status: "inconclusive",
    summary: message,
    evidenceEventIds: [eventId]
  });
  const report = CaseReportSchema.parse({
    schemaVersion: "1.0",
    runId: context.runId,
    caseId,
    attemptId,
    startedAt: context.startedAt,
    finishedAt: new Date().toISOString(),
    verdict: "INCONCLUSIVE",
    results: {
      product: inconclusive("Product behavior could not be judged."),
      harness: plane === "harness" ? inconclusive(summary) : pass("Harness recorded the failure."),
      environment:
        plane === "environment" ? inconclusive(summary) : pass("No environment failure was observed.")
    },
    assertions: [
      {
        id: `${caseId}-RUNNER-INCONCLUSIVE`,
        outcome: "inconclusive",
        evidenceEventIds: [eventId],
        summary
      }
    ],
    failures: [
      {
        code: plane === "environment" ? "ENVIRONMENT_FAILURE" : "HARNESS_RUNTIME_FAILURE",
        summary,
        stage,
        evidenceEventIds: [eventId]
      }
    ],
    artifacts: []
  });
  return { cases: [report], events: [event] };
}

export function syntheticSmokeGatedEvidence(
  context: SiteTestRunContext,
  summary: string
): CollectedCaseEvidence {
  const caseId = "EXP-010";
  const attemptId = "A-001";
  const eventId = `${caseId}-${attemptId}-SMOKE-GATED`;
  const event: EvidenceEvent = {
    id: eventId,
    runId: context.runId,
    caseId,
    attemptId,
    actor: "runner",
    seq: 1,
    timestamp: new Date().toISOString(),
    monotonicMs: 0,
    stage: "EXP-010-A05",
    type: "smoke-gate",
    status: "inconclusive",
    details: { executed: false, reason: summary },
    artifactIds: []
  };
  const report = CaseReportSchema.parse({
    schemaVersion: "1.0",
    runId: context.runId,
    caseId,
    attemptId,
    startedAt: context.startedAt,
    finishedAt: event.timestamp,
    verdict: "INCONCLUSIVE",
    results: {
      product: { status: "pass", summary: "No deployed-smoke product assertion was executed." },
      harness: { status: "pass", summary: "The runner correctly enforced the isolated acceptance gate.", evidenceEventIds: [eventId] },
      environment: { status: "pass", summary: "No smoke-target environment assertion was required." }
    },
    assertions: [{
      id: "EXP-010-A05",
      outcome: "inconclusive",
      evidenceEventIds: [eventId],
      summary
    }],
    failures: [{
      code: "SMOKE_GATED_BY_ISOLATED_PRODUCT_FAILURE",
      summary,
      stage: "EXP-010-A05",
      evidenceEventIds: [eventId],
      details: { executed: false }
    }],
    artifacts: []
  });
  return { cases: [report], events: [event] };
}

export function selectedCasesPassed(
  evidence: CollectedCaseEvidence,
  caseIds: readonly string[]
): boolean {
  return caseIds.every((caseId) =>
    experienceAttemptIds(caseId).every((attemptId) =>
      evidence.cases.some(
        (report) =>
          report.caseId === caseId &&
          report.attemptId === attemptId &&
          report.verdict === "PASS"
      )
    )
  );
}

export function addCollectionIssues(
  collected: CollectedCaseEvidence,
  diagnostics: SiteTestDiagnostics,
  runResults: WriteExperienceReportInput["runResults"]
): void {
  for (const issue of collected.issues ?? []) {
    markHarnessInconclusive(runResults, diagnostics, issue.message);
  }
}

export function resourceRecords(
  snapshot: DockerSiteTestStackSnapshot
): RunResourceRecord[] {
  return snapshot.services.map((service) => ({
    runId: snapshot.runId,
    resourceType: "docker-container",
    resourceId: service.containerId,
    ownerRunId: snapshot.runId,
    cleanupStatus: "pending",
    details: {
      composeProject: snapshot.projectName,
      service: service.service,
      imageId: service.imageId
    }
  }));
}

export function markHarnessInconclusive(
  runResults: WriteExperienceReportInput["runResults"],
  diagnostics: SiteTestDiagnostics | undefined,
  summary: string,
  recordDiagnostic = true
): void {
  runResults.harness = { status: "inconclusive", summary };
  runResults.product = {
    status: "inconclusive",
    summary: "Product behavior could not be fully judged because the harness was inconclusive."
  };
  if (recordDiagnostic) {
    diagnostics?.issues.push(summary);
  }
}

export function markEnvironmentInconclusive(
  runResults: WriteExperienceReportInput["runResults"],
  summary: string
): void {
  runResults.environment = { status: "inconclusive", summary };
  runResults.product = {
    status: "inconclusive",
    summary: "Product behavior could not be fully judged because the environment was inconclusive."
  };
}

export function environmentError(error: unknown, stage: string): EnvironmentStageError {
  if (error instanceof EnvironmentStageError) {
    return error;
  }
  return new EnvironmentStageError(errorMessage(error), stage, { cause: error });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRetainedCleanupError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "retained" in error &&
    error.retained === true;
}

export function playwrightBudget(remainingMs: number): number {
  const budget = Math.floor(remainingMs - SITE_TEST_FINALIZATION_RESERVE_MS);
  if (budget <= 0) {
    throw new OverallDeadlineError(SITE_TEST_HARD_DEADLINE_MS);
  }
  return budget;
}

function caseKey(caseId: string, attemptId: string): string {
  return `${caseId}/${attemptId}`;
}
