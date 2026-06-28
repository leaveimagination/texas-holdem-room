import { Prisma } from "@prisma/client";
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
}
