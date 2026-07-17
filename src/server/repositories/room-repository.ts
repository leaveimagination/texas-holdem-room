import { Prisma } from "@prisma/client";
import { createHash, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import type { RoomState } from "@/lib/poker/engine";
import { serializeCard, type Card } from "@/lib/poker/cards";
import { SessionSummarySchema } from "@/lib/poker/schemas";
import type { PendingTopUp, SessionPlayerResult } from "@/lib/poker/types";
import { prisma } from "@/server/db";

export class RoomRepository {
  async hasRunMarkerParticipant(roomId: string, runId: string): Promise<boolean> {
    const participants = await prisma.roomParticipant.findMany({
      where: { roomId },
      select: { displayName: true }
    });
    const markerPrefix = `SITE-${runId}-`;

    return participants.some((participant) => participant.displayName.startsWith(markerPrefix));
  }

  async deleteExactRoom(roomId: string): Promise<void> {
    if (typeof roomId !== "string" || roomId.length === 0) {
      throw new TypeError("An exact room ID is required");
    }

    await prisma.$transaction(async (tx) => {
      await tx.pot.deleteMany({ where: { hand: { roomId } } });
      await tx.handAction.deleteMany({ where: { hand: { roomId } } });
      await tx.handPlayer.deleteMany({ where: { hand: { roomId } } });
      await tx.hand.deleteMany({ where: { roomId } });
      await tx.buyIn.deleteMany({ where: { roomId } });
      await tx.tournamentResult.deleteMany({ where: { roomId } });
      await tx.roomParticipant.deleteMany({ where: { roomId } });
      await tx.room.delete({ where: { id: roomId } });
    });
  }

  async listPublicHandReviews(roomId: string): Promise<PublicHandReview[]> {
    const hands = await prisma.hand.findMany({
      where: { roomId },
      orderBy: { handNumber: "asc" },
      select: {
        handNumber: true,
        board: true,
        players: {
          select: {
            startingChips: true,
            endingChips: true,
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

  async recordBuyIn(roomId: string, participantId: string, amount: number): Promise<void> {
    await prisma.buyIn.create({
      data: {
        id: this.createId("buyin"),
        roomId,
        participantId,
        amount
      }
    });
  }

  async recordTopUp(roomId: string, pending: PendingTopUp): Promise<void> {
    const id = `buyin_${roomId}_${pending.participantId}_hand_${pending.targetHandNumber}`;
    await prisma.buyIn.upsert({
      where: { id },
      create: {
        id,
        roomId,
        participantId: pending.participantId,
        amount: pending.amount
      },
      update: { amount: pending.amount }
    });
  }

  async finishRoom(roomId: string, endedAt: Date, summary: SessionPlayerResult[]): Promise<void> {
    const validated = SessionSummarySchema.parse(summary);
    await prisma.room.update({
      where: { id: roomId },
      data: {
        endedAt,
        sessionSummary: validated as Prisma.InputJsonValue
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

  async createParticipant(roomId: string, displayName: string): Promise<CreatedParticipant> {
    const participantToken = this.createId("participant");
    const participant = await prisma.roomParticipant.create({
      data: {
        id: this.createId("participant"),
        roomId,
        displayName,
        role: "player",
        tokenHash: hashToken(participantToken)
      },
      select: { id: true }
    });

    return {
      participantId: participant.id,
      participantToken
    };
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface PublicHandReview {
  handNumber: number;
  board: string[];
  winners: PublicHandWinner[];
  players: PublicHandPlayer[];
  potSize: number;
  actions: PublicHandAction[];
}

export interface PublicHandWinner {
  participantId: string;
  displayName: string;
  seatNumber: number | null;
}

export interface PublicHandPlayer {
  participantId: string;
  displayName: string;
  seatNumber: number | null;
  startingChips: number;
  endingChips: number;
  netChips: number;
}

export interface PublicHandAction {
  sequenceNumber: number;
  street: string;
  participantId: string;
  actionType: string;
  amount: number | null;
  resultingStack: number;
}

export interface CreatedParticipant {
  participantId: string;
  participantToken: string;
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
    startingChips: number;
    endingChips: number;
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
  const players = (hand.players ?? []).map((player) => ({
    participantId: player.participant.id,
    displayName: player.participant.displayName,
    seatNumber: player.participant.seatNumber,
    startingChips: player.startingChips,
    endingChips: player.endingChips,
    netChips: player.endingChips - player.startingChips
  }));

  return {
    handNumber: hand.handNumber,
    board: serializeBoard(hand.board),
    winners: [...new Set(winnerIds)].map((participantId) => {
      const participant = participantsById.get(participantId);

      return {
        participantId,
        displayName: participant?.displayName ?? participantId,
        seatNumber: participant?.seatNumber ?? null
      };
    }),
    players,
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
      startingChips: hand.startingChipsByParticipantId[seat.participantId],
      endingChips: seat.chips,
      holeCards: Prisma.NullableJsonNullValueInput.JsonNull
    }];
  });
  const actions = hand.actions.map((action, index): Prisma.HandActionCreateManyInput => {
    const player = bettingByParticipantId.get(action.playerId);

    return {
      id: `${hand.id}-action-${index + 1}`,
      handId: hand.id,
      sequenceNumber: index + 1,
      street: action.street,
      participantId: action.playerId,
      actionType: action.type,
      amount: action.amount ?? null,
      resultingStack: player?.stack ?? room.seats.find((seat) => seat.participantId === action.playerId)?.chips ?? 0
    };
  });
  const pots = (room.flow.handResult?.pots ?? []).map((pot, index): Prisma.PotCreateManyInput => ({
    id: `${hand.id}-pot-${index + 1}`,
    handId: hand.id,
    potType: index === 0 ? "main" : "side",
    amount: pot.amount,
    eligibleParticipantIds: pot.eligibleParticipantIds as unknown as Prisma.InputJsonValue,
    winnerParticipantIds: pot.eligibleParticipantIds.filter(
      (participantId) => (pot.awardsByParticipantId[participantId] ?? 0) > 0
    ) as unknown as Prisma.InputJsonValue
  }));

  return { players, actions, pots };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function serializeBoard(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((card) => {
    if (typeof card === "string") {
      return [card];
    }

    if (isCard(card)) {
      return [serializeCard(card)];
    }

    return [];
  });
}

function isCard(value: unknown): value is Card {
  return (
    typeof value === "object" &&
    value !== null &&
    "rank" in value &&
    "suit" in value &&
    typeof value.rank === "string" &&
    typeof value.suit === "string"
  );
}

function compareToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
