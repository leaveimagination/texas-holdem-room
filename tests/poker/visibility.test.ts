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
      players: []
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
});
