import { describe, expect, it } from "vitest";
import { EXPERIENCE_THRESHOLDS } from "../evidence/contracts";
import {
  areViewsSynchronized,
  assertSynchronizedViews,
  findEarliestDivergentProjection,
  type ViewProjection
} from "./synchronization";
import {
  assertCrossViewConvergence,
  assertDeadStateDuration,
  assertLocalFeedback,
  assertTimedPhaseDuration,
  isCrossViewConvergenceTimely,
  isDeadStateWithinLimit,
  isLocalFeedbackTimely,
  isTimedPhaseWithinTolerance
} from "./timing";
import {
  assertCenterPointHit,
  assertMinimumHitTarget,
  assertNoViewportOverflow,
  centerPoint,
  centerPointHitsTarget,
  hasMinimumHitTarget,
  hasViewportOverflow
} from "./layout";
import {
  assertChipConservation,
  assertHandNetBalanced,
  assertSessionNetAccounting,
  chipsAreConserved,
  isHandNetBalanced,
  isSessionNetCorrect
} from "./accounting";
import { assertPrivateCardsAuthorized, classifyPrivateCardVisibility } from "./privacy";
import { ProductAssertionError } from "../support/experience-test";

const synchronized: ViewProjection = {
  phase: "betting",
  sequence: 7,
  handNumber: 3,
  street: "flop",
  boardLength: 3,
  pot: 180,
  actor: "p2"
};

describe("mechanical experience assertions", () => {
  it("compares synchronized view fields and reports the earliest divergent checkpoint", () => {
    expect(areViewsSynchronized([synchronized, { ...synchronized }])).toBe(true);
    expect(areViewsSynchronized([synchronized, { ...synchronized, pot: 200 }])).toBe(false);

    expect(findEarliestDivergentProjection([
      { monotonicMs: 30, projections: { host: synchronized, player: { ...synchronized, pot: 200 } } },
      { monotonicMs: 10, projections: { host: synchronized, player: { ...synchronized } } },
      { monotonicMs: 20, projections: { host: synchronized, player: { ...synchronized, actor: "p3" } } }
    ])).toEqual({
      monotonicMs: 20,
      baselineActor: "host",
      divergentActor: "player",
      differingFields: ["actor"],
      baseline: synchronized,
      divergent: { ...synchronized, actor: "p3" }
    });
  });

  it("treats the 800ms, 1000ms, and 3000ms limits as inclusive boundaries", () => {
    expect(isLocalFeedbackTimely(800)).toBe(true);
    expect(isLocalFeedbackTimely(801)).toBe(false);
    expect(isCrossViewConvergenceTimely(1_000)).toBe(true);
    expect(isCrossViewConvergenceTimely(1_001)).toBe(false);
    expect(isDeadStateWithinLimit(3_000)).toBe(true);
    expect(isDeadStateWithinLimit(3_001)).toBe(false);
    expect(isLocalFeedbackTimely(-1)).toBe(false);
    expect(isCrossViewConvergenceTimely(Number.NaN)).toBe(false);
    expect(EXPERIENCE_THRESHOLDS).toMatchObject({
      localFeedbackMs: 800,
      crossViewConvergenceMs: 1_000,
      unexplainedDeadStateMs: 3_000
    });
  });

  it("raises a product-only failure with complete mechanical assertion diagnostics", () => {
    expect(() => assertCrossViewConvergence(1_001, {
      assertionId: "EXP-003-A03",
      caseId: "EXP-003",
      attemptId: "A-001",
      actor: "player-2",
      artifactIds: ["SHOT-1", "TRACE-1"]
    }, { sequence: 7, pot: 180 })).toThrow(
      /case=EXP-003.*attempt=A-001.*actor=player-2.*earliestDivergentProjection=.*measured=1001.*threshold=1000.*artifacts=SHOT-1,TRACE-1/i
    );
  });

  it("routes every mechanical failure through ProductAssertionError", () => {
    const context = {
      assertionId: "EXP-009-A03",
      caseId: "EXP-009",
      attemptId: "A-001",
      actor: "mobile-player",
      artifactIds: ["SHOT-MOBILE"]
    };
    const failures = [
      () => assertSynchronizedViews([{ monotonicMs: 10, projections: { host: synchronized, player: { ...synchronized, pot: 181 } } }], context),
      () => assertLocalFeedback(801, context),
      () => assertDeadStateDuration(3_001, context),
      () => assertTimedPhaseDuration(2_401, 2_000, context),
      () => assertMinimumHitTarget({ width: 43, height: 44 }, context),
      () => assertNoViewportOverflow({ scrollWidth: 391, clientWidth: 390 }, context),
      () => assertCenterPointHit(
        { left: 10, top: 20, width: 44, height: 44 },
        hitTestResult({ x: 32, y: 42 }, false),
        context
      ),
      () => assertChipConservation({ startingChips: [100], appliedTopUps: [], endingChips: [99] }, context),
      () => assertHandNetBalanced([10, -9], context),
      () => assertSessionNetAccounting({ initialChips: 100, appliedTopUpChips: 50, finalChips: 175, netChips: 75 }, context),
      () => assertPrivateCardsAuthorized({ visible: true, viewerRole: "spectator", ownerParticipantId: "p1" }, context)
    ];

    for (const failure of failures) {
      expect(failure).toThrow(ProductAssertionError);
    }
  });

  it("accepts timed phases at exactly plus or minus 400ms", () => {
    expect(isTimedPhaseWithinTolerance(1_600, 2_000)).toBe(true);
    expect(isTimedPhaseWithinTolerance(2_400, 2_000)).toBe(true);
    expect(isTimedPhaseWithinTolerance(1_599, 2_000)).toBe(false);
    expect(isTimedPhaseWithinTolerance(2_401, 2_000)).toBe(false);
  });

  it("checks 44x44 hit boxes, overflow, and center-point hit testing", () => {
    expect(hasMinimumHitTarget({ width: 44, height: 44 })).toBe(true);
    expect(hasMinimumHitTarget({ width: 43.99, height: 44 })).toBe(false);
    expect(hasViewportOverflow({ scrollWidth: 390, clientWidth: 390 })).toBe(false);
    expect(hasViewportOverflow({ scrollWidth: 391, clientWidth: 390 })).toBe(true);

    const target = { left: 10, top: 20, width: 44, height: 50 };
    expect(centerPoint(target)).toEqual({ x: 32, y: 45 });
    expect(centerPointHitsTarget(target, hitTestResult({ x: 32, y: 45 }, true))).toBe(true);
    expect(centerPointHitsTarget(target, hitTestResult({ x: 32, y: 45 }, false))).toBe(false);
    expect(centerPointHitsTarget(target, hitTestResult({ x: 31, y: 45 }, true))).toBe(false);
  });

  it("proves chip conservation and per-hand and session net accounting", () => {
    expect(chipsAreConserved({
      startingChips: [1_000, 1_000, 1_000],
      appliedTopUps: [500],
      endingChips: [1_300, 1_100, 1_100]
    })).toBe(true);
    expect(chipsAreConserved({
      startingChips: [1_000, 1_000],
      appliedTopUps: [],
      endingChips: [900, 1_099]
    })).toBe(false);
    expect(isHandNetBalanced([120, -80, -40])).toBe(true);
    expect(isHandNetBalanced([120, -80, -39])).toBe(false);
    expect(isSessionNetCorrect({ initialChips: 1_000, appliedTopUpChips: 500, finalChips: 1_700, netChips: 200 })).toBe(true);
    expect(isSessionNetCorrect({ initialChips: 1_000, appliedTopUpChips: 500, finalChips: 1_700, netChips: 700 })).toBe(false);
  });

  it("classifies private-card visibility without exposing card values", () => {
    expect(classifyPrivateCardVisibility({
      visible: false,
      viewerRole: "spectator",
      ownerParticipantId: "p1"
    })).toBe("hidden");
    expect(classifyPrivateCardVisibility({
      visible: true,
      viewerRole: "spectator",
      ownerParticipantId: "p1"
    })).toBe("leak");
    expect(classifyPrivateCardVisibility({
      visible: true,
      viewerRole: "spectator",
      viewerParticipantId: "p1",
      ownerParticipantId: "p1"
    })).toBe("leak");
    expect(classifyPrivateCardVisibility({
      visible: true,
      viewerRole: "spectator",
      ownerParticipantId: "p1",
      showdown: true
    })).toBe("authorized");
    expect(classifyPrivateCardVisibility({
      visible: true,
      viewerRole: "player",
      viewerParticipantId: "p1",
      ownerParticipantId: "p1"
    })).toBe("authorized");
    expect(classifyPrivateCardVisibility({
      visible: true,
      viewerRole: "player",
      viewerParticipantId: "p2",
      ownerParticipantId: "p1",
      showdown: true,
      ownerFolded: true
    })).toBe("leak");
    expect(classifyPrivateCardVisibility({
      visible: true,
      viewerRole: "player",
      viewerParticipantId: "p2",
      ownerParticipantId: "p1",
      showdown: true,
      ruleRevealed: true
    })).toBe("authorized");
  });
});

function hitTestResult(point: { x: number; y: number }, targetOrDescendantHit: boolean) {
  const hitElement = { contains: () => false };
  const targetElement = {
    contains: (candidate: unknown) => targetOrDescendantHit && candidate === hitElement
  };
  return {
    point,
    targetElement,
    elementFromPoint: hitElement
  };
}
