import { z } from "zod";

export const BlindIncreaseSchema = z.object({
  type: z.enum(["minutes", "hands"]),
  interval: z.number().int().min(1).max(120)
});

export const RoomSettingsSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("cash"),
    seats: z.number().int().min(2).max(6),
    initialChips: z.number().int().min(100).max(100000),
    smallBlind: z.number().int().min(1),
    bigBlind: z.number().int().min(2),
    actionTimerSeconds: z.number().int().min(5).max(300).nullable()
  }).strict(),
  z.object({
    mode: z.literal("tournament"),
    seats: z.number().int().min(2).max(6),
    initialChips: z.number().int().min(100).max(100000),
    smallBlind: z.number().int().min(1),
    bigBlind: z.number().int().min(2),
    actionTimerSeconds: z.number().int().min(5).max(300).nullable(),
    blindIncrease: BlindIncreaseSchema
  }).strict()
]);

export type RoomSettings = z.infer<typeof RoomSettingsSchema>;

export function validateRoomSettings(input: unknown): RoomSettings {
  const settings = RoomSettingsSchema.parse(input);
  if (settings.bigBlind < settings.smallBlind * 2) {
    throw new Error("Big blind must be at least twice the small blind");
  }
  return settings;
}
