export interface ProductAssertionContext {
  assertionId: string;
  caseId: string;
  attemptId: string;
  actor: string;
  earliestDivergentProjection: unknown;
  measuredValue: unknown;
  threshold: unknown;
  artifactIds: readonly string[];
}

export type MechanicalAssertionContext = Pick<
  ProductAssertionContext,
  "assertionId" | "caseId" | "attemptId" | "actor" | "artifactIds"
>;

export interface HarnessInconclusiveContext extends MechanicalAssertionContext {
  reason: string;
  details: unknown;
}

export class HarnessInconclusiveError extends Error {
  readonly context: HarnessInconclusiveContext;

  constructor(context: HarnessInconclusiveContext) {
    super([
      `Harness assertion ${context.assertionId} is inconclusive`,
      `case=${context.caseId}`,
      `attempt=${context.attemptId}`,
      `actor=${context.actor}`,
      `reason=${context.reason}`,
      `details=${serializeDiagnostic(context.details)}`,
      `artifacts=${context.artifactIds.join(",") || "none"}`
    ].join("; "));
    this.name = "HarnessInconclusiveError";
    this.context = Object.freeze({
      ...context,
      artifactIds: Object.freeze([...context.artifactIds])
    });
  }
}

export class ProductAssertionError extends Error {
  readonly context: ProductAssertionContext;

  constructor(context: ProductAssertionContext) {
    super([
      `Product assertion ${context.assertionId} failed`,
      `case=${context.caseId}`,
      `attempt=${context.attemptId}`,
      `actor=${context.actor}`,
      `earliestDivergentProjection=${serializeDiagnostic(context.earliestDivergentProjection)}`,
      `measured=${serializeDiagnostic(context.measuredValue)}`,
      `threshold=${serializeDiagnostic(context.threshold)}`,
      `artifacts=${context.artifactIds.join(",") || "none"}`
    ].join("; "));
    this.name = "ProductAssertionError";
    this.context = Object.freeze({
      ...context,
      artifactIds: Object.freeze([...context.artifactIds])
    });
  }
}

export function assertProductCondition(
  condition: boolean,
  context: ProductAssertionContext
): asserts condition {
  if (!condition) {
    throw new ProductAssertionError(context);
  }
}

export async function observeProduct<T>(
  operation: () => Promise<T>,
  context: ProductAssertionContext
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isBoundedObservationTimeout(error)) {
      throw new ProductAssertionError(context);
    }
    throw error;
  }
}

function isBoundedObservationTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function serializeDiagnostic(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}
