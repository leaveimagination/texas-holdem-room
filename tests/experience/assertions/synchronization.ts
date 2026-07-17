import {
  HarnessInconclusiveError,
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
  projections: readonly ActorProjectionEvidence[];
}

export interface ActorProjectionEvidence {
  actor: string;
  projection: ViewProjection;
}

export interface ProjectionDivergence {
  monotonicMs: number;
  baselineActor: string;
  divergentActor: string;
  differingFields: Array<keyof ViewProjection>;
  baseline: ViewProjection;
  divergent: ViewProjection;
}

export interface ProjectionEvidenceIssue {
  monotonicMs: number | null;
  missingActors: string[];
  duplicateActors: string[];
  unexpectedActors: string[];
}

export type SynchronizationAssessment =
  | { status: "synchronized" }
  | { status: "divergent"; divergence: ProjectionDivergence }
  | { status: "inconclusive"; evidenceIssue: ProjectionEvidenceIssue };

const projectionFields: ReadonlyArray<keyof ViewProjection> = [
  "phase",
  "sequence",
  "handNumber",
  "street",
  "boardLength",
  "pot",
  "actor"
];

export function assessViewSynchronization(
  checkpoints: readonly ProjectionCheckpoint[],
  expectedActors: readonly string[]
): SynchronizationAssessment {
  const roster = [...new Set(expectedActors)];
  if (roster.length < 2 || roster.length !== expectedActors.length) {
    return {
      status: "inconclusive",
      evidenceIssue: {
        monotonicMs: null,
        missingActors: roster,
        duplicateActors: duplicates(expectedActors),
        unexpectedActors: []
      }
    };
  }
  if (checkpoints.length === 0) {
    return {
      status: "inconclusive",
      evidenceIssue: {
        monotonicMs: null,
        missingActors: roster,
        duplicateActors: [],
        unexpectedActors: []
      }
    };
  }

  for (const checkpoint of [...checkpoints].sort(
    (left, right) => left.monotonicMs - right.monotonicMs
  )) {
    const issue = projectionEvidenceIssue(checkpoint, roster);
    if (issue) {
      return { status: "inconclusive", evidenceIssue: issue };
    }
  }

  const divergence = findEarliestDivergentProjection(checkpoints);
  return divergence
    ? { status: "divergent", divergence }
    : { status: "synchronized" };
}

export function findEarliestDivergentProjection(
  checkpoints: readonly ProjectionCheckpoint[]
): ProjectionDivergence | null {
  for (const checkpoint of [...checkpoints].sort(
    (left, right) => left.monotonicMs - right.monotonicMs
  )) {
    const entries = checkpoint.projections;
    if (entries.length < 2) {
      continue;
    }
    const { actor: baselineActor, projection: baseline } = entries[0];
    for (const { actor: divergentActor, projection: divergent } of entries.slice(1)) {
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
  expectedActors: readonly string[],
  context: MechanicalAssertionContext
): void {
  const assessment = assessViewSynchronization(checkpoints, expectedActors);
  if (assessment.status === "inconclusive") {
    throw new HarnessInconclusiveError({
      ...context,
      reason: "missing, duplicate, or invalid cross-view actor evidence",
      details: assessment.evidenceIssue
    });
  }
  const divergence = assessment.status === "divergent"
    ? assessment.divergence
    : null;
  assertProductCondition(assessment.status === "synchronized", {
    ...context,
    earliestDivergentProjection: divergence,
    measuredValue: divergence?.differingFields ?? [],
    threshold: { expectedActors, comparison: "exact synchronized projection equality" }
  });
}

function projectionEvidenceIssue(
  checkpoint: ProjectionCheckpoint,
  expectedActors: readonly string[]
): ProjectionEvidenceIssue | null {
  const observedActors = checkpoint.projections.map(({ actor }) => actor);
  const expected = new Set(expectedActors);
  const missingActors = expectedActors.filter((actor) => !observedActors.includes(actor));
  const duplicateActors = duplicates(observedActors);
  const unexpectedActors = [...new Set(observedActors.filter((actor) => !expected.has(actor)))];
  return missingActors.length > 0 || duplicateActors.length > 0 || unexpectedActors.length > 0
    ? {
        monotonicMs: checkpoint.monotonicMs,
        missingActors,
        duplicateActors,
        unexpectedActors
      }
    : null;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicateValues = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicateValues.add(value);
    }
    seen.add(value);
  }
  return [...duplicateValues];
}
