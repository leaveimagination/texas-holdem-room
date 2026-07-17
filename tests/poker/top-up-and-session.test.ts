import { describe, expect, it } from "vitest";
import { parseCard } from "@/lib/poker/cards";
import {
  applyPendingTopUps,
  applyPlayerAction,
  completeHandBoundary,
  createInitialRoomState,
  finalizeSession,
  getApplicableTopUps,
  queueTopUp,
  requestRoomEnd,
  startHand,
  type RoomState
} from "@/lib/poker/engine";

const fixedDeck = "As Ah Kd Kh Qs Qh Jd Jh Tc Td 9s 9h 8d 8h 7s 7h 6d 6h 5s 5h 4d 4h 3s 3h 2d 2h Ac Ad Kc Ks Qc Qd Jc Js Ts Th 9c 9d 8c 8s 7c 7d 6c 6s 5c 5d 4c 4s 3c 3d 2c 2s"
  .split(" ")
  .map(parseCard);

describe("queued top-ups and session finalization", () => {
  it("accumulates safe top-ups for the next hand without changing the active stack", () => {
    const active = startHand(createReadyCashRoom(), fixedDeck, 0);
    const stackBefore = active.seats.find((seat) => seat.participantId === "p1")!.chips;

    const first = queueTopUp(active, "p1", 500);
    const second = queueTopUp(first, "p1", 300);

    expect(second.seats.find((seat) => seat.participantId === "p1")?.chips).toBe(stackBefore);
    expect(second.seats.find((seat) => seat.participantId === "p1")?.cumulativeBuyIn).toBe(1_000);
    expect(second.pendingTopUps.p1).toEqual({
      participantId: "p1",
      targetHandNumber: 2,
      amount: 800,
      requestCount: 2
    });
  });

  it("rejects tournament, unseated, finished, and overflowing top-ups", () => {
    const tournament = createReadyTournamentRoom();
    const active = startHand(createReadyCashRoom(), fixedDeck, 0);
    const nearLimit = queueTopUp(active, "p1", Number.MAX_SAFE_INTEGER);

    expect(() => queueTopUp(tournament, "p1", 500)).toThrow("TOP_UP_NOT_ALLOWED");
    expect(() => queueTopUp(active, "missing", 500)).toThrow("TOP_UP_NOT_ALLOWED");
    expect(() => queueTopUp({ ...active, status: "finished" }, "p1", 500)).toThrow("ROOM_FINISHED");
    expect(() => queueTopUp(nearLimit, "p1", 1)).toThrow("TOP_UP_AMOUNT_INVALID");
    expect(() => queueTopUp(active, "p1", 1.5)).toThrow("TOP_UP_AMOUNT_INVALID");
  });

  it("applies all target-hand top-ups atomically before the next hand", () => {
    const active = queueTopUp(queueTopUp(startHand(createReadyCashRoom(), fixedDeck, 0), "p1", 500), "p1", 300);
    const summary = applyPlayerAction(active, { type: "fold", playerId: active.hand!.actorId }, 0);
    const stackAfterHand = summary.seats.find((seat) => seat.participantId === "p1")!.chips;

    expect(getApplicableTopUps(summary)).toEqual([
      { participantId: "p1", targetHandNumber: 2, amount: 800, requestCount: 2 }
    ]);

    const applied = applyPendingTopUps(summary);
    expect(applied.seats.find((seat) => seat.participantId === "p1")).toMatchObject({
      chips: stackAfterHand + 800,
      cumulativeBuyIn: 1_800
    });
    expect(applied.pendingTopUps).toEqual({});

    const nextHand = completeHandBoundary(summary, 2_000, fixedDeck);
    expect(nextHand.hand).toMatchObject({ number: 2, finished: false });
    expect(nextHand.flow).toMatchObject({ phase: "betting", deadlineAt: null, handResult: null });
    expect(nextHand.seats.find((seat) => seat.participantId === "p1")?.cumulativeBuyIn).toBe(1_800);
    expect(nextHand.pendingTopUps).toEqual({});
  });

  it("clears the transient result but keeps requests pending until two players can start", () => {
    const summary = createOneEligiblePlayerSummary();
    const queuedForWinner = queueTopUp(summary, "p1", 400);

    expect(getApplicableTopUps(queuedForWinner)).toEqual([]);
    const waiting = completeHandBoundary(queuedForWinner, 2_000, fixedDeck);

    expect(waiting.flow).toEqual({
      phase: "betting",
      sequence: queuedForWinner.flow.sequence + 1,
      deadlineAt: null,
      nextRunoutStep: null,
      handResult: null
    });
    expect(waiting.hand?.finished).toBe(true);
    expect(waiting.pendingTopUps.p1?.amount).toBe(400);

    const revived = queueTopUp(waiting, "p2", 600);
    const nextHand = completeHandBoundary(revived, 2_100, fixedDeck);
    expect(nextHand.hand).toMatchObject({ number: 2, finished: false });
    expect(nextHand.pendingTopUps).toEqual({});
    expect(nextHand.seats.find((seat) => seat.participantId === "p1")?.cumulativeBuyIn).toBe(1_400);
    expect(nextHand.seats.find((seat) => seat.participantId === "p2")?.cumulativeBuyIn).toBe(1_600);
  });

  it("marks an active hand as final idempotently and computes durable session totals", () => {
    const active = startHand(createReadyCashRoom(), fixedDeck, 0);
    const requested = requestRoomEnd(active);

    expect(requested.endAfterCurrentHand).toBe(true);
    expect(requestRoomEnd(requested)).toBe(requested);

    const finalState: RoomState = {
      ...requested,
      seats: requested.seats.map((seat) =>
        seat.participantId === "p1"
          ? { ...seat, chips: 2_100, cumulativeBuyIn: 1_800 }
          : { ...seat, chips: 700, cumulativeBuyIn: 1_000 }
      ),
      pendingTopUps: {
        p1: { participantId: "p1", targetHandNumber: 2, amount: 200, requestCount: 1 }
      }
    };
    const finished = finalizeSession(finalState, 10_000);

    expect(finished.status).toBe("finished");
    expect(finished.sessionEndedAt).toBe(10_000);
    expect(finished.flow).toMatchObject({ phase: "session-summary", deadlineAt: null, handResult: null });
    expect(finished.pendingTopUps).toEqual({});
    expect(finished.sessionSummary).toEqual([
      { participantId: "p1", displayName: "P1", initialChips: 1_000, topUpChips: 800, finalChips: 2_100, netChips: 300 },
      { participantId: "p2", displayName: "P2", initialChips: 1_000, topUpChips: 0, finalChips: 700, netChips: -300 }
    ]);
  });
});

function createReadyCashRoom(): RoomState {
  return seatPlayers(createInitialRoomState(
    { mode: "cash", seats: 2, initialChips: 1_000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    "room-top-up"
  ));
}

function createReadyTournamentRoom(): RoomState {
  return seatPlayers(createInitialRoomState(
    {
      mode: "tournament",
      seats: 2,
      initialChips: 1_000,
      smallBlind: 10,
      bigBlind: 20,
      actionTimerSeconds: null,
      blindIncrease: { type: "hands", interval: 5 }
    },
    "room-tournament"
  ));
}

function seatPlayers(room: RoomState): RoomState {
  return {
    ...room,
    seats: room.seats.map((seat, index) => ({
      ...seat,
      participantId: `p${index + 1}`,
      displayName: `P${index + 1}`,
      chips: 1_000,
      cumulativeBuyIn: 1_000,
      status: "ready"
    }))
  };
}

function createOneEligiblePlayerSummary(): RoomState {
  const active = startHand(createReadyCashRoom(), fixedDeck, 0);
  const summary = applyPlayerAction(active, { type: "fold", playerId: "p1" }, 0);
  return {
    ...summary,
    seats: summary.seats.map((seat) =>
      seat.participantId === "p1"
        ? { ...seat, chips: 2_000, status: "active" }
        : { ...seat, chips: 0, status: "all-in" }
    )
  };
}
