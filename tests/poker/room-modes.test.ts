import { describe, expect, it } from "vitest";
import {
  applyPlayerAction,
  canClaimSeat,
  claimSeat,
  createInitialRoomState,
  finishHandIfReady,
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

  it("rejects chip adds before a player busts", () => {
    const state = claimSeat(createCashRoom(), "p1", "Player 1", 1);

    expect(() => rebuy(state, "p1", 500)).toThrow("Adding chips is only available after your stack reaches zero");
  });

  it("rejects tournament chip adds", () => {
    const state = claimSeat(createTournamentRoom(), "p1", "Player 1", 1);

    expect(() => rebuy(state, "p1", 500)).toThrow("Adding chips is only available at flexible tables");
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

  it("eliminates zero-chip tournament players and finishes with one remaining player", () => {
    const state = {
      ...createPlayingHeadsUpTournamentRoom(),
      hand: {
        ...createPlayingHeadsUpTournamentRoom().hand!,
        actorId: "p2",
        betting: {
          ...createPlayingHeadsUpTournamentRoom().hand!.betting,
          actorId: "p2",
          players: [
            { id: "p1", stack: 1000, committed: 0, streetCommitted: 0, folded: false, allIn: false },
            { id: "p2", stack: 0, committed: 1000, streetCommitted: 1000, folded: false, allIn: false }
          ]
        }
      },
      seats: createPlayingHeadsUpTournamentRoom().seats.map((seat) =>
        seat.participantId === "p2" ? { ...seat, chips: 0, status: "all-in" as const } : seat
      )
    };

    const finished = applyPlayerAction(state, { type: "fold", playerId: "p2" });

    expect(finished.seats.find((seat) => seat.participantId === "p2")?.status).toBe("eliminated");
    expect(finished.status).toBe("finished");
  });

  it("increases tournament blinds after the configured number of hands", () => {
    const state = {
      ...createPlayingTournamentRoom(),
      handCounter: 5,
      hand: {
        ...createPlayingTournamentRoom().hand!,
        actorId: "p3",
        number: 5,
        betting: {
          ...createPlayingTournamentRoom().hand!.betting,
          actorId: "p3",
          players: [
            { id: "p1", stack: 1000, committed: 0, streetCommitted: 0, folded: false, allIn: false },
            { id: "p2", stack: 1000, committed: 0, streetCommitted: 0, folded: true, allIn: false },
            { id: "p3", stack: 1000, committed: 0, streetCommitted: 0, folded: false, allIn: false }
          ]
        }
      },
      seats: createPlayingTournamentRoom().seats.map((seat, index) => ({
        ...seat,
        participantId: `p${index + 1}`,
        displayName: `Player ${index + 1}`,
        chips: 1000,
        cumulativeBuyIn: 1000,
        status: index === 1 ? "folded" as const : "active" as const
      }))
    };

    const finished = applyPlayerAction(state, { type: "fold", playerId: "p3" });

    expect(finished.status).toBe("playing");
    expect(finished.settings.smallBlind).toBe(20);
    expect(finished.settings.bigBlind).toBe(40);
  });

  it("does not eliminate all-in tournament players before a winner is known", () => {
    const state = {
      ...createPlayingHeadsUpTournamentRoom(),
      hand: {
        ...createPlayingHeadsUpTournamentRoom().hand!,
        betting: {
          ...createPlayingHeadsUpTournamentRoom().hand!.betting,
          currentBet: 1000,
          players: [
            { id: "p1", stack: 0, committed: 1000, streetCommitted: 1000, folded: false, allIn: true },
            { id: "p2", stack: 0, committed: 1000, streetCommitted: 1000, folded: false, allIn: true }
          ]
        }
      },
      seats: createPlayingHeadsUpTournamentRoom().seats.map((seat) => ({
        ...seat,
        chips: 0,
        status: "all-in" as const
      }))
    };

    const finished = finishHandIfReady(state);

    expect(finished.hand?.finished).toBe(true);
    expect(finished.hand?.winners).toEqual([]);
    expect(finished.status).toBe("playing");
    expect(finished.seats.map((seat) => seat.status)).toEqual(["all-in", "all-in"]);
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

function createPlayingTournamentRoom() {
  const room = createInitialRoomState(
    {
      mode: "tournament",
      seats: 3,
      initialChips: 1000,
      smallBlind: 10,
      bigBlind: 20,
      actionTimerSeconds: null,
      blindIncrease: { type: "hands", interval: 5 }
    },
    "room-1"
  );

  return {
    ...room,
    status: "playing" as const,
    handCounter: 1,
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
          { id: "p2", stack: 1000, committed: 0, streetCommitted: 0, folded: false, allIn: false },
          { id: "p3", stack: 1000, committed: 0, streetCommitted: 0, folded: false, allIn: false }
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

function createPlayingHeadsUpTournamentRoom() {
  const room = createInitialRoomState(
    {
      mode: "tournament",
      seats: 2,
      initialChips: 1000,
      smallBlind: 10,
      bigBlind: 20,
      actionTimerSeconds: null,
      blindIncrease: { type: "hands", interval: 5 }
    },
    "room-1"
  );

  return {
    ...room,
    status: "playing" as const,
    handCounter: 1,
    hand: {
      id: "room-1-1",
      number: 1,
      street: "preflop" as const,
      board: [],
      deck: [],
      actorId: "p2",
      betting: {
        street: "preflop" as const,
        currentBet: 0,
        minRaise: 20,
        actorId: "p2",
        players: [
          { id: "p1", stack: 1000, committed: 0, streetCommitted: 0, folded: false, allIn: false },
          { id: "p2", stack: 0, committed: 1000, streetCommitted: 1000, folded: false, allIn: false }
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
      chips: index === 1 ? 0 : 1000,
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
