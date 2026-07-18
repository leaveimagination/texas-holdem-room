import { describe, expect, test, vi } from "vitest";

import {
  buildProductionCleanupCommand,
  combineProductFailureWithRetainedCleanup,
  discoverProductionAppContainer,
  runExactProductionCleanup,
  type DockerCommandRunner
} from "../../scripts/site-test/production-smoke";

describe("production smoke container discovery", () => {
  test("discovers the one running default production app by exact Compose labels", async () => {
    const run = scriptedDocker([
      { stdout: "app-123\n" },
      { stdout: JSON.stringify([{ State: { Health: { Status: "healthy" } }, Image: "sha256:image-1" }]) }
    ]);

    await expect(discoverProductionAppContainer({ expectedImageId: "sha256:image-1", run }))
      .resolves.toEqual({ containerId: "app-123", imageId: "sha256:image-1" });
    expect(run).toHaveBeenNthCalledWith(1, "docker", [
      "ps", "--filter", "status=running",
      "--filter", "label=com.docker.compose.project=texas-holdem",
      "--filter", "label=com.docker.compose.service=app",
      "--format", "{{.ID}}"
    ]);
  });

  test.each(["", "app-1\napp-2\n"])("rejects zero or multiple production app matches: %j", async (stdout) => {
    await expect(discoverProductionAppContainer({
      expectedImageId: "sha256:image-1",
      run: scriptedDocker([{ stdout }])
    })).rejects.toThrow(/exactly one running app container/);
  });

  test.each([
    [{ State: { Health: { Status: "unhealthy" } }, Image: "sha256:image-1" }, /not healthy/],
    [{ State: { Health: { Status: "healthy" } }, Image: "sha256:other" }, /image ID mismatch/]
  ])("rejects an unsafe discovered container", async (inspection, message) => {
    await expect(discoverProductionAppContainer({
      expectedImageId: "sha256:image-1",
      run: scriptedDocker([{ stdout: "app-123\n" }, { stdout: JSON.stringify([inspection]) }])
    })).rejects.toThrow(message);
  });

  test("allows an explicit disposable project override without weakening the default", async () => {
    const run = scriptedDocker([
      { stdout: "disposable-app\n" },
      { stdout: JSON.stringify([{ State: { Health: { Status: "healthy" } }, Image: "sha256:unique" }]) }
    ]);
    await discoverProductionAppContainer({
      project: "holdem-site-task11-ab12cd",
      expectedImageId: "sha256:unique",
      run
    });
    expect(run).toHaveBeenNthCalledWith(1, "docker", expect.arrayContaining([
      "label=com.docker.compose.project=holdem-site-task11-ab12cd"
    ]));
  });
});

describe("production smoke exact cleanup command", () => {
  test("uses a docker exec argument array with the cleanup marker and exact identifiers", () => {
    expect(buildProductionCleanupCommand({
      containerId: "app-123",
      roomId: "room;not-shell",
      runId: "run$(not-shell)"
    })).toEqual({
      command: "docker",
      args: [
        "exec", "-e", "SITE_TEST_CLEANUP_ALLOWED=1", "app-123",
        "./node_modules/.bin/tsx", "src/server/site-test-cleanup.ts",
        "room;not-shell", "run$(not-shell)"
      ]
    });
  });

  test("accepts only a matching JSON result that deleted the exact room", async () => {
    const run = scriptedDocker([{
      stdout: `${JSON.stringify({ deleted: true, retainedReason: null, roomId: "room-1", runId: "run-1" })}\n`
    }]);
    await expect(runExactProductionCleanup({
      containerId: "app-123", roomId: "room-1", runId: "run-1", run
    })).resolves.toMatchObject({ deleted: true, roomId: "room-1", runId: "run-1" });
  });

  test.each([
    ["not-json", /valid cleanup JSON/],
    [JSON.stringify({ deleted: false, retainedReason: "ownership-marker-not-found", roomId: "room-1", runId: "run-1" }), /ownership-marker-not-found/],
    [JSON.stringify({ deleted: true, retainedReason: null, roomId: "other", runId: "run-1" }), /identity mismatch/]
  ])("retains the exact room when cleanup cannot be proven", async (stdout, message) => {
    await expect(runExactProductionCleanup({
      containerId: "app-123", roomId: "room-1", runId: "run-1",
      run: scriptedDocker([{ stdout }])
    })).rejects.toThrow(message);
  });
});

test("keeps a proven product FAIL while reporting exact retained cleanup", () => {
  const result = combineProductFailureWithRetainedCleanup({
    productFailure: {
      assertionId: "EXP-010-A03",
      message: "seat claim failed",
      actor: "player",
      measuredValue: false,
      threshold: true,
      artifactIds: []
    },
    roomId: "room-1",
    ownershipMarker: "SITE-run-1-smoke-player",
    cleanupReason: "ownership-marker-not-found"
  });
  expect(result.verdict).toBe("FAIL");
  expect(result.results.product.status).toBe("fail");
  expect(result.results.environment.status).toBe("inconclusive");
  expect(result.failures).toContainEqual(expect.objectContaining({
    code: "EXACT_CLEANUP_RETAINED",
    details: expect.objectContaining({ roomId: "room-1" })
  }));
});

function scriptedDocker(outputs: Array<{ stdout: string; stderr?: string; exitCode?: number }>): DockerCommandRunner {
  return vi.fn(async () => {
    const next = outputs.shift();
    if (!next) throw new Error("Unexpected Docker call");
    return { exitCode: next.exitCode ?? 0, stdout: next.stdout, stderr: next.stderr ?? "" };
  });
}
