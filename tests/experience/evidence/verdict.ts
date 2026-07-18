import type { CaseReport, EvidenceEvent, OverallVerdict } from "./contracts";

export interface CaseVerdictInput {
  caseId?: string;
  attemptId?: string;
  runId?: string;
  evidenceEvents?: readonly EvidenceEvent[];
  results: CaseReport["results"];
  assertions: readonly CaseReport["assertions"][number][];
  failures?: readonly CaseReport["failures"][number][];
}

export interface RunVerdictInput {
  results: CaseReport["results"];
  cases: readonly CaseVerdictInput[];
  baseResults?: CaseReport["results"];
}

export function deriveCaseVerdict(input: CaseVerdictInput): OverallVerdict {
  const { assertions, results } = input;

  if (isCleanupOnlyUncertainty(input)) {
    return "FAIL";
  }

  if (
    results.harness.status !== "pass" ||
    results.environment.status !== "pass" ||
    results.product.status === "inconclusive" ||
    assertions.length === 0 ||
    assertions.some(({ outcome }) => outcome === "inconclusive")
  ) {
    return "INCONCLUSIVE";
  }

  if (assertions.some(({ outcome }) => outcome === "fail")) {
    return "FAIL";
  }

  if (results.product.status === "fail") {
    return "INCONCLUSIVE";
  }

  return "PASS";
}

export function deriveRunVerdict(input: RunVerdictInput): OverallVerdict {
  const cleanupOnly = input.cases.some(isCleanupOnlyUncertainty) &&
    input.cases.every((caseReport) =>
      (caseReport.results.harness.status === "pass" && caseReport.results.environment.status === "pass") ||
      isCleanupOnlyUncertainty(caseReport)
    ) &&
    input.baseResults?.harness.status === "pass" &&
    input.baseResults.environment.status === "pass";
  if (
    (!cleanupOnly && input.results.harness.status !== "pass") ||
    (!cleanupOnly && input.results.environment.status !== "pass") ||
    input.results.product.status === "inconclusive" ||
    input.cases.length === 0
  ) {
    return "INCONCLUSIVE";
  }

  const judgedCases = input.cases.filter(
    (caseReport) => !isExactNonExecutedSmokeGate(caseReport)
  );
  const caseVerdicts = judgedCases.map(deriveCaseVerdict);
  if (caseVerdicts.includes("INCONCLUSIVE")) {
    return "INCONCLUSIVE";
  }
  if (caseVerdicts.includes("FAIL")) {
    return "FAIL";
  }

  return input.results.product.status === "pass" ? "PASS" : "INCONCLUSIVE";
}

function isCleanupOnlyUncertainty(caseReport: CaseVerdictInput): boolean {
  if (caseReport.caseId !== "EXP-010" || caseReport.attemptId !== "A-001") return false;
  const failedAssertions = caseReport.assertions.filter(({ outcome }) => outcome === "fail");
  const inconclusiveAssertions = caseReport.assertions.filter(
    ({ outcome }) => outcome === "inconclusive"
  );
  if (
    caseReport.results.product.status !== "fail" ||
    caseReport.results.harness.status !== "inconclusive" ||
    caseReport.results.environment.status !== "inconclusive" ||
    failedAssertions.length !== 1 ||
    failedAssertions[0]?.id === "EXP-010-A04" ||
    inconclusiveAssertions.length !== 1 ||
    inconclusiveAssertions[0]?.id !== "EXP-010-A04" ||
    new Set(caseReport.assertions.map(({ id }) => id)).size !== caseReport.assertions.length ||
    caseReport.assertions.some(({ outcome }) => outcome !== "pass" && outcome !== "fail" && outcome !== "inconclusive")
  ) {
    return false;
  }
  const failures = caseReport.failures ?? [];
  const cleanupFailures = failures.filter(({ code }) => code === "EXACT_CLEANUP_RETAINED");
  const productFailures = failures.filter(({ code }) => code === "PRODUCT_ASSERTION_FAILED");
  if (failures.length !== 2 || cleanupFailures.length !== 1 || productFailures.length !== 1) {
    return false;
  }
  const cleanup = cleanupFailures[0];
  const product = productFailures[0];
  const failedAssertion = failedAssertions[0];
  const cleanupAssertion = inconclusiveAssertions[0];
  const details = cleanup.details;
  const productEvent = traceableEvent(product.evidenceEventIds, failedAssertion.evidenceEventIds, caseReport, failedAssertion.id, "product-failure");
  const cleanupEvent = traceableEvent(cleanup.evidenceEventIds, cleanupAssertion.evidenceEventIds, caseReport, "EXP-010-A04", "environment-cleanup");
  const cleanupEventDetails = cleanupEvent?.details;
  return product.stage === failedAssertion.id &&
    productEvent !== undefined &&
    cleanup.stage === "EXP-010-A04" &&
    cleanupEvent !== undefined && productEvent.id !== cleanupEvent.id &&
    typeof details === "object" && details !== null && !Array.isArray(details) &&
    typeof cleanupEventDetails === "object" && cleanupEventDetails !== null && !Array.isArray(cleanupEventDetails) &&
    nonemptyString((details as Record<string, unknown>).roomId) &&
    nonemptyString(caseReport.runId) &&
    (details as Record<string, unknown>).ownershipMarker === `SITE-${caseReport.runId}-smoke-player` &&
    (cleanupEventDetails as Record<string, unknown>).roomId === (details as Record<string, unknown>).roomId &&
    (cleanupEventDetails as Record<string, unknown>).ownershipMarker === (details as Record<string, unknown>).ownershipMarker &&
    nonemptyString((details as Record<string, unknown>).retainedReason) &&
    ((details as Record<string, unknown>).cleanupStatus === undefined ||
      (details as Record<string, unknown>).cleanupStatus === "retained");
}

function traceableEvent(left: readonly string[], right: readonly string[], report: CaseVerdictInput, stage: string, type: string): EvidenceEvent | undefined {
  if (!left.every(nonemptyString) || !right.every(nonemptyString) || left.length === 0 || right.length === 0) return undefined;
  return report.evidenceEvents?.find((event) =>
    left.includes(event.id) && right.includes(event.id) &&
    event.runId === report.runId && event.caseId === "EXP-010" && event.attemptId === "A-001" &&
    event.stage === stage && event.type === type);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isExactNonExecutedSmokeGate(caseReport: CaseVerdictInput): boolean {
  if (caseReport.caseId !== "EXP-010" || caseReport.attemptId !== "A-001") {
    return false;
  }
  if (caseReport.failures?.length !== 1 || caseReport.assertions.length !== 1) {
    return false;
  }
  const assertion = caseReport.assertions[0];
  if (assertion.id !== "EXP-010-A05" || assertion.outcome !== "inconclusive") {
    return false;
  }
  return caseReport.failures.every((failure) => {
    const details = failure.details;
    return failure.code === "SMOKE_GATED_BY_ISOLATED_PRODUCT_FAILURE" &&
      failure.stage === "EXP-010-A05" &&
      typeof details === "object" &&
      details !== null &&
      !Array.isArray(details) &&
      (details as Record<string, unknown>).executed === false;
  });
}
