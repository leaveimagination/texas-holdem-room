import { describe, expect, it } from "vitest";
import { parseCard } from "@/lib/poker/cards";
import {
  createInitialRoomState,
  finalizeSession,
  kickParticipant,
  queueTopUp,
  startHand,
  type RoomState
} from "@/lib/poker/engine";

const fixedDeck = "As Ah Kd Kh Qs Qh Jd Jh Tc Td 9s 9h 8d 8h 7s 7h 6d 6h 5s 5h 4d 4h 3s 3h 2d 2h Ac Ad Kc Ks Qc Qd Jc Js Ts Th 9c 9d 8c 8s 7c 7d 6c 6s 5c 5d 4c 4s 3c 3d 2c 2s"
  .split(" ")
  .map(parseCard);

describe("host kick transition", () => {
  it("vacates a lobby seat, cancels its top-up, and retains session accounting", () => {
    const queued = queueTopUp(readyRoom(), "p1", 500);

    const kicked = kickParticipant(queued, "p1", 100);

    expect(kicked.seats[0]).toEqual({
      seatNumber: 1,
      participantId: null,
      displayName: null,
      chips: 0,
      cumulativeBuyIn: 0,
      status: "empty"
    });
    expect(kicked.pendingTopUps.p1).toBeUndefined();
    expect(kicked.removedParticipants.p1).toEqual({
      participantId: "p1",
      displayName: "P1",
      initialChips: 1_000,
      cumulativeBuyIn: 1_000,
      finalChips: 1_000
    });

    expect(finalizeSession(kicked, 200).sessionSummary).toEqual(expect.arrayContaining([
      { participantId: "p1", displayName: "P1", initialChips: 1_000, topUpChips: 0, finalChips: 1_000, netChips: 0 }
    ]));
  });

  it("forces the acting player to fold without refunding committed chips", () => {
    const active = startHand(readyRoom(), fixedDeck, 0);
    const targetId = active.hand!.actorId;
    const before = active.hand!.betting.players.find((player) => player.id === targetId)!;

    const kicked = kickParticipant(active, targetId, 100);
    const after = kicked.hand!.betting.players.find((player) => player.id === targetId)!;

    expect(after.folded).toBe(true);
    expect(after.committed).toBe(before.committed);
    expect(kicked.hand?.finished).toBe(true);
    expect(kicked.seats.some((seat) => seat.participantId === targetId)).toBe(false);
  });

  it("rejects an unknown or already removed participant", () => {
    const room = readyRoom();
    expect(() => kickParticipant(room, "missing", 100)).toThrow("PARTICIPANT_NOT_FOUND");
    const kicked = kickParticipant(room, "p1", 100);
    expect(() => kickParticipant(kicked, "p1", 101)).toThrow("PARTICIPANT_NOT_FOUND");
  });

  it("folds a non-acting and all-in target while preserving the current actor and commitment", () => {
    const active = startHand(readyRoom(3), fixedDeck, 0);
    const actorId = active.hand!.actorId;
    const target = active.hand!.betting.players.find((player) => player.id !== actorId)!;
    const allIn: RoomState = {
      ...active,
      hand: {
        ...active.hand!,
        betting: {
          ...active.hand!.betting,
          players: active.hand!.betting.players.map((player) =>
            player.id === target.id ? { ...player, stack: 0, committed: 1_000, allIn: true } : player
          )
        }
      },
      seats: active.seats.map((seat) => seat.participantId === target.id ? { ...seat, chips: 0, status: "all-in" } : seat)
    };

    const kicked = kickParticipant(allIn, target.id, 100);

    expect(kicked.hand?.betting.players.find((player) => player.id === target.id)).toMatchObject({
      folded: true,
      allIn: true,
      committed: 1_000
    });
    expect(kicked.hand?.actorId).toBe(actorId);
  });

  it("declines a target's pending insurance before forcing the fold", () => {
    const active = startHand(readyRoom(), fixedDeck, 0);
    const targetId = active.hand!.actorId;
    const insurance: RoomState = {
      ...active,
      flow: { ...active.flow, phase: "insurance-pending" },
      hand: {
        ...active.hand!,
        insuranceOffer: {
          id: "insurance-1",
          status: "pending",
          offeredTo: targetId,
          potAmount: 100,
          equityPct: 60,
          coverage: 80,
          premium: 20
        }
      }
    };

    const kicked = kickParticipant(insurance, targetId, 100);

    expect(kicked.hand?.insuranceOffer?.status).toBe("declined");
    expect(kicked.hand?.betting.players.find((player) => player.id === targetId)?.folded).toBe(true);
  });

  it("does not rewrite an outcome after presentation has begun", () => {
    const active = startHand(readyRoom(), fixedDeck, 0);
    const targetId = active.hand!.actorId;
    const presenting: RoomState = {
      ...active,
      flow: { phase: "showdown-reveal", sequence: 1, deadlineAt: 2_000, nextRunoutStep: { street: "flop", cardIndexOnStreet: 0 }, handResult: null }
    };
    const before = presenting.hand!.betting.players.find((player) => player.id === targetId)!;

    const kicked = kickParticipant(presenting, targetId, 100);

    expect(kicked.flow).toEqual(presenting.flow);
    expect(kicked.hand?.betting.players.find((player) => player.id === targetId)).toEqual(before);
    expect(kicked.seats.some((seat) => seat.participantId === targetId)).toBe(false);
  });
});

function readyRoom(seats = 2): RoomState {
  const room = createInitialRoomState(
    { mode: "cash", seats, initialChips: 1_000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    "kick-room"
  );
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
