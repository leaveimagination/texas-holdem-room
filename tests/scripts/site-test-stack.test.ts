import { EventEmitter } from "node:events";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";

import {
  EnvironmentCleanupError,
  createSiteTestRunIdentity
} from "../../scripts/site-test/contracts";
import {
  DockerSiteTestStack,
  type DockerContainerInspect,
  type DockerProcessRunner
} from "../../scripts/site-test/docker-stack";
import { reserveLoopbackPorts } from "../../scripts/site-test/ports";
import {
  runProcess,
  type ProcessLogEntry,
  type SpawnProcess,
  type SpawnedProcess
} from "../../scripts/site-test/process-runner";

const imageName = "registry.example.test/holdem@sha256:manifest";
const imageId = "sha256:immutable-image-id";
const rootDirectory = join(process.cwd(), "fixture-root");

describe("site test run identity", () => {
  test("sanitizes the run ID into an exact isolated Compose project and run label", () => {
    expect(createSiteTestRunIdentity("  Run_2026/07:Alpha  ")).toEqual({
      runId: "run-2026-07-alpha",
      projectName: "holdem-site-run-2026-07-alpha",
      runLabel: "run-2026-07-alpha"
    });
  });

  test("rejects a run ID that has no safe characters", () => {
    expect(() => createSiteTestRunIdentity("___///")).toThrow(/safe character/i);
  });
});

describe("loopback port reservation", () => {
  test("returns three distinct ports while binding only to loopback", async () => {
    const candidates = [45100, 45100, 45101, 45102];
    const released: number[] = [];
    let heldCount = 0;
    let peakHeldCount = 0;

    const ports = await reserveLoopbackPorts(3, {
      bind: async (host) => {
        expect(host).toBe("127.0.0.1");
        const port = candidates.shift();
        if (port === undefined) {
          throw new Error("candidate port fixture exhausted");
        }
        heldCount += 1;
        peakHeldCount = Math.max(peakHeldCount, heldCount);
        return {
          port,
          release: async () => {
            released.push(port);
            heldCount -= 1;
          }
        };
      }
    });

    expect(ports).toEqual([45100, 45101, 45102]);
    expect(new Set(ports).size).toBe(3);
    expect(peakHeldCount).toBe(3);
    expect(released).toHaveLength(4);
    expect(heldCount).toBe(0);
  });
});

describe("safe process runner", () => {
  test("aborts at the deadline while preserving partial output and redacting streamed logs", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as SpawnedProcess;
    child.stdout = stdout;
    child.stderr = stderr;

    const spawn: SpawnProcess = vi.fn((_command, _args, options) => {
      options.signal.addEventListener(
        "abort",
        () => {
          child.emit("close", null, "SIGTERM");
        },
        { once: true }
      );
      queueMicrotask(() => {
        stdout.write("partial stdout\n");
        stderr.write("token=secret-");
        stderr.write("value\n");
      });
      return child;
    });
    const streamed: ProcessLogEntry[] = [];

    const result = runProcess("fixture-command", ["--literal", "a value"], {
      timeoutMs: 10,
      spawn,
      redact: (value) => value.replaceAll("secret-value", "[REDACTED]"),
      onLog: (entry) => streamed.push(entry)
    });

    await expect(result).rejects.toMatchObject({
      name: "ProcessTimeoutError",
      command: "fixture-command",
      args: ["--literal", "a value"],
      stdout: "partial stdout\n",
      stderr: "token=secret-value\n"
    });
    expect(streamed.map((entry) => `${entry.stream}:${entry.text}`).join("")).toContain(
      "stderr:token=[REDACTED]"
    );
    expect(streamed.map((entry) => entry.text).join("")).not.toContain("secret-value");
    expect(spawn).toHaveBeenCalledWith(
      "fixture-command",
      ["--literal", "a value"],
      expect.objectContaining({ shell: false, windowsHide: true })
    );
  });
});

describe("isolated Docker site test stack", () => {
  test("uses exact argument arrays, waits for health, and records the immutable app image", async () => {
    const fixture = createDockerFixture();
    const stack = createStack(fixture.run);

    const snapshot = await stack.start();

    expect(snapshot).toMatchObject({
      runId: "run-001",
      projectName: "holdem-site-run-001",
      image: imageName,
      imageId,
      ports: { app: 43100, postgres: 45432, redis: 46379 }
    });
    expect(snapshot.services.map((service) => [service.service, service.health])).toEqual([
      ["app", "healthy"],
      ["postgres", "healthy"],
      ["redis", "healthy"]
    ]);
    expect(fixture.calls[0]).toMatchObject({
      command: "docker",
      args: ["image", "inspect", "--format", "{{.Id}}", imageName]
    });
    expect(fixture.calls[1]).toMatchObject({
      command: "docker",
      args: [
        "compose",
        "--project-name",
        "holdem-site-run-001",
        "-f",
        join(rootDirectory, "docker-compose.prod.yml"),
        "-f",
        join(rootDirectory, "docker-compose.experience.yml"),
        "up",
        "--detach",
        "--wait",
        "--wait-timeout",
        "180",
        "--no-build",
        "--pull",
        "never"
      ]
    });
    expect(fixture.calls[1]?.env).toMatchObject({
      APP_ORIGIN: "http://127.0.0.1:43100",
      POSTGRES_PASSWORD: "fixture-password",
      SITE_TEST_APP_PORT: "43100",
      SITE_TEST_POSTGRES_PORT: "45432",
      SITE_TEST_REDIS_PORT: "46379",
      SITE_TEST_IMAGE: imageName,
      SITE_TEST_RUN_ID: "run-001"
    });
  });

  test("rejects an app container that does not use the inspected immutable image ID", async () => {
    const fixture = createDockerFixture({ appImageId: "sha256:unexpected-image-id" });
    const stack = createStack(fixture.run);

    await expect(stack.start()).rejects.toThrow(/immutable image ID/i);
  });

  test("refuses teardown when current Compose ownership differs from the recorded stack", async () => {
    const fixture = createDockerFixture({
      inspections: [
        healthyContainers(),
        healthyContainers({ projectName: "texas-holdem" })
      ]
    });
    const stack = createStack(fixture.run);
    await stack.start();

    await expect(stack.stop()).rejects.toBeInstanceOf(EnvironmentCleanupError);
    expect(fixture.calls.some((call) => call.args.includes("down"))).toBe(false);
  });

  test("refuses teardown when the current container IDs differ from the recorded stack", async () => {
    const fixture = createDockerFixture({
      idLists: ["app-id\npostgres-id\nredis-id\n", "replacement-app-id\npostgres-id\nredis-id\n"],
      inspections: [
        healthyContainers(),
        healthyContainers({ appId: "replacement-app-id" })
      ]
    });
    const stack = createStack(fixture.run);
    await stack.start();

    await expect(stack.stop()).rejects.toThrow(/container IDs/i);
    expect(fixture.calls.some((call) => call.args.includes("down"))).toBe(false);
  });

  test("tears down volumes only after exact ownership checks pass", async () => {
    const fixture = createDockerFixture({
      inspections: [healthyContainers(), healthyContainers()]
    });
    const stack = createStack(fixture.run);
    await stack.start();

    await stack.stop();

    expect(fixture.calls.at(-1)).toMatchObject({
      command: "docker",
      args: [
        "compose",
        "--project-name",
        "holdem-site-run-001",
        "-f",
        join(rootDirectory, "docker-compose.prod.yml"),
        "-f",
        join(rootDirectory, "docker-compose.experience.yml"),
        "down",
        "--volumes"
      ]
    });
  });

  test("collects project-scoped diagnostics without mutating Docker state", async () => {
    const fixture = createDockerFixture({
      logOutput: "app-1 | password=fixture-password diagnostic line\n"
    });
    const stack = createStack(fixture.run);

    const diagnostics = await stack.collectDiagnostics();

    expect(diagnostics).toBe("app-1 | password=[REDACTED] diagnostic line\n");
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]?.args).toEqual([
      "compose",
      "--project-name",
      "holdem-site-run-001",
      "-f",
      join(rootDirectory, "docker-compose.prod.yml"),
      "-f",
      join(rootDirectory, "docker-compose.experience.yml"),
      "logs",
      "--no-color",
      "--timestamps"
    ]);
  });
});

function createStack(run: DockerProcessRunner): DockerSiteTestStack {
  return new DockerSiteTestStack({
    runId: "run-001",
    rootDirectory,
    image: imageName,
    ports: { app: 43100, postgres: 45432, redis: 46379 },
    postgresPassword: "fixture-password",
    run
  });
}

interface DockerFixtureOptions {
  appImageId?: string;
  idLists?: string[];
  inspections?: DockerContainerInspect[][];
  logOutput?: string;
}

function createDockerFixture(options: DockerFixtureOptions = {}) {
  const calls: Array<{
    command: string;
    args: string[];
    env?: NodeJS.ProcessEnv;
  }> = [];
  const inspections = [
    ...(options.inspections ?? [healthyContainers({ appImageId: options.appImageId })])
  ];
  const idLists = [
    ...(options.idLists ??
      inspections.map(() => "app-id\npostgres-id\nredis-id\n"))
  ];

  const run: DockerProcessRunner = async (command, args, runOptions = {}) => {
    calls.push({ command, args: [...args], env: runOptions.env });

    if (args[0] === "image" && args[1] === "inspect") {
      return { exitCode: 0, stdout: `${imageId}\n`, stderr: "" };
    }
    if (args.includes("up") || args.includes("down")) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (args.includes("ps")) {
      const stdout = idLists.shift();
      if (stdout === undefined) {
        throw new Error("container ID fixture exhausted");
      }
      return { exitCode: 0, stdout, stderr: "" };
    }
    if (args[0] === "inspect") {
      const inspection = inspections.shift();
      if (inspection === undefined) {
        throw new Error("container inspection fixture exhausted");
      }
      return { exitCode: 0, stdout: JSON.stringify(inspection), stderr: "" };
    }
    if (args.includes("logs")) {
      return { exitCode: 0, stdout: options.logOutput ?? "", stderr: "" };
    }
    throw new Error(`Unexpected Docker fixture invocation: ${command} ${args.join(" ")}`);
  };

  return { calls, run };
}

interface HealthyContainerOverrides {
  appId?: string;
  appImageId?: string;
  projectName?: string;
  runLabel?: string;
}

function healthyContainers(overrides: HealthyContainerOverrides = {}): DockerContainerInspect[] {
  const projectName = overrides.projectName ?? "holdem-site-run-001";
  const runLabel = overrides.runLabel ?? "run-001";
  const baseLabels = {
    "com.docker.compose.project": projectName,
    "com.texas-holdem.site-test-run": runLabel
  };
  return [
    {
      Id: overrides.appId ?? "app-id",
      Image: overrides.appImageId ?? imageId,
      Config: { Labels: { ...baseLabels, "com.docker.compose.service": "app" } },
      State: { Status: "running", Health: { Status: "healthy" } }
    },
    {
      Id: "postgres-id",
      Image: "sha256:postgres-image",
      Config: { Labels: { ...baseLabels, "com.docker.compose.service": "postgres" } },
      State: { Status: "running", Health: { Status: "healthy" } }
    },
    {
      Id: "redis-id",
      Image: "sha256:redis-image",
      Config: { Labels: { ...baseLabels, "com.docker.compose.service": "redis" } },
      State: { Status: "running", Health: { Status: "healthy" } }
    }
  ];
}
