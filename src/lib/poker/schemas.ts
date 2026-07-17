import { z } from "zod";

export const SessionPlayerResultSchema = z.object({
  participantId: z.string(),
  displayName: z.string(),
  initialChips: z.number().int().nonnegative().safe(),
  topUpChips: z.number().int().nonnegative().safe(),
  finalChips: z.number().int().nonnegative().safe(),
  netChips: z.number().int().safe()
}).strict();

export const SessionSummarySchema = z.array(SessionPlayerResultSchema);
