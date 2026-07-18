import { runProcess, type ProcessResult } from "./process-runner";
import type { FinishCaseInput } from "../../tests/experience/evidence/recorder";

const DEFAULT_PRODUCTION_PROJECT = "texas-holdem";
const PRODUCTION_SERVICE = "app";

export type DockerCommandRunner = (
  command: string,
  args: readonly string[]
) => Promise<ProcessResult>;

export interface ProductionAppContainer {
  containerId: string;
  imageId: string;
}

export interface DiscoverProductionAppContainerOptions {
  expectedImageId: string;
  project?: string;
  run?: DockerCommandRunner;
}

export async function discoverProductionAppContainer(
  options: DiscoverProductionAppContainerOptions
): Promise<ProductionAppContainer> {
  const project = validatedProject(options.project ?? DEFAULT_PRODUCTION_PROJECT);
  const run = options.run ?? runProcess;
  const listed = await run("docker", [
    "ps",
    "--filter", "status=running",
    "--filter", `label=com.docker.compose.project=${project}`,
    "--filter", `label=com.docker.compose.service=${PRODUCTION_SERVICE}`,
    "--format", "{{.ID}}"
  ]);
  const containerIds = listed.stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
  if (containerIds.length !== 1) {
    throw new Error(
      `Expected exactly one running app container for Compose project ${project}; found ${containerIds.length}`
    );
  }

  const containerId = containerIds[0];
  const inspected = await run("docker", ["inspect", containerId]);
  const record = parseSingleInspection(inspected.stdout, containerId);
  const health = record.State?.Health?.Status;
  if (health !== "healthy") {
    throw new Error(`Discovered app container ${containerId} is not healthy (status=${health ?? "missing"})`);
  }
  if (record.Image !== options.expectedImageId) {
    throw new Error(
      `Discovered app container image ID mismatch: expected ${options.expectedImageId}, found ${record.Image ?? "missing"}`
    );
  }
  return { containerId, imageId: record.Image };
}

export function buildProductionCleanupCommand(input: {
  containerId: string;
  roomId: string;
  runId: string;
}): { command: "docker"; args: string[] } {
  for (const [name, value] of Object.entries(input)) {
    if (value.length === 0 || /[\r\n\0]/u.test(value)) {
      throw new Error(`${name} must be a non-empty exact identifier`);
    }
  }
  return {
    command: "docker",
    args: [
      "exec",
      "-e", "SITE_TEST_CLEANUP_ALLOWED=1",
      input.containerId,
      "./node_modules/.bin/tsx",
      "src/server/site-test-cleanup.ts",
      input.roomId,
      input.runId
    ]
  };
}

export async function runExactProductionCleanup(input: {
  containerId: string;
  roomId: string;
  runId: string;
  run?: DockerCommandRunner;
}): Promise<{ deleted: true; retainedReason: null; roomId: string; runId: string }> {
  const invocation = buildProductionCleanupCommand({
    containerId: input.containerId,
    roomId: input.roomId,
    runId: input.runId
  });
  const result = await (input.run ?? runProcess)(invocation.command, invocation.args);
  const line = result.stdout.trim().split(/\r?\n/u).at(-1) ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error("The deployed image did not return valid cleanup JSON; retaining the exact room", { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new Error("The deployed image did not return valid cleanup JSON; retaining the exact room");
  }
  if (parsed.roomId !== input.roomId || parsed.runId !== input.runId) {
    throw new Error("Cleanup result identity mismatch; retaining the exact room");
  }
  if (parsed.deleted !== true || parsed.retainedReason !== null) {
    const reason = typeof parsed.retainedReason === "string" ? parsed.retainedReason : "cleanup-not-proven";
    throw new Error(`Cleanup retained the exact room: ${reason}`);
  }
  return { deleted: true, retainedReason: null, roomId: input.roomId, runId: input.runId };
}

export function combineProductFailureWithRetainedCleanup(input: {
  productFailure: {
    assertionId: string;
    message: string;
    actor: string;
    measuredValue: unknown;
    threshold: unknown;
    artifactIds: readonly string[];
  };
  roomId: string;
  ownershipMarker: string;
  cleanupReason: string;
}): FinishCaseInput {
  return combineSmokeFailureWithRetainedCleanup({
    priorFailure: { kind: "product", ...input.productFailure },
    roomId: input.roomId,
    ownershipMarker: input.ownershipMarker,
    cleanupReason: input.cleanupReason
  });
}

export type SmokePriorFailure =
  | { kind: "timeout" | "harness"; message: string }
  | { kind: "product"; assertionId: string; message: string; actor: string; measuredValue: unknown; threshold: unknown; artifactIds: readonly string[] };

export function combineSmokeFailureWithRetainedCleanup(input: {
  priorFailure?: SmokePriorFailure;
  roomId: string;
  ownershipMarker: string;
  cleanupReason: string;
}): FinishCaseInput {
  const product = input.priorFailure?.kind === "product" ? input.priorFailure : undefined;
  const retentionDetails = {
    roomId: input.roomId,
    ownershipMarker: input.ownershipMarker,
    retainedReason: input.cleanupReason
  };
  const prior: FinishCaseInput = {
    verdict: product ? "FAIL" : "INCONCLUSIVE",
    results: {
      product: product
        ? { status: "fail", summary: product.message, evidenceEventIds: [] }
        : input.priorFailure
          ? { status: "inconclusive", summary: input.priorFailure.message, evidenceEventIds: [] }
          : { status: "pass", summary: "The public smoke journey passed before cleanup.", evidenceEventIds: [] },
      harness: { status: "pass", summary: "Prior smoke evidence was captured.", evidenceEventIds: [] },
      environment: { status: "pass", summary: "The deployed app was available.", evidenceEventIds: [] }
    },
    assertions: product ? [{
      id: product.assertionId,
      outcome: "fail",
      evidenceEventIds: [],
      summary: product.message,
      details: {
        actor: product.actor,
        measuredValue: product.measuredValue,
        threshold: product.threshold,
        artifactIds: [...product.artifactIds]
      }
    }] : [],
    failures: product ? [{
      code: "PRODUCT_ASSERTION_FAILED",
      summary: product.message,
      stage: product.assertionId,
      evidenceEventIds: []
    }] : input.priorFailure ? [{
      code: input.priorFailure.kind === "timeout" ? "HARNESS_TIMEOUT" : "HARNESS_RUNTIME_FAILURE",
      summary: input.priorFailure.message,
      stage: "attempt-runtime",
      evidenceEventIds: []
    }] : []
  };
  return augmentSmokeResultWithRetainedCleanup(prior, input);
}

export function augmentSmokeResultWithRetainedCleanup(
  prior: FinishCaseInput,
  input: { roomId: string; ownershipMarker: string; cleanupReason: string }
): FinishCaseInput {
  const retentionDetails = { roomId: input.roomId, ownershipMarker: input.ownershipMarker, retainedReason: input.cleanupReason };
  return {
    ...prior,
    verdict: prior.verdict === "FAIL" ? "FAIL" : "INCONCLUSIVE",
    results: {
      product: prior.results.product,
      harness: { status: "inconclusive", summary: `Exact cleanup could not be proven. Prior harness: ${prior.results.harness.summary}`, evidenceEventIds: [...(prior.results.harness.evidenceEventIds ?? [])] },
      environment: { status: "inconclusive", summary: input.cleanupReason, evidenceEventIds: [...(prior.results.environment.evidenceEventIds ?? [])] }
    },
    assertions: [
      ...prior.assertions.filter(({ id }) => id !== "EXP-010-A04"),
      { id: "EXP-010-A04", outcome: "inconclusive", evidenceEventIds: [], summary: input.cleanupReason, details: retentionDetails }
    ],
    failures: [...prior.failures, {
      code: "EXACT_CLEANUP_RETAINED",
      summary: input.cleanupReason,
      stage: "EXP-010-A04",
      evidenceEventIds: [],
      details: retentionDetails
    }]
  };
}

function validatedProject(project: string): string {
  if (project === DEFAULT_PRODUCTION_PROJECT) return project;
  if (!/^holdem-site-[a-z0-9][a-z0-9-]*$/u.test(project)) {
    throw new Error("A project override is allowed only for a disposable holdem-site-* validation stack");
  }
  return project;
}

function parseSingleInspection(stdout: string, containerId: string): {
  State?: { Health?: { Status?: string } };
  Image?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Docker returned invalid inspection JSON for ${containerId}`, { cause: error });
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0] !== "object" || parsed[0] === null) {
    throw new Error(`Docker returned an unexpected inspection result for ${containerId}`);
  }
  return parsed[0] as { State?: { Health?: { Status?: string } }; Image?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
