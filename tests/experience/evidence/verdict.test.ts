import { describe, expect, it } from "vitest";

import {
  EXPERIENCE_CASES,
  experienceAttemptIds,
  TWO_ATTEMPT_CASE_IDS
} from "../case-catalog";
import {
  ExperienceCaseManifestSchema,
  type CaseReport
} from "./contracts";
import { deriveCaseVerdict, deriveRunVerdict } from "./verdict";

const PASSING_RESULTS: CaseReport["results"] = {
  product: {
    status: "pass",
    summary: "All product assertions passed.",
    evidenceEventIds: []
  },
  harness: {
    status: "pass",
    summary: "Evidence capture was trustworthy.",
    evidenceEventIds: []
  },
  environment: {
    status: "pass",
    summary: "All dependencies were healthy.",
    evidenceEventIds: []
  }
};

function assertion(
  outcome: CaseReport["assertions"][number]["outcome"]
): CaseReport["assertions"][number] {
  return {
    id: "EXP-001-A01",
    outcome,
    evidenceEventIds: ["EXP-001-A-001-E-000001"],
    summary: `The product assertion was ${outcome}.`
  };
}

describe("experience case catalog", () => {
  it("contains exactly the ten approved immutable manifests", () => {
    expect(EXPERIENCE_CASES.map(({ caseId }) => caseId)).toEqual(
      Array.from({ length: 10 }, (_, index) =>
        `EXP-${String(index + 1).padStart(3, "0")}`
      )
    );

    for (const manifest of EXPERIENCE_CASES) {
      expect(ExperienceCaseManifestSchema.parse(manifest)).toEqual(manifest);
      expect(Object.isFrozen(manifest)).toBe(true);
      expect(Object.isFrozen(manifest.assertions)).toBe(true);
      expect(manifest.forbiddenOutcomes.length).toBeGreaterThan(0);
      expect(manifest.stopConditions.overallTimeoutMs).toBeGreaterThan(0);
      expect(manifest.stopConditions.noProgressTimeoutMs).toBeGreaterThan(0);
    }
  });

  it("uses globally unique mechanical assertion IDs", () => {
    const assertionIds = EXPERIENCE_CASES.flatMap(({ assertions }) =>
      assertions.map(({ id }) => id)
    );

    expect(new Set(assertionIds).size).toBe(assertionIds.length);
    expect(
      EXPERIENCE_CASES.every(({ caseId, assertions }) =>
        assertions.every(({ id }) => id.startsWith(`${caseId}-`))
      )
    ).toBe(true);
  });

  it("names every deterministic poker fixture", () => {
    const deterministicCaseIds = [
      "EXP-003",
      "EXP-004",
      "EXP-005",
      "EXP-006",
      "EXP-007",
      "EXP-008",
      "EXP-009"
    ];

    for (const caseId of deterministicCaseIds) {
      const manifest = EXPERIENCE_CASES.find((entry) => entry.caseId === caseId);
      expect(manifest?.fixture.path, caseId).toMatch(
        /^tests\/experience\/fixtures\/[a-z0-9-]+$/
      );
    }
  });

  it("declares only the approved real-time cases for two attempts", () => {
    expect([...TWO_ATTEMPT_CASE_IDS]).toEqual([
      "EXP-003",
      "EXP-004",
      "EXP-006",
      "EXP-008"
    ]);
    expect(
      Object.fromEntries(
        EXPERIENCE_CASES.map(({ caseId }) => [
          caseId,
          experienceAttemptIds(caseId)
        ])
      )
    ).toEqual({
      "EXP-001": ["A-001"],
      "EXP-002": ["A-001"],
      "EXP-003": ["A-001", "A-002"],
      "EXP-004": ["A-001", "A-002"],
      "EXP-005": ["A-001"],
      "EXP-006": ["A-001", "A-002"],
      "EXP-007": ["A-001"],
      "EXP-008": ["A-001", "A-002"],
      "EXP-009": ["A-001"],
      "EXP-010": ["A-001"]
    });
  });

  it("records the exact betting oracle and gates deployed smoke on isolated acceptance", () => {
    const normalBetting = EXPERIENCE_CASES.find(
      ({ caseId }) => caseId === "EXP-003"
    );
    const deployedSmoke = EXPERIENCE_CASES.find(
      ({ caseId }) => caseId === "EXP-010"
    );

    expect(normalBetting?.fixture.expectedFacts.join(" ")).toContain(
      "call, call, check; check, bet 20, raise to 40, fold, call; check, check; bet 20, call"
    );
    expect(
      deployedSmoke?.assertions.some(({ description }) =>
        /isolated acceptance.*pass/i.test(description)
      )
    ).toBe(true);
  });
});

describe("deriveCaseVerdict", () => {
  it("returns PASS when all three planes and product assertions pass", () => {
    expect(
      deriveCaseVerdict({
        results: PASSING_RESULTS,
        assertions: [assertion("pass")]
      })
    ).toBe("PASS");
  });

  it("returns FAIL only for a recorded failed product assertion", () => {
    expect(
      deriveCaseVerdict({
        results: {
          ...PASSING_RESULTS,
          product: {
            status: "fail",
            summary: "A product assertion was proven false.",
            evidenceEventIds: ["EXP-001-A-001-E-000001"]
          }
        },
        assertions: [assertion("fail")]
      })
    ).toBe("FAIL");

    expect(
      deriveCaseVerdict({
        results: {
          ...PASSING_RESULTS,
          product: {
            status: "fail",
            summary: "The browser runner exited unexpectedly.",
            evidenceEventIds: []
          }
        },
        assertions: [assertion("pass")]
      })
    ).toBe("INCONCLUSIVE");
  });

  it.each(["harness", "environment"] as const)(
    "returns INCONCLUSIVE for %s uncertainty",
    (plane) => {
      expect(
        deriveCaseVerdict({
          results: {
            ...PASSING_RESULTS,
            [plane]: {
              status: "inconclusive",
              summary: `${plane} evidence was incomplete.`,
              evidenceEventIds: []
            }
          },
          assertions: [assertion("pass")]
        })
      ).toBe("INCONCLUSIVE");
    }
  );

  it("gives INCONCLUSIVE precedence over an untrustworthy product failure", () => {
    expect(
      deriveCaseVerdict({
        results: {
          product: {
            status: "fail",
            summary: "A product assertion was proven false.",
            evidenceEventIds: ["EXP-001-A-001-E-000001"]
          },
          harness: {
            status: "fail",
            summary: "The evidence stream was truncated.",
            evidenceEventIds: []
          },
          environment: PASSING_RESULTS.environment
        },
        assertions: [assertion("fail")]
      })
    ).toBe("INCONCLUSIVE");
  });
});

describe("deriveRunVerdict", () => {
  it("ignores only the exact non-executed smoke gate when a product failure is proven", () => {
    const gated = {
      caseId: "EXP-010",
      attemptId: "A-001",
      results: PASSING_RESULTS,
      assertions: [assertion("inconclusive")],
      failures: [{
        code: "SMOKE_GATED_BY_ISOLATED_PRODUCT_FAILURE",
        summary: "gated",
        stage: "EXP-010-A05",
        evidenceEventIds: []
      }]
    };
    const failed = {
      caseId: "EXP-002",
      attemptId: "A-001",
      results: { ...PASSING_RESULTS, product: { status: "fail" as const, summary: "failed", evidenceEventIds: [] } },
      assertions: [assertion("fail")],
      failures: []
    };

    expect(deriveRunVerdict({ cases: [failed, gated], results: { ...PASSING_RESULTS, product: failed.results.product } }))
      .toBe("FAIL");
    expect(deriveRunVerdict({ cases: [{ ...gated, caseId: "EXP-009" }], results: PASSING_RESULTS }))
      .toBe("INCONCLUSIVE");
  });

  it("aggregates case evidence without trusting reported case verdicts", () => {
    const passingCase = {
      results: PASSING_RESULTS,
      assertions: [assertion("pass")]
    };
    const failingCase = {
      results: {
        ...PASSING_RESULTS,
        product: {
          status: "fail" as const,
          summary: "A product assertion was proven false.",
          evidenceEventIds: ["EXP-001-A-001-E-000001"]
        }
      },
      assertions: [assertion("fail")]
    };

    expect(
      deriveRunVerdict({ cases: [passingCase], results: PASSING_RESULTS })
    ).toBe("PASS");
    expect(
      deriveRunVerdict({ cases: [passingCase, failingCase], results: PASSING_RESULTS })
    ).toBe("FAIL");
  });

  it("gives run-level uncertainty precedence over product failures", () => {
    expect(
      deriveRunVerdict({
        cases: [
          {
            results: {
              ...PASSING_RESULTS,
              product: {
                status: "fail",
                summary: "A product assertion was proven false.",
                evidenceEventIds: ["EXP-001-A-001-E-000001"]
              }
            },
            assertions: [assertion("fail")]
          }
        ],
        results: {
          ...PASSING_RESULTS,
          environment: {
            status: "inconclusive",
            summary: "The database health check was lost.",
            evidenceEventIds: []
          }
        }
      })
    ).toBe("INCONCLUSIVE");
  });
});
