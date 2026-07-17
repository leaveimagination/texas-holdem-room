import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const forbiddenAdapters = vi.hoisted(() => ({
  browserLaunch: vi.fn(),
  prisma: vi.fn(),
  redis: vi.fn()
}));

vi.mock("@playwright/test", () => ({
  chromium: { launch: forbiddenAdapters.browserLaunch }
}));
vi.mock("@prisma/client", () => ({ PrismaClient: forbiddenAdapters.prisma }));
vi.mock("ioredis", () => ({ default: forbiddenAdapters.redis }));

import {
  inspectDefaultBrowserVersion,
  persistDefaultDiagnostics,
  persistDefaultRetainedResources,
  preflightDefaultStack
} from "../../scripts/site-test/runner-defaults";
import { injectProductFailureEvidence } from "../../scripts/site-test/runner-evidence";
import type {
  SiteTestRunContext,
  SiteTestStageControl,
  SiteTestStackHandle
} from "../../scripts/site-test/runner-contracts";
import type { DockerSiteTestStackSnapshot } from "../../scripts/site-test/docker-stack";
import type { DockerProcessRunner } from "../../scripts/site-test/docker-stack";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  forbiddenAdapters.browserLaunch.mockReset();
  forbiddenAdapters.prisma.mockReset();
  forbiddenAdapters.redis.mockReset();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe("production site-test adapter cancellation", () => {
  test("isolates Chromium version discovery in the bounded child-process runner", async () => {
    forbiddenAdapters.browserLaunch.mockRejectedValue(
      new Error("direct in-process Chromium launch is forbidden")
    );
    const processRun: DockerProcessRunner = vi.fn(async (_command, _args, options) => {
      expect(options).toMatchObject({
        timeoutMs: 1_234,
        signal: control.signal
      });
      return { exitCode: 0, stdout: "138.0.7204.4\n", stderr: "" };
    });
    await expect(
      inspectDefaultBrowserVersion(context("browser"), control, processRun)
    ).resolves.toBe(
      "138.0.7204.4"
    );
    expect(processRun).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["-e", expect.stringMatching(/browser\.version/)]),
      expect.objectContaining({ timeoutMs: 1_234, signal: control.signal })
    );
    expect(forbiddenAdapters.browserLaunch).not.toHaveBeenCalled();
  });

  test("uses verified Docker health for PostgreSQL and Redis without uncancellable clients", async () => {
    forbiddenAdapters.prisma.mockImplementation(() => {
      throw new Error("Prisma probe must not run");
    });
    forbiddenAdapters.redis.mockImplementation(() => {
      throw new Error("Redis client probe must not run");
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 })
    );
    const stack = stackHandle(healthySnapshot());

    await expect(
      preflightDefaultStack(context("preflight"), stack, undefined, control)
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43000/api/health",
      { signal: control.signal }
    );
    expect(forbiddenAdapters.prisma).not.toHaveBeenCalled();
    expect(forbiddenAdapters.redis).not.toHaveBeenCalled();
  });

  test("passes cancellation through injected evidence and diagnostics writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "site-default-cancel-"));
    temporaryDirectories.push(root);
    const cancelled = new AbortController();
    cancelled.abort(new Error("stage cancelled"));
    const cancelledControl = { signal: cancelled.signal, timeoutMs: 1_000 };
    const runContext = context("writes", root);

    await expect(
      injectProductFailureEvidence(
        runContext,
        { cases: [], events: [] },
        { caseId: "EXP-001", attemptId: "A-001" },
        cancelledControl
      )
    ).rejects.toThrow(/stage cancelled|abort/i);
    await expect(
      persistDefaultDiagnostics(
        runContext,
        { playwright: [], issues: [] },
        cancelledControl
      )
    ).rejects.toThrow(/stage cancelled|abort/i);
  });

  test("durably records exact retained resources outside the aggregate report", async () => {
    const root = await mkdtemp(join(tmpdir(), "site-retained-resources-"));
    temporaryDirectories.push(root);
    const runContext = context("retained", root);
    const resources = healthySnapshot().services.map((service) => ({
      runId: runContext.runId,
      resourceType: "docker-container",
      resourceId: service.containerId,
      ownerRunId: runContext.runId,
      cleanupStatus: "retained" as const,
      details: { service: service.service }
    }));

    await persistDefaultRetainedResources(
      runContext,
      resources,
      "Final report persistence failed: disk full",
      control
    );

    const record = JSON.parse(
      await readFile(join(root, "diagnostics", "retained-resources.json"), "utf8")
    ) as { runId: string; reason: string; resources: typeof resources };
    expect(record).toMatchObject({
      runId: runContext.runId,
      reason: expect.stringMatching(/final report persistence failed/i)
    });
    expect(record.resources).toEqual(resources);
    expect(record.resources.every(({ cleanupStatus }) => cleanupStatus === "retained"))
      .toBe(true);
  });
});

const control: SiteTestStageControl = {
  signal: new AbortController().signal,
  timeoutMs: 1_234
};

function context(label: string, outputRoot = join(tmpdir(), `site-${label}`)): SiteTestRunContext {
  return {
    runId: "run-01",
    rootDirectory: process.cwd(),
    outputRoot,
    caseOutputRoot: join(outputRoot, "cases"),
    startedAt: "2026-07-17T00:00:00.000Z",
    image: "holdem:test",
    ports: { app: 43000, postgres: 45432, redis: 46379 },
    postgresPassword: "fixture-password",
    isolatedBaseUrl: "http://127.0.0.1:43000",
    redisUrl: "redis://127.0.0.1:46379",
    databaseUrl: "postgresql://holdem:fixture-password@127.0.0.1:45432/holdem",
    smokeBaseUrl: "http://localhost:3000",
    knownSecrets: ["fixture-password"]
  };
}

function stackHandle(snapshot: DockerSiteTestStackSnapshot): SiteTestStackHandle {
  return {
    runId: snapshot.runId,
    projectName: snapshot.projectName,
    snapshot,
    start: async () => snapshot,
    collectDiagnostics: async () => "",
    stop: async () => undefined
  };
}

function healthySnapshot(): DockerSiteTestStackSnapshot {
  return {
    runId: "run-01",
    projectName: "holdem-site-run-01",
    image: "holdem:test",
    imageId: "sha256:image",
    ports: { app: 43000, postgres: 45432, redis: 46379 },
    services: (["app", "postgres", "redis"] as const).map((service) => ({
      service,
      containerId: `${service}-id`,
      projectName: "holdem-site-run-01",
      runLabel: "run-01",
      status: "running",
      health: "healthy",
      imageId: service === "app" ? "sha256:image" : `sha256:${service}`
    }))
  };
}
