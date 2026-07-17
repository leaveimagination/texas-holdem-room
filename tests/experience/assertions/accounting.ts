import {
  assertProductCondition,
  type MechanicalAssertionContext
} from "../support/experience-test";

export function chipsAreConserved(input: {
  startingChips: readonly number[];
  appliedTopUps: readonly number[];
  endingChips: readonly number[];
}): boolean {
  return sum(input.startingChips) + sum(input.appliedTopUps) === sum(input.endingChips);
}

export function isHandNetBalanced(netChips: readonly number[]): boolean {
  return sum(netChips) === 0;
}

export function isSessionNetCorrect(input: {
  initialChips: number;
  appliedTopUpChips: number;
  finalChips: number;
  netChips: number;
}): boolean {
  return input.netChips === input.finalChips - input.initialChips - input.appliedTopUpChips;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function assertChipConservation(
  input: {
    startingChips: readonly number[];
    appliedTopUps: readonly number[];
    endingChips: readonly number[];
  },
  context: MechanicalAssertionContext
): void {
  assertProductCondition(chipsAreConserved(input), {
    ...context,
    earliestDivergentProjection: null,
    measuredValue: sum(input.endingChips),
    threshold: sum(input.startingChips) + sum(input.appliedTopUps)
  });
}

export function assertHandNetBalanced(
  netChips: readonly number[],
  context: MechanicalAssertionContext
): void {
  assertProductCondition(isHandNetBalanced(netChips), {
    ...context,
    earliestDivergentProjection: null,
    measuredValue: sum(netChips),
    threshold: 0
  });
}

export function assertSessionNetAccounting(
  input: {
    initialChips: number;
    appliedTopUpChips: number;
    finalChips: number;
    netChips: number;
  },
  context: MechanicalAssertionContext
): void {
  assertProductCondition(isSessionNetCorrect(input), {
    ...context,
    earliestDivergentProjection: null,
    measuredValue: input.netChips,
    threshold: input.finalChips - input.initialChips - input.appliedTopUpChips
  });
}
