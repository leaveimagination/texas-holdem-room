import { NextResponse } from "next/server";
import { z } from "zod";
import { RoomRepository } from "@/server/repositories/room-repository";

export const runtime = "nodejs";

const JoinRoomRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(24)
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await context.params;
  const parsed = JoinRoomRequestSchema.safeParse(await readJson(request));

  if (!parsed.success) {
    return NextResponse.json({ error: "Nickname is required" }, { status: 400 });
  }

  try {
    const participant = await new RoomRepository().createParticipant(roomId, parsed.data.displayName);
    return NextResponse.json(participant, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to join room";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
