import type { CaseReport, OverallVerdict } from "./contracts";

export interface CaseVerdictInput {
  results: CaseReport["results"];
  assertions: readonly CaseReport["assertions"][number][];
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

  const caseVerdicts = input.cases.map(deriveCaseVerdict);
  if (caseVerdicts.includes("INCONCLUSIVE")) {
    return "INCONCLUSIVE";
  }
  if (caseVerdicts.includes("FAIL")) {
    return "FAIL";
  }

  return input.results.product.status === "pass" ? "PASS" : "INCONCLUSIVE";
}
