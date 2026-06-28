import { describe, expect, it } from "vitest";
import { parseCard } from "@/lib/poker/cards";
import { applyPlayerAction, createInitialRoomState, startHand } from "@/lib/poker/engine";

const fixedDeck = "As Ah Kd Kh Qs Qh Jd Jh Tc Td 9s 9h 8d 8h 7s 7h 6d 6h 5s 5h 4d 4h 3s 3h 2d 2h Ac Ad Kc Ks Qc Qd Jc Js Ts Th 9c 9d 8c 8s 7c 7d 6c 6s 5c 5d 4c 4s 3c 3d 2c 2s"
  .split(" ")
  .map(parseCard);

describe("engine", () => {
  it("starts a hand with blinds and private hole cards", () => {
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
        chips: 1000,
        cumulativeBuyIn: 1000,
        status: "ready"
      }))
    };

    const started = startHand(state, fixedDeck);

    expect(started.hand?.number).toBe(1);
    expect(started.hand?.street).toBe("preflop");
    expect(started.hand?.board).toEqual([]);
    expect(started.seats[0].chips + started.seats[1].chips).toBe(1970);
    expect(started.hand?.holeCardsByParticipantId.p1).toHaveLength(2);
  });

  it("ends hand early when everyone but one player folds", () => {
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
        chips: 1000,
        cumulativeBuyIn: 1000,
        status: "ready"
      }))
    };

    const started = startHand(state, fixedDeck);
    const finished = applyPlayerAction(started, { type: "fold", playerId: started.hand!.actorId });

    expect(finished.hand?.finished).toBe(true);
    expect(finished.hand?.winners.length).toBe(1);
  });
});
