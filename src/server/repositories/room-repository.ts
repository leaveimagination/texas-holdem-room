import { Prisma } from "@prisma/client";
import { createHash, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import type { RoomState } from "@/lib/poker/engine";
import { buildPots } from "@/lib/poker/betting";
import { prisma } from "@/server/db";

export class RoomRepository {
  async listPublicHandReviews(roomId: string): Promise<PublicHandReview[]> {
    const hands = await prisma.hand.findMany({
      where: { roomId },
      orderBy: { handNumber: "asc" },
      select: {
        handNumber: true,
        board: true,
        players: {
          select: {
            participant: {
              select: {
                id: true,
                displayName: true,
                seatNumber: true
              }
            }
          }
        },
        pots: {
          select: {
            amount: true,
            winnerParticipantIds: true
          }
        },
        actions: {
          orderBy: { sequenceNumber: "asc" },
          select: {
            sequenceNumber: true,
            street: true,
            participantId: true,
            actionType: true,
            amount: true,
            resultingStack: true
          }
        }
      }
    });

    return hands.map(mapHandToPublicReview);
  }

  async recordHand(room: RoomState): Promise<void> {
    if (!room.hand || !room.hand.finished) {
      return;
    }

    const hand = room.hand;
    const details = createHandPersistenceDetails(room);
    await prisma.$transaction(async (tx) => {
      await tx.hand.upsert({
      where: {
        roomId_handNumber: {
          roomId: room.roomId,
          handNumber: hand.number
        }
      },
      create: {
        id: hand.id,
        roomId: room.roomId,
        handNumber: hand.number,
        buttonSeat: room.buttonSeat ?? 1,
        smallBlind: room.settings.smallBlind,
        bigBlind: room.settings.bigBlind,
        board: hand.board as unknown as Prisma.InputJsonValue,
        endedAt: new Date()
      },
      update: {
        board: hand.board as unknown as Prisma.InputJsonValue,
        endedAt: new Date()
      }
      });

      await tx.handAction.deleteMany({ where: { handId: hand.id } });
      await tx.handPlayer.deleteMany({ where: { handId: hand.id } });
      await tx.pot.deleteMany({ where: { handId: hand.id } });

      if (details.players.length > 0) {
        await tx.handPlayer.createMany({ data: details.players });
      }

      if (details.actions.length > 0) {
        await tx.handAction.createMany({ data: details.actions });
      }

      if (details.pots.length > 0) {
        await tx.pot.createMany({ data: details.pots });
      }
    });
  }

  createId(prefix: string): string {
    return `${prefix}_${nanoid(12)}`;
  }

  hashToken(token: string): string {
    return hashToken(token);
  }

  async verifyHostToken(roomId: string, token: string): Promise<boolean> {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { hostTokenHash: true }
    });

    return room ? compareToken(token, room.hostTokenHash) : false;
  }

  async verifyParticipantToken(roomId: string, token: string): Promise<string | null> {
    const participant = await prisma.roomParticipant.findFirst({
      where: {
        roomId,
        tokenHash: hashToken(token)
      },
      select: { id: true }
    });

    return participant?.id ?? null;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface PublicHandReview {
  handNumber: number;
  board: unknown;
  winners: PublicHandWinner[];
  potSize: number;
  actions: PublicHandAction[];
}

export interface PublicHandWinner {
  participantId: string;
  displayName: string;
  seatNumber: number | null;
}

export interface PublicHandAction {
  sequenceNumber: number;
  street: string;
  participantId: string;
  actionType: string;
  amount: number | null;
  resultingStack: number;
}

export interface HandPersistenceDetails {
  players: Prisma.HandPlayerCreateManyInput[];
  actions: Prisma.HandActionCreateManyInput[];
  pots: Prisma.PotCreateManyInput[];
}

interface HandReviewRow {
  handNumber: number;
  board: unknown;
  players?: Array<{
    participant: {
      id: string;
      displayName: string;
      seatNumber: number | null;
    };
    holeCards?: unknown;
  }>;
  pots: Array<{
    amount: number;
    winnerParticipantIds: unknown;
  }>;
  actions: PublicHandAction[];
}

export function mapHandToPublicReview(hand: HandReviewRow): PublicHandReview {
  const participantsById = new Map(
    (hand.players ?? []).map((player) => [player.participant.id, player.participant])
  );
  const winnerIds = hand.pots.flatMap((pot) => toStringArray(pot.winnerParticipantIds));

  return {
    handNumber: hand.handNumber,
    board: hand.board,
    winners: [...new Set(winnerIds)].map((participantId) => {
      const participant = participantsById.get(participantId);

      return {
        participantId,
        displayName: participant?.displayName ?? participantId,
        seatNumber: participant?.seatNumber ?? null
      };
    }),
    potSize: hand.pots.reduce((sum, pot) => sum + pot.amount, 0),
    actions: hand.actions.map((action) => ({
      sequenceNumber: action.sequenceNumber,
      street: action.street,
      participantId: action.participantId,
      actionType: action.actionType,
      amount: action.amount,
      resultingStack: action.resultingStack
    }))
  };
}

export function createHandPersistenceDetails(room: RoomState): HandPersistenceDetails {
  if (!room.hand?.finished) {
    return { players: [], actions: [], pots: [] };
  }

  const hand = room.hand;
  const bettingByParticipantId = new Map(hand.betting.players.map((player) => [player.id, player]));
  const players = room.seats.flatMap((seat): Prisma.HandPlayerCreateManyInput[] => {
    if (!seat.participantId || !bettingByParticipantId.has(seat.participantId)) {
      return [];
    }

    const betting = bettingByParticipantId.get(seat.participantId)!;
    return [{
      id: `${hand.id}-${seat.participantId}`,
      handId: hand.id,
      participantId: seat.participantId,
      seatNumber: seat.seatNumber,
      startingChips: betting.stack + betting.committed,
      endingChips: seat.chips,
      holeCards: hand.holeCardsByParticipantId[seat.participantId] as unknown as Prisma.InputJsonValue
    }];
  });
  const actions = hand.actions.map((action, index): Prisma.HandActionCreateManyInput => {
    const player = bettingByParticipantId.get(action.playerId);

    return {
      id: `${hand.id}-action-${index + 1}`,
      handId: hand.id,
      sequenceNumber: index + 1,
      street: hand.street,
      participantId: action.playerId,
      actionType: action.type,
      amount: action.amount ?? null,
      resultingStack: player?.stack ?? room.seats.find((seat) => seat.participantId === action.playerId)?.chips ?? 0
    };
  });
  const builtPots = buildPots(hand.betting.players);
  const winnerParticipantIds = hand.winners;
  const pots = builtPots.map((pot, index): Prisma.PotCreateManyInput => ({
    id: `${hand.id}-pot-${index + 1}`,
    handId: hand.id,
    potType: index === 0 ? "main" : "side",
    amount: pot.amount,
    eligibleParticipantIds: pot.eligiblePlayerIds as unknown as Prisma.InputJsonValue,
    winnerParticipantIds: winnerParticipantIds.filter((winnerId) => pot.eligiblePlayerIds.includes(winnerId)) as unknown as Prisma.InputJsonValue
  }));

  return { players, actions, pots };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function compareToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
