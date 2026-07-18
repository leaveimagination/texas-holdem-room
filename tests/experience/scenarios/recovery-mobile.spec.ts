import { mkdir, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  assertCenterPointHit,
  assertMinimumHitTarget,
  assertNoViewportOverflow,
} from "../assertions/layout";
import { EXPERIENCE_CASES } from "../case-catalog";
import type { EvidenceEvent } from "../evidence/contracts";
import { EXPERIENCE_THRESHOLDS } from "../evidence/contracts";
import { EvidenceRecorder, type FinishCaseInput } from "../evidence/recorder";
import {
  ExperienceApiClient,
  bootstrapBrowserIdentity,
} from "../fixtures/api-client";
import {
  buildReconnectFixture,
  buildTopUpAccountingFixture,
} from "../fixtures/builders";
import {
  consumeFixtureSeedBrokerForPlaywrightWorker,
  seedFixtureThroughBroker,
  type SeedFixtureDescriptor,
} from "../fixtures/seed-broker-client";
import type { KnownSecretRegistry, PokerFixture } from "../fixtures/types";
import { RoomPage } from "../page-objects/room-page";
import { ActorPool, type ActorHandle } from "../support/actor-pool";
import {
  ProductAssertionError,
  assertProductCondition,
  observeProduct,
} from "../support/experience-test";
import {
  exactJourneyMatches,
  observedTimeline,
  privacySamples,
  privacyTimelineIsSafe,
  requiredControlEvidenceComplete,
  requiredCountsPresent,
  type ObservedFlowFrame,
} from "../support/recovery-observation";
import {
  runExperienceCase,
  type AttemptCoordinates,
} from "../support/run-case";
import type { TelemetryEvent } from "../support/telemetry";

const BROKER = consumeFixtureSeedBrokerForPlaywrightWorker();
const ASSERTIONS = {
  "EXP-008": ["EXP-008-A01", "EXP-008-A02", "EXP-008-A03", "EXP-008-A04"],
  "EXP-009": [
    "EXP-009-A01",
    "EXP-009-A02",
    "EXP-009-A03",
    "EXP-009-A04",
    "EXP-009-A05",
  ],
} as const;
const MOBILE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
};

test("EXP-008 reconnects actor, host, and spectator without corrupting flow", async ({
  browser,
}) => {
  test.setTimeout(caseTimeout("EXP-008") * 2 + 30_000);
  await runCase(
    browser,
    "EXP-008",
    undefined,
    async ({ fixture: f, coordinates }) => {
      const journeys: ReconnectJourneyEvidence[] = [];
      for (const role of ["actor", "host", "spectator"] as const) {
        for (const timing of ["before-deadline", "after-deadline"] as const) {
          journeys.push(await reconnectJourney(f, coordinates, role, timing));
        }
      }
      await pass(f, "EXP-008-A01", {
        journeys: journeys.map(
          ({ role, timing, guidanceMs, recoveryMs, freshRoomId }) => ({
            role,
            timing,
            guidanceMs,
            recoveryMs,
            freshRoomId,
          }),
        ),
        maxGuidanceMs: 800,
        maxDeadStateMs: 3000,
      });
      await pass(f, "EXP-008-A02", {
        journeys: journeys.map(
          ({ role, timing, before, recovered, timeline }) => ({
            role,
            timing,
            before,
            recovered,
            timeline,
          }),
        ),
      });
      await pass(f, "EXP-008-A03", {
        journeys: journeys.map(
          ({ role, timing, actionIds, resultIds, timeline }) => ({
            role,
            timing,
            actionIds,
            resultIds,
            timeline,
          }),
        ),
      });
      await pass(f, "EXP-008-A04", {
        journeys: journeys.map(({ role, timing, privacy }) => ({
          role,
          timing,
          privacy,
        })),
      });
      return finish(f, "EXP-008");
    },
  );
});

test("EXP-009 completes the touch mobile poker journey at 390x844", async ({
  browser,
}) => {
  test.setTimeout(caseTimeout("EXP-009") * 2 + 30_000);
  await runCase(
    browser,
    "EXP-009",
    MOBILE,
    async ({ fixture: f, coordinates }) => {
      const poker = buildTopUpAccountingFixture({
        runId: env().runId,
        participantIds: placeholderIds(["target", "opponent"]),
      });
      let lobbyCheckpoint = false;
      const room = await provision(
        f,
        poker,
        ["target", "opponent"],
        coordinates,
        "EXP-009-A01",
        {
          traceBeforeJoinRole: "target",
          claimBeforeSeed: { role: "target", seatNumber: 1 },
          beforeSeed: async ({ actor }) => {
            f.evidenceActor = actor;
            await mobileCheckpoint(
              f,
              actor,
              coordinates,
              "lobby",
              [actor.page.getByRole("button", { name: "Claim seat 1" })],
              true,
            );
            lobbyCheckpoint = true;
          },
        },
      );
      const target = f.pool.get("player-1");
      const host = f.pool.get("host");
      f.evidenceActor = target;
      await collect(f, "EXP-009-A01", async () =>
        product(
          lobbyCheckpoint && room.claimedSeat?.seatNumber === 1,
          coordinates,
          "EXP-009-A01",
          "target",
          { lobbyCheckpoint, claimedSeat: room.claimedSeat },
          { visibleJoinTraced: true, lobbyBeforeSeed: true, claimedSeat: 1 },
        ),
      );
      await step(f, "EXP-009-A01", coordinates, "target", "open top-up", () =>
        target.page
          .getByText("Add chips", { exact: true })
          .click({ timeout: 3_000 }),
      );
      await mobileCheckpoint(
        f,
        target,
        coordinates,
        "top-up-open",
        [
          target.page.getByRole("spinbutton", { name: "Add chips amount" }),
          target.page.getByRole("button", { name: "Add next hand" }),
        ],
        true,
      );
      await step(
        f,
        "EXP-009-A01",
        coordinates,
        "target",
        "enter top-up amount",
        () =>
          target.page
            .getByRole("spinbutton", { name: "Add chips amount" })
            .fill("300", { timeout: 3_000 }),
      );
      await step(f, "EXP-009-A01", coordinates, "target", "queue top-up", () =>
        target.page
          .getByRole("button", { name: "Add next hand" })
          .click({ timeout: 3_000 }),
      );
      await step(
        f,
        "EXP-009-A01",
        coordinates,
        "host",
        "open host controls",
        () => room.pages.host.openHostControls(),
      );
      await mobileCheckpoint(f, host, coordinates, "host-controls", [
        host.page.getByRole("button", { name: "End room" }),
        host.page.getByRole("textbox", { name: "Disconnected participant" }),
        host.page.getByRole("button", { name: "Pause for disconnect" }),
      ]);
      await mobileCheckpoint(
        f,
        target,
        coordinates,
        "active-betting",
        [
          target.page.locator('[data-action-type="fold"]'),
          target.page.locator('[data-action-type="all-in"]'),
        ],
        true,
      );
      const runout = observeMobileRunout(target.page);
      await step(f, "EXP-009-A01", coordinates, "target", "all-in", () =>
        room.pages.target.performAction("all-in"),
      );
      await step(f, "EXP-009-A01", coordinates, "opponent", "call", () =>
        room.pages.opponent.performAction("call"),
      );
      let runoutFrames: Array<{
        phase: string;
        sequence: number;
        boardLength: number;
        atMs: number;
      }> = [];
      await collect(f, "EXP-009-A05", async () => {
        runoutFrames = await expected(
          runout,
          coordinates,
          "EXP-009-A05",
          "target",
          "showdown then five one-card runout steps",
        );
      });
      await collect(f, "EXP-009-A05", async () =>
        product(
          JSON.stringify(
            runoutFrames.map(({ phase, boardLength }) => [phase, boardLength]),
          ) ===
            JSON.stringify([
              ["showdown-reveal", 0],
              ["runout", 1],
              ["runout", 2],
              ["runout", 3],
              ["runout", 4],
              ["runout", 5],
              ["hand-summary", 5],
            ]),
          coordinates,
          "EXP-009-A05",
          "target",
          runoutFrames,
          "showdown, board 1..5, hand-summary",
        ),
      );
      await collect(f, "EXP-009-A01", async () => {
        await expected(
          target.page
            .locator('[aria-label="Hand result"]')
            .waitFor({ timeout: 12_000 }),
          coordinates,
          "EXP-009-A01",
          "target",
          "mobile hand result",
        );
      });
      await mobileCheckpoint(
        f,
        target,
        coordinates,
        "hand-result",
        [target.page.locator('[aria-label="Hand result"]')],
        true,
      );
      await collect(f, "EXP-009-A05", async () => {
        await expected(
          target.page
            .locator('[aria-label="Table"][data-hand-number="2"]')
            .waitFor({ timeout: 8_000 }),
          coordinates,
          "EXP-009-A05",
          "target",
          "next mobile hand",
        );
      });
      await step(
        f,
        "EXP-009-A01",
        coordinates,
        "host",
        "request room end",
        () => room.pages.host.requestRoomEnd(),
      );
      const opponent = f.pool.get("player-2");
      const finalFold = opponent.page.locator('[data-action-type="fold"]');
      await mobileCheckpoint(f, opponent, coordinates, "final-hand-betting", [
        finalFold,
      ]);
      // Center-hit failure is already durable product evidence above. Force is used
      // only to keep collecting the required session-result evidence after a real
      // mobile overlay blocks this action; it never turns that failure into PASS.
      await step(
        f,
        "EXP-009-A01",
        coordinates,
        "opponent",
        "forced continuation after recorded occlusion",
        () =>
          finalFold.evaluate(
            (button: HTMLButtonElement) => button.click(),
            undefined,
            { timeout: 3_000 },
          ),
      );
      await collect(f, "EXP-009-A01", async () => {
        await expected(
          target.page
            .locator('[aria-label="Session results"]')
            .waitFor({ timeout: 12_000 }),
          coordinates,
          "EXP-009-A01",
          "target",
          "mobile session result",
        );
      });
      await mobileCheckpoint(
        f,
        target,
        coordinates,
        "session-result",
        [target.page.locator('[aria-label="Session results"]')],
        true,
      );
      await pass(f, "EXP-009-A01", {
        observedJourney: [
          "visible-join",
          "claim-seat-1",
          "betting",
          "top-up-300",
          "host-controls",
          "all-in",
          "call",
          "five-card-runout",
          "hand-result",
          "end-after-current-hand",
          "session-result",
        ],
        claimedSeat: room.claimedSeat,
      });
      await pass(f, "EXP-009-A05", {
        viewport: target.page.viewportSize(),
        touch: true,
        userAgent: await target.page.evaluate(() => navigator.userAgent),
      });
      return finish(f, "EXP-009");
    },
  );
});

type CaseId = keyof typeof ASSERTIONS;
interface Env {
  runId: string;
  baseUrl: string;
  outputRoot: string;
  caseOutputRoot: string;
  broker: NonNullable<typeof BROKER>;
}
interface Fx {
  pool: ActorPool;
  recorder: EvidenceRecorder;
  outputRoot: string;
  events: Map<string, EvidenceEvent[]>;
  failures: Map<string, ProductAssertionError[]>;
  telemetryEvents: TelemetryEvent[];
  evidenceActor: ActorHandle | null;
  secrets: Secrets;
}
class Secrets implements KnownSecretRegistry {
  values: string[] = [];
  add(value: string | Uint8Array) {
    const text =
      typeof value === "string" ? value : Buffer.from(value).toString();
    if (text && !this.values.includes(text)) this.values.push(text);
  }
}

type ReconnectRole = "actor" | "host" | "spectator";
type ReconnectTiming = "before-deadline" | "after-deadline";
interface ReconnectJourneyEvidence {
  role: ReconnectRole;
  timing: ReconnectTiming;
  freshRoomId: string;
  guidanceMs: number | null;
  recoveryMs: number;
  before: Awaited<ReturnType<RoomPage["readProjection"]>>;
  recovered: Awaited<ReturnType<RoomPage["readProjection"]>>;
  timeline: ObservedFlowFrame[];
  actionIds: string[];
  resultIds: string[];
  privacy: Awaited<ReturnType<typeof readPrivacyFacts>>;
}

async function reconnectJourney(
  f: Fx,
  c: AttemptCoordinates,
  role: ReconnectRole,
  timing: ReconnectTiming,
): Promise<ReconnectJourneyEvidence> {
  // A new context for every authority in every subjourney prevents cookies, sockets,
  // pages, or participant identities from making one reconnect validate another.
  for (const actorId of [
    "host",
    "player-1",
    "player-2",
    "player-3",
    "player-4",
    "spectator",
  ])
    await f.pool.recreateActor(actorId);
  const poker = buildReconnectFixture({
    runId: env().runId,
    participantIds: placeholderIds(["actor", "opponent"]),
  });
  const room = await provision(
    f,
    poker,
    ["actor", "opponent"],
    c,
    "EXP-008-A01",
  );
  const observer = f.pool.get("player-2");
  const observedAt = f.telemetryEvents.length;
  await room.pages.actor.performAction("all-in");
  await room.pages.opponent.performAction("call");
  await collect(f, "EXP-008-A02", async () => {
    await expected(
      room.pages.spectator.waitForPhase("showdown-reveal", {
        sequence: 1,
        timeout: 3_000,
      }),
      c,
      "EXP-008-A02",
      `${role}-${timing}`,
      "showdown-reveal sequence 1",
    );
  });
  if (timing === "after-deadline")
    await collect(f, "EXP-008-A02", async () => {
      await expected(
        room.pages.spectator.waitForPhase("runout", {
          sequence: 2,
          timeout: 3_000,
        }),
        c,
        "EXP-008-A02",
        `${role}-${timing}`,
        "first runout step after deadline",
      );
    });

  const actorId = role === "actor" ? "player-1" : role;
  const original = f.pool.get(actorId);
  const originalRoom =
    role === "actor"
      ? room.pages.actor
      : role === "host"
        ? room.pages.host
        : room.pages.spectator;
  const before = await originalRoom.readProjection();
  const authoritativeTimeline = observeFlowToResult(observer.page, before);
  const disconnectedAt = performance.now();
  const replacement = await f.pool.recreateActor(actorId);

  // Exercise the product's real host disconnect command for a genuinely closed
  // acting-player socket, and verify that it changes the authoritative UI.
  if (role === "actor") {
    await room.pages.host.openHostControls();
    const hostPage = f.pool.get("host").page;
    await hostPage
      .getByRole("textbox", { name: "Disconnected participant" })
      .fill(room.ids.actor);
    await hostPage
      .getByRole("button", { name: "Pause for disconnect" })
      .click();
    await collect(f, "EXP-008-A01", async () => {
      await expected(
        hostPage
          .locator(
            `[data-participant-id="${room.ids.actor}"][data-seat-status="disconnected"]`,
          )
          .waitFor({
            state: "visible",
            timeout: EXPERIENCE_THRESHOLDS.localFeedbackMs,
          }),
        c,
        "EXP-008-A01",
        `${role}-${timing}-host-control`,
        "real disconnect control marks authoritative seat disconnected",
      );
    });
  }

  const recoveredRoom = roomPage(replacement);
  const url =
    role === "host"
      ? `${room.inviteUrl}?host=${encodeURIComponent(room.hostToken)}`
      : room.inviteUrl;
  const guidanceRemainingMs = Math.max(
    1,
    EXPERIENCE_THRESHOLDS.localFeedbackMs -
      (performance.now() - disconnectedAt),
  );
  const guidance = replacement.page.getByText("Reconnecting to table", {
    exact: true,
  });
  const guidanceObservation = guidance
    .waitFor({ state: "visible", timeout: guidanceRemainingMs })
    .then(
      () => performance.now() - disconnectedAt,
      () => null,
    );
  await replacement.page.goto(url);
  if (role === "host") await recoveredRoom.join(owner(env().runId, "host"));
  else if (role === "spectator")
    await recoveredRoom.join("Spectator", "spectator");
  else await recoveredRoom.join(room.names.actor);
  const guidanceMs = await guidanceObservation;
  await collect(f, "EXP-008-A01", async () => {
    await expected(
      replacement.page
        .getByRole("dialog", { name: "Join flow" })
        .waitFor({
          state: "hidden",
          timeout: EXPERIENCE_THRESHOLDS.unexplainedDeadStateMs,
        }),
      c,
      "EXP-008-A01",
      `${role}-${timing}`,
      "join dialog hidden before usable",
    );
  });
  const targetSequence = timing === "before-deadline" ? 1 : 2;
  await collect(f, "EXP-008-A01", async () =>
    product(
      guidanceMs !== null &&
        guidanceMs <= EXPERIENCE_THRESHOLDS.localFeedbackMs,
      c,
      "EXP-008-A01",
      `${role}-${timing}`,
      guidanceMs,
      EXPERIENCE_THRESHOLDS.localFeedbackMs,
    ),
  );
  await collect(f, "EXP-008-A01", async () => {
    await expected(
      replacement.page
        .locator('[aria-label="Table"]')
        .waitFor({
          state: "visible",
          timeout: EXPERIENCE_THRESHOLDS.unexplainedDeadStateMs,
        }),
      c,
      "EXP-008-A01",
      `${role}-${timing}`,
      { maxDeadStateMs: 3000 },
    );
  });
  const convergence = await waitForProjectionMatch(
    recoveredRoom,
    room.pages.opponent,
    EXPERIENCE_THRESHOLDS.crossViewConvergenceMs,
  );
  const recovered = convergence.recovered;
  const usable = await replacement.page.evaluate(
    (reconnectRole) => ({
      dialogHidden: !document.querySelector('[aria-label="Join flow"]'),
      tableVisible: Boolean(document.querySelector('[aria-label="Table"]')),
      roleControlVisible:
        reconnectRole !== "host" ||
        Boolean(document.querySelector('[data-control-panel="host"]')),
      enabledActionCount: document.querySelectorAll(
        "[data-action-type]:not([disabled])",
      ).length,
    }),
    role,
  );
  const recoveryMs = performance.now() - disconnectedAt;
  await collect(f, "EXP-008-A01", async () =>
    product(
      recoveryMs <= EXPERIENCE_THRESHOLDS.unexplainedDeadStateMs &&
        usable.dialogHidden &&
        usable.tableVisible &&
        usable.roleControlVisible &&
        recovered.sequence !== null,
      c,
      "EXP-008-A01",
      `${role}-${timing}`,
      { recoveryMs, usable, recovered },
      {
        maxDeadStateMs: 3000,
        dialogHidden: true,
        tableVisible: true,
        roleControlVisible: true,
        authoritativeProjection: true,
      },
    ),
  );
  await collect(f, "EXP-008-A02", async () =>
    product(
      before.sequence === targetSequence &&
        convergence.matched &&
        recovered.handNumber === before.handNumber &&
        (recovered.sequence ?? -1) >= targetSequence &&
        recovered.boardLength >= before.boardLength,
      c,
      "EXP-008-A02",
      `${role}-${timing}`,
      {
        before,
        recovered,
        authoritative: convergence.authoritative,
        convergenceMs: convergence.elapsedMs,
      },
      {
        disconnectedAtSequence: targetSequence,
        exactAuthoritativeMatchWithinMs: 1000,
        noRewind: true,
      },
    ),
  );

  await authoritativeTimeline;
  await waitForObservedTimeline(f, observer, observedAt);
  const timeline = observedTimeline(f.telemetryEvents, "player-2", observedAt);
  const sequences = timeline.map((entry) => entry.sequence);
  const boards = timeline.map((entry) => entry.board.length);
  const expectedSequences = poker.oracle.presentation.map(
    ({ sequence }) => sequence,
  );
  const actionIds = [
    ...new Set(timeline.flatMap(({ actionIds }) => actionIds)),
  ];
  const expectedActionIds = [
    `h1-a1-${room.ids.actor}-all-in`,
    `h1-a2-${room.ids.opponent}-call`,
  ];
  const resultIds = [
    ...new Set(
      timeline
        .map(({ resultId }) => resultId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const expectedBoards = poker.oracle.presentation.map(({ board }) => [
    ...board,
  ]);
  const expectedPhases = poker.oracle.presentation.map(({ phase }) => phase);
  await collect(f, "EXP-008-A03", async () =>
    product(
      exactJourneyMatches({
        frames: timeline,
        sequences: expectedSequences,
        phases: expectedPhases,
        boards: expectedBoards,
        actionIds: expectedActionIds,
        resultIds: ["hand-1"],
      }),
      c,
      "EXP-008-A03",
      `${role}-${timing}`,
      { timeline, actionIds, resultIds },
      {
        sequences: expectedSequences,
        phases: expectedPhases,
        boards: expectedBoards,
        actionIds: expectedActionIds,
        resultIds: ["hand-1"],
      },
    ),
  );
  await replacement.telemetry.flush();
  const privacyTimeline = privacySamples(
    f.telemetryEvents,
    actorId,
    observedAt,
  );
  const privacy = await readPrivacyFacts(replacement.page);
  await collect(f, "EXP-008-A04", async () =>
    product(
      privacyTimelineIsSafe(
        privacyTimeline,
        poker.oracle.expectedBoard,
        role === "spectator",
      ),
      c,
      "EXP-008-A04",
      `${role}-${timing}`,
      privacyTimeline,
      {
        nonEmpty: true,
        exactBoardPrefixes: poker.oracle.expectedBoard,
        spectatorPrivateCardCount: 0,
      },
    ),
  );
  if (role === "spectator" && timing === "after-deadline") {
    await f.pool.startTraceAfterBootstrap("spectator", { traceReady: true });
    f.evidenceActor = replacement;
    await capture(f, replacement, "reconnect-after-deadline");
  }
  void original;
  void observer;
  return {
    role,
    timing,
    freshRoomId: room.roomId,
    guidanceMs,
    recoveryMs,
    before,
    recovered,
    timeline,
    actionIds,
    resultIds,
    privacy,
  };
}

async function waitForObservedTimeline(
  f: Fx,
  observer: ReturnType<ActorPool["get"]>,
  since: number,
): Promise<void> {
  const deadline = performance.now() + 3_000;
  do {
    await observer.telemetry.flush();
    const sequences = observedTimeline(
      f.telemetryEvents,
      "player-2",
      since,
    ).map(({ sequence }) => sequence);
    if ([1, 2, 3, 4, 5, 6, 7].every((sequence) => sequences.includes(sequence)))
      return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (performance.now() < deadline);
}

async function waitForProjectionMatch(
  recoveredRoom: RoomPage,
  authoritativeRoom: RoomPage,
  timeoutMs: number,
) {
  const started = performance.now();
  let recovered = await recoveredRoom.readProjection();
  let authoritative = await authoritativeRoom.readProjection();
  while (performance.now() - started <= timeoutMs) {
    if (JSON.stringify(recovered) === JSON.stringify(authoritative))
      return {
        matched: true,
        recovered,
        authoritative,
        elapsedMs: performance.now() - started,
      };
    await delay(25);
    [recovered, authoritative] = await Promise.all([
      recoveredRoom.readProjection(),
      authoritativeRoom.readProjection(),
    ]);
  }
  return {
    matched: false,
    recovered,
    authoritative,
    elapsedMs: performance.now() - started,
  };
}

async function observeFlowToResult(
  page: Page,
  initial: Awaited<ReturnType<RoomPage["readProjection"]>>,
) {
  return page.evaluate(async (first) => {
    const timeline: Array<{
      phase: string | null;
      sequence: number | null;
      boardLength: number;
      resultId: string | null;
    }> = [];
    const seen = new Set<string>();
    const started = performance.now();
    while (performance.now() - started < 20_000) {
      const table = document.querySelector<HTMLElement>('[aria-label="Table"]');
      const result = document.querySelector<HTMLElement>(
        "[data-hand-result-number]",
      );
      const entry = {
        phase: table?.dataset.flowPhase ?? null,
        sequence: table?.dataset.flowSequence
          ? Number(table.dataset.flowSequence)
          : null,
        boardLength: Number(table?.dataset.boardCardCount ?? 0),
        resultId: result?.dataset.handResultNumber
          ? `hand-${result.dataset.handResultNumber}`
          : null,
      };
      const key = `${entry.phase}/${entry.sequence}/${entry.boardLength}/${entry.resultId}`;
      if (!seen.has(key)) {
        seen.add(key);
        timeline.push(entry);
      }
      if (entry.resultId) return timeline;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return timeline;
  }, initial);
}

async function observeMobileRunout(page: Page) {
  return page.evaluate(async () => {
    const frames: Array<{
      phase: string;
      sequence: number;
      boardLength: number;
      atMs: number;
    }> = [];
    const seen = new Set<string>();
    const started = performance.now();
    while (performance.now() - started < 15_000) {
      const table = document.querySelector<HTMLElement>('[aria-label="Table"]');
      const phase = table?.dataset.flowPhase ?? "";
      const sequence = Number(table?.dataset.flowSequence ?? -1);
      const boardLength = Number(table?.dataset.boardCardCount ?? 0);
      if (phase !== "betting") {
        const key = `${phase}/${sequence}/${boardLength}`;
        if (!seen.has(key)) {
          seen.add(key);
          frames.push({
            phase,
            sequence,
            boardLength,
            atMs: performance.now() - started,
          });
        }
      }
      if (phase === "hand-summary") return frames;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return frames;
  });
}

async function runCase(
  browser: Browser,
  caseId: CaseId,
  contextOptions: BrowserContextOptions | undefined,
  execute: (input: {
    fixture: Fx;
    coordinates: AttemptCoordinates;
  }) => Promise<FinishCaseInput>,
) {
  const e = env();
  const recorders = new Map<string, EvidenceRecorder>();
  const secrets = new Secrets();
  secrets.add(e.broker.authorizationToken);
  await runExperienceCase({
    runId: e.runId,
    caseId,
    recorderFactory(c) {
      const r = recorder(e, c, secrets.values);
      recorders.set(`${c.caseId}/${c.attemptId}`, r);
      return r;
    },
    async createFixture(c): Promise<Fx> {
      const outputRoot = join(e.outputRoot, "cases", c.caseId, c.attemptId);
      const r = recorders.get(`${c.caseId}/${c.attemptId}`)!;
      const telemetryEvents: TelemetryEvent[] = [];
      const pool = new ActorPool({
        browser,
        outputRoot,
        contextOptions,
        telemetrySink: async (event) => {
          telemetryEvents.push(event);
          await recordTelemetry(r, event);
        },
      });
      await pool.createActors({ playerCount: 4, includeSpectator: true });
      return {
        pool,
        recorder: r,
        outputRoot,
        events: new Map(),
        failures: new Map<string, ProductAssertionError[]>(),
        telemetryEvents,
        evidenceActor: null,
        secrets,
      };
    },
    async execute({ runId, caseId, attemptId, fixture }) {
      return execute({ fixture, coordinates: { runId, caseId, attemptId } });
    },
    async disposeFixture(f) {
      const actor = f.evidenceActor;
      const prefix = artifactPrefix(e.outputRoot, f.outputRoot);
      await f.pool.closeAll();
      if (actor) {
        if (await isFile(actor.tracePath))
          await f.recorder.recordArtifact({
            id: `${prefix}-${actor.metadata.id}-trace`,
            path: artifactPath(e.outputRoot, actor.tracePath),
            description: "Tokenless journey trace",
            kind: "trace",
            mediaType: "application/zip",
            required: true,
          });
        const video = (
          await readdir(actor.videoDirectory).catch(() => [])
        ).find((name) => name.endsWith(".webm"));
        if (video)
          await f.recorder.recordArtifact({
            id: `${prefix}-${actor.metadata.id}-video`,
            path: artifactPath(e.outputRoot, join(actor.videoDirectory, video)),
            description: "Journey video",
            kind: "video",
            mediaType: "video/webm",
            required: true,
          });
      }
    },
    async persistFallbackReport(c, input) {
      return recorder(e, c, secrets.values).finishCase(input);
    },
  });
}

async function provision<Role extends string>(
  f: Fx,
  poker: PokerFixture<Role, any, any>,
  roles: readonly Role[],
  coordinates: AttemptCoordinates,
  assertionId: string,
  options: {
    traceBeforeJoinRole?: Role;
    claimBeforeSeed?: { role: Role; seatNumber: number };
    beforeSeed?: (input: { actor: ActorHandle; role: Role }) => Promise<void>;
  } = {},
) {
  const e = env();
  const api = new ExperienceApiClient({
    baseUrl: e.baseUrl,
    knownSecrets: f.secrets,
  });
  const created = await api.createRoom(poker.settings);
  f.secrets.add(created.hostToken);
  const pages = {} as Record<Role | "host" | "spectator", RoomPage>;
  const names = {} as Record<Role, string>;
  const ids = {} as Record<Role, string>;
  for (const [index, role] of roles.entries()) {
    const actor = f.pool.get(`player-${index + 1}`);
    if (options.traceBeforeJoinRole === role) {
      await f.pool.startJourneyTraceBeforeNavigation(actor.metadata.id);
      await actor.page.goto(created.inviteUrl);
      await actor.page
        .getByRole("form", { name: "Join room" })
        .waitFor({ state: "visible" });
      await mobileCheckpoint(f, actor, coordinates, "join-flow", []);
    }
    const identity = await bootstrapBrowserIdentity({
      page: actor.page,
      baseUrl: e.baseUrl,
      roomId: created.roomId,
      role,
      displayName: owner(e.runId, role),
      knownSecrets: f.secrets,
    });
    pages[role] = roomPage(actor);
    names[role] = identity.displayName;
    ids[role] = identity.participantId;
  }
  if (options.beforeSeed) {
    const role = options.claimBeforeSeed?.role ?? roles[0];
    const index = roles.indexOf(role);
    await options.beforeSeed({
      actor: f.pool.get(`player-${index + 1}`),
      role,
    });
  }
  let claimedSeat: {
    role: Role;
    seatNumber: number;
    participantId: string;
  } | null = null;
  if (options.claimBeforeSeed) {
    const index = roles.indexOf(options.claimBeforeSeed.role);
    if (index < 0)
      throw new Error(
        `Cannot claim a seat for unknown role ${String(options.claimBeforeSeed.role)}`,
      );
    const actor = f.pool.get(`player-${index + 1}`);
    await pages[options.claimBeforeSeed.role].claimSeat(
      options.claimBeforeSeed.seatNumber,
    );
    await actor.page
      .locator(
        `[data-seat-number="${options.claimBeforeSeed.seatNumber}"][data-local-seat="true"]`,
      )
      .waitFor({ state: "visible", timeout: 3_000 });
    claimedSeat = {
      role: options.claimBeforeSeed.role,
      seatNumber: options.claimBeforeSeed.seatNumber,
      participantId: ids[options.claimBeforeSeed.role],
    };
  }
  const host = f.pool.get("host");
  await bootstrapBrowserIdentity({
    page: host.page,
    baseUrl: e.baseUrl,
    roomId: created.roomId,
    role: "host",
    displayName: owner(e.runId, "host"),
    hostToken: created.hostToken,
    knownSecrets: f.secrets,
  });
  pages.host = roomPage(host);
  await seedFixtureThroughBroker({
    broker: e.broker,
    runId: e.runId,
    roomId: created.roomId,
    fixture: { kind: poker.id, participantIds: ids } as SeedFixtureDescriptor,
  });
  for (const [index, role] of roles.entries()) {
    const actor = f.pool.get(`player-${index + 1}`);
    await actor.page.reload();
    pages[role] = roomPage(actor);
    await pages[role].join(names[role]);
    await actor.page
      .getByRole("dialog", { name: "Join flow" })
      .waitFor({ state: "hidden" });
  }
  await host.page.goto(
    new URL(
      `/room/${encodeURIComponent(created.roomId)}?host=${encodeURIComponent(created.hostToken)}`,
      e.baseUrl,
    ).toString(),
  );
  pages.host = roomPage(host);
  await pages.host.join(owner(e.runId, "host"));
  await host.page
    .getByRole("dialog", { name: "Join flow" })
    .waitFor({ state: "hidden" });
  await host.page.evaluate(() =>
    history.replaceState(null, "", location.pathname),
  );
  const spectator = f.pool.get("spectator");
  await spectator.page.goto(created.inviteUrl);
  pages.spectator = roomPage(spectator);
  await pages.spectator.join("Spectator", "spectator");
  await spectator.page
    .getByRole("dialog", { name: "Join flow" })
    .waitFor({ state: "hidden" });
  await collect(f, assertionId, async () => {
    await expected(
      pages.spectator.waitForPhase("betting", { timeout: 8_000 }),
      coordinates,
      assertionId,
      "spectator",
      "seeded betting projection",
    );
  });
  return {
    pages,
    names,
    ids,
    roomId: created.roomId,
    inviteUrl: created.inviteUrl,
    hostToken: created.hostToken,
    claimedSeat,
  };
}

async function mobileCheckpoint(
  f: Fx,
  actor: ActorHandle,
  c: AttemptCoordinates,
  name: string,
  controls: Locator[],
  baseline = false,
) {
  const dimensions = await actor.page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  await collect(f, "EXP-009-A02", async () => {
    assertNoViewportOverflow(
      dimensions,
      mechanical(c, "EXP-009-A02", actor.metadata.id),
    );
  });
  const dynamicControls = actor.page.locator(checkpointControlSelector(name));
  const expectedControlIds = await dynamicControls.evaluateAll((elements) =>
    elements.map(
      (element, index) =>
        `${element.getAttribute("data-action-type") ?? element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName}-${index}`,
    ),
  );
  const observedControlIds: string[] = [];
  for (const control of [dynamicControls, ...controls]) {
    const matches = await control.all();
    await collect(f, "EXP-009-A02", async () =>
      product(
        matches.length > 0,
        c,
        "EXP-009-A02",
        actor.metadata.id,
        { checkpoint: name, count: matches.length },
        { requiredControlCount: ">=1" },
      ),
    );
    for (const [matchIndex, match] of matches.entries()) {
      if (control === dynamicControls)
        observedControlIds.push(expectedControlIds[matchIndex]);
      const geometry = await match.evaluate((target) => {
        let container: HTMLElement | null = target.parentElement;
        while (container) {
          const style = getComputedStyle(container);
          if (
            /(auto|scroll)/.test(
              `${style.overflow}${style.overflowX}${style.overflowY}`,
            )
          )
            break;
          container = container.parentElement;
        }
        if (container) {
          const targetRect = target.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          container.scrollBy({
            left: targetRect.left - containerRect.left,
            top: targetRect.top - containerRect.top,
            behavior: "instant",
          });
        }
        const rect = target.getBoundingClientRect();
        const containerRect = container?.getBoundingClientRect();
        const point = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
        const hit = document.elementFromPoint(point.x, point.y);
        return {
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
          point,
          hit: hit === target || target.contains(hit),
          insideViewport:
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight,
          scrollContainer: container
            ? {
                explicit: true,
                clientWidth: container.clientWidth,
                scrollWidth: container.scrollWidth,
                clientHeight: container.clientHeight,
                scrollHeight: container.scrollHeight,
                bounds: {
                  left: containerRect!.left,
                  top: containerRect!.top,
                  right: containerRect!.right,
                  bottom: containerRect!.bottom,
                },
                controlInsideBounds:
                  rect.left >= containerRect!.left &&
                  rect.right <= containerRect!.right &&
                  rect.top >= containerRect!.top &&
                  rect.bottom <= containerRect!.bottom,
              }
            : null,
        };
      });
      await collect(f, "EXP-009-A02", async () =>
        product(
          geometry.insideViewport ||
            Boolean(
              geometry.scrollContainer?.explicit &&
              geometry.scrollContainer.controlInsideBounds,
            ),
          c,
          "EXP-009-A02",
          actor.metadata.id,
          { checkpoint: name, geometry },
          "control inside viewport or measured documented scroll container",
        ),
      );
      if (await match.isEnabled().catch(() => false)) {
        await collect(f, "EXP-009-A03", async () => {
          assertMinimumHitTarget(
            { width: geometry.rect.width, height: geometry.rect.height },
            mechanical(c, "EXP-009-A03", actor.metadata.id),
          );
        });
        await collect(f, "EXP-009-A04", async () => {
          assertCenterPointHit(
            geometry.rect,
            {
              point: geometry.point,
              targetElement: { contains: () => geometry.hit },
              elementFromPoint: geometry.hit ? { contains: () => false } : null,
            },
            mechanical(c, "EXP-009-A04", actor.metadata.id),
          );
        });
      }
    }
  }
  await collect(f, "EXP-009-A02", async () =>
    product(
      requiredControlEvidenceComplete(expectedControlIds, observedControlIds),
      c,
      "EXP-009-A02",
      actor.metadata.id,
      { checkpoint: name, expectedControlIds, observedControlIds },
      "every dynamically rendered required control has individual geometry evidence",
    ),
  );
  const requirements = checkpointRequirements(name);
  const requiredCounts = await actor.page.evaluate(
    (items) =>
      items.map(({ label, selector, minimum }) => ({
        label,
        minimum,
        count: Array.from(
          document.querySelectorAll<HTMLElement>(selector),
        ).filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            rect.width > 0 &&
            rect.height > 0
          );
        }).length,
      })),
    requirements,
  );
  await collect(f, "EXP-009-A02", async () =>
    product(
      requiredCountsPresent(requiredCounts),
      c,
      "EXP-009-A02",
      actor.metadata.id,
      { checkpoint: name, requiredCounts },
      "all required content categories present with non-vacuous counts",
    ),
  );
  const visualGeometry = await actor.page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '.poker-card, .card-back, .seat-bet, .seat-stack, .seat-nameplate, [aria-label="Hand result"], [aria-label="Session results"]',
      ),
    )
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const point = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
        const hit = document.elementFromPoint(point.x, point.y);
        return {
          selector: element.className || element.getAttribute("aria-label"),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          insideViewport:
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight,
          centerUnoccluded: hit === element || element.contains(hit),
        };
      }),
  );
  await collect(f, "EXP-009-A04", async () =>
    product(
      visualGeometry.length > 0,
      c,
      "EXP-009-A04",
      actor.metadata.id,
      { checkpoint: name, count: visualGeometry.length },
      { requiredVisibleGeometryCount: ">=1" },
    ),
  );
  await collect(f, "EXP-009-A02", async () =>
    product(
      visualGeometry.every(({ insideViewport }) => insideViewport),
      c,
      "EXP-009-A02",
      actor.metadata.id,
      { checkpoint: name, visualGeometry },
      "every visible card/bet/stack/name/result inside viewport",
    ),
  );
  await collect(f, "EXP-009-A04", async () =>
    product(
      visualGeometry.every(({ centerUnoccluded }) => centerUnoccluded),
      c,
      "EXP-009-A04",
      actor.metadata.id,
      { checkpoint: name, visualGeometry },
      "no interactive layer occludes visible cards/bets/stacks/names/results",
    ),
  );
  await pass(f, "EXP-009-A02", {
    checkpoint: name,
    dimensions,
    visualGeometry,
  });
  await pass(f, "EXP-009-A03", { checkpoint: name, controls: controls.length });
  await pass(f, "EXP-009-A04", {
    checkpoint: name,
    centerHitTest: true,
    visualGeometry,
  });
  if (baseline) {
    const baselinePath = join(
      actor.screenshotNamespace,
      `${name}-baseline.png`,
    );
    await actor.page.screenshot({
      path: baselinePath,
      fullPage: true,
      animations: "disabled",
      mask: [
        actor.page.getByRole("status"),
        actor.page.locator('[class*="toast"]'),
      ],
    });
    await f.recorder.recordArtifact({
      id: `${artifactPrefix(env().outputRoot, f.outputRoot)}-${name}-visual-baseline`,
      path: artifactPath(env().outputRoot, baselinePath),
      description: `Stable masked mobile baseline: ${name}`,
      kind: "screenshot",
      mediaType: "image/png",
      required: true,
    });
  }
  await capture(f, actor, name);
}
function checkpointControlSelector(name: string) {
  if (name === "join-flow")
    return '[aria-label="Join room"] input:not([type="hidden"]):not([disabled]),[aria-label="Join room"] button:not([disabled])';
  if (name === "lobby")
    return 'button[aria-label^="Claim seat"]:not([disabled])';
  if (name === "active-betting" || name === "final-hand-betting")
    return "[data-action-type]:not([disabled])";
  if (name === "top-up-open")
    return '[data-control-panel="top-up"][open] input:not([disabled]),[data-control-panel="top-up"][open] button:not([disabled])';
  if (name === "host-controls")
    return '[data-control-panel="host"][open] input:not([disabled]),[data-control-panel="host"][open] button:not([disabled])';
  if (name === "hand-result")
    return '[aria-label="Hand result"],[aria-label="Hand result"] button:not([disabled])';
  if (name === "session-result")
    return '[aria-label="Session results"],[aria-label="Session results"] button:not([disabled])';
  return "button:not([disabled]),input:not([disabled])";
}
function checkpointRequirements(name: string) {
  if (name === "join-flow")
    return [
      { label: "nickname", selector: '[aria-label="Join room"] input[name="displayName"]', minimum: 1 },
      { label: "join modes", selector: '[aria-label="Join room"] button:not([disabled])', minimum: 2 },
    ];
  const common = [
    { label: "names", selector: ".seat-nameplate", minimum: 1 },
    { label: "stacks", selector: ".seat-stack", minimum: 1 },
  ];
  if (name === "lobby")
    return [{ label: "seats", selector: "[data-seat-number]", minimum: 2 }];
  if (name === "top-up-open")
    return [
      ...common,
      {
        label: "top-up",
        selector: '[data-control-panel="top-up"][open]',
        minimum: 1,
      },
      { label: "cards", selector: ".poker-card,.card-back", minimum: 2 },
      { label: "bets", selector: ".seat-bet", minimum: 1 },
    ];
  if (name === "host-controls")
    return [
      ...common,
      {
        label: "host controls",
        selector: '[data-control-panel="host"][open]',
        minimum: 1,
      },
      { label: "cards", selector: ".poker-card,.card-back", minimum: 2 },
      { label: "bets", selector: ".seat-bet", minimum: 1 },
    ];
  if (name === "hand-result")
    return [
      ...common,
      {
        label: "hand result",
        selector: '[aria-label="Hand result"]',
        minimum: 1,
      },
      { label: "result players", selector: ".hand-result-player", minimum: 2 },
    ];
  if (name === "session-result")
    return [
      {
        label: "session result",
        selector: '[aria-label="Session results"]',
        minimum: 1,
      },
      {
        label: "session rows",
        selector: ".session-result-row:not(.is-heading)",
        minimum: 2,
      },
    ];
  return [
    ...common,
    {
      label: "all betting controls",
      selector: "[data-action-type]",
      minimum: 3,
    },
    { label: "cards", selector: ".poker-card,.card-back", minimum: 2 },
    { label: "bets", selector: ".seat-bet", minimum: 1 },
  ];
}

async function readPrivacyFacts(page: Page) {
  return page.evaluate(() => {
    const table = document.querySelector<HTMLElement>('[aria-label="Table"]');
    const betting = table?.dataset.flowPhase === "betting";
    return {
      unauthorizedVisibleCount: betting
        ? Array.from(
            document.querySelectorAll<HTMLElement>(".hole-card-row"),
          ).filter((el) => {
            const style = getComputedStyle(el);
            return style.visibility !== "hidden" && style.display !== "none";
          }).length
        : 0,
      boardCount: Number(table?.dataset.boardCardCount ?? 0),
    };
  });
}
function monotonic(values: Array<number | null>) {
  const present = values.filter((v): v is number => v !== null);
  return present.every(
    (value, index) => index === 0 || value >= present[index - 1],
  );
}
async function pass(f: Fx, id: string, details: Record<string, unknown>) {
  const event = await f.recorder.recordEvent({
    stage: id,
    type: "product-assertion",
    status: "pass",
    details,
  });
  const list = f.events.get(id) ?? [];
  list.push(event);
  f.events.set(id, list);
}
async function capture(f: Fx, actor: ActorHandle, name: string) {
  await mkdir(actor.screenshotNamespace, { recursive: true });
  const path = join(actor.screenshotNamespace, `${name}.png`);
  await actor.page.screenshot({ path, fullPage: true });
  await f.recorder.recordArtifact({
    id: `${artifactPrefix(env().outputRoot, f.outputRoot)}-${name}-${actor.metadata.id}`,
    path: artifactPath(env().outputRoot, path),
    description: name,
    kind: "screenshot",
    mediaType: "image/png",
    required: true,
  });
}
function finish(f: Fx, caseId: CaseId): FinishCaseInput {
  const assertions = ASSERTIONS[caseId].map((id) => {
    const evidenceEventIds = (f.events.get(id) ?? []).map((event) => event.id);
    const failures = f.failures.get(id) ?? [];
    if (!evidenceEventIds.length)
      throw new Error(`Missing assertion evidence ${id}`);
    return {
      id,
      outcome: failures.length ? ("fail" as const) : ("pass" as const),
      evidenceEventIds,
      summary: failures.length
        ? failures.map(({ message }) => message).join("; ")
        : `${id} passed`,
    };
  });
  const evidenceEventIds = assertions.flatMap((a) => a.evidenceEventIds);
  const failed = assertions.filter((a) => a.outcome === "fail");
  return {
    verdict: failed.length ? "FAIL" : "PASS",
    results: {
      product: {
        status: failed.length ? "fail" : "pass",
        summary: failed.length
          ? `${[...f.failures.values()].flat().length} product assertion(s) failed`
          : "All product assertions passed",
        evidenceEventIds: [...evidenceEventIds],
      },
      harness: {
        status: "pass",
        summary: "Browser and evidence capture completed",
        evidenceEventIds: [...evidenceEventIds],
      },
      environment: {
        status: "pass",
        summary: "Isolated target remained available",
        evidenceEventIds: [],
      },
    },
    assertions,
    failures: failed.map((failure) => ({
      code: "PRODUCT_ASSERTION_FAILED",
      summary: failure.summary,
      stage: failure.id,
      evidenceEventIds: [...failure.evidenceEventIds],
    })),
  };
}
async function collect(
  f: Fx,
  assertionId: string,
  operation: () => Promise<void>,
) {
  try {
    await operation();
  } catch (error) {
    if (!(error instanceof ProductAssertionError)) throw error;
    const failures = f.failures.get(assertionId) ?? [];
    failures.push(error);
    f.failures.set(assertionId, failures);
    const event = await f.recorder.recordEvent({
      stage: assertionId,
      type: "product-assertion",
      status: "fail",
      details: {
        actor: error.context.actor,
        measuredValue: error.context.measuredValue,
        threshold: error.context.threshold,
      },
    });
    const list = f.events.get(assertionId) ?? [];
    list.push(event);
    f.events.set(assertionId, list);
  }
}
async function step(
  f: Fx,
  assertionId: string,
  c: AttemptCoordinates,
  actor: string,
  threshold: string,
  operation: () => Promise<unknown>,
) {
  await collect(f, assertionId, async () => {
    await expected(
      Promise.resolve().then(operation),
      c,
      assertionId,
      actor,
      threshold,
    );
  });
}
function product(
  ok: unknown,
  c: AttemptCoordinates,
  id: string,
  actor: string,
  measured: unknown,
  threshold: unknown,
) {
  assertProductCondition(Boolean(ok), {
    ...mechanical(c, id, actor),
    earliestDivergentProjection: measured,
    measuredValue: measured,
    threshold,
  });
}
async function expected<T>(
  operation: Promise<T>,
  c: AttemptCoordinates,
  id: string,
  actor: string,
  threshold: unknown,
) {
  return observeProduct(() => operation, {
    ...mechanical(c, id, actor),
    earliestDivergentProjection: null,
    measuredValue: "not observed before bounded deadline",
    threshold,
  });
}
function mechanical(c: AttemptCoordinates, assertionId: string, actor: string) {
  return {
    caseId: c.caseId,
    attemptId: c.attemptId,
    assertionId,
    actor,
    artifactIds: [],
  };
}
function roomPage(actor: ActorHandle) {
  return new RoomPage(actor.page, {
    actor: actor.metadata.id,
    screenshotNamespace: actor.screenshotNamespace,
    telemetry: actor.telemetry,
  });
}
function recorder(e: Env, c: AttemptCoordinates, secrets: string[]) {
  return new EvidenceRecorder({
    outputRoot: join(e.caseOutputRoot, c.caseId, c.attemptId),
    runId: c.runId,
    caseId: c.caseId,
    attemptId: c.attemptId,
    actor: "scenario",
    knownSecrets: secrets,
  });
}
async function recordTelemetry(r: EvidenceRecorder, event: TelemetryEvent) {
  await r.recordEvent({
    actor: String(event.details.actor ?? "browser"),
    stage: "browser-telemetry",
    type: event.kind,
    status: event.kind.includes("error") ? "observed-error" : "observed",
    details: { browserMonotonicMs: event.monotonicMs, ...event.details },
  });
}
function env(): Env {
  if (!BROKER)
    throw new Error("Fixture seed broker was not provided to isolated worker");
  return {
    runId: required("SITE_TEST_RUN_ID"),
    baseUrl: required("SITE_TEST_ISOLATED_BASE_URL"),
    outputRoot: required("SITE_TEST_OUTPUT_ROOT"),
    caseOutputRoot: required("SITE_TEST_CASE_OUTPUT_ROOT"),
    broker: BROKER,
  };
}
function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function artifactPath(root: string, path: string) {
  const value = relative(root, path);
  if (value.startsWith("..")) throw new Error("Artifact escaped run root");
  return value.replaceAll("\\", "/");
}
function artifactPrefix(root: string, path: string) {
  return artifactPath(root, path)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
async function isFile(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
function owner(runId: string, role: string) {
  return `SITE-${runId}-${role}`;
}
function placeholderIds<Role extends string>(roles: readonly Role[]) {
  return Object.fromEntries(
    roles.map((role) => [role, role]),
  ) as unknown as Record<Role, string>;
}
function caseTimeout(id: string) {
  return (
    EXPERIENCE_CASES.find((candidate) => candidate.caseId === id)!
      .stopConditions.overallTimeoutMs + 15_000
  );
}
