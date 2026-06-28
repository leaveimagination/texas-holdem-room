import { Prisma } from "@prisma/client";
import { createHash, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import type { RoomState } from "@/lib/poker/engine";
import { prisma } from "@/server/db";

export class RoomRepository {
  async recordHand(room: RoomState): Promise<void> {
    if (!room.hand || !room.hand.finished) {
      return;
    }

    await prisma.hand.upsert({
      where: {
        roomId_handNumber: {
          roomId: room.roomId,
          handNumber: room.hand.number
        }
      },
      create: {
        id: room.hand.id,
        roomId: room.roomId,
        handNumber: room.hand.number,
        buttonSeat: room.buttonSeat ?? 1,
        smallBlind: room.settings.smallBlind,
        bigBlind: room.settings.bigBlind,
        board: room.hand.board as unknown as Prisma.InputJsonValue,
        endedAt: new Date()
      },
      update: {
        board: room.hand.board as unknown as Prisma.InputJsonValue,
        endedAt: new Date()
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

function compareToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
