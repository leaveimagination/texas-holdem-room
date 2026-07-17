import { Prisma, RoomMode } from "@prisma/client";
import { NextResponse } from "next/server";
import { createInitialRoomState } from "@/lib/poker/engine";
import { validateRoomSettings } from "@/lib/room/settings";
import { prisma } from "@/server/db";
import { LiveRoomStore } from "@/server/live-room-store";
import { createRedisClient } from "@/server/redis";
import { createRedisKeyValueStore } from "@/server/redis-key-value-store";
import { RoomRepository } from "@/server/repositories/room-repository";
import { publicBaseUrl } from "@/server/room-links";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let settings: ReturnType<typeof validateRoomSettings>;

  try {
    settings = validateRoomSettings(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid room settings";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const repository = new RoomRepository();
  const roomId = repository.createId("room");
  const hostToken = repository.createId("host");
  const room = createInitialRoomState(settings, roomId);
  const redis = createRedisClient();
  redis.on("error", () => undefined);
  let durableRoomCreated = false;

  try {
    await prisma.room.create({
      data: {
        id: roomId,
        hostTokenHash: repository.hashToken(hostToken),
        inviteCode: roomId,
        mode: settings.mode === "cash" ? RoomMode.CASH : RoomMode.TOURNAMENT,
        settings: settings as Prisma.InputJsonValue
      }
    });
    durableRoomCreated = true;

    await new LiveRoomStore(createRedisKeyValueStore(redis)).saveRoom(room);
  } catch (error) {
    if (durableRoomCreated) {
      await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    }

    const message = error instanceof Error ? error.message : "Unable to create room";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    redis.disconnect();
  }

  const baseUrl = publicBaseUrl(request);
  const inviteUrl = `${baseUrl}/room/${roomId}`;
  const hostUrl = `${inviteUrl}?host=${encodeURIComponent(hostToken)}`;

  return NextResponse.json({ roomId, inviteUrl, hostUrl }, { status: 201 });
}
