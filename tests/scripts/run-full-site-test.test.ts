import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import playwrightConfig from "../../playwright.experience.config";
import {
  DEFAULT_SITE_TEST_CASE_IDS,
  EnvironmentStageError,
  SITE_TEST_HARD_DEADLINE_MS,
  SITE_TEST_FINALIZATION_RESERVE_MS,
  SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS,
  OverallDeadlineError,
  createDefaultSiteTestRunnerDependencies,
  injectProductFailureEvidence,
  parseSiteTestArguments,
  runFullSiteTest,
  type CollectedCaseEvidence,
  type SiteTestRunContext,
  type SiteTestRunnerDependencies
} from "../../scripts/run-full-site-test";
import { runPlaywrightGroup } from "../../scripts/site-test/playwright-group";
import { writeDefaultMetadata } from "../../scripts/site-test/runner-defaults";
import { ProcessTimeoutError } from "../../scripts/site-test/process-runner";
import type { DockerSiteTestStackSnapshot } from "../../scripts/site-test/docker-stack";
import {
  EXPERIENCE_THRESHOLDS,
  type CaseReport,
  type EvidenceEvent
} from "../experience/evidence/contracts";
import { writeExperienceReport } from "../experience/evidence/report-writer";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe("site test argument contract", () => {
  test("selects EXP-001 through EXP-010 by default", () => {
    const selection = parseSiteTestArguments([]);

    expect(selection.caseIds).toEqual(DEFAULT_SITE_TEST_CASE_IDS);
    expect(selection.caseIds).toEqual(
      Array.from({ length: 10 }, (_, index) => `EXP-${String(index + 1).padStart(3, "0")}`)
    );
    expect(selection.injectProductFailure).toBeUndefined();
    expect(selection.injectEnvironmentFailure).toBeUndefined();
  });

  test("accepts only exact known case IDs and preserves an explicit filter", () => {
    expect(parseSiteTestArguments(["--cases=EXP-004,EXP-001"]).caseIds).toEqual([
      "EXP-004",
      "EXP-001"
    ]);
    expect(() => parseSiteTestArguments(["--cases=EXP-001,EXP-011"])).toThrow(
      /unknown experience case.*EXP-011/i
    );
    expect(() => parseSiteTestArguments(["--cases=EXP-001,EXP-001"])).toThrow(
      /duplicate experience case/i
    );
  });

  test("validates private fault-injection coordinates", () => {
    expect(
      parseSiteTestArguments(["--inject-product-failure=EXP-001/A-001"])
        .injectProductFailure
    ).toEqual({ caseId: "EXP-001", attemptId: "A-001" });
    expect(
      parseSiteTestArguments(["--inject-environment-failure=postgres-health"])
        .injectEnvironmentFailure
    ).toBe("postgres-health");
    expect(() =>
      parseSiteTestArguments(["--inject-environment-failure=redis-health"])
    ).toThrow(/unsupported environment failure/i);
  });
});

describe("dedicated Playwright group", () => {
  test("uses Chromium serially with manual actor traces and run-scoped output", () => {
    expect(playwrightConfig.testDir).toMatch(/tests[\\/]experience[\\/]scenarios$/);
    expect(playwrightConfig.workers).toBe(1);
    expect(playwrightConfig.retries).toBe(0);
    expect(playwrightConfig.reporter).toEqual([["line"]]);
    expect(playwrightConfig.outputDir).toMatch(
      /outputs[\\/]site-test[\\/]manual[\\/]diagnostics[\\/]playwright$/
    );
    expect(playwrightConfig.use?.trace).toBe("off");
    expect(playwrightConfig.use?.video).toBe("off");
    expect(playwrightConfig.projects).toHaveLength(1);
    expect(playwrightConfig.projects?.[0]).toMatchObject({
      name: "chromium",
      use: { browserName: "chromium" }
    });
  });

  test("passes exact IDs and URLs through argv/env without shell interpolation", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const run = vi.fn(async (_command, _args, options) => {
      options?.onLog?.({ stream: "stdout", text: "one pw\n" });
      options?.onLog?.({ stream: "stderr", text: "two\n" });
      return { exitCode: 0, stdout: "one pw\n", stderr: "two\n" };
    });

    const result = await runPlaywrightGroup({
      rootDirectory: "C:\\repo with spaces",
      runId: "run-01",
      outputRoot: "C:\\output with spaces\\run-01",
      caseOutputRoot: "C:\\temp evidence\\run-01",
      caseIds: ["EXP-001", "EXP-003"],
      isolatedBaseUrl: "http://127.0.0.1:43000",
      redisUrl: "redis://127.0.0.1:46379",
      databaseUrl: "postgresql://holdem:pw@127.0.0.1:45432/holdem?schema=public",
      smokeBaseUrl: "http://localhost:3000",
      timeoutMs: 45_000,
      run,
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text)
    });

    expect(result).toEqual({
      exitCode: 0,
      stdout: "one pw\n",
      stderr: "two\n",
      timedOut: false
    });
    expect(stdout).toEqual(["one [REDACTED]\n"]);
    expect(stderr).toEqual(["two\n"]);
    expect(run).toHaveBeenCalledTimes(1);
    const [command, args, options] = run.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toContain("test");
    expect(args).toContain("--config");
    expect(args).toContain("--grep");
    expect(args).toContain("\\b(?:EXP-001|EXP-003)\\b");
    expect(args.every((argument: string) => !argument.includes("&&"))).toBe(true);
    expect(options).toMatchObject({
      cwd: "C:\\repo with spaces",
      timeoutMs: 45_000,
      env: {
        SITE_TEST_RUN_ID: "run-01",
        SITE_TEST_OUTPUT_ROOT: "C:\\output with spaces\\run-01",
        SITE_TEST_CASE_OUTPUT_ROOT: "C:\\temp evidence\\run-01",
        SITE_TEST_CASE_IDS: "EXP-001,EXP-003",
        SITE_TEST_ISOLATED_BASE_URL: "http://127.0.0.1:43000",
        SITE_TEST_REDIS_URL: "redis://127.0.0.1:46379",
        SITE_TEST_DATABASE_URL:
          "postgresql://holdem:pw@127.0.0.1:45432/holdem?schema=public",
        SITE_TEST_SMOKE_URL: "http://localhost:3000"
      }
    });
  });

  test("preserves redacted partial output when Playwright times out", async () => {
    const run = vi.fn(async () => {
      throw new ProcessTimeoutError("timed out", {
        command: process.execPath,
        args: ["playwright"],
        stdout: "partial hostToken=[REDACTED]\n",
        stderr: "partial failure\n",
        timeoutMs: 12_000
      });
    });

    await expect(
      runPlaywrightGroup({
        rootDirectory: process.cwd(),
        runId: "run-01",
        outputRoot: "C:\\output",
        caseOutputRoot: "C:\\cases",
        caseIds: ["EXP-001"],
        isolatedBaseUrl: "http://127.0.0.1:43000",
        redisUrl: "redis://127.0.0.1:46379",
        databaseUrl: "postgresql://holdem:pw@127.0.0.1:45432/holdem",
        smokeBaseUrl: "http://localhost:3000",
        timeoutMs: 12_000,
        run
      })
    ).resolves.toEqual({
      exitCode: 2,
      stdout: "partial hostToken=[REDACTED]\n",
      stderr: "partial failure\n",
      timedOut: true
    });
  });

  test("redacts generic credentials and registered host URLs from streamed logs", async () => {
    const streamed: string[] = [];
    const secretHostUrl = "https://example.test/room?hostToken=host-secret";
    const run = vi.fn(async (_command, _args, options) => {
      options?.onLog?.({
        stream: "stdout",
        text:
          `Authorization: Bearer bearer-secret\n${secretHostUrl}\n` +
          "participantToken=participant-secret\n"
      });
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    await runPlaywrightGroup({
      rootDirectory: process.cwd(),
      runId: "run-01",
      outputRoot: "C:\\output",
      caseOutputRoot: "C:\\cases",
      caseIds: ["EXP-001"],
      isolatedBaseUrl: "http://127.0.0.1:43000",
      redisUrl: "redis://127.0.0.1:46379",
      databaseUrl: "postgresql://holdem:pw@127.0.0.1:45432/holdem",
      smokeBaseUrl: "http://localhost:3000",
      timeoutMs: 12_000,
      knownSecrets: [secretHostUrl],
      run,
      writeStdout: (text) => streamed.push(text)
    });

    const output = streamed.join("");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("bearer-secret");
    expect(output).not.toContain("host-secret");
    expect(output).not.toContain("participant-secret");
    expect(output).not.toContain(secretHostUrl);
  });
});

describe("full site runner", () => {
  test("writes pre-execution Git, image, browser, deadline, and threshold metadata", async () => {
    const harness = await createHarness();

    await writeDefaultMetadata(
      harness.context,
      parseSiteTestArguments(["--cases=EXP-001,EXP-002"]),
      "Chromium 138.0.7204.4"
    );

    const metadata = JSON.parse(
      await readFile(
        join(harness.context.outputRoot, "diagnostics", "metadata.json"),
        "utf8"
      )
    );
    expect(metadata).toMatchObject({
      schemaVersion: "1.0",
      runId: "run-01",
      image: "holdem:test",
      hardDeadlineMs: SITE_TEST_HARD_DEADLINE_MS,
      selectedCaseIds: ["EXP-001", "EXP-002"],
      thresholds: EXPERIENCE_THRESHOLDS
    });
    expect(metadata.gitRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(metadata.playwrightVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(metadata.chromiumVersion).toBe("Chromium 138.0.7204.4");
  });

  test("reserves enough bounded time for every required finalization stage", () => {
    expect(SITE_TEST_FINALIZATION_RESERVE_MS).toBeGreaterThanOrEqual(
      15_000 + 30_000 + 60_000 + 15_000 + 30_000 + 120_000 + 15_000
    );
    expect(SITE_TEST_FINALIZATION_RESERVE_MS).toBeLessThan(
      SITE_TEST_HARD_DEADLINE_MS
    );
  });

  test("keeps report, diagnostics, validation, and cleanup inside the absolute deadline", async () => {
    const harness = await createHarness();
    let insideDeadline = false;
    const outsideDeadline: string[] = [];
    harness.dependencies.withDeadline = async (timeoutMs, task) => {
      harness.deadlines.push(timeoutMs);
      insideDeadline = true;
      try {
        return await task(new AbortController().signal, () => timeoutMs);
      } finally {
        insideDeadline = false;
      }
    };
    const observe = <T extends (...args: never[]) => Promise<unknown>>(
      label: string,
      operation: T
    ): T =>
      (async (...args: Parameters<T>) => {
        if (!insideDeadline) outsideDeadline.push(label);
        return await operation(...args);
      }) as T;
    harness.dependencies.writeReport = observe(
      "report",
      harness.dependencies.writeReport as (...args: never[]) => Promise<unknown>
    ) as SiteTestRunnerDependencies["writeReport"];
    harness.dependencies.validateEvidence = observe(
      "validate",
      harness.dependencies.validateEvidence as (...args: never[]) => Promise<unknown>
    ) as SiteTestRunnerDependencies["validateEvidence"];
    harness.dependencies.persistDiagnostics = observe(
      "diagnostics",
      harness.dependencies.persistDiagnostics as (...args: never[]) => Promise<unknown>
    ) as SiteTestRunnerDependencies["persistDiagnostics"];

    await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001"]),
      dependencies: harness.dependencies
    });

    expect(outsideDeadline).toEqual([]);
    expect(harness.calls).toContain("cleanup");
  });

  test("awaits cooperative cancellation before rejecting the hard deadline", async () => {
    const events: string[] = [];

    await expect(
      createDefaultSiteTestRunnerDependencies().withDeadline(10, async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              events.push("aborted");
              setTimeout(() => {
                events.push("terminated");
                resolve();
              }, 10);
            },
            { once: true }
          );
        });
      })
    ).rejects.toBeInstanceOf(OverallDeadlineError);

    expect(events).toEqual(["aborted", "terminated"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(["aborted", "terminated"]);
  });

  test("does not start a bounded stage when its budget would consume finalization reserve", async () => {
    const harness = await createHarness();
    harness.dependencies.withDeadline = async (_timeoutMs, task) =>
      await task(
        new AbortController().signal,
        () => SITE_TEST_FINALIZATION_RESERVE_MS + 5_000
      );

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001"]),
      dependencies: harness.dependencies
    });

    expect(result).toMatchObject({ exitCode: 2, verdict: "INCONCLUSIVE" });
    expect(harness.calls).toEqual([]);
  });

  test("enforces a stage timeout for a non-cooperative dependency and starts no later stage", async () => {
    vi.useFakeTimers();
    try {
      const harness = await createHarness();
      harness.dependencies.inspectBrowserVersion = async () => {
        harness.calls.push("browser-version");
        return await new Promise<string>((resolve) => {
          // Deliberately ignores the stage AbortSignal and outlives its budget.
          setTimeout(
            () => resolve("late Chromium"),
            SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.browserVersion * 2
          );
        });
      };

      const startedAt = Date.now();
      const run = runFullSiteTest({
        selection: parseSiteTestArguments(["--cases=EXP-001"]),
        dependencies: harness.dependencies
      });
      let settledAt: number | undefined;
      void run.finally(() => {
        settledAt = Date.now();
      });
      await vi.advanceTimersByTimeAsync(
        SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.browserVersion * 2
      );
      const result = await run;

      expect(result).toMatchObject({
        exitCode: 2,
        verdict: "INCONCLUSIVE",
        outputRoot: harness.context.outputRoot
      });
      expect((settledAt ?? Infinity) - startedAt).toBeLessThanOrEqual(
        SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS.browserVersion
      );
      expect(harness.calls).toEqual(["allocate", "browser-version"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("runs ordered isolated and smoke stages under one 30-minute deadline", async () => {
    const harness = await createHarness();
    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001,EXP-010"]),
      dependencies: harness.dependencies
    });

    expect(result).toMatchObject({ exitCode: 0, verdict: "PASS" });
    expect(harness.deadlines).toEqual([SITE_TEST_HARD_DEADLINE_MS]);
    expect(SITE_TEST_HARD_DEADLINE_MS).toBe(30 * 60 * 1_000);
    expect(harness.playwrightTimeouts).toHaveLength(2);
    expect(
      harness.playwrightTimeouts.every(
        (timeoutMs) => timeoutMs > 0 && timeoutMs < SITE_TEST_HARD_DEADLINE_MS
      )
    ).toBe(true);
    expect(harness.calls).toEqual([
      "allocate",
      "browser-version",
      "metadata",
      "inspect-image",
      "create-stack",
      "start-stack",
      "preflight",
      "playwright:EXP-001",
      "collect:EXP-001",
      "aggregate",
      "validate:isolated",
      "playwright:EXP-010",
      "collect:EXP-010",
      "aggregate",
      "validate:final",
      "docker-diagnostics",
      "persist-diagnostics",
      "validate:finalized-pack",
      "cleanup",
      "aggregate:cleanup-status"
    ]);
  });

  test("never touches deployed smoke when EXP-010 is omitted", async () => {
    const harness = await createHarness();

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-002"]),
      dependencies: harness.dependencies
    });

    expect(result.exitCode).toBe(0);
    expect(harness.playwrightGroups).toEqual([["EXP-002"]]);
    expect(harness.calls.some((call) => call.includes("EXP-010"))).toBe(false);
  });

  test("rejects a started stack whose app image changed after inspection", async () => {
    const harness = await createHarness({ stackImageId: "sha256:replacement-image" });

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001,EXP-010"]),
      dependencies: harness.dependencies
    });

    expect(result).toMatchObject({ exitCode: 2, verdict: "INCONCLUSIVE" });
    expect(harness.calls).not.toContain("preflight");
    expect(harness.playwrightGroups).toEqual([]);
    expect(result.report?.results.environment.status).toBe("inconclusive");
  });

  test("creates the exact stack handle before start so partial-start resources remain diagnosable", async () => {
    const harness = await createHarness({
      stackStart: async () => {
        throw new Error("Compose wait failed after containers were created");
      }
    });

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001"]),
      dependencies: harness.dependencies
    });

    expect(result).toMatchObject({ exitCode: 2, verdict: "INCONCLUSIVE" });
    expect(harness.calls.indexOf("create-stack")).toBeLessThan(
      harness.calls.indexOf("start-stack")
    );
    expect(harness.calls).toContain("docker-diagnostics");
    expect(harness.calls).toContain("cleanup");
  });

  test("skips deployed smoke after an isolated product failure and returns exit 1", async () => {
    const harness = await createHarness({
      evidenceFor: (caseIds) => evidence(caseIds, "FAIL")
    });

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001,EXP-010"]),
      dependencies: harness.dependencies
    });

    expect(result).toMatchObject({ exitCode: 1, verdict: "FAIL" });
    expect(harness.playwrightGroups).toEqual([["EXP-001"]]);
    expect(harness.calls).not.toContain("playwright:EXP-010");
  });

  test("classifies a timed-out Playwright group as harness-inconclusive even with product failure evidence", async () => {
    const harness = await createHarness({
      evidenceFor: (caseIds) => evidence(caseIds, "FAIL")
    });
    harness.dependencies.runPlaywrightGroup = async (input) => {
      harness.calls.push(`playwright:${input.caseIds.join(",")}`);
      return {
        exitCode: 2,
        stdout: "partial output",
        stderr: "deadline exceeded",
        timedOut: true
      };
    };

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001"]),
      dependencies: harness.dependencies
    });

    expect(result).toMatchObject({ exitCode: 2, verdict: "INCONCLUSIVE" });
    expect(result.report?.results.harness.status).toBe("inconclusive");
  });

  test("finalizes partial evidence for injected environment failure before exact cleanup", async () => {
    const harness = await createHarness({
      preflight: async () => {
        throw new EnvironmentStageError("Injected PostgreSQL health failure", "postgres-health");
      }
    });

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments([
        "--cases=EXP-001,EXP-010",
        "--inject-environment-failure=postgres-health"
      ]),
      dependencies: harness.dependencies
    });

    expect(result).toMatchObject({ exitCode: 2, verdict: "INCONCLUSIVE" });
    expect(harness.playwrightGroups).toEqual([]);
    expect(harness.calls).toContain("docker-diagnostics");
    expect(harness.calls.indexOf("aggregate")).toBeLessThan(
      harness.calls.indexOf("validate:final")
    );
    expect(harness.calls.indexOf("validate:final")).toBeLessThan(
      harness.calls.indexOf("cleanup")
    );
    expect(harness.calls.indexOf("persist-diagnostics")).toBeLessThan(
      harness.calls.indexOf("cleanup")
    );
    expect(harness.calls.indexOf("validate:finalized-pack")).toBeGreaterThan(
      harness.calls.indexOf("persist-diagnostics")
    );
    expect(harness.calls.indexOf("validate:finalized-pack")).toBeLessThan(
      harness.calls.indexOf("cleanup")
    );
    expect(result.report).toBeDefined();
    expect(result.report!.cases[0]).toMatchObject({
      caseId: "EXP-001",
      verdict: "INCONCLUSIVE",
      results: { environment: { status: "inconclusive" } }
    });
  });

  test("records an injected product assertion and artifact and returns exit 1", async () => {
    const harness = await createHarness({ useRealProductInjection: true });

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments([
        "--cases=EXP-001",
        "--inject-product-failure=EXP-001/A-001"
      ]),
      dependencies: harness.dependencies
    });

    expect(result).toMatchObject({ exitCode: 1, verdict: "FAIL" });
    expect(result.report).toBeDefined();
    const injected = result.report!.cases[0];
    expect(injected.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcome: "fail", id: "EXP-001-INJECTED-PRODUCT-FAILURE" })
      ])
    );
    const artifact = injected.artifacts.find(({ id }) => id.includes("INJECTED"));
    expect(artifact).toBeDefined();
    expect(await readFile(join(harness.context.outputRoot, artifact!.path), "utf8")).toMatch(
      /deliberate product failure/i
    );
  });

  test("does not clean the stack when no report became durable", async () => {
    const harness = await createHarness({
      writeReport: async () => {
        throw new Error("disk full before atomic report rename");
      }
    });

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-010"]),
      dependencies: harness.dependencies
    });

    expect(result.exitCode).toBe(2);
    expect(harness.calls).not.toContain("cleanup");
    expect(result.report).toBeUndefined();
  });

  test("does not continue into evidence collection, smoke, or cleanup after timeout", async () => {
    const harness = await createHarness();
    const controller = new AbortController();
    harness.dependencies.withDeadline = async (timeoutMs, task) =>
      await task(controller.signal, () =>
        controller.signal.aborted ? 0 : timeoutMs
      );
    harness.dependencies.runPlaywrightGroup = async (input) => {
      harness.calls.push(`playwright:${input.caseIds.join(",")}`);
      controller.abort(new OverallDeadlineError(SITE_TEST_HARD_DEADLINE_MS));
      return { exitCode: 2, stdout: "partial", stderr: "timed out", timedOut: true };
    };

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001,EXP-010"]),
      dependencies: harness.dependencies
    });
    const callsAtSettlement = [...harness.calls];

    expect(result).toMatchObject({ exitCode: 2, verdict: "INCONCLUSIVE" });
    expect(harness.calls).not.toContain("collect:EXP-001");
    expect(harness.calls).not.toContain("playwright:EXP-010");
    expect(harness.calls).not.toContain("cleanup");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.calls).toEqual(callsAtSettlement);
  });

  test("retains the stack when the current final report write fails", async () => {
    const harness = await createHarness();
    const writeReport = harness.dependencies.writeReport;
    let retainedFallback:
      | { resources: readonly { cleanupStatus: string }[]; reason: string }
      | undefined;
    harness.dependencies.persistRetainedResources = async (
      _context,
      resources,
      reason
    ) => {
      harness.calls.push("persist-retained-resources");
      retainedFallback = { resources, reason };
    };
    let writes = 0;
    harness.dependencies.writeReport = async (input, control) => {
      writes += 1;
      if (writes === 2) throw new Error("final atomic rename failed");
      return await writeReport(input, control);
    };

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001"]),
      dependencies: harness.dependencies
    });

    expect(result.exitCode).toBe(2);
    expect(harness.calls).not.toContain("cleanup");
    expect(harness.calls).toContain("persist-retained-resources");
    expect(retainedFallback?.resources.every(
      ({ cleanupStatus }) => cleanupStatus === "retained"
    )).toBe(true);
    expect(retainedFallback?.reason).toMatch(/final report persistence failed/i);
  });

  test("persists retained resources when cleanup and its status report both fail", async () => {
    const harness = await createHarness({
      stackStop: async () => {
        throw Object.assign(new Error("Docker down left the exact stack running"), {
          retained: true
        });
      }
    });
    const writeReport = harness.dependencies.writeReport;
    let writes = 0;
    harness.dependencies.writeReport = async (input, control) => {
      writes += 1;
      if (writes === 3) {
        throw new Error("cleanup status atomic rename failed");
      }
      return await writeReport(input, control);
    };
    let retainedFallback:
      | { resources: readonly { cleanupStatus: string }[]; reason: string }
      | undefined;
    harness.dependencies.persistRetainedResources = async (
      _context,
      resources,
      reason
    ) => {
      harness.calls.push("persist-retained-resources");
      retainedFallback = { resources, reason };
    };

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001"]),
      dependencies: harness.dependencies
    });

    expect(result).toMatchObject({ exitCode: 2, verdict: "INCONCLUSIVE" });
    expect(harness.calls).toContain("cleanup");
    expect(harness.calls).toContain("persist-retained-resources");
    expect(retainedFallback?.resources.every(
      ({ cleanupStatus }) => cleanupStatus === "retained"
    )).toBe(true);
    expect(retainedFallback?.reason).toMatch(/cleanup status persistence failed/i);
  });

  test("preserves run location and the last partial report when the absolute deadline fires", async () => {
    const harness = await createHarness();
    const controller = new AbortController();
    harness.dependencies.withDeadline = async (timeoutMs, task) =>
      await task(controller.signal, () =>
        controller.signal.aborted ? 0 : timeoutMs
      );
    let groups = 0;
    harness.dependencies.runPlaywrightGroup = async (input) => {
      groups += 1;
      harness.calls.push(`playwright:${input.caseIds.join(",")}`);
      if (groups === 2) {
        controller.abort(new OverallDeadlineError(SITE_TEST_HARD_DEADLINE_MS));
        return { exitCode: 2, stdout: "partial", stderr: "timeout", timedOut: true };
      }
      return { exitCode: 0, stdout: "ok", stderr: "", timedOut: false };
    };

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001,EXP-010"]),
      dependencies: harness.dependencies
    });

    expect(result).toMatchObject({
      exitCode: 2,
      verdict: "INCONCLUSIVE",
      runId: harness.context.runId,
      outputRoot: harness.context.outputRoot,
      report: { runId: harness.context.runId }
    });
  });

  test("retains the stack when diagnostics cannot be persisted", async () => {
    const harness = await createHarness();
    harness.dependencies.persistDiagnostics = async () => {
      harness.calls.push("persist-diagnostics");
      throw new Error("diagnostics disk full");
    };

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001"]),
      dependencies: harness.dependencies
    });

    expect(result.exitCode).toBe(2);
    expect(harness.calls).not.toContain("cleanup");
    expect(result.report?.resources.every(({ cleanupStatus }) => cleanupStatus === "retained"))
      .toBe(true);
  });

  test("retains the stack when final pack validation fails", async () => {
    const harness = await createHarness();
    harness.dependencies.validateEvidence = async (_root, _secrets, phase) => {
      harness.calls.push(`validate:${phase}`);
      if (phase === "finalized-pack") throw new Error("diagnostic secret detected");
      return { filesScanned: 4, textEntriesScanned: 4, artifactCount: 0 };
    };

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001"]),
      dependencies: harness.dependencies
    });

    expect(result.exitCode).toBe(2);
    expect(harness.calls).not.toContain("cleanup");
    expect(result.report?.resources.every(({ cleanupStatus }) => cleanupStatus === "retained"))
      .toBe(true);
  });

  test("retains the stack when current final report validation fails", async () => {
    const harness = await createHarness();
    harness.dependencies.validateEvidence = async (_root, _secrets, phase) => {
      harness.calls.push(`validate:${phase}`);
      if (phase === "final") throw new Error("final report schema invalid");
      return { filesScanned: 4, textEntriesScanned: 4, artifactCount: 0 };
    };

    const result = await runFullSiteTest({
      selection: parseSiteTestArguments(["--cases=EXP-001"]),
      dependencies: harness.dependencies
    });

    expect(result.exitCode).toBe(2);
    expect(harness.calls).not.toContain("cleanup");
    expect(result.report?.resources.every(({ cleanupStatus }) => cleanupStatus === "retained"))
      .toBe(true);
  });
});

interface HarnessOptions {
  evidenceFor?(caseIds: readonly string[]): CollectedCaseEvidence;
  preflight?: SiteTestRunnerDependencies["preflight"];
  writeReport?: SiteTestRunnerDependencies["writeReport"];
  useRealProductInjection?: boolean;
  stackImageId?: string;
  stackStart?: () => Promise<void>;
  stackStop?: () => Promise<void>;
}

async function createHarness(options: HarnessOptions = {}) {
  const base = await mkdtemp(join(tmpdir(), "site-runner-test-"));
  temporaryDirectories.push(base);
  const context: SiteTestRunContext = {
    runId: "run-01",
    rootDirectory: process.cwd(),
    outputRoot: join(base, "outputs", "site-test", "run-01"),
    caseOutputRoot: join(base, "outputs", "site-test", ".case-evidence-run-01"),
    startedAt: "2026-07-17T00:00:00.000Z",
    image: "holdem:test",
    ports: { app: 43000, postgres: 45432, redis: 46379 },
    postgresPassword: "fixture-password",
    isolatedBaseUrl: "http://127.0.0.1:43000",
    redisUrl: "redis://127.0.0.1:46379",
    databaseUrl:
      "postgresql://holdem:fixture-password@127.0.0.1:45432/holdem?schema=public",
    smokeBaseUrl: "http://localhost:3000",
    knownSecrets: ["fixture-password"]
  };
  const calls: string[] = [];
  const deadlines: number[] = [];
  const playwrightGroups: string[][] = [];
  const playwrightTimeouts: number[] = [];
  let writeCount = 0;
  const stackSnapshot = snapshot(options.stackImageId);
  const stack = {
    snapshot: stackSnapshot,
    runId: stackSnapshot.runId,
    projectName: stackSnapshot.projectName,
    start: async () => {
      calls.push("start-stack");
      await options.stackStart?.();
      return stackSnapshot;
    },
    collectDiagnostics: async () => {
      calls.push("docker-diagnostics");
      return "docker diagnostics";
    },
    stop: async () => {
      calls.push("cleanup");
      await options.stackStop?.();
    }
  };

  const dependencies: SiteTestRunnerDependencies = {
    withDeadline: async (timeoutMs, task) => {
      deadlines.push(timeoutMs);
      return await task(new AbortController().signal, () => timeoutMs);
    },
    allocateRun: async () => {
      calls.push("allocate");
      return context;
    },
    inspectBrowserVersion: async () => {
      calls.push("browser-version");
      return "Chromium 138.0.7204.4";
    },
    writeMetadata: async () => {
      calls.push("metadata");
    },
    inspectImage: async () => {
      calls.push("inspect-image");
      return "sha256:image";
    },
    createStack: () => {
      calls.push("create-stack");
      return stack;
    },
    preflight:
      options.preflight ??
      (async () => {
        calls.push("preflight");
      }),
    runPlaywrightGroup: async (input) => {
      const ids = [...input.caseIds];
      playwrightGroups.push(ids);
      playwrightTimeouts.push(input.timeoutMs);
      calls.push(`playwright:${ids.join(",")}`);
      return {
        exitCode: 0,
        stdout: `${ids.join(",")} stdout`,
        stderr: "",
        timedOut: false
      };
    },
    collectCaseEvidence: async (_context, caseIds) => {
      calls.push(`collect:${caseIds.join(",")}`);
      return options.evidenceFor?.(caseIds) ?? evidence(caseIds, "PASS");
    },
    injectProductFailure: options.useRealProductInjection
      ? injectProductFailureEvidence
      : async (_context, current) => current,
    writeReport:
      options.writeReport ??
      (async (input) => {
        calls.push(writeCount < 2 ? "aggregate" : "aggregate:cleanup-status");
        writeCount += 1;
        return await writeExperienceReport(input);
      }),
    validateEvidence: async (_outputRoot, _knownSecrets, phase) => {
      calls.push(`validate:${phase}`);
      return { filesScanned: 4, textEntriesScanned: 4, artifactCount: 0 };
    },
    persistDiagnostics: async () => {
      calls.push("persist-diagnostics");
    },
    persistRetainedResources: async () => {
      calls.push("persist-retained-resources");
    },
    now: () => "2026-07-17T00:01:00.000Z"
  };

  return {
    calls,
    context,
    deadlines,
    dependencies,
    playwrightGroups,
    playwrightTimeouts
  };
}

function evidence(
  caseIds: readonly string[],
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE"
): CollectedCaseEvidence {
  const cases = caseIds.map((caseId) => caseReport(caseId, verdict));
  const events = cases.map((report) => eventFor(report));
  return { cases, events };
}

function caseReport(caseId: string, verdict: "PASS" | "FAIL" | "INCONCLUSIVE"): CaseReport {
  const fail = verdict === "FAIL";
  const inconclusive = verdict === "INCONCLUSIVE";
  return {
    schemaVersion: "1.0",
    runId: "run-01",
    caseId,
    attemptId: "A-001",
    startedAt: "2026-07-17T00:00:00.000Z",
    finishedAt: "2026-07-17T00:00:30.000Z",
    verdict,
    results: {
      product: {
        status: fail ? "fail" : inconclusive ? "inconclusive" : "pass",
        summary: fail ? "A product assertion failed." : inconclusive ? "Not judged." : "Passed.",
        evidenceEventIds: []
      },
      harness: {
        status: inconclusive ? "inconclusive" : "pass",
        summary: inconclusive ? "Harness interrupted." : "Harness passed.",
        evidenceEventIds: []
      },
      environment: { status: "pass", summary: "Environment passed.", evidenceEventIds: [] }
    },
    assertions: [
      {
        id: `${caseId}-ASSERTION`,
        outcome: fail ? "fail" : inconclusive ? "inconclusive" : "pass",
        evidenceEventIds: [],
        summary: fail ? "Failed." : inconclusive ? "Not judged." : "Passed."
      }
    ],
    failures: fail
      ? [
          {
            code: "PRODUCT_ASSERTION_FAILED",
            summary: "A product assertion failed.",
            stage: "fixture",
            evidenceEventIds: []
          }
        ]
      : [],
    artifacts: []
  };
}

function eventFor(report: CaseReport): EvidenceEvent {
  return {
    id: `${report.caseId}-${report.attemptId}-E-000001`,
    runId: report.runId,
    caseId: report.caseId,
    attemptId: report.attemptId,
    actor: "runner",
    seq: 1,
    timestamp: report.startedAt,
    monotonicMs: 1,
    stage: "fixture",
    type: "checkpoint",
    status: report.verdict === "PASS" ? "pass" : "fail",
    details: {},
    artifactIds: []
  };
}

function snapshot(appImageId = "sha256:image"): DockerSiteTestStackSnapshot {
  const projectName = "holdem-site-run-01";
  return {
    runId: "run-01",
    projectName,
    image: "holdem:test",
    imageId: appImageId,
    ports: { app: 43000, postgres: 45432, redis: 46379 },
    services: (["app", "postgres", "redis"] as const).map((service) => ({
      service,
      containerId: `${service}-container`,
      projectName,
      runLabel: "run-01",
      status: "running",
      health: "healthy",
      imageId: service === "app" ? appImageId : `${service}:image`
    }))
  };
}
