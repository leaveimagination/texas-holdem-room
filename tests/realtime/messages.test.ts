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

  it("rejects extra fields on quick_phrase", () => {
    expect(() =>
      ClientMessageSchema.parse({
        type: "quick_phrase",
        roomId: "room1",
        participantToken: "token",
        phrase: "nice_hand",
        chatter: "hello"
      })
    ).toThrow();
  });

  it("rejects extra fields on join_room", () => {
    expect(() =>
      ClientMessageSchema.parse({
        type: "join_room",
        roomId: "room1",
        participantToken: null,
        displayName: "dealer",
        note: "welcome"
      })
    ).toThrow();
  });

  it("rejects extra fields inside player_action.action", () => {
    expect(() =>
      ClientMessageSchema.parse({
        type: "player_action",
        roomId: "room1",
        participantToken: "token",
        action: {
          type: "fold",
          playerId: "p1",
          unsupported: "oops"
        }
      })
    ).toThrow();
  });
});
