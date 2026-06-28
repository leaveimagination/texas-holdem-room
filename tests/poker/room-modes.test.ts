import { describe, expect, it } from "vitest";
import {
  canClaimSeat,
  claimSeat,
  createInitialRoomState,
  markDisconnected,
  rebuy
} from "@/lib/poker/engine";

describe("room mode rules", () => {
  it("adds cash rebuys to chips and cumulative buy-in", () => {
    const seated = claimSeat(createCashRoom(), "p1", "Player 1", 1);
    const state = {
      ...seated,
      seats: seated.seats.map((seat) => (seat.participantId === "p1" ? { ...seat, chips: 0 } : seat))
    };
    const updated = rebuy(state, "p1", 500);

    expect(updated.seats[0]).toMatchObject({
      participantId: "p1",
      chips: 500,
      cumulativeBuyIn: 1500,
      status: "seated"
    });
  });

  it("rejects cash rebuys before a player busts", () => {
    const state = claimSeat(createCashRoom(), "p1", "Player 1", 1);

    expect(() => rebuy(state, "p1", 500)).toThrow("Rebuy is only available after busting");
  });

  it("rejects tournament rebuys", () => {
    const state = claimSeat(createTournamentRoom(), "p1", "Player 1", 1);

    expect(() => rebuy(state, "p1", 500)).toThrow("Rebuys are only allowed in cash games");
  });

  it("disallows tournament late seat claims after play has started", () => {
    const state = { ...createTournamentRoom(), status: "playing" as const };

    expect(canClaimSeat(state, "p1", 1)).toBe(false);
    expect(() => claimSeat(state, "p1", "Player 1", 1)).toThrow("Seat cannot be claimed now");
  });

  it("pauses an active hand when a player is marked disconnected", () => {
    const state = createPlayingCashRoom();

    const disconnected = markDisconnected(state, "p1");

    expect(disconnected.status).toBe("paused");
    expect(disconnected.seats[0].status).toBe("disconnected");
    expect(disconnected.hand?.finished).toBe(false);
  });

  it("does not pause when a folded player is marked disconnected", () => {
    const state = {
      ...createPlayingCashRoom(),
      hand: {
        ...createPlayingCashRoom().hand!,
        betting: {
          ...createPlayingCashRoom().hand!.betting,
          players: createPlayingCashRoom().hand!.betting.players.map((player) =>
            player.id === "p1" ? { ...player, folded: true } : player
          )
        }
      }
    };

    const disconnected = markDisconnected(state, "p1");

    expect(disconnected.status).toBe("playing");
    expect(disconnected.seats[0].status).toBe("disconnected");
  });
});

function createPlayingCashRoom() {
  const room = createCashRoom();
  return {
    ...room,
    status: "playing" as const,
    hand: {
      id: "room-1-1",
      number: 1,
      street: "preflop" as const,
      board: [],
      deck: [],
      actorId: "p1",
      betting: {
        street: "preflop" as const,
        currentBet: 0,
        minRaise: 20,
        actorId: "p1",
        players: [
          { id: "p1", stack: 1000, committed: 0, streetCommitted: 0, folded: false, allIn: false },
          { id: "p2", stack: 1000, committed: 0, streetCommitted: 0, folded: false, allIn: false }
        ]
      },
      holeCardsByParticipantId: {},
      actions: [],
      finished: false,
      winners: []
    },
    seats: room.seats.map((seat, index) => ({
      ...seat,
      participantId: `p${index + 1}`,
      displayName: `Player ${index + 1}`,
      chips: 1000,
      cumulativeBuyIn: 1000,
      status: "active" as const
    }))
  };
}

function createCashRoom() {
  return createInitialRoomState(
    { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    "room-1"
  );
}

function createTournamentRoom() {
  return createInitialRoomState(
    {
      mode: "tournament",
      seats: 2,
      initialChips: 1000,
      smallBlind: 10,
      bigBlind: 20,
      actionTimerSeconds: null,
      blindIncrease: { type: "hands", interval: 10 }
    },
    "room-1"
  );
}
