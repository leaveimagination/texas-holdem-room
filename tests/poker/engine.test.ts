import { describe, expect, it } from "vitest";
import { parseCard, serializeCard } from "@/lib/poker/cards";
import { getLegalActions } from "@/lib/poker/betting";
import { applyInsuranceDecision, applyPlayerAction, createInitialRoomState, finishHandIfReady, startHand, type RoomState } from "@/lib/poker/engine";

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
    expect(called.hand?.board.map(serializeCard)).toEqual(["Qs", "Qh", "Jd", "Jh", "Tc"]);
    expect(called.hand?.winners).toEqual(["p1", "p2"]);
    expect(called.seats[0].chips).toBe(100);
    expect(called.seats[1].chips).toBe(15);
  });

  it("allows the opener to complete a short all-in big blind to the full configured blind", () => {
    const started = startHand(createReadyHeadsUpState([100, 15]), fixedDeck);
    const completed = applyPlayerAction(started, { type: "raise", playerId: started.hand!.actorId, amountTo: 20 });

    expect(completed.hand?.betting.currentBet).toBe(20);
    expect(completed.hand?.finished).toBe(true);
    expect(completed.hand?.board.map(serializeCard)).toEqual(["Qs", "Qh", "Jd", "Jh", "Tc"]);
    expect(completed.hand?.winners).toEqual(["p1", "p2"]);
    expect(completed.seats[0].chips).toBe(100);
    expect(completed.seats[1].chips).toBe(15);
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

  it("keeps the full blind as the future raise unit after an explicit all-in completes a short big blind", () => {
    const started = startHand(createReadyThreeHandedState([20, 100, 15]), fixedDeck);
    const completed = applyPlayerAction(started, { type: "all-in", playerId: started.hand!.actorId });
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
    expect(called.hand?.board.map(serializeCard)).toEqual(["Jd", "Jh", "Tc", "Td", "9s"]);
    expect(called.hand?.winners).not.toEqual([]);
    expect(called.hand?.betting.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "p1", allIn: false, streetCommitted: 20 }),
        expect.objectContaining({ id: "p2", allIn: false, streetCommitted: 20 }),
        expect.objectContaining({ id: "p3", allIn: true, streetCommitted: 15 })
      ])
    );
  });

  it("advances through flop, turn, and river before showdown after checked betting rounds", () => {
    const preflop = startHand(createReadyHeadsUpState(), fixedDeck);
    const called = applyPlayerAction(preflop, { type: "call", playerId: preflop.hand!.actorId });
    const flop = applyPlayerAction(called, { type: "check", playerId: called.hand!.actorId });

    expect(flop.hand?.finished).toBe(false);
    expect(flop.hand?.street).toBe("flop");
    expect(flop.hand?.board.map(serializeCard)).toEqual(["Qs", "Qh", "Jd"]);
    expect(flop.hand?.actorId).toBe("p2");
    expect(flop.hand?.betting).toMatchObject({ street: "flop", currentBet: 0, minRaise: 20 });

    const turn = applyPlayerAction(
      applyPlayerAction(flop, { type: "check", playerId: "p2" }),
      { type: "check", playerId: "p1" }
    );
    expect(turn.hand?.street).toBe("turn");
    expect(turn.hand?.board.map(serializeCard)).toEqual(["Qs", "Qh", "Jd", "Jh"]);

    const river = applyPlayerAction(
      applyPlayerAction(turn, { type: "check", playerId: "p2" }),
      { type: "check", playerId: "p1" }
    );
    expect(river.hand?.street).toBe("river");
    expect(river.hand?.board.map(serializeCard)).toEqual(["Qs", "Qh", "Jd", "Jh", "Tc"]);

    const showdown = applyPlayerAction(
      applyPlayerAction(river, { type: "check", playerId: "p2" }),
      { type: "check", playerId: "p1" }
    );
    expect(showdown.hand?.finished).toBe(true);
    expect(showdown.hand?.winners).toEqual(["p1", "p2"]);
    expect(showdown.seats.map((seat) => seat.chips)).toEqual([1000, 1000]);
  });

  it("awards main and side pots to each pot's best eligible hand at showdown", () => {
    const deck = "Kh Qs 9c Kd Jd 9d 9h 2c 3d 4s 7c 8d 8h Tc Td Jh Qh Ks Ac 2d 3h 4c 5s 6c 7d 8s 9s Ts Jc Qc Kc Ad Ah As 2h 2s 3c 3s 4d 4h 5c 5d"
      .split(" ")
      .map(parseCard);
    const started = startHand(createReadyThreeHandedState([50, 100, 100]), deck);
    const p1AllIn = applyPlayerAction(started, { type: "all-in", playerId: "p1" });
    const p2AllIn = applyPlayerAction(p1AllIn, { type: "all-in", playerId: "p2" });
    const showdown = applyPlayerAction(p2AllIn, { type: "call", playerId: "p3" });

    expect(showdown.hand?.finished).toBe(true);
    expect(showdown.hand?.board).toHaveLength(5);
    expect(showdown.hand?.winners).toEqual(["p1", "p2"]);
    expect(showdown.seats.map((seat) => seat.chips)).toEqual([150, 100, 0]);
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

  it("offers cash-game all-in insurance before running out the river", () => {
    const pending = finishHandIfReady(createTurnAllInInsuranceState());

    expect(pending.hand?.finished).toBe(false);
    expect(pending.hand?.board.map(serializeCard)).toEqual(["2c", "7d", "9h", "3s"]);
    expect(pending.hand?.insuranceOffer).toMatchObject({
      status: "pending",
      offeredTo: "p1",
      potAmount: 200
    });
    expect(pending.hand?.insuranceOffer?.coverage).toBeGreaterThan(100);
    expect(pending.hand?.insuranceOffer?.premium).toBeGreaterThan(0);
  });

  it("pays accepted all-in insurance when the covered favorite loses", () => {
    const pending = finishHandIfReady(createTurnAllInInsuranceState());
    const resolved = applyInsuranceDecision(pending, "p1", true);

    expect(resolved.hand?.finished).toBe(true);
    expect(resolved.hand?.board.map(serializeCard)).toEqual(["2c", "7d", "9h", "3s", "Kc"]);
    expect(resolved.hand?.winners).toEqual(["p2"]);
    expect(resolved.hand?.insuranceOffer).toMatchObject({ status: "accepted", paidOut: true });
    expect(resolved.seats.find((seat) => seat.participantId === "p1")?.chips).toBe(pending.hand?.insuranceOffer?.coverage);
  });
});

function createTurnAllInInsuranceState(): RoomState {
  return {
    roomId: "room-insurance",
    mode: "cash",
    settings: { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    status: "playing",
    handCounter: 1,
    buttonSeat: 1,
    seats: [
      { seatNumber: 1, participantId: "p1", displayName: "Aces", chips: 0, cumulativeBuyIn: 1000, status: "all-in" },
      { seatNumber: 2, participantId: "p2", displayName: "Kings", chips: 0, cumulativeBuyIn: 1000, status: "all-in" }
    ],
    hand: {
      id: "room-insurance-1",
      number: 1,
      street: "turn",
      board: ["2c", "7d", "9h", "3s"].map(parseCard),
      deck: "Kc 4d 5d 6d 8d Td Jd Qd Ad".split(" ").map(parseCard),
      actorId: "p1",
      betting: {
        street: "turn",
        currentBet: 100,
        minRaise: 20,
        actorId: "p1",
        players: [
          { id: "p1", stack: 0, committed: 100, streetCommitted: 100, folded: false, allIn: true },
          { id: "p2", stack: 0, committed: 100, streetCommitted: 100, folded: false, allIn: true }
        ]
      },
      holeCardsByParticipantId: {
        p1: ["As", "Ah"].map(parseCard),
        p2: ["Ks", "Kh"].map(parseCard)
      },
      actions: [
        { playerId: "p1", type: "all-in", street: "turn", amount: 100 },
        { playerId: "p2", type: "call", street: "turn", amount: 100 }
      ],
      finished: false,
      winners: []
    }
  };
}
