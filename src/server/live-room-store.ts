import { z } from "zod";
import type { RoomState } from "@/lib/poker/engine";
import { RoomSettingsSchema, validateRoomSettings } from "@/lib/room/settings";
import { RANKS, SUITS } from "@/lib/poker/cards";

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

const SeatStatusSchema = z.enum(["empty", "seated", "ready", "active", "folded", "all-in", "eliminated", "disconnected"]);
const BettingPlayerSchema = z.object({
  id: z.string(),
  stack: z.number(),
  committed: z.number(),
  streetCommitted: z.number(),
  folded: z.boolean(),
  allIn: z.boolean()
});
const BettingStateSchema = z.object({
  street: z.enum(["preflop", "flop", "turn", "river"]),
  currentBet: z.number(),
  minRaise: z.number(),
  actorId: z.string(),
  players: z.array(BettingPlayerSchema)
});
const CardSchema = z.object({
  rank: z.enum(RANKS),
  suit: z.enum(SUITS)
});
const SeatSchema = z
  .object({
    seatNumber: z.number().int().positive(),
    participantId: z.string().nullable(),
    displayName: z.string().nullable(),
    chips: z.number().int(),
    status: SeatStatusSchema,
    cumulativeBuyIn: z.number().int(),
    holeCards: z.array(CardSchema).optional()
  })
  .strict();
const HandActionRecordSchema = z.object({
  playerId: z.string(),
  type: z.enum(["fold", "check", "call", "bet", "raise", "all-in"]),
  street: z.enum(["preflop", "flop", "turn", "river"]),
  amount: z.number().optional()
});
const InsuranceOfferSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "accepted", "declined"]),
  offeredTo: z.string(),
  potAmount: z.number().int().positive(),
  equityPct: z.number(),
  coverage: z.number().int().positive(),
  premium: z.number().int().positive(),
  paidOut: z.boolean().optional()
});
const HandStateSchema = z
  .object({
    id: z.string(),
    number: z.number().int().nonnegative(),
    street: z.enum(["preflop", "flop", "turn", "river"]),
    board: z.array(CardSchema),
    deck: z.array(CardSchema),
    actorId: z.string(),
    betting: BettingStateSchema,
    holeCardsByParticipantId: z.record(z.string(), z.array(CardSchema)),
    actions: z.array(HandActionRecordSchema),
    insuranceOffer: InsuranceOfferSchema.optional(),
    finished: z.boolean(),
    winners: z.array(z.string())
  })
  .strict();
const RoomStateSchema = z
  .object({
    roomId: z.string(),
    mode: z.enum(["cash", "tournament"]),
    settings: RoomSettingsSchema,
    status: z.enum(["lobby", "playing", "paused", "finished"]),
    handCounter: z.number().int().nonnegative(),
    buttonSeat: z.number().int().positive().nullable(),
    seats: z.array(SeatSchema),
    hand: HandStateSchema.nullable()
  })
  .strict();

export class LiveRoomStore {
  constructor(private readonly store: KeyValueStore) {}

  async getRoom(roomId: string): Promise<RoomState | null> {
    const raw = await this.store.get(this.key(roomId));
    if (!raw) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    const result = RoomStateSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }

    try {
      validateRoomSettings(result.data.settings);
    } catch {
      return null;
    }

    return result.data;
  }

  async saveRoom(room: RoomState, ttlSeconds = 86400): Promise<void> {
    await this.store.set(this.key(room.roomId), JSON.stringify(room), "EX", ttlSeconds);
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.store.del(this.key(roomId));
  }

  private key(roomId: string): string {
    return `room:${roomId}`;
  }
}
