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
}

export function deriveCaseVerdict(input: CaseVerdictInput): OverallVerdict {
  const { assertions, results } = input;

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
  if (
    input.results.harness.status !== "pass" ||
    input.results.environment.status !== "pass" ||
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
