import { describe, expect, it } from "vitest";
import { ClientMessageSchema } from "@/lib/realtime/messages";

describe("realtime messages", () => {
  it("accepts player actions", () => {
    const parsed = ClientMessageSchema.parse({
      type: "player_action",
      roomId: "room1",
      participantToken: "token",
      action: { type: "fold", playerId: "p1" }
    });

    expect(parsed.type).toBe("player_action");
  });

  it("rejects unknown message types", () => {
    expect(() => ClientMessageSchema.parse({ type: "peek_cards" })).toThrow();
  });
});
