import { EXPERIENCE_THRESHOLDS } from "../evidence/contracts";
import {
  assertProductCondition,
  type MechanicalAssertionContext
} from "../support/experience-test";

export function isLocalFeedbackTimely(elapsedMs: number): boolean {
  return isValidDuration(elapsedMs) && elapsedMs <= EXPERIENCE_THRESHOLDS.localFeedbackMs;
}

export function isCrossViewConvergenceTimely(elapsedMs: number): boolean {
  return isValidDuration(elapsedMs) && elapsedMs <= EXPERIENCE_THRESHOLDS.crossViewConvergenceMs;
}

export function isDeadStateWithinLimit(elapsedMs: number): boolean {
  return isValidDuration(elapsedMs) && elapsedMs <= EXPERIENCE_THRESHOLDS.unexplainedDeadStateMs;
}

export function isTimedPhaseWithinTolerance(
  measuredMs: number,
  expectedMs: number,
  toleranceMs = EXPERIENCE_THRESHOLDS.timedPhaseToleranceMs
): boolean {
  return isValidDuration(measuredMs) &&
    isValidDuration(expectedMs) &&
    isValidDuration(toleranceMs) &&
    Math.abs(measuredMs - expectedMs) <= toleranceMs;
}

function isValidDuration(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function assertLocalFeedback(
  elapsedMs: number,
  context: MechanicalAssertionContext,
  earliestDivergentProjection: unknown = null
): void {
  assertProductCondition(isLocalFeedbackTimely(elapsedMs), {
    ...context,
    earliestDivergentProjection,
    measuredValue: elapsedMs,
    threshold: EXPERIENCE_THRESHOLDS.localFeedbackMs
  });
}

export function assertCrossViewConvergence(
  elapsedMs: number,
  context: MechanicalAssertionContext,
  earliestDivergentProjection: unknown
): void {
  assertProductCondition(isCrossViewConvergenceTimely(elapsedMs), {
    ...context,
    earliestDivergentProjection,
    measuredValue: elapsedMs,
    threshold: EXPERIENCE_THRESHOLDS.crossViewConvergenceMs
  });
}

export function assertDeadStateDuration(
  elapsedMs: number,
  context: MechanicalAssertionContext,
  earliestDivergentProjection: unknown = null
): void {
  assertProductCondition(isDeadStateWithinLimit(elapsedMs), {
    ...context,
    earliestDivergentProjection,
    measuredValue: elapsedMs,
    threshold: EXPERIENCE_THRESHOLDS.unexplainedDeadStateMs
  });
}

export function assertTimedPhaseDuration(
  measuredMs: number,
  expectedMs: number,
  context: MechanicalAssertionContext,
  earliestDivergentProjection: unknown = null
): void {
  assertProductCondition(isTimedPhaseWithinTolerance(measuredMs, expectedMs), {
    ...context,
    earliestDivergentProjection,
    measuredValue: measuredMs,
    threshold: {
      expectedMs,
      toleranceMs: EXPERIENCE_THRESHOLDS.timedPhaseToleranceMs
    }
  });
}
