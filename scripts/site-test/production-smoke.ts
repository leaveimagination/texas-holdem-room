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
  const product = input.productFailure;
  const retentionDetails = {
    roomId: input.roomId,
    ownershipMarker: input.ownershipMarker,
    retainedReason: input.cleanupReason
  };
  return {
    verdict: "FAIL",
    results: {
      product: { status: "fail", summary: product.message, evidenceEventIds: [] },
      harness: {
        status: "inconclusive",
        summary: "Exact cleanup could not be proven after the product failure.",
        evidenceEventIds: []
      },
      environment: {
        status: "inconclusive",
        summary: input.cleanupReason,
        evidenceEventIds: []
      }
    },
    assertions: [{
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
    }],
    failures: [{
      code: "PRODUCT_ASSERTION_FAILED",
      summary: product.message,
      stage: product.assertionId,
      evidenceEventIds: []
    }, {
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
