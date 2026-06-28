import { NextResponse } from "next/server";
import { RoomRepository } from "@/server/repositories/room-repository";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const hands = await new RoomRepository().listPublicHandReviews(roomId);

  return NextResponse.json(hands);
}
