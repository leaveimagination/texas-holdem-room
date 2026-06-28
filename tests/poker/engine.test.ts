import { describe, expect, it } from "vitest";
import { parseCard } from "@/lib/poker/cards";
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

  it("does not leave the hand with an all-in opening actor when nobody can act after blinds", () => {
    expect(() => startHand(createReadyHeadsUpState([5, 15]), fixedDeck)).toThrow("No player can act after blinds");
  });
});
