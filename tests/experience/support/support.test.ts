import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { CaseReportSchema, type CaseReport } from "../evidence/contracts";
import type { FinishCaseInput } from "../evidence/recorder";
import { ActorPool } from "./actor-pool";
import { createBrowserMonitorLifecycle, settleBrowserMonitors } from "./browser-monitor";
import { ProductAssertionError, observeProduct } from "./experience-test";
import { ExperienceCaseRunError, runExperienceCase } from "./run-case";
import { installBrowserTelemetry, projectWebSocketPayload, type TelemetryEvent } from "./telemetry";

const outputRoots: string[] = [];

afterEach(async () => {
  await Promise.all(outputRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("experience support", () => {
  it("settles through the real cancelled-rAF-poll race and consumes browser state", async () => {
    const scope = new Map<string, { cancelled: boolean; done: boolean; value: number }>();
    scope.set("monitor", { cancelled: false, done: false, value: 0 });
    const monitor = createBrowserMonitorLifecycle<number>({
      observe: async (signal) => {
        while (!signal.aborted) {
          const state = scope.get("monitor");
          if (state?.done) return state.value;
          await delay(16, undefined, { signal });
        }
        throw signal.reason;
      },
      cancelBrowser: async () => {
        const state = scope.get("monitor");
        if (state) state.cancelled = true;
        await delay(0);
        if (scope.get("monitor")?.cancelled) scope.delete("monitor");
      },
      cleanupBrowser: async () => { scope.delete("monitor"); }
    });

    await expect(Promise.race([
      settleBrowserMonitors([monitor]),
      delay(100).then(() => { throw new Error("monitor cleanup exceeded failure-path budget"); })
    ])).resolves.toBeUndefined();
    expect(scope.has("monitor")).toBe(false);
  });

  it("projects WebSocket frames into safe fields without retaining raw payloads", () => {
    const projection = projectWebSocketPayload(JSON.stringify({
      type: "room_snapshot",
      participantToken: "participant-secret",
      payload: {
        flow: { phase: "betting", sequence: 9 },
        hand: {
          number: 4,
          street: "flop",
          board: ["Ac", "Kd", "7h"],
          pot: 180,
          actorId: "p2",
          seats: [{ participantId: "p1", holeCards: ["As", "Ah"] }],
          actions: [{ playerId: "p1", type: "all-in" }, { playerId: "p2", type: "call", amount: 80 }]
        }
      }
    }));

    expect(projection).toEqual({
      type: "room_snapshot",
      phase: "betting",
      sequence: 9,
      handNumber: 4,
      street: "flop",
      boardLength: 3,
      board: ["Ac", "Kd", "7h"],
      actionIds: ["h4-a1-p1-all-in", "h4-a2-p2-call-80"],
      resultId: null,
      privateCardVisibility: { visible: true, cardCount: 2 },
      pot: 180,
      actor: "p2",
      privateCardKeyPresent: true
    });
    expect(JSON.stringify(projection)).not.toContain("participant-secret");
    expect(JSON.stringify(projection)).not.toContain("As");
    expect(JSON.stringify(projection)).not.toContain("raw");
    expect(projectWebSocketPayload("not-json")).toEqual({
      type: "malformed",
      phase: null,
      sequence: null,
      handNumber: null,
      street: null,
      boardLength: null,
      board: [],
      actionIds: [],
      resultId: null,
      privateCardVisibility: { visible: false, cardCount: 0 },
      pot: null,
      actor: null,
      privateCardKeyPresent: false
    });
  });

  it("does not classify documented showdown hole-card reveals as private payload", () => {
    const projection = projectWebSocketPayload(JSON.stringify({
      type: "room_snapshot",
      payload: { flow: { phase: "runout", sequence: 3 }, hand: { number: 1, seats: [{ participantId: "p1", holeCards: ["As", "Ah"] }] } }
    }));
    expect(projection.privateCardKeyPresent).toBe(true);
    expect(projection.privateCardVisibility).toEqual({ visible: false, cardCount: 0 });
  });

  it("still classifies private and undocumented hole-card paths during public reveal phases", () => {
    const malicious = projectWebSocketPayload(JSON.stringify({ payload: { flow: { phase: "runout" }, privateCards: ["As", "Ah"] } }));
    const undocumented = projectWebSocketPayload(JSON.stringify({ payload: { flow: { phase: "hand-summary" }, audit: { holeCards: ["Ks", "Kh"] } } }));
    expect(malicious.privateCardVisibility).toEqual({ visible: true, cardCount: 2 });
    expect(undocumented.privateCardVisibility).toEqual({ visible: true, cardCount: 2 });
  });

  it("installs telemetry before navigation and surfaces asynchronous sink failures on flush", async () => {
    const order: string[] = [];
    let binding: ((source: unknown, event: TelemetryEvent) => void) | undefined;
    const page = {
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => {
        order.push("binding");
        binding = callback;
      }),
      addInitScript: vi.fn(async () => { order.push("init-script"); }),
      on: vi.fn()
    } as unknown as Page;
    const telemetry = await installBrowserTelemetry(page, "host", async () => {
      throw new Error("evidence sink failed");
    });

    expect(order).toEqual(["binding", "init-script"]);
    binding?.({}, {
      kind: "websocket-message",
      wallTime: "2026-07-17T00:00:00.000Z",
      monotonicMs: 10,
      details: { projection: { type: "table_update" } }
    });
    await expect(telemetry.flush()).rejects.toThrow(/evidence sink failed/i);
  });

  it("drops undeclared binding fields instead of accepting page-supplied raw frames", async () => {
    let binding: ((source: unknown, event: TelemetryEvent) => void) | undefined;
    const captured: TelemetryEvent[] = [];
    const page = {
      exposeBinding: vi.fn(async (_name: string, callback: typeof binding) => { binding = callback; }),
      addInitScript: vi.fn(async () => undefined),
      on: vi.fn()
    } as unknown as Page;
    const telemetry = await installBrowserTelemetry(page, "host", async (event) => {
      captured.push(event);
    });

    binding?.({}, {
      kind: "websocket-message",
      wallTime: "2026-07-17T00:00:00.000Z",
      monotonicMs: 10,
      details: {
        projection: { type: "table_update", phase: "betting", actor: "p1" },
        rawFrame: "participant-secret"
      }
    });
    await telemetry.flush();

    expect(captured).toEqual([{
      kind: "websocket-message",
      wallTime: "2026-07-17T00:00:00.000Z",
      monotonicMs: 10,
      details: {
        actor: "host",
        projection: {
          type: "table_update",
          phase: "betting",
          sequence: null,
          handNumber: null,
          street: null,
          boardLength: null,
          board: [],
          actionIds: [],
          resultId: null,
          privateCardVisibility: { visible: false, cardCount: 0 },
          pot: null,
          actor: "p1",
          privateCardKeyPresent: false
        }
      }
    }]);
    expect(JSON.stringify(captured)).not.toContain("participant-secret");
    expect(JSON.stringify(captured)).not.toContain("rawFrame");
  });

  it("captures only allowlisted metadata for arbitrary console and page-error diagnostics", async () => {
    const handlers = new Map<string, (value: unknown) => void>();
    const captured: TelemetryEvent[] = [];
    const page = {
      exposeBinding: vi.fn(async () => undefined),
      addInitScript: vi.fn(async () => undefined),
      on: vi.fn((name: string, handler: (value: unknown) => void) => {
        handlers.set(name, handler);
      })
    } as unknown as Page;
    const telemetry = await installBrowserTelemetry(page, "host", async (event) => {
      captured.push(event);
    });

    const diagnostics = [
      "participant token is p-secret; private cards are As Ah",
      "holeCards=As,Ah and hole cards are Kd Qc",
      "CrEdEnTiAl=MiXeD-Secret PrIvAtEcArDs=Qs,Jh",
      "participantToken%3Dencoded-secret%26holeCards%3D7s%2C8h",
      "password=line-secret\nholeCards=9c,\nTd"
    ];
    for (const diagnostic of diagnostics) {
      handlers.get("console")?.({
        type: () => "error",
        text: () => diagnostic
      });
      handlers.get("pageerror")?.(new Error(diagnostic));
    }
    await telemetry.flush();

    expect(captured).toHaveLength(diagnostics.length * 2);
    for (const [index, event] of captured.entries()) {
      const diagnostic = diagnostics[Math.floor(index / 2)];
      const consoleEvent = index % 2 === 0;
      expect(event).toMatchObject({
        kind: consoleEvent ? "console-error" : "page-error",
        details: {
          actor: "host",
          source: consoleEvent ? "console" : "page",
          type: consoleEvent ? "console-error" : "uncaught-exception",
          severity: "error",
          originalLength: diagnostic.length,
          diagnostic: "[REDACTED]"
        }
      });
      expect(Object.keys(event.details).sort()).toEqual([
        "actor",
        "diagnostic",
        "originalLength",
        "severity",
        "source",
        "type"
      ]);
    }
    const serialized = JSON.stringify(captured);
    for (const secret of [
      "p-secret",
      "private cards are As Ah",
      "holeCards=As,Ah",
      "Kd Qc",
      "MiXeD-Secret",
      "Qs,Jh",
      "encoded-secret",
      "7s%2C8h",
      "line-secret",
      "9c",
      "Td",
      "As",
      "Ah"
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("message");
  });

  it("passes the DOM checkpoint through the serialized page.evaluate argument boundary", async () => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelector: () => null,
        querySelectorAll: () => []
      }
    });
    const evaluate = vi.fn(async (
      callback: (checkpoint: string) => unknown,
      checkpoint?: string
    ) => {
      const reconstructed = new Function(`return (${callback.toString()})`)() as (
        value: string | undefined
      ) => unknown;
      return reconstructed(checkpoint);
    });
    const page = {
      exposeBinding: vi.fn(async () => undefined),
      addInitScript: vi.fn(async () => undefined),
      on: vi.fn(),
      evaluate
    } as unknown as Page;

    try {
      const telemetry = await installBrowserTelemetry(page, "host", async () => undefined);
      await expect(telemetry.captureDomCheckpoint("serialized checkpoint")).resolves.toMatchObject({
        details: { actor: "host", checkpoint: "serialized checkpoint" }
      });
      expect(evaluate).toHaveBeenCalledWith(expect.any(Function), "serialized checkpoint");
    } finally {
      if (previousDocument) {
        Object.defineProperty(globalThis, "document", previousDocument);
      } else {
        Reflect.deleteProperty(globalThis, "document");
      }
    }
  });

  it("formats product assertion failures with the complete diagnostic context", () => {
    const error = new ProductAssertionError({
      assertionId: "EXP-003-A03",
      caseId: "EXP-003",
      attemptId: "A-001",
      actor: "player-2",
      earliestDivergentProjection: { sequence: 7, actor: "p3" },
      measuredValue: 1_001,
      threshold: 1_000,
      artifactIds: ["SHOT-1", "TRACE-2"]
    });

    expect(error.message).toContain("case=EXP-003");
    expect(error.message).toContain("attempt=A-001");
    expect(error.message).toContain("actor=player-2");
    expect(error.message).toContain('earliestDivergentProjection={"sequence":7,"actor":"p3"}');
    expect(error.message).toContain("measured=1001");
    expect(error.message).toContain("threshold=1000");
    expect(error.message).toContain("artifacts=SHOT-1,TRACE-2");
  });

  it("classifies a bounded UI observation timeout as a product failure and preserves other errors", async () => {
    const context = {
      assertionId: "EXP-002-A03",
      caseId: "EXP-002",
      attemptId: "A-001",
      actor: "host",
      earliestDivergentProjection: null,
      measuredValue: { visible: false },
      threshold: { visible: true },
      artifactIds: []
    };
    const timeout = Object.assign(new Error("locator timed out"), { name: "TimeoutError" });
    const transport = new Error("socket reset");

    await expect(observeProduct(async () => { throw timeout; }, context)).rejects.toMatchObject({
      name: "ProductAssertionError",
      context
    });
    await expect(observeProduct(async () => { throw transport; }, context)).rejects.toBe(transport);
  });

  it("keeps browser and transport faults inconclusive while bounded expected-state misses are product failures", async () => {
    const context = {
      assertionId: "EXP-006-A05", caseId: "EXP-006", attemptId: "A-001", actor: "target",
      earliestDivergentProjection: { handNumber: 2 }, measuredValue: "pending", threshold: "hand 3", artifactIds: []
    };
    const boundedMiss = Object.assign(new Error("expected hand boundary was not observed"), { name: "TimeoutError" });
    const browserCrash = Object.assign(new Error("page closed"), { name: "TargetClosedError" });
    const transport = Object.assign(new Error("websocket reset"), { code: "ECONNRESET" });

    await expect(observeProduct(async () => { throw boundedMiss; }, context)).rejects.toBeInstanceOf(ProductAssertionError);
    await expect(observeProduct(async () => { throw browserCrash; }, context)).rejects.toBe(browserCrash);
    await expect(observeProduct(async () => { throw transport; }, context)).rejects.toBe(transport);
  });

  it("preserves both declared attempts with separate fixtures before throwing a product failure", async () => {
    const events: string[] = [];
    const fixtures: object[] = [];

    const promise = runExperienceCase({
      runId: "RUN-1",
      caseId: "EXP-003",
      createFixture: async ({ attemptId }) => {
        const fixture = { attemptId };
        fixtures.push(fixture);
        events.push(`create:${attemptId}`);
        return fixture;
      },
      execute: async ({ attemptId }) => {
        events.push(`execute:${attemptId}`);
        if (attemptId === "A-001") {
          throw new ProductAssertionError({
            assertionId: "EXP-003-A03",
            caseId: "EXP-003",
            attemptId,
            actor: "player-1",
            earliestDivergentProjection: { sequence: 4 },
            measuredValue: 1_001,
            threshold: 1_000,
            artifactIds: ["SHOT-1"]
          });
        }
        return passingFinishInput("EXP-003-A03");
      },
      recorderFactory: ({ attemptId }) => fakeRecorder(attemptId, events),
      persistFallbackReport: fallbackReport,
      disposeFixture: async (_fixture, { attemptId }) => {
        events.push(`dispose:${attemptId}`);
      }
    });

    await expect(promise).rejects.toMatchObject({
      name: "ExperienceCaseRunError",
      reports: [
        { attemptId: "A-001", verdict: "FAIL", results: { product: { status: "fail" }, harness: { status: "pass" } } },
        { attemptId: "A-002", verdict: "PASS" }
      ]
    });
    expect(fixtures).toHaveLength(2);
    expect(fixtures[0]).not.toBe(fixtures[1]);
    expect(events).toEqual([
      "create:A-001",
      "execute:A-001",
      "persist:A-001:FAIL",
      "dispose:A-001",
      "persist:A-001:FAIL",
      "create:A-002",
      "execute:A-002",
      "persist:A-002:PASS",
      "dispose:A-002",
      "persist:A-002:PASS"
    ]);
  });

  it("durably records a recorder initialization failure and continues to the later attempt", async () => {
    const events: string[] = [];
    const promise = runExperienceCase({
      runId: "RUN-recorder",
      caseId: "EXP-003",
      createFixture: async ({ attemptId }) => ({ attemptId }),
      execute: async () => passingFinishInput("EXP-003-A01"),
      recorderFactory: ({ attemptId }) => {
        events.push(`recorder:${attemptId}`);
        if (attemptId === "A-001") {
          throw new Error("recorder unavailable");
        }
        return fakeRecorder(attemptId, events);
      },
      persistFallbackReport: async ({ attemptId }, input) => {
        events.push(`fallback-persist:${attemptId}:${input.verdict}`);
        return makeReport(attemptId, input);
      },
      disposeFixture: async () => undefined
    });

    await expect(promise).rejects.toMatchObject({
      name: "ExperienceCaseRunError",
      reports: [
        {
          attemptId: "A-001",
          verdict: "INCONCLUSIVE",
          results: { harness: { status: "inconclusive" } }
        },
        { attemptId: "A-002", verdict: "PASS" }
      ],
      persistenceErrors: []
    });
    expect(events).toEqual([
      "recorder:A-001",
      "fallback-persist:A-001:INCONCLUSIVE",
      "recorder:A-002",
      "persist:A-002:PASS",
      "persist:A-002:PASS"
    ]);
  });

  it("persists the execution result before cleanup and then durably records cleanup failure", async () => {
    const events: string[] = [];

    const promise = runExperienceCase({
      runId: "RUN-cleanup",
      caseId: "EXP-001",
      createFixture: async () => ({ fixture: true }),
      execute: async () => passingFinishInput("EXP-001-A01"),
      recorderFactory: ({ attemptId }) => fakeRecorder(attemptId, events),
      persistFallbackReport: fallbackReport,
      disposeFixture: async () => {
        events.push("dispose:A-001");
        throw new Error("context close failed");
      }
    });

    await expect(promise).rejects.toMatchObject({
      name: "ExperienceCaseRunError",
      reports: [{
        attemptId: "A-001",
        verdict: "INCONCLUSIVE",
        results: {
          product: { status: "pass" },
          harness: { status: "inconclusive" }
        },
        failures: [expect.objectContaining({
          code: "HARNESS_RUNTIME_FAILURE",
          summary: "context close failed"
        })]
      }]
    });
    expect(events).toEqual([
      "persist:A-001:PASS",
      "dispose:A-001",
      "persist:A-001:INCONCLUSIVE"
    ]);
  });

  it("cleans up and persists an inconclusive report when the pre-cleanup write fails", async () => {
    const events: string[] = [];
    let firstAttemptWrites = 0;

    const promise = runExperienceCase({
      runId: "RUN-write-failure",
      caseId: "EXP-003",
      createFixture: async ({ attemptId }) => ({ attemptId }),
      execute: async () => passingFinishInput("EXP-003-A01"),
      recorderFactory: ({ attemptId }) => ({
        async finishCase(input: FinishCaseInput) {
          if (attemptId === "A-001" && firstAttemptWrites++ === 0) {
            events.push("persist:A-001:ERROR");
            throw new Error("pre-cleanup write failed");
          }
          events.push(`persist:${attemptId}:${input.verdict}`);
          return makeReport(attemptId, input);
        }
      }),
      persistFallbackReport: fallbackReport,
      disposeFixture: async (_fixture, { attemptId }) => {
        events.push(`dispose:${attemptId}`);
      }
    });

    await expect(promise).rejects.toMatchObject({
      name: "ExperienceCaseRunError",
      reports: [
        {
          attemptId: "A-001",
          verdict: "INCONCLUSIVE",
          results: { product: { status: "pass" }, harness: { status: "inconclusive" } }
        },
        { attemptId: "A-002", verdict: "PASS" }
      ],
      persistenceErrors: []
    });
    expect(events).toEqual([
      "persist:A-001:ERROR",
      "dispose:A-001",
      "persist:A-001:INCONCLUSIVE",
      "persist:A-002:PASS",
      "dispose:A-002",
      "persist:A-002:PASS"
    ]);
  });

  it("uses fallback persistence when the final primary report write fails", async () => {
    const events: string[] = [];
    let primaryWrites = 0;
    const promise = runExperienceCase({
      runId: "RUN-final-write-failure",
      caseId: "EXP-001",
      createFixture: async () => ({ fixture: true }),
      execute: async () => passingFinishInput("EXP-001-A01"),
      recorderFactory: () => ({
        async finishCase(input: FinishCaseInput) {
          primaryWrites += 1;
          if (primaryWrites === 2) {
            events.push("primary:INCONCLUSIVE:ERROR");
            throw new Error("final primary write failed");
          }
          events.push(`primary:${input.verdict}`);
          return makeReport("A-001", input);
        }
      }),
      persistFallbackReport: async ({ attemptId }, input) => {
        events.push(`fallback:${input.verdict}`);
        return makeReport(attemptId, input);
      },
      disposeFixture: async () => {
        events.push("dispose:A-001");
        throw new Error("context close failed");
      }
    });

    await expect(promise).rejects.toMatchObject({
      name: "ExperienceCaseRunError",
      persistenceErrors: [],
      reports: [{
        verdict: "INCONCLUSIVE",
        results: { product: { status: "pass" }, harness: { status: "inconclusive" } },
        failures: [
          expect.objectContaining({ stage: "attempt-reporting", summary: "final primary write failed" }),
          expect.objectContaining({ stage: "attempt-cleanup", summary: "context close failed" })
        ]
      }]
    });
    expect(events).toEqual([
      "primary:PASS",
      "dispose:A-001",
      "primary:INCONCLUSIVE:ERROR",
      "fallback:INCONCLUSIVE"
    ]);
  });

  it("records product assertion and cleanup failures in the same durable report", async () => {
    const events: string[] = [];
    const promise = runExperienceCase({
      runId: "RUN-product-cleanup",
      caseId: "EXP-001",
      createFixture: async () => ({ fixture: true }),
      execute: async () => {
        throw new ProductAssertionError({
          assertionId: "EXP-001-A01",
          caseId: "EXP-001",
          attemptId: "A-001",
          actor: "host",
          earliestDivergentProjection: null,
          measuredValue: false,
          threshold: true,
          artifactIds: ["TRACE-1"]
        });
      },
      recorderFactory: ({ attemptId }) => fakeRecorder(attemptId, events),
      persistFallbackReport: fallbackReport,
      disposeFixture: async () => { throw new Error("context close failed"); }
    });

    await expect(promise).rejects.toMatchObject({
      name: "ExperienceCaseRunError",
      reports: [{
        verdict: "INCONCLUSIVE",
        results: { product: { status: "fail" }, harness: { status: "inconclusive" } },
        failures: [
          expect.objectContaining({ code: "PRODUCT_ASSERTION_FAILED" }),
          expect.objectContaining({ code: "HARNESS_RUNTIME_FAILURE", stage: "attempt-cleanup" })
        ]
      }]
    });
  });

  it("classifies unexpected runtime errors as harness inconclusive for every attempt", async () => {
    const reports: CaseReport[] = [];
    await expect(runExperienceCase({
      runId: "RUN-2",
      caseId: "EXP-008",
      createFixture: async ({ attemptId }) => ({ attemptId }),
      execute: async () => {
        throw new Error("browser crashed");
      },
      recorderFactory: ({ attemptId }) => ({
        async finishCase(input: FinishCaseInput) {
          const report = makeReport(attemptId, input);
          reports.push(report);
          return report;
        }
      }),
      persistFallbackReport: fallbackReport,
      disposeFixture: async () => undefined
    })).rejects.toBeInstanceOf(ExperienceCaseRunError);

    expect(reports).toHaveLength(4);
    expect(reports.every((report) => report.verdict === "INCONCLUSIVE")).toBe(true);
    expect(reports.every((report) => report.results.harness.status === "inconclusive")).toBe(true);
    expect(reports.every((report) => report.results.product.status === "inconclusive")).toBe(true);
  });

  it("starts traces only after traceReady and stops every active trace even after a stop failure", async () => {
    const starts: number[] = [];
    const stops: number[] = [];
    const closes: number[] = [];
    let index = 0;
    const browser = {
      async newContext() {
        const actorIndex = index++;
        const page = { on: vi.fn(), addInitScript: vi.fn(), exposeBinding: vi.fn() } as unknown as Page;
        return {
          tracing: {
            start: vi.fn(async () => { starts.push(actorIndex); }),
            stop: vi.fn(async () => {
              stops.push(actorIndex);
              if (actorIndex === 0) throw new Error("trace stop failed");
            })
          },
          newPage: vi.fn(async () => page),
          close: vi.fn(async () => { closes.push(actorIndex); })
        } as unknown as BrowserContext;
      }
    } as unknown as Browser;
    const pool = new ActorPool({ browser, outputRoot: await temporaryOutputRoot(), telemetrySink: async () => undefined });

    const actors = await pool.createActors({ playerCount: 4, includeSpectator: true });
    expect(actors.map(({ metadata }) => metadata.role)).toEqual([
      "host", "player", "player", "player", "player", "spectator"
    ]);
    expect(starts).toEqual([]);
    await pool.startTraceAfterBootstrap("host", { traceReady: true });
    await pool.startTraceAfterBootstrap("player-1", { traceReady: true });
    expect(starts).toEqual([0, 1]);

    await expect(pool.closeAll()).rejects.toThrow(/trace stop failed/i);
    expect(stops).toEqual([0, 1]);
    expect([...closes].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("flushes telemetry emitted while browser contexts close before closeAll resolves", async () => {
    let releaseSink!: () => void;
    const sinkGate = new Promise<void>((resolve) => { releaseSink = resolve; });
    let pendingSinkEvents = 0;
    const browser = {
      async newContext() {
        let binding: ((source: unknown, event: TelemetryEvent) => void) | undefined;
        const page = {
          on: vi.fn(),
          addInitScript: vi.fn(),
          exposeBinding: vi.fn(async (_name, callback) => { binding = callback; })
        } as unknown as Page;
        return {
          tracing: { start: vi.fn(), stop: vi.fn() },
          newPage: vi.fn(async () => page),
          close: vi.fn(async () => {
            binding?.({}, {
              kind: "websocket-close",
              wallTime: "2026-07-17T00:00:00.000Z",
              monotonicMs: 1,
              details: { code: 1000, wasClean: true }
            });
          })
        } as unknown as BrowserContext;
      }
    } as unknown as Browser;
    const pool = new ActorPool({
      browser,
      outputRoot: await temporaryOutputRoot(),
      telemetrySink: async () => {
        pendingSinkEvents += 1;
        await sinkGate;
      }
    });
    await pool.createActors({ playerCount: 4, includeSpectator: true });

    const close = pool.closeAll();
    await vi.waitFor(() => expect(pendingSinkEvents).toBe(6));
    try {
      await expect(Promise.race([
        close.then(() => "closed" as const),
        delay(25).then(() => "waiting" as const)
      ])).resolves.toBe("waiting");
    } finally {
      releaseSink();
    }
    await close;
  });

  it("closes actors already created when a later actor context fails", async () => {
    const close = vi.fn(async () => undefined);
    let contextCount = 0;
    const browser = {
      async newContext() {
        if (contextCount++ === 1) {
          throw new Error("context allocation failed");
        }
        return {
          tracing: { start: vi.fn(), stop: vi.fn() },
          newPage: vi.fn(async () => ({
            on: vi.fn(),
            addInitScript: vi.fn(),
            exposeBinding: vi.fn()
          })),
          close
        };
      }
    } as unknown as Browser;
    const pool = new ActorPool({
      browser,
      outputRoot: await temporaryOutputRoot(),
      telemetrySink: async () => undefined
    });

    await expect(pool.createActors({ playerCount: 4 })).rejects.toThrow(/context allocation failed/i);
    expect(close).toHaveBeenCalledOnce();
    expect(pool.list()).toEqual([]);
  });

  it("preserves creation failures and retries a partial context close through closeAll", async () => {
    let closeAttempts = 0;
    const close = vi.fn(async () => {
      closeAttempts += 1;
      if (closeAttempts === 1) {
        throw new Error("first close failed");
      }
    });
    const browser = {
      async newContext() {
        return {
          tracing: { start: vi.fn(), stop: vi.fn() },
          newPage: vi.fn(async () => { throw new Error("page creation failed"); }),
          close
        };
      }
    } as unknown as Browser;
    const pool = new ActorPool({
      browser,
      outputRoot: await temporaryOutputRoot(),
      telemetrySink: async () => undefined
    });

    await expect(pool.createActors({ playerCount: 4 })).rejects.toThrow(/page creation failed.*first close failed/i);
    expect(close).toHaveBeenCalledTimes(2);
    expect(pool.list()).toEqual([]);
  });
});

async function temporaryOutputRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "experience-actor-pool-"));
  outputRoots.push(root);
  return root;
}

function passingFinishInput(assertionId: string): FinishCaseInput {
  return {
    verdict: "PASS",
    results: {
      product: { status: "pass", summary: "Product passed.", evidenceEventIds: [] },
      harness: { status: "pass", summary: "Harness passed.", evidenceEventIds: [] },
      environment: { status: "pass", summary: "Environment passed.", evidenceEventIds: [] }
    },
    assertions: [{ id: assertionId, outcome: "pass", evidenceEventIds: [], summary: "Passed." }],
    failures: []
  };
}

function fakeRecorder(attemptId: string, events: string[]) {
  return {
    async finishCase(input: FinishCaseInput): Promise<CaseReport> {
      events.push(`persist:${attemptId}:${input.verdict}`);
      return makeReport(attemptId, input);
    }
  };
}

function makeReport(attemptId: string, input: FinishCaseInput): CaseReport {
  return CaseReportSchema.parse({
    schemaVersion: "1.0",
    runId: "RUN-1",
    caseId: "EXP-003",
    attemptId,
    startedAt: "2026-07-17T00:00:00.000Z",
    finishedAt: "2026-07-17T00:00:01.000Z",
    ...input,
    artifacts: []
  });
}

async function fallbackReport(
  { attemptId }: { attemptId: string },
  input: FinishCaseInput
): Promise<CaseReport> {
  return makeReport(attemptId, input);
}
