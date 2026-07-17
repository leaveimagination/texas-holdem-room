import { describe, expect, it } from "vitest";
import { parseCard } from "@/lib/poker/cards";
import { toParticipantView } from "@/lib/poker/visibility";
import type { RoomState } from "@/lib/poker/engine";

const state: RoomState = {
  roomId: "r1",
  mode: "cash",
  settings: {
    mode: "cash",
    seats: 2,
    initialChips: 1000,
    smallBlind: 10,
    bigBlind: 20,
    actionTimerSeconds: null
  },
  status: "playing",
  handCounter: 1,
  buttonSeat: 1,
  flow: {
    phase: "betting",
    sequence: 0,
    deadlineAt: null,
    nextRunoutStep: null,
    handResult: null
  },
  pendingTopUps: {},
  endAfterCurrentHand: false,
  sessionEndedAt: null,
  sessionSummary: null,
  seats: [
    {
      seatNumber: 1,
      participantId: "p1",
      displayName: "A",
      chips: 990,
      status: "active",
      cumulativeBuyIn: 1000
    },
    {
      seatNumber: 2,
      participantId: "p2",
      displayName: "B",
      chips: 980,
      status: "active",
      cumulativeBuyIn: 1000
    }
  ],
  hand: {
    id: "h1",
    number: 1,
    street: "preflop",
    board: [],
    deck: [],
    actorId: "p1",
    betting: {
      street: "preflop",
      currentBet: 20,
      minRaise: 20,
      actorId: "p1",
      players: [
        { id: "p1", stack: 990, committed: 10, streetCommitted: 10, folded: false, allIn: false },
        { id: "p2", stack: 980, committed: 20, streetCommitted: 20, folded: false, allIn: false }
      ]
    },
    holeCardsByParticipantId: {
      p1: [parseCard("As"), parseCard("Ah")],
      p2: [parseCard("Kd"), parseCard("Kh")]
    },
    startingChipsByParticipantId: { p1: 1000, p2: 1000 },
    actions: [],
    finished: false,
    winners: []
  }
};

describe("visibility", () => {
  it("shows a player only their own hole cards", () => {
    const view = toParticipantView(state, { participantId: "p1", role: "player", host: false });

    expect(view.hand?.seats[0].holeCards).toEqual(["As", "Ah"]);
    expect(view.hand?.seats[1].holeCards).toBeUndefined();
  });

  it("does not show hidden cards to host", () => {
    const view = toParticipantView(state, { participantId: "host", role: "spectator", host: true });

    expect(view.hand?.seats[0].holeCards).toBeUndefined();
    expect(view.hand?.seats[1].holeCards).toBeUndefined();
    expect(view.hostControls).toBe(true);
  });

  it("never shows hole cards to spectators, even with a participantId", () => {
    const view = toParticipantView(state, { participantId: "p1", role: "spectator", host: false });

    expect(view.hand?.seats[0].holeCards).toBeUndefined();
    expect(view.hand?.seats[1].holeCards).toBeUndefined();
  });

  it("includes only legal betting actions for the current actor", () => {
    const view = toParticipantView(state, { participantId: "p1", role: "player", host: false });

    expect(view.hand?.legalActions.map((action) => action.type)).toEqual(["fold", "call", "raise", "all-in"]);
  });

  it("includes public table metadata for frontend seat and betting indicators", () => {
    const view = toParticipantView(state, { participantId: "p1", role: "player", host: true });

    expect(view.settings).toMatchObject({ smallBlind: 10, bigBlind: 20, actionTimerSeconds: null });
    expect(view.buttonSeat).toBe(1);
    expect(view.hand).toMatchObject({
      currentBet: 20,
      minRaise: 20
    });
    expect(view.hand?.seats).toEqual([
      expect.objectContaining({ seatNumber: 1, role: "BTN/SB", committed: 10, streetCommitted: 10 }),
      expect.objectContaining({ seatNumber: 2, role: "BB", committed: 20, streetCommitted: 20 })
    ]);
  });

  it("does not leak winner cards on finished fold-win hands", () => {
    const foldWinState: RoomState = {
      ...state,
      hand: {
        ...state.hand!,
        finished: true,
        winners: ["p2"]
      }
    };

    const viewer = toParticipantView(foldWinState, { participantId: "p1", role: "player", host: false });
    const winner = toParticipantView(foldWinState, { participantId: "p2", role: "player", host: false });

    expect(viewer.hand?.seats[1].holeCards).toBeUndefined();
    expect(winner.hand?.seats[1].holeCards).toEqual(["Kd", "Kh"]);
  });

  it("reveals only non-folded contenders once a multiway showdown starts", () => {
    const showdown = threeWayShowdownState();
    const spectatorView = toParticipantView(showdown, { participantId: null, role: "spectator", host: false });
    const hostView = toParticipantView(showdown, { participantId: null, role: "spectator", host: true });

    expect(spectatorView.hand?.seats.find((seat) => seat.participantId === "p1")?.holeCards).toEqual(["As", "Ah"]);
    expect(spectatorView.hand?.seats.find((seat) => seat.participantId === "p2")?.holeCards).toEqual(["Kd", "Kh"]);
    expect(spectatorView.hand?.seats.find((seat) => seat.participantId === "folded")?.holeCards).toBeUndefined();
    expect(hostView.hand?.seats.find((seat) => seat.participantId === "folded")?.holeCards).toBeUndefined();
  });

  it("exposes reconstructable flow and safe pending totals without premature results", () => {
    const runout: RoomState = {
      ...state,
      pendingTopUps: {
        p1: { participantId: "p1", targetHandNumber: 2, amount: 800, requestCount: 2 }
      },
      endAfterCurrentHand: true,
      flow: {
        phase: "runout",
        sequence: 3,
        deadlineAt: 5_000,
        nextRunoutStep: { street: "turn", cardIndexOnStreet: 0 },
        handResult: sampleHandResult()
      },
      hand: {
        ...state.hand!,
        board: [parseCard("2c"), parseCard("3d"), parseCard("4h")],
        deck: [parseCard("5s"), parseCard("6c")],
        winners: ["p1"]
      }
    };

    const view = toParticipantView(runout, { participantId: null, role: "spectator", host: false });

    expect(view.flow).toMatchObject({
      phase: "runout",
      sequence: 3,
      deadlineAt: 5_000,
      nextRunoutStep: { street: "turn", cardIndexOnStreet: 0 },
      handResult: null
    });
    expect(view.pendingTopUps).toEqual({ p1: { amount: 800, targetHandNumber: 2 } });
    expect(view.endAfterCurrentHand).toBe(true);
    expect(view.hand?.winners).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("requestCount");
    expect(JSON.stringify(view)).not.toContain("deck");
    expect(JSON.stringify(view)).not.toContain("5s");
  });

  it("exposes the exact hand result only during hand summary", () => {
    const summary: RoomState = {
      ...state,
      flow: {
        phase: "hand-summary",
        sequence: 7,
        deadlineAt: 12_000,
        nextRunoutStep: null,
        handResult: sampleHandResult()
      },
      hand: { ...state.hand!, finished: true, winners: ["p1"] }
    };

    const view = toParticipantView(summary, { participantId: null, role: "spectator", host: false });

    expect(view.flow.handResult?.players).toHaveLength(2);
    expect(view.hand?.winners).toEqual(["p1"]);
    expect(view.hand?.legalActions).toEqual([]);
  });

  it("exposes the durable final session summary and no betting actions", () => {
    const sessionRoom: RoomState = {
      ...state,
      status: "finished",
      sessionEndedAt: 20_000,
      sessionSummary: [
        { participantId: "p1", displayName: "A", initialChips: 1_000, topUpChips: 500, finalChips: 1_700, netChips: 200 },
        { participantId: "p2", displayName: "B", initialChips: 1_000, topUpChips: 0, finalChips: 800, netChips: -200 }
      ],
      flow: {
        phase: "session-summary",
        sequence: 8,
        deadlineAt: null,
        nextRunoutStep: null,
        handResult: null
      }
    };

    const view = toParticipantView(sessionRoom, { participantId: null, role: "spectator", host: false });

    expect(view.sessionEndedAt).toBe(20_000);
    expect(view.sessionSummary).toHaveLength(2);
    expect(view.flow.phase).toBe("session-summary");
    expect(view.hand?.legalActions).toEqual([]);
  });
});

function threeWayShowdownState(): RoomState {
  return {
    ...state,
    settings: { ...state.settings, seats: 3 },
    flow: {
      phase: "showdown-reveal",
      sequence: 1,
      deadlineAt: 2_000,
      nextRunoutStep: { street: "flop", cardIndexOnStreet: 0 },
      handResult: null
    },
    seats: [
      ...state.seats,
      { seatNumber: 3, participantId: "folded", displayName: "C", chips: 900, status: "folded", cumulativeBuyIn: 1_000 }
    ],
    hand: {
      ...state.hand!,
      betting: {
        ...state.hand!.betting,
        players: [
          ...state.hand!.betting.players,
          { id: "folded", stack: 900, committed: 100, streetCommitted: 100, folded: true, allIn: false }
        ]
      },
      holeCardsByParticipantId: {
        ...state.hand!.holeCardsByParticipantId,
        folded: [parseCard("Qc"), parseCard("Qd")]
      },
      startingChipsByParticipantId: { ...state.hand!.startingChipsByParticipantId, folded: 1_000 }
    }
  };
}

function sampleHandResult() {
  return {
    handNumber: 1,
    board: ["2c", "3d", "4h", "5s", "6c"],
    winnerParticipantIds: ["p1"],
    players: [
      { participantId: "p1", displayName: "A", seatNumber: 1, startingChips: 1_000, committedChips: 1_000, potAward: 2_000, insuranceDelta: 0, endingChips: 2_000, netChips: 1_000 },
      { participantId: "p2", displayName: "B", seatNumber: 2, startingChips: 1_000, committedChips: 1_000, potAward: 0, insuranceDelta: 0, endingChips: 0, netChips: -1_000 }
    ],
    pots: [{ potIndex: 0, amount: 2_000, eligibleParticipantIds: ["p1", "p2"], awardsByParticipantId: { p1: 2_000 } }]
  };
}
