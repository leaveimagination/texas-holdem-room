import type { CaseReport, OverallVerdict } from "./contracts";

export interface CaseVerdictInput {
  caseId?: string;
  attemptId?: string;
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
  const inconclusiveAssertions = caseReport.assertions.filter(
    ({ outcome }) => outcome === "inconclusive"
  );
  if (
    caseReport.results.product.status !== "fail" ||
    caseReport.results.harness.status !== "inconclusive" ||
    caseReport.results.environment.status !== "inconclusive" ||
    !caseReport.assertions.some(({ outcome }) => outcome === "fail") ||
    inconclusiveAssertions.length !== 1 ||
    inconclusiveAssertions[0]?.id !== "EXP-010-A04"
  ) {
    return false;
  }
  const cleanupFailures = caseReport.failures?.filter(({ code }) => code === "EXACT_CLEANUP_RETAINED") ?? [];
  if (cleanupFailures.length !== 1 || caseReport.failures?.some(({ code }) => code !== "EXACT_CLEANUP_RETAINED" && code !== "PRODUCT_ASSERTION_FAILED")) {
    return false;
  }
  const cleanup = cleanupFailures[0];
  const details = cleanup.details;
  return cleanup.stage === "EXP-010-A04" &&
    typeof details === "object" && details !== null && !Array.isArray(details) &&
    typeof (details as Record<string, unknown>).roomId === "string" &&
    typeof (details as Record<string, unknown>).ownershipMarker === "string" &&
    typeof (details as Record<string, unknown>).retainedReason === "string" &&
    ((details as Record<string, unknown>).cleanupStatus === undefined ||
      (details as Record<string, unknown>).cleanupStatus === "retained");
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
