import { describe, expect, it } from "vitest";
import type { Page } from "@playwright/test";
import {
  DockerSiteTestStack,
  type DockerContainerInspect,
  type DockerProcessRunner,
  type DockerSiteTestStackSnapshot
} from "../../../scripts/site-test/docker-stack";
import { serializeCard } from "@/lib/poker/cards";
import type { RoomState } from "@/lib/poker/engine";
import { ExperienceApiClient, bootstrapBrowserIdentity } from "./api-client";
import {
  buildFourPlayerAllInFixture,
  buildNormalBettingFixture,
  buildReconnectFixture,
  buildSidePotFixture,
  buildSplitPotFixture,
  buildTopUpAccountingFixture
} from "./builders";
import { deckWithTopCards } from "./deck";
import {
  FixtureRuntime,
  buildRunResourceRecord,
  createFixtureTargetEnvironment
} from "./runtime";
import type {
  BrowserJoinPage,
  BrowserJoinResponse,
  FixtureTargetEnvironment,
  JoinedPlayerIdentity
} from "./types";

const runId = "r5";
const playwrightPageIsBootstrapCompatible: BrowserJoinPage = null as unknown as Page;
void playwrightPageIsBootstrapCompatible;

describe("deckWithTopCards", () => {
  it("places requested cards first and completes one deterministic 52-card deck", () => {
    const deck = deckWithTopCards(["As", "Kh", "2c"]);
    const serialized = deck.map(serializeCard);

    expect(serialized.slice(0, 3)).toEqual(["As", "Kh", "2c"]);
    expect(serialized).toHaveLength(52);
    expect(new Set(serialized)).toHaveLength(52);
    expect(serialized.slice(3)).toEqual(
      deckWithTopCards([])
        .map(serializeCard)
        .filter((card) => card !== "As" && card !== "Kh" && card !== "2c")
    );
  });

  it("rejects duplicate top cards instead of constructing an invalid deck", () => {
    expect(() => deckWithTopCards(["As", "As"])).toThrow(/duplicate top card.*As/i);
  });
});

describe("normal betting fixture", () => {
  it("rejects a run ID that violates the shared ownership-marker nickname bound", () => {
    expect(() => buildNormalBettingFixture({
      runId: "run-2026-07-alpha",
      participantIds: { button: "b", small: "s", big: "g" }
    })).toThrow(/run ID.*at most 6 characters/i);
  });

  it("declares exact identities, seats, cards, action order, and post-action UI oracles", () => {
    const fixture = buildNormalBettingFixture({
      runId,
      participantIds: {
        button: "normal-button",
        small: "normal-small",
        big: "normal-big"
      }
    });

    expect(fixture.id).toBe("normal-betting");
    expect(fixture.settings).toEqual({
      mode: "cash",
      seats: 3,
      initialChips: 200,
      smallBlind: 10,
      bigBlind: 20,
      actionTimerSeconds: null
    });
    expect(fixture.participants).toEqual([
      participant("button", "normal-button", 1, 200),
      participant("small", "normal-small", 2, 200),
      participant("big", "normal-big", 3, 200)
    ]);
    expect(sumStartingChips(fixture.participants)).toBe(600);
    expect(fixture.oracle.holeCardsByRole).toEqual({
      button: ["As", "Ah"],
      small: ["Kc", "Kd"],
      big: ["Qc", "Qd"]
    });
    expect(fixture.oracle.expectedBoard).toEqual(["2c", "7d", "9h", "3s", "4c"]);
    expectUniqueDeck(fixture.deck);

    expect(fixture.actionPlan.map(({ actorRole, street, action }) => ({
      actorRole,
      street,
      type: action.type,
      amountTo: "amountTo" in action ? action.amountTo : undefined
    }))).toEqual([
      { actorRole: "button", street: "preflop", type: "call", amountTo: undefined },
      { actorRole: "small", street: "preflop", type: "call", amountTo: undefined },
      { actorRole: "big", street: "preflop", type: "check", amountTo: undefined },
      { actorRole: "small", street: "flop", type: "check", amountTo: undefined },
      { actorRole: "big", street: "flop", type: "bet", amountTo: 20 },
      { actorRole: "button", street: "flop", type: "raise", amountTo: 40 },
      { actorRole: "small", street: "flop", type: "fold", amountTo: undefined },
      { actorRole: "big", street: "flop", type: "call", amountTo: undefined },
      { actorRole: "big", street: "turn", type: "check", amountTo: undefined },
      { actorRole: "button", street: "turn", type: "check", amountTo: undefined },
      { actorRole: "big", street: "river", type: "bet", amountTo: 20 },
      { actorRole: "button", street: "river", type: "call", amountTo: undefined }
    ]);

    expect(fixture.oracle.transitions).toEqual([
      transition("normal-01", "small", "preflop", 50, 0, FACING_BET),
      transition("normal-02", "big", "preflop", 60, 0, CHECK_OR_RAISE),
      transition("normal-03", "small", "flop", 60, 3, CHECK_OR_BET),
      transition("normal-04", "big", "flop", 60, 3, CHECK_OR_BET),
      transition("normal-05", "button", "flop", 80, 3, FACING_BET),
      transition("normal-06", "small", "flop", 120, 3, FACING_BET),
      transition("normal-07", "big", "flop", 120, 3, FACING_BET),
      transition("normal-08", "big", "turn", 140, 4, CHECK_OR_BET),
      transition("normal-09", "button", "turn", 140, 4, CHECK_OR_BET),
      transition("normal-10", "big", "river", 140, 5, CHECK_OR_BET),
      transition("normal-11", "button", "river", 160, 5, FACING_BET),
      transition("normal-12", null, "river", 180, 5, [])
    ]);
  });
});

describe("four-player all-in fixture", () => {
  it("uses tournament mode and the specified ace-through-jack deal and board", () => {
    const fixture = buildFourPlayerAllInFixture({
      runId,
      participantIds: {
        aces: "allin-aces",
        kings: "allin-kings",
        queens: "allin-queens",
        jacks: "allin-jacks"
      }
    });

    expect(fixture.settings.mode).toBe("tournament");
    expect(fixture.topCards).toEqual(
      "As Kh Qc Jd Ah Kd Qh Js 2c 7d 9h 3s 4c".split(" ")
    );
    expect(fixture.participants).toEqual([
      participant("aces", "allin-aces", 2, 100),
      participant("kings", "allin-kings", 3, 100),
      participant("queens", "allin-queens", 4, 100),
      participant("jacks", "allin-jacks", 1, 100)
    ]);
    expect(sumStartingChips(fixture.participants)).toBe(400);
    expect(fixture.oracle.holeCardsByRole).toEqual({
      aces: ["As", "Ah"],
      kings: ["Kh", "Kd"],
      queens: ["Qc", "Qh"],
      jacks: ["Jd", "Js"]
    });
    expect(fixture.oracle.expectedBoard).toEqual(["2c", "7d", "9h", "3s", "4c"]);
    expect(fixture.actionPlan.map(actionSummary)).toEqual([
      ["queens", "all-in"],
      ["jacks", "all-in"],
      ["aces", "all-in"],
      ["kings", "call"]
    ]);
    expect(fixture.oracle.pots).toEqual([
      {
        amount: 400,
        eligibleRoles: ["jacks", "aces", "kings", "queens"],
        awardsByRole: { aces: 400 }
      }
    ]);
    expectUniqueDeck(fixture.deck);
  });
});

describe("side-pot and split-pot fixtures", () => {
  it("declares the independent 400/300/200 side-pot and ace/king/queen awards", () => {
    const fixture = buildSidePotFixture({
      runId,
      participantIds: {
        aces: "side-aces",
        kings: "side-kings",
        queens: "side-queens",
        jacks: "side-jacks"
      }
    });

    expect(fixture.participants).toEqual([
      participant("aces", "side-aces", 2, 100),
      participant("kings", "side-kings", 3, 200),
      participant("queens", "side-queens", 4, 300),
      participant("jacks", "side-jacks", 1, 300)
    ]);
    expect(fixture.oracle.stackTiers).toEqual([100, 200, 300, 300]);
    expect(sumStartingChips(fixture.participants)).toBe(900);
    expect(fixture.oracle.expectedBoard).toEqual(["2c", "7d", "9h", "3s", "4c"]);
    expect(fixture.oracle.pots).toEqual([
      {
        amount: 400,
        eligibleRoles: ["jacks", "aces", "kings", "queens"],
        awardsByRole: { aces: 400 }
      },
      {
        amount: 300,
        eligibleRoles: ["jacks", "kings", "queens"],
        awardsByRole: { kings: 300 }
      },
      {
        amount: 200,
        eligibleRoles: ["jacks", "queens"],
        awardsByRole: { queens: 200 }
      }
    ]);
    expect(fixture.oracle.totalAwardsByRole).toEqual({
      aces: 400,
      kings: 300,
      queens: 200,
      jacks: 0
    });
    expectUniqueDeck(fixture.deck);
  });

  it("declares a board-made straight that splits a 200 pot exactly 100/100", () => {
    const fixture = buildSplitPotFixture({
      runId,
      participantIds: { left: "split-left", right: "split-right" }
    });

    expect(fixture.participants).toEqual([
      participant("left", "split-left", 1, 100),
      participant("right", "split-right", 2, 100)
    ]);
    expect(sumStartingChips(fixture.participants)).toBe(200);
    expect(fixture.oracle.expectedBoard).toEqual(["5c", "6d", "7h", "8s", "9c"]);
    expect(fixture.oracle.boardHand).toBe("nine-high straight");
    expect(fixture.oracle.pots).toEqual([
      {
        amount: 200,
        eligibleRoles: ["left", "right"],
        awardsByRole: { left: 100, right: 100 }
      }
    ]);
    expectUniqueDeck(fixture.deck);
  });
});

describe("top-up/accounting fixture", () => {
  it("declares two queued requests, unchanged current chips, single boundary application, and balanced final rows", () => {
    const fixture = buildTopUpAccountingFixture({
      runId,
      participantIds: { target: "topup-target", opponent: "topup-opponent" }
    });

    expect(fixture.settings.mode).toBe("cash");
    expect(fixture.participants).toEqual([
      participant("target", "topup-target", 1, 1_000),
      participant("opponent", "topup-opponent", 2, 1_000)
    ]);
    expect(sumStartingChips(fixture.participants)).toBe(2_000);
    expect(fixture.actionPlan.map((action) => [action.kind, action.actorRole, action.handNumber])).toEqual([
      ["top-up", "target", 1],
      ["top-up", "target", 1],
      ["player-action", "target", 1],
      ["wait-for-state", "harness", 2],
      ["request-room-end", "host", 2],
      ["player-action", "opponent", 2]
    ]);
    expect(fixture.actionPlan[3]).toEqual({
      kind: "wait-for-state",
      id: "topup-04",
      actorRole: "harness",
      handNumber: 2,
      phase: "betting",
      pendingTopUpByRole: { target: 0 }
    });
    expect(fixture.oracle).toMatchObject({
      queuedAmounts: [300, 200],
      pendingTotal: 500,
      currentHandTargetStackBeforeQueue: 990,
      currentHandTargetStackAfterQueue: 990,
      handOneTargetSettlementDelta: 0,
      handTwoTargetBlind: 20,
      handTwoTargetStackAfterBlind: 1_470,
      appliedTopUpChips: 500,
      nextHandTargetCumulativeBuyIn: 1_500,
      appliedAtHandNumber: 2,
      applicationCount: 1,
      handAwards: [
        { handNumber: 1, pot: 30, awardsByRole: { opponent: 30 } },
        { handNumber: 2, pot: 30, awardsByRole: { target: 30 } }
      ],
      finalRows: [
        { role: "target", initialChips: 1_000, topUpChips: 500, finalChips: 1_500, netChips: 0 },
        { role: "opponent", initialChips: 1_000, topUpChips: 0, finalChips: 1_000, netChips: 0 }
      ],
      finalChipTotal: 2_500
    });
    for (const row of fixture.oracle.finalRows) {
      expect(row.netChips).toBe(row.finalChips - row.initialChips - row.topUpChips);
    }
    expectUniqueDeck(fixture.deck);
  });
});

describe("reconnect fixture", () => {
  it("declares stable actions, phase deadlines, boards, and actor/host/spectator subcases", () => {
    const fixture = buildReconnectFixture({
      runId,
      participantIds: { actor: "reconnect-actor", opponent: "reconnect-opponent" }
    });

    expect(fixture.participants).toEqual([
      participant("actor", "reconnect-actor", 1, 100),
      participant("opponent", "reconnect-opponent", 2, 100)
    ]);
    expect(sumStartingChips(fixture.participants)).toBe(200);
    expect(fixture.actionPlan.map(({ id, actorRole, action }) => [id, actorRole, action.type])).toEqual([
      ["H1-A001", "actor", "all-in"],
      ["H1-A002", "opponent", "call"]
    ]);
    expect(fixture.oracle.presentation).toEqual([
      { phase: "showdown-reveal", sequence: 1, deadlineAtMs: 2_000, board: [] },
      { phase: "runout", sequence: 2, deadlineAtMs: 3_000, board: ["2c"] },
      { phase: "runout", sequence: 3, deadlineAtMs: 4_000, board: ["2c", "7d"] },
      { phase: "runout", sequence: 4, deadlineAtMs: 6_000, board: ["2c", "7d", "9h"] },
      { phase: "runout", sequence: 5, deadlineAtMs: 8_000, board: ["2c", "7d", "9h", "3s"] },
      { phase: "runout", sequence: 6, deadlineAtMs: 10_000, board: ["2c", "7d", "9h", "3s", "4c"] },
      { phase: "hand-summary", sequence: 7, deadlineAtMs: 12_000, board: ["2c", "7d", "9h", "3s", "4c"] }
    ]);
    expect(fixture.oracle.subcases).toEqual([
      {
        role: "actor",
        timing: "before-action",
        disconnectAtMs: 0,
        expectedHandNumber: 1,
        expectedFlowSequence: 0,
        expectedActionIds: [],
        expectedBoard: []
      },
      {
        role: "host",
        timing: "before-deadline",
        disconnectAtMs: 1_500,
        expectedHandNumber: 1,
        expectedFlowSequence: 1,
        expectedActionIds: ["H1-A001", "H1-A002"],
        expectedBoard: []
      },
      {
        role: "spectator",
        timing: "after-deadline",
        disconnectAtMs: 2_001,
        expectedHandNumber: 1,
        expectedFlowSequence: 2,
        expectedActionIds: ["H1-A001", "H1-A002"],
        expectedBoard: ["2c"]
      }
    ]);
    expectUniqueDeck(fixture.deck);
  });
});

describe("ordinary HTTP credential bootstrap", () => {
  it("creates rooms and participants through public endpoints while registering tokens only as known secrets", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const knownSecrets = new Set<string | Uint8Array>();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body
      });

      if (url.endsWith("/api/rooms")) {
        return jsonResponse(201, {
          roomId: "room-http",
          inviteUrl: "http://127.0.0.1:43100/room/room-http",
          hostUrl: "http://127.0.0.1:43100/room/room-http?host=host-secret"
        });
      }

      return jsonResponse(201, {
        participantId: "participant-http",
        participantToken: "participant-secret"
      });
    };
    const client = new ExperienceApiClient({
      baseUrl: "http://127.0.0.1:43100",
      knownSecrets,
      fetch: fetchImpl
    });

    const room = await client.createRoom({
      mode: "cash",
      seats: 2,
      initialChips: 100,
      smallBlind: 10,
      bigBlind: 20,
      actionTimerSeconds: null
    });
    const player = await client.joinPlayer(room.roomId, "SITE-r5-player");

    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:43100/api/rooms",
        method: "POST",
        body: {
          mode: "cash",
          seats: 2,
          initialChips: 100,
          smallBlind: 10,
          bigBlind: 20,
          actionTimerSeconds: null
        }
      },
      {
        url: "http://127.0.0.1:43100/api/rooms/room-http/participants",
        method: "POST",
        body: { displayName: "SITE-r5-player" }
      }
    ]);
    expect(room).toEqual({
      roomId: "room-http",
      inviteUrl: "http://127.0.0.1:43100/room/room-http",
      hostToken: "host-secret"
    });
    expect(player).toEqual({
      participantId: "participant-http",
      participantToken: "participant-secret",
      displayName: "SITE-r5-player"
    });
    expect([...knownSecrets]).toEqual(["host-secret", "participant-secret"]);
  });

  it("completes the visible join before clearing the host query and returning a trace-ready non-secret identity", async () => {
    const events: string[] = [];
    const knownSecrets = new Set<string | Uint8Array>();
    const response: BrowserJoinResponse = {
      url: () => "http://127.0.0.1:43100/api/rooms/room-browser/participants",
      request: () => ({ method: () => "POST" }),
      json: async () => ({
        participantId: "participant-browser",
        participantToken: "browser-secret"
      })
    };
    let currentUrl = "about:blank";
    const page: BrowserJoinPage = {
      async goto(url) {
        currentUrl = url;
        events.push(`goto:${url}`);
      },
      waitForResponse(predicate) {
        events.push("wait-for-participant-response");
        expect(predicate(response)).toBe(true);
        return Promise.resolve(response);
      },
      getByRole(role, options) {
        return {
          async fill(value: string) {
            events.push(`fill:${role}:${options.name}:${value}`);
          },
          async click() {
            events.push(`click:${role}:${options.name}`);
          },
          async waitFor(waitOptions: { state: string }) {
            events.push(`wait:${role}:${options.name}:${waitOptions.state}`);
          }
        };
      },
      async evaluate() {
        currentUrl = "http://127.0.0.1:43100/room/room-browser";
        events.push("history.replaceState");
      },
      url() {
        return currentUrl;
      }
    };

    const identity = await bootstrapBrowserIdentity({
      page,
      baseUrl: "http://127.0.0.1:43100",
      roomId: "room-browser",
      role: "host-player",
      displayName: "SITE-r5-host",
      hostToken: "host-browser-secret",
      knownSecrets
    });

    expect(events).toEqual([
      "goto:http://127.0.0.1:43100/room/room-browser?host=host-browser-secret",
      "fill:textbox:Nickname:SITE-r5-host",
      "wait-for-participant-response",
      "click:button:Join",
      "wait:dialog:Join flow:hidden",
      "history.replaceState"
    ]);
    expect(identity).toEqual({
      role: "host-player",
      participantId: "participant-browser",
      displayName: "SITE-r5-host",
      traceReady: true,
      safeUrl: "http://127.0.0.1:43100/room/room-browser"
    });
    expect(JSON.stringify(identity)).not.toContain("secret");
    expect([...knownSecrets]).toEqual(["host-browser-secret", "browser-secret"]);
    expect(page.url()).not.toContain("?host=");
  });

  it("scrubs the host query in a failure-safe path when visible join bootstrap fails", async () => {
    const events: string[] = [];
    let currentUrl = "about:blank";
    const page: BrowserJoinPage = {
      async goto(url) {
        currentUrl = url;
        events.push("goto");
      },
      waitForResponse() {
        events.push("wait-for-participant-response");
        return Promise.reject(new Error("participant request failed"));
      },
      getByRole() {
        return {
          async fill() {
            events.push("fill");
          },
          async click() {
            events.push("click");
          },
          async waitFor() {
            events.push("wait-for-dialog");
          }
        };
      },
      async evaluate() {
        currentUrl = "http://127.0.0.1:43100/room/room-browser";
        events.push("history.replaceState");
      },
      url() {
        return currentUrl;
      }
    };

    await expect(bootstrapBrowserIdentity({
      page,
      baseUrl: "http://127.0.0.1:43100",
      roomId: "room-browser",
      role: "host-player",
      displayName: "SITE-r5-host",
      hostToken: "host-browser-secret",
      knownSecrets: new Set()
    })).rejects.toThrow("participant request failed");

    expect(events).toEqual([
      "goto",
      "fill",
      "wait-for-participant-response",
      "click",
      "history.replaceState"
    ]);
    expect(page.url()).toBe("http://127.0.0.1:43100/room/room-browser");
  });
});

describe("FixtureRuntime", () => {
  it("seeds a started fixture through the real room engine and LiveRoomStore using only the isolated Redis URL", async () => {
    const values = new Map<string, string>();
    const openedUrls: string[] = [];
    let disconnected = false;
    const environment = createFixtureTargetEnvironment(await verifiedStackSnapshot());
    const runtime = new FixtureRuntime({
      targetEnvironment: environment,
      redisFactory(url) {
        openedUrls.push(url);
        return {
          get: async (key) => values.get(key) ?? null,
          set: async (key, value) => {
            values.set(key, value);
            return "OK";
          },
          del: async (key) => values.delete(key) ? 1 : 0,
          disconnect() {
            disconnected = true;
          }
        };
      }
    });
    const fixture = buildNormalBettingFixture({
      runId,
      participantIds: {
        button: "runtime-button",
        small: "runtime-small",
        big: "runtime-big"
      }
    });

    const seeded = await runtime.seedRoom("room-runtime", fixture);
    const persisted = JSON.parse(values.get("room:room-runtime") ?? "null") as RoomState;

    expect(openedUrls).toEqual([environment.redisUrl]);
    expect(disconnected).toBe(true);
    expect(seeded).toEqual(persisted);
    expect(persisted.roomId).toBe("room-runtime");
    expect(persisted.status).toBe("playing");
    expect(persisted.hand?.number).toBe(1);
    expect(persisted.seats.map(({ participantId, seatNumber, chips }) => ({
      participantId,
      seatNumber,
      chips
    }))).toEqual([
      { participantId: "runtime-button", seatNumber: 1, chips: 200 },
      { participantId: "runtime-small", seatNumber: 2, chips: 190 },
      { participantId: "runtime-big", seatNumber: 3, chips: 180 }
    ]);
    expect(Object.fromEntries(
      Object.entries(persisted.hand?.holeCardsByParticipantId ?? {}).map(([id, cards]) => [
        id,
        cards.map(serializeCard)
      ])
    )).toEqual({
      "runtime-small": ["Kc", "Kd"],
      "runtime-big": ["Qc", "Qd"],
      "runtime-button": ["As", "Ah"]
    });
  });

  it("refuses direct target casts and structurally valid forged Task 4 snapshots", () => {
    expect(() => new FixtureRuntime({
      targetEnvironment: {
        name: "deployed",
        kind: "isolated",
        runId,
        baseUrl: "http://localhost:3000",
        redisUrl: "redis://localhost:6379/0"
      } as FixtureTargetEnvironment
    })).toThrow(/verified isolated stack/i);

    expect(() => createFixtureTargetEnvironment(isolatedStackSnapshot())).toThrow(
      /not issued by a verified Docker site test stack lifecycle/i
    );
  });

  it("accepts a snapshot issued after the injected Task 4 lifecycle verifies the stack", async () => {
    const environment = createFixtureTargetEnvironment(await verifiedStackSnapshot());

    expect(environment).toEqual({
      name: "holdem-site-r5",
      kind: "isolated",
      runId: "r5",
      baseUrl: "http://127.0.0.1:43100",
      redisUrl: "redis://127.0.0.1:43101/0"
    });
  });

});

describe("run resource projection", () => {
  it("records exact non-secret room ownership facts and omits all credentials and Redis connection data", async () => {
    const environment = createFixtureTargetEnvironment(await verifiedStackSnapshot());
    const players: JoinedPlayerIdentity[] = [
      {
        role: "button",
        participantId: "resource-button",
        participantToken: "participant-secret-one",
        displayName: "SITE-r5-button"
      },
      {
        role: "big",
        participantId: "resource-big",
        participantToken: "participant-secret-two",
        displayName: "SITE-r5-big"
      }
    ];

    const record = buildRunResourceRecord({
      runId,
      room: {
        roomId: "room-resource",
        inviteUrl: "http://127.0.0.1:43100/room/room-resource",
        hostToken: "host-secret"
      },
      participants: players,
      targetEnvironment: environment
    });

    expect(record).toEqual({
      runId: "r5",
      resourceType: "poker-room",
      resourceId: "room-resource",
      ownerRunId: "r5",
      cleanupStatus: "pending",
      details: {
        targetEnvironment: "holdem-site-r5",
        participantIds: {
          button: "resource-button",
          big: "resource-big"
        },
        ownershipMarkers: {
          button: "SITE-r5-button",
          big: "SITE-r5-big"
        }
      }
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toMatch(/host-secret|participant-secret|redis-secret|redisUrl|participantToken|hostToken/i);
  });
});

const FACING_BET = ["fold", "call", "raise", "all-in"] as const;
const CHECK_OR_RAISE = ["check", "raise", "all-in"] as const;
const CHECK_OR_BET = ["check", "bet", "all-in"] as const;

function participant(role: string, participantId: string, seatNumber: number, startingChips: number) {
  return {
    role,
    participantId,
    displayName: `SITE-${runId}-${role}`,
    seatNumber,
    startingChips
  };
}

function sumStartingChips(participants: ReadonlyArray<{ startingChips: number }>): number {
  return participants.reduce((sum, participant) => sum + participant.startingChips, 0);
}

function transition(
  afterActionId: string,
  actorRole: string | null,
  street: string,
  pot: number,
  boardLength: number,
  legalPrimaryActions: readonly string[]
) {
  return { afterActionId, actorRole, street, pot, boardLength, legalPrimaryActions };
}

function actionSummary(action: { actorRole: string; action: { type: string } }): [string, string] {
  return [action.actorRole, action.action.type];
}

function expectUniqueDeck(deck: ReadonlyArray<{ rank: string; suit: string }>): void {
  const cards = deck.map((card) => `${card.rank}${card.suit}`);
  expect(cards).toHaveLength(52);
  expect(new Set(cards)).toHaveLength(52);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function isolatedStackSnapshot(): DockerSiteTestStackSnapshot {
  const projectName = "holdem-site-r5";
  const services = (["app", "postgres", "redis"] as const).map((service) => ({
    service,
    containerId: `${service}-container`,
    projectName,
    runLabel: "r5",
    status: "running",
    health: "healthy",
    imageId: `${service}-image`
  }));
  return {
    runId: "r5",
    projectName,
    image: "texas-holdem-friends-room:latest",
    imageId: "sha256:app-image",
    ports: { app: 43_100, postgres: 43_102, redis: 43_101 },
    services
  };
}

async function verifiedStackSnapshot(): Promise<DockerSiteTestStackSnapshot> {
  const snapshot = isolatedStackSnapshot();
  const containers: DockerContainerInspect[] = snapshot.services.map((service) => ({
    Id: service.containerId,
    Image: service.service === "app" ? snapshot.imageId : service.imageId,
    Config: {
      Labels: {
        "com.docker.compose.project": snapshot.projectName,
        "com.docker.compose.service": service.service,
        "com.texas-holdem.site-test-run": snapshot.runId
      }
    },
    State: {
      Status: service.status,
      Health: { Status: service.health }
    }
  }));
  const run: DockerProcessRunner = async (_command, args) => {
    if (args[0] === "image" && args[1] === "inspect") {
      return { exitCode: 0, stdout: `${snapshot.imageId}\n`, stderr: "" };
    }
    if (args.includes("up")) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (args.includes("ps")) {
      return {
        exitCode: 0,
        stdout: `${snapshot.services.map(({ containerId }) => containerId).join("\n")}\n`,
        stderr: ""
      };
    }
    if (args[0] === "inspect") {
      return { exitCode: 0, stdout: JSON.stringify(containers), stderr: "" };
    }
    throw new Error(`Unexpected injected Docker command: ${args.join(" ")}`);
  };
  const stack = new DockerSiteTestStack({
    runId: snapshot.runId,
    rootDirectory: process.cwd(),
    ports: snapshot.ports,
    postgresPassword: "fixture-password",
    image: snapshot.image,
    run
  });

  return stack.start();
}
