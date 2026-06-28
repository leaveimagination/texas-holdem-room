import { describe, expect, it } from "vitest";
import { parseCard, serializeCard } from "@/lib/poker/cards";
import { getLegalActions } from "@/lib/poker/betting";
import { applyPlayerAction, createInitialRoomState, startHand } from "@/lib/poker/engine";

const fixedDeck = "As Ah Kd Kh Qs Qh Jd Jh Tc Td 9s 9h 8d 8h 7s 7h 6d 6h 5s 5h 4d 4h 3s 3h 2d 2h Ac Ad Kc Ks Qc Qd Jc Js Ts Th 9c 9d 8c 8s 7c 7d 6c 6s 5c 5d 4c 4s 3c 3d 2c 2s"
  .split(" ")
  .map(parseCard);

function createReadyHeadsUpState(chips: [number, number] = [1000, 1000]) {
  let state = createInitialRoomState(
    { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    "room1"
  );

  state = {
    ...state,
    seats: state.seats.map((seat, index) => ({
      ...seat,
      participantId: `p${index + 1}`,
      displayName: `P${index + 1}`,
      chips: chips[index],
      cumulativeBuyIn: chips[index],
      status: "ready"
    }))
  };

  return state;
}

function createReadyThreeHandedState(chips: [number, number, number] = [1000, 1000, 1000]) {
  let state = createInitialRoomState(
    { mode: "cash", seats: 3, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    "room1"
  );

  state = {
    ...state,
    seats: state.seats.map((seat, index) => ({
      ...seat,
      participantId: `p${index + 1}`,
      displayName: `P${index + 1}`,
      chips: chips[index],
      cumulativeBuyIn: chips[index],
      status: "ready"
    }))
  };

  return state;
}

function createSparseFourSeatState() {
  const state = createInitialRoomState(
    { mode: "cash", seats: 4, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    "room1"
  );

  return {
    ...state,
    buttonSeat: 1,
    seats: state.seats.map((seat) => {
      if (seat.seatNumber === 2) {
        return seat;
      }

      return {
        ...seat,
        participantId: `p${seat.seatNumber}`,
        displayName: `P${seat.seatNumber}`,
        chips: 1000,
        cumulativeBuyIn: 1000,
        status: "ready" as const
      };
    })
  };
}

describe("engine", () => {
  it("posts normal blinds, deals hole cards, and assigns the opening actor heads up", () => {
    const started = startHand(createReadyHeadsUpState(), fixedDeck);

    expect(started.hand?.number).toBe(1);
    expect(started.hand?.street).toBe("preflop");
    expect(started.hand?.board).toEqual([]);
    expect(started.seats[0].chips).toBe(990);
    expect(started.seats[1].chips).toBe(980);
    expect(started.hand?.betting.currentBet).toBe(20);
    expect(started.hand?.actorId).toBe("p1");
    expect(started.hand?.actorId).toBe(started.hand?.betting.actorId);
    expect(started.hand?.holeCardsByParticipantId.p1).toHaveLength(2);
  });

  it("awards the pot to the remaining player when the opener folds", () => {
    const started = startHand(createReadyHeadsUpState(), fixedDeck);
    const finished = applyPlayerAction(started, { type: "fold", playerId: started.hand!.actorId });

    expect(finished.hand?.finished).toBe(true);
    expect(finished.hand?.winners).toEqual(["p2"]);
    expect(finished.seats[0].chips).toBe(990);
    expect(finished.seats[1].chips).toBe(1010);
  });

  it("does not choose an all-in small blind as the opening actor when the big blind can act", () => {
    const started = startHand(createReadyHeadsUpState([5, 100]), fixedDeck);

    expect(started.seats[0].status).toBe("all-in");
    expect(started.hand?.actorId).toBe("p2");
    expect(started.hand?.betting.actorId).toBe("p2");
  });

  it("closes the action after the small blind calls a short all-in big blind", () => {
    const started = startHand(createReadyHeadsUpState([100, 15]), fixedDeck);
    const called = applyPlayerAction(started, { type: "call", playerId: started.hand!.actorId });

    expect(started.seats[1].status).toBe("all-in");
    expect(started.hand?.betting.currentBet).toBe(15);
    expect(started.hand?.actorId).toBe("p1");
    expect(called.hand?.finished).toBe(true);
    expect(called.hand?.winners).toEqual([]);
    expect(called.seats[0].chips).toBe(85);
    expect(called.seats[1].chips).toBe(0);
  });

  it("allows the opener to complete a short all-in big blind to the full configured blind", () => {
    const started = startHand(createReadyHeadsUpState([100, 15]), fixedDeck);
    const completed = applyPlayerAction(started, { type: "raise", playerId: started.hand!.actorId, amountTo: 20 });

    expect(completed.hand?.betting.currentBet).toBe(20);
    expect(completed.hand?.finished).toBe(true);
    expect(completed.seats[0].chips).toBe(80);
    expect(completed.seats[1].chips).toBe(0);
  });

  it("keeps the full blind as the future raise unit after completing a short big blind", () => {
    const started = startHand(createReadyThreeHandedState([100, 100, 15]), fixedDeck);
    const completed = applyPlayerAction(started, { type: "raise", playerId: started.hand!.actorId, amountTo: 20 });
    const nextActions = getLegalActions(completed.hand!.betting, completed.hand!.actorId);

    expect(started.hand?.actorId).toBe("p1");
    expect(completed.hand?.finished).toBe(false);
    expect(completed.hand?.actorId).toBe("p2");
    expect(completed.hand?.betting.currentBet).toBe(20);
    expect(completed.hand?.betting.minRaise).toBe(20);
    expect(nextActions).toContainEqual({ type: "raise", minAmountTo: 40, maxAmountTo: 100 });
    expect(nextActions).not.toContainEqual({ type: "raise", minAmountTo: 25, maxAmountTo: 100 });
  });

  it("finishes after the next player calls a short-big-blind completion in three-handed play", () => {
    const started = startHand(createReadyThreeHandedState([100, 100, 15]), fixedDeck);
    const completed = applyPlayerAction(started, { type: "raise", playerId: started.hand!.actorId, amountTo: 20 });
    const called = applyPlayerAction(completed, { type: "call", playerId: completed.hand!.actorId });

    expect(started.seats[2].status).toBe("all-in");
    expect(completed.hand?.finished).toBe(false);
    expect(completed.hand?.actorId).toBe("p2");
    expect(called.hand?.finished).toBe(true);
    expect(called.hand?.winners).toEqual([]);
    expect(called.hand?.betting.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "p1", allIn: false, streetCommitted: 20 }),
        expect.objectContaining({ id: "p2", allIn: false, streetCommitted: 20 }),
        expect.objectContaining({ id: "p3", allIn: true, streetCommitted: 15 })
      ])
    );
  });

  it("does not leave the hand with an all-in opening actor when nobody can act after blinds", () => {
    expect(() => startHand(createReadyHeadsUpState([5, 15]), fixedDeck)).toThrow("No player can act after blinds");
  });

  it("keeps the hand live when a remaining player still owes chips after an all-in and a fold", () => {
    const started = startHand(createReadyThreeHandedState([200, 200, 200]), fixedDeck);
    const jammed = applyPlayerAction(started, { type: "all-in", playerId: started.hand!.actorId });
    const afterFold = applyPlayerAction(jammed, { type: "fold", playerId: jammed.hand!.actorId });

    expect(started.hand?.actorId).toBe("p1");
    expect(jammed.hand?.betting.currentBet).toBe(200);
    expect(afterFold.hand?.finished).toBe(false);
    expect(afterFold.hand?.actorId).toBe("p3");
    expect(afterFold.hand?.betting.actorId).toBe("p3");
    expect(afterFold.hand?.betting.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "p1", allIn: true, streetCommitted: 200 }),
        expect.objectContaining({ id: "p2", folded: true }),
        expect.objectContaining({ id: "p3", allIn: false, streetCommitted: 20 })
      ])
    );
  });

  it("deals hole cards starting from the seat left of the button", () => {
    const started = startHand(createSparseFourSeatState(), fixedDeck);

    expect(started.buttonSeat).toBe(3);
    expect(started.hand?.holeCardsByParticipantId.p4.map(serializeCard)).toEqual(["As", "Kh"]);
    expect(started.hand?.holeCardsByParticipantId.p1.map(serializeCard)).toEqual(["Ah", "Qs"]);
    expect(started.hand?.holeCardsByParticipantId.p3.map(serializeCard)).toEqual(["Kd", "Qh"]);
  });
});
