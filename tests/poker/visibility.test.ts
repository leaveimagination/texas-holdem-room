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
});
