import { z } from "zod";

const BettingActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fold"), playerId: z.string() }).strict(),
  z.object({ type: z.literal("check"), playerId: z.string() }).strict(),
  z.object({ type: z.literal("call"), playerId: z.string() }).strict(),
  z.object({ type: z.literal("bet"), playerId: z.string(), amountTo: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("raise"), playerId: z.string(), amountTo: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("all-in"), playerId: z.string() }).strict()
]);

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join_room"), roomId: z.string(), participantToken: z.string().nullable(), displayName: z.string().min(1).max(24) }).strict(),
  z
    .object({
      type: z.literal("claim_seat"),
      roomId: z.string(),
      participantToken: z.string(),
      displayName: z.string().min(1).max(24),
      seatNumber: z.number().int().min(1).max(9)
    })
    .strict(),
  z.object({ type: z.literal("leave_seat"), roomId: z.string(), participantToken: z.string() }).strict(),
  z.object({ type: z.literal("set_ready"), roomId: z.string(), participantToken: z.string() }).strict(),
  z.object({ type: z.literal("start_room"), roomId: z.string(), hostToken: z.string() }).strict(),
  z.object({ type: z.literal("pause_room"), roomId: z.string(), hostToken: z.string() }).strict(),
  z.object({ type: z.literal("resume_room"), roomId: z.string(), hostToken: z.string() }).strict(),
  z.object({ type: z.literal("end_room"), roomId: z.string(), hostToken: z.string() }).strict(),
  z.object({ type: z.literal("player_action"), roomId: z.string(), participantToken: z.string(), action: BettingActionSchema }).strict(),
  z.object({ type: z.literal("rebuy"), roomId: z.string(), participantToken: z.string(), amount: z.number().int().positive() }).strict(),
  z.object({
    type: z.literal("quick_phrase"),
    roomId: z.string(),
    participantToken: z.string(),
    phrase: z.enum(["think", "nice_hand", "well_played", "another_hand", "wait_for_me", "back_now"])
  }).strict(),
  z.object({
    type: z.literal("handle_disconnect"),
    roomId: z.string(),
    hostToken: z.string(),
    participantId: z.string(),
    handling: z.enum(["wait", "fold", "remove", "pause"])
  }).strict()
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: "room_snapshot"; payload: unknown }
  | { type: "table_update"; payload: unknown }
  | { type: "private_cards"; payload: unknown }
  | { type: "legal_actions"; payload: unknown }
  | { type: "hand_started"; payload: unknown }
  | { type: "street_changed"; payload: unknown }
  | { type: "action_recorded"; payload: unknown }
  | { type: "hand_finished"; payload: unknown }
  | { type: "blind_level_changed"; payload: unknown }
  | { type: "player_disconnected"; payload: unknown }
  | { type: "player_reconnected"; payload: unknown }
  | { type: "player_eliminated"; payload: unknown }
  | { type: "room_finished"; payload: unknown }
  | { type: "system_message"; payload: { message: string } }
  | { type: "error"; payload: { message: string } };
