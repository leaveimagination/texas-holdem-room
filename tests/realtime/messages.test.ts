import { describe, expect, it } from "vitest";
import { ClientMessageSchema, type ServerMessage } from "@/lib/realtime/messages";

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

  it("accepts all-in insurance decisions", () => {
    const parsed = ClientMessageSchema.parse({
      type: "insurance_decision",
      roomId: "room1",
      participantToken: "token",
      accepted: true
    });

    expect(parsed.type).toBe("insurance_decision");
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

  it("requires display names when claiming seats", () => {
    const parsed = ClientMessageSchema.parse({
      type: "claim_seat",
      roomId: "room1",
      participantToken: "token",
      displayName: "dealer",
      seatNumber: 9
    });

    expect(parsed.type).toBe("claim_seat");
    if (parsed.type !== "claim_seat") {
      throw new Error("Expected claim_seat message");
    }
    expect(parsed.seatNumber).toBe(9);
  });

  it("rejects seat claims above nine", () => {
    expect(() =>
      ClientMessageSchema.parse({
        type: "claim_seat",
        roomId: "room1",
        participantToken: "token",
        displayName: "dealer",
        seatNumber: 10
      })
    ).toThrow();
  });

  it("rejects unsafe top-up amounts", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "rebuy",
        roomId: "room1",
        participantToken: "token",
        amount: Number.MAX_SAFE_INTEGER + 1
      }).success
    ).toBe(false);
  });

  it("defines the authoritative flow event messages", () => {
    const messages = [
      {
        type: "showdown_started",
        payload: { handNumber: 1, phaseSequence: 2, revealedParticipantIds: ["p1", "p2"], deadline: 2_000 }
      },
      {
        type: "runout_card_revealed",
        payload: { handNumber: 1, phaseSequence: 3, street: "flop", cardIndex: 0, card: "As", deadline: 3_000 }
      },
      {
        type: "top_up_queued",
        payload: { participantId: "p1", displayName: "P1", submittedAmount: 500, pendingTotal: 800, targetHandNumber: 2 }
      },
      {
        type: "top_up_applied",
        payload: { participantId: "p1", displayName: "P1", amount: 800, handNumber: 2 }
      },
      { type: "room_end_requested", payload: { finalHandNumber: 1 } },
      {
        type: "room_finished",
        payload: {
          players: [
            { participantId: "p1", displayName: "P1", initialChips: 1_000, topUpChips: 0, finalChips: 1_100, netChips: 100 }
          ]
        }
      },
      { type: "error", payload: { code: "PRESENTATION_IN_PROGRESS", message: "Hand presentation is in progress" } }
    ] satisfies ServerMessage[];

    expect(messages.map((message) => message.type)).toEqual([
      "showdown_started",
      "runout_card_revealed",
      "top_up_queued",
      "top_up_applied",
      "room_end_requested",
      "room_finished",
      "error"
    ]);
  });
});
