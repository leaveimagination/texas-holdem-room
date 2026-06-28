import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/rooms/[roomId]/hands/route";
import { mapHandToPublicReview, RoomRepository } from "@/server/repositories/room-repository";

describe("hand history review shape", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps durable hand rows to public review fields without hole cards", () => {
    const publicHand = mapHandToPublicReview({
      handNumber: 3,
      board: ["As", "Kd", "Qc", "2h", "9s"],
      players: [
        {
          holeCards: ["Ah", "Ad"],
          participant: { id: "p1", displayName: "Ada", seatNumber: 1 }
        }
      ],
      pots: [
        {
          amount: 150,
          winnerParticipantIds: ["p1"]
        }
      ],
      actions: [
        {
          sequenceNumber: 1,
          street: "preflop",
          participantId: "p1",
          actionType: "raise",
          amount: 40,
          resultingStack: 960
        }
      ]
    });

    expect(Object.keys(publicHand)).toEqual(["handNumber", "board", "winners", "potSize", "actions"]);
    expect(publicHand).toEqual({
      handNumber: 3,
      board: ["As", "Kd", "Qc", "2h", "9s"],
      winners: [{ participantId: "p1", displayName: "Ada", seatNumber: 1 }],
      potSize: 150,
      actions: [
        {
          sequenceNumber: 1,
          street: "preflop",
          participantId: "p1",
          actionType: "raise",
          amount: 40,
          resultingStack: 960
        }
      ]
    });
    expect(JSON.stringify(publicHand)).not.toContain("holeCards");
    expect(JSON.stringify(publicHand)).not.toContain("Ah");
  });

  it("returns public hand reviews from the hands API", async () => {
    const publicHands = [
      {
        handNumber: 1,
        board: ["As", "Kd", "Qc"],
        winners: [{ participantId: "p1", displayName: "Ada", seatNumber: 1 }],
        potSize: 120,
        actions: [
          {
            sequenceNumber: 1,
            street: "preflop",
            participantId: "p1",
            actionType: "raise",
            amount: 40,
            resultingStack: 960
          }
        ]
      }
    ];
    const listPublicHandReviews = vi
      .spyOn(RoomRepository.prototype, "listPublicHandReviews")
      .mockResolvedValue(publicHands);

    const response = await GET(new Request("http://test.local/api/rooms/room-1/hands"), {
      params: Promise.resolve({ roomId: "room-1" })
    });

    expect(listPublicHandReviews).toHaveBeenCalledWith("room-1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(publicHands);
    expect(JSON.stringify(body)).not.toContain("holeCards");
  });
});
