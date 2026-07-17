import {
  assertProductCondition,
  type MechanicalAssertionContext
} from "../support/experience-test";

export interface ViewProjection {
  phase: string | null;
  sequence: number | null;
  handNumber: number | null;
  street: string | null;
  boardLength: number;
  pot: number;
  actor: string | null;
}

export interface ProjectionCheckpoint {
  monotonicMs: number;
  projections: Readonly<Record<string, ViewProjection>>;
}

export interface ProjectionDivergence {
  monotonicMs: number;
  baselineActor: string;
  divergentActor: string;
  differingFields: Array<keyof ViewProjection>;
  baseline: ViewProjection;
  divergent: ViewProjection;
}

const projectionFields: ReadonlyArray<keyof ViewProjection> = [
  "phase",
  "sequence",
  "handNumber",
  "street",
  "boardLength",
  "pot",
  "actor"
];

export function areViewsSynchronized(projections: readonly ViewProjection[]): boolean {
  if (projections.length < 2) {
    return true;
  }
  const baseline = projections[0];
  return projections.slice(1).every((projection) =>
    projectionFields.every((field) => projection[field] === baseline[field])
  );
}

export function findEarliestDivergentProjection(
  checkpoints: readonly ProjectionCheckpoint[]
): ProjectionDivergence | null {
  for (const checkpoint of [...checkpoints].sort(
    (left, right) => left.monotonicMs - right.monotonicMs
  )) {
    const entries = Object.entries(checkpoint.projections);
    if (entries.length < 2) {
      continue;
    }
    const [baselineActor, baseline] = entries[0];
    for (const [divergentActor, divergent] of entries.slice(1)) {
      const differingFields = projectionFields.filter(
        (field) => baseline[field] !== divergent[field]
      );
      if (differingFields.length > 0) {
        return {
          monotonicMs: checkpoint.monotonicMs,
          baselineActor,
          divergentActor,
          differingFields,
          baseline,
          divergent
        };
      }
    }
  }
  return null;
}

export function assertSynchronizedViews(
  checkpoints: readonly ProjectionCheckpoint[],
  context: MechanicalAssertionContext
): void {
  const divergence = findEarliestDivergentProjection(checkpoints);
  assertProductCondition(divergence === null, {
    ...context,
    earliestDivergentProjection: divergence,
    measuredValue: divergence?.differingFields ?? [],
    threshold: "exact synchronized projection equality"
  });
}
