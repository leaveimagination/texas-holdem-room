import { describe, expect, it } from "vitest";
import { parseCard } from "@/lib/poker/cards";
import { applyPlayerAction, createInitialRoomState, startHand, type RoomState } from "@/lib/poker/engine";
import { RoomFlowController } from "@/server/room-flow-controller";

const fixedDeck = "As Ah Kd Kh Qs Qh Jd Jh Tc Td 9s 9h 8d 8h 7s 7h 6d 6h 5s 5h 4d 4h 3s 3h 2d 2h Ac Ad Kc Ks Qc Qd Jc Js Ts Th 9c 9d 8c 8s 7c 7d 6c 6s 5c 5d 4c 4s 3c 3d 2c 2s"
  .split(" ")
  .map(parseCard);

describe("RoomFlowController", () => {
  it("builds timer tokens and rejects stale sequence or hand identities", () => {
    const locked = createHeadsUpAllIn();
    const controller = new RoomFlowController(() => 2_000);
    const token = controller.timerToken(locked);

    expect(token).toEqual({
      roomId: "room-controller",
      handId: "room-controller-1",
      sequence: 1,
      deadlineAt: 2_000
    });
    expect(controller.matchesToken(locked, token!)).toBe(true);
    expect(controller.matchesToken({
      ...locked,
      flow: { ...locked.flow, sequence: locked.flow.sequence + 1 }
    }, token!)).toBe(false);
    expect(controller.matchesToken({
      ...locked,
      hand: { ...locked.hand!, id: "another-hand" }
    }, token!)).toBe(false);
  });

  it("catches up overdue runout phases but stops at the hand persistence boundary", () => {
    const locked = createHeadsUpAllIn();
    const controller = new RoomFlowController(() => 12_000);

    expect(controller.catchUpDuePhases(locked, 1_999)).toBe(locked);

    const settled = controller.catchUpDuePhases(locked);
    expect(settled.hand?.board).toHaveLength(5);
    expect(settled.hand?.finished).toBe(true);
    expect(settled.flow).toMatchObject({
      phase: "hand-summary",
      deadlineAt: 12_000,
      sequence: 7
    });
    expect(controller.isHandBoundaryDue(settled, 11_999)).toBe(false);
    expect(controller.isHandBoundaryDue(settled, 12_000)).toBe(true);

    expect(controller.catchUpDuePhases(settled, 12_000)).toBe(settled);
  });

  it("delegates the due hand boundary transition without advancing it early", () => {
    const controller = new RoomFlowController(() => 12_000);
    const settled = controller.catchUpDuePhases(createHeadsUpAllIn());

    expect(controller.completeHandBoundary(settled, 11_999)).toBe(settled);

    const nextHand = controller.completeHandBoundary(settled, 12_000, fixedDeck);
    expect(nextHand.handCounter).toBe(2);
    expect(nextHand.hand?.finished).toBe(false);
    expect(nextHand.flow).toMatchObject({ phase: "betting", deadlineAt: null });
  });
});

function createHeadsUpAllIn(): RoomState {
  const room = createInitialRoomState(
    { mode: "cash", seats: 2, initialChips: 100, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    "room-controller"
  );
  const ready: RoomState = {
    ...room,
    seats: room.seats.map((seat, index) => ({
      ...seat,
      participantId: `p${index + 1}`,
      displayName: `P${index + 1}`,
      chips: 100,
      cumulativeBuyIn: 100,
      status: "ready"
    }))
  };
  const started = startHand(ready, fixedDeck, 0);
  const shoved = applyPlayerAction(started, { type: "all-in", playerId: started.hand!.actorId }, 0);
  return applyPlayerAction(shoved, { type: "call", playerId: shoved.hand!.actorId }, 0);
}
