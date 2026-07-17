import { describe, expect, it } from "vitest";
import { parseCard, serializeCard, type Card } from "@/lib/poker/cards";
import {
  advanceDuePhase,
  applyPlayerAction,
  createInitialRoomState,
  finishHandIfReady,
  startHand,
  type RoomState
} from "@/lib/poker/engine";

const fixedDeck = "As Ah Kd Kh Qs Qh Jd Jh Tc Td 9s 9h 8d 8h 7s 7h 6d 6h 5s 5h 4d 4h 3s 3h 2d 2h Ac Ad Kc Ks Qc Qd Jc Js Ts Th 9c 9d 8c 8s 7c 7d 6c 6s 5c 5d 4c 4s 3c 3d 2c 2s"
  .split(" ")
  .map(parseCard);

describe("authoritative runout flow", () => {
  it("reveals a four-way preflop all-in one phase at a time before settlement", () => {
    const locked = playFourWayPreflopAllIn(0);

    expect(locked.flow).toMatchObject({
      phase: "showdown-reveal",
      sequence: 1,
      deadlineAt: 2_000,
      nextRunoutStep: { street: "flop", cardIndexOnStreet: 0 },
      handResult: null
    });
    expect(locked.hand?.board).toEqual([]);
    expect(locked.hand?.finished).toBe(false);
    expect(locked.hand?.winners).toEqual([]);
    expect(advanceDuePhase(locked, 1_999)).toBe(locked);

    const flop1 = advanceDuePhase(locked, 2_000);
    expect(flop1.hand?.board.map(serializeCard)).toEqual(["Tc"]);
    expect(flop1.flow).toMatchObject({
      phase: "runout",
      sequence: 2,
      deadlineAt: 3_000,
      nextRunoutStep: { street: "flop", cardIndexOnStreet: 1 },
      handResult: null
    });

    const flop2 = advanceDuePhase(flop1, 3_000);
    expect(flop2.hand?.board.map(serializeCard)).toEqual(["Tc", "Td"]);
    expect(flop2.flow.deadlineAt).toBe(4_000);

    const flop3 = advanceDuePhase(flop2, 4_000);
    expect(flop3.hand?.board.map(serializeCard)).toEqual(["Tc", "Td", "9s"]);
    expect(flop3.flow).toMatchObject({ deadlineAt: 6_000, nextRunoutStep: { street: "turn", cardIndexOnStreet: 0 } });

    const turn = advanceDuePhase(flop3, 6_000);
    expect(turn.hand?.board.map(serializeCard)).toEqual(["Tc", "Td", "9s", "9h"]);
    expect(turn.flow).toMatchObject({ deadlineAt: 8_000, nextRunoutStep: { street: "river", cardIndexOnStreet: 0 } });

    const river = advanceDuePhase(turn, 8_000);
    expect(river.hand?.board.map(serializeCard)).toEqual(["Tc", "Td", "9s", "9h", "8d"]);
    expect(river.flow).toMatchObject({ phase: "runout", deadlineAt: 10_000, nextRunoutStep: null, handResult: null });
    expect(river.hand?.finished).toBe(false);
    expect(river.hand?.winners).toEqual([]);

    const settled = advanceDuePhase(river, 10_000);
    expect(settled.flow).toMatchObject({ phase: "hand-summary", sequence: 7, deadlineAt: 12_000 });
    expect(settled.hand?.finished).toBe(true);
    expect(settled.flow.handResult?.players).toHaveLength(4);
    expect(settled.flow.handResult?.board).toEqual(["Tc", "Td", "9s", "9h", "8d"]);
  });

  it("skips already-visible streets for a multiway flop all-in", () => {
    const locked = createThreeWayFlopAllIn();

    expect(locked.flow).toMatchObject({
      phase: "showdown-reveal",
      deadlineAt: 2_000,
      nextRunoutStep: { street: "turn", cardIndexOnStreet: 0 }
    });
    expect(locked.hand?.board.map(serializeCard)).toEqual(["Jd", "Jh", "Tc"]);

    const turn = advanceDuePhase(locked, 2_000);
    expect(turn.hand?.board.map(serializeCard)).toEqual(["Jd", "Jh", "Tc", "Td"]);
    expect(turn.flow).toMatchObject({ deadlineAt: 4_000, nextRunoutStep: { street: "river", cardIndexOnStreet: 0 } });

    const river = advanceDuePhase(turn, 4_000);
    expect(river.hand?.board.map(serializeCard)).toEqual(["Jd", "Jh", "Tc", "Td", "9s"]);
    expect(river.hand?.finished).toBe(false);

    const settled = advanceDuePhase(river, 6_000);
    expect(settled.hand?.finished).toBe(true);
    expect(settled.flow.phase).toBe("hand-summary");
  });

  it("enters a two-second summary immediately on a fold win with exact player deltas", () => {
    const started = startHand(createReadyRoom([1_000, 1_000]), fixedDeck, 500);
    const finished = applyPlayerAction(started, { type: "fold", playerId: started.hand!.actorId }, 500);

    expect(finished.flow).toMatchObject({ phase: "hand-summary", deadlineAt: 2_500 });
    expect(finished.hand?.finished).toBe(true);
    expect(finished.flow.handResult?.players).toEqual([
      expect.objectContaining({ participantId: "p2", startingChips: 1_000, committedChips: 20, potAward: 30, endingChips: 1_010, netChips: 10 }),
      expect.objectContaining({ participantId: "p1", startingChips: 1_000, committedChips: 10, potAward: 0, endingChips: 990, netChips: -10 })
    ]);
    expect(finished.flow.handResult?.pots).toEqual([
      { potIndex: 0, amount: 20, eligibleParticipantIds: ["p2"], awardsByParticipantId: { p2: 20 } },
      { potIndex: 1, amount: 10, eligibleParticipantIds: ["p2"], awardsByParticipantId: { p2: 10 } }
    ]);
  });

  it("records exact main and side-pot awards and signed results", () => {
    const deck = "Kh Qs 9c Kd Jd 9d 9h 2c 3d 4s 7c 8d 8h Tc Td Jh Qh Ks Ac 2d 3h 4c 5s 6c 7d 8s 9s Ts Jc Qc Kc Ad Ah As 2h 2s 3c 3s 4d 4h 5c 5d"
      .split(" ")
      .map(parseCard);
    const started = startHand(createReadyRoom([50, 100, 100]), deck, 0);
    const p1AllIn = applyPlayerAction(started, { type: "all-in", playerId: "p1" }, 0);
    const p2AllIn = applyPlayerAction(p1AllIn, { type: "all-in", playerId: "p2" }, 0);
    const locked = applyPlayerAction(p2AllIn, { type: "call", playerId: "p3" }, 0);
    const settled = advanceThroughPreflopRunout(locked);

    expect(settled.seats.map((seat) => seat.chips)).toEqual([150, 100, 0]);
    expect(settled.flow.handResult?.pots).toEqual([
      { potIndex: 0, amount: 150, eligibleParticipantIds: ["p1", "p2", "p3"], awardsByParticipantId: { p1: 150 } },
      { potIndex: 1, amount: 100, eligibleParticipantIds: ["p2", "p3"], awardsByParticipantId: { p2: 100 } }
    ]);
    expect(settled.flow.handResult?.players).toEqual([
      expect.objectContaining({ participantId: "p1", potAward: 150, endingChips: 150, netChips: 100 }),
      expect.objectContaining({ participantId: "p2", potAward: 100, endingChips: 100, netChips: 0 }),
      expect.objectContaining({ participantId: "p3", potAward: 0, endingChips: 0, netChips: -100 })
    ]);
  });
});

function createReadyRoom(chips: number[]): RoomState {
  const room = createInitialRoomState(
    { mode: "cash", seats: chips.length, initialChips: 1_000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    "room-runout"
  );

  return {
    ...room,
    seats: room.seats.map((seat, index) => ({
      ...seat,
      participantId: `p${index + 1}`,
      displayName: `P${index + 1}`,
      chips: chips[index],
      cumulativeBuyIn: 1_000,
      status: "ready"
    }))
  };
}

function playFourWayPreflopAllIn(now: number): RoomState {
  const started = startHand(createReadyRoom([100, 100, 100, 100]), fixedDeck, now);
  const p4 = applyPlayerAction(started, { type: "all-in", playerId: "p4" }, now);
  const p1 = applyPlayerAction(p4, { type: "all-in", playerId: "p1" }, now);
  const p2 = applyPlayerAction(p1, { type: "all-in", playerId: "p2" }, now);
  return applyPlayerAction(p2, { type: "call", playerId: "p3" }, now);
}

function createThreeWayFlopAllIn(): RoomState {
  const started = startHand(createReadyRoom([100, 100, 100]), fixedDeck, 0);
  const deck = [...started.hand!.deck];
  const board: Card[] = [deck.shift()!, deck.shift()!, deck.shift()!];
  const allIn: RoomState = {
    ...started,
    seats: started.seats.map((seat) => ({ ...seat, chips: 0, status: "all-in" })),
    hand: {
      ...started.hand!,
      street: "flop",
      board,
      deck,
      betting: {
        ...started.hand!.betting,
        street: "flop",
        currentBet: 100,
        players: started.hand!.betting.players.map((player) => ({
          ...player,
          stack: 0,
          committed: 100,
          streetCommitted: 100,
          allIn: true
        }))
      }
    }
  };

  return finishHandIfReady(allIn, 0);
}

function advanceThroughPreflopRunout(state: RoomState): RoomState {
  return [2_000, 3_000, 4_000, 6_000, 8_000, 10_000].reduce(
    (current, now) => advanceDuePhase(current, now),
    state
  );
}
