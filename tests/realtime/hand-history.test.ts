import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GET } from "@/app/api/rooms/[roomId]/hands/route";
import RoomReviewPage from "@/app/room/[roomId]/review/page";
import { createHandPersistenceDetails, mapHandToPublicReview, RoomRepository } from "@/server/repositories/room-repository";
import type { RoomState } from "@/lib/poker/engine";

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

  it("builds durable hand players, actions, and pots from finished room state", () => {
    const details = createHandPersistenceDetails(finishedRoom());

    expect(details.players).toHaveLength(2);
    expect(details.actions).toEqual([
      expect.objectContaining({
        sequenceNumber: 1,
        participantId: "p2",
        actionType: "fold",
        resultingStack: 980
      })
    ]);
    expect(details.pots).toEqual([
      expect.objectContaining({
        amount: 20,
        winnerParticipantIds: ["p1"],
        eligibleParticipantIds: ["p1"]
      })
    ]);
  });

  it("renders public hand history on the review page", async () => {
    vi.spyOn(RoomRepository.prototype, "listPublicHandReviews").mockResolvedValue([
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
    ]);

    const page = await RoomReviewPage({ params: Promise.resolve({ roomId: "room-1" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Hand 1");
    expect(html).toContain("Board: As Kd Qc");
    expect(html).toContain("Pot: 120");
    expect(html).toContain("Winners:");
    expect(html).toContain("Ada");
    expect(html).toContain("preflop");
    expect(html).toContain("raise 40");
    expect(html).not.toContain("holeCards");
  });
});

function finishedRoom(): RoomState {
  return {
    roomId: "room-1",
    mode: "cash",
    settings: { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    status: "playing",
    handCounter: 1,
    buttonSeat: 1,
    seats: [
      { seatNumber: 1, participantId: "p1", displayName: "Ada", chips: 1030, status: "active", cumulativeBuyIn: 1000 },
      { seatNumber: 2, participantId: "p2", displayName: "Linus", chips: 980, status: "folded", cumulativeBuyIn: 1000 }
    ],
    hand: {
      id: "hand-1",
      number: 1,
      street: "preflop",
      board: [],
      deck: [],
      actorId: "p2",
      betting: {
        street: "preflop",
        currentBet: 20,
        minRaise: 20,
        actorId: "p2",
        players: [
          { id: "p1", stack: 990, committed: 10, streetCommitted: 10, folded: false, allIn: false },
          { id: "p2", stack: 980, committed: 20, streetCommitted: 20, folded: true, allIn: false }
        ]
      },
      holeCardsByParticipantId: {},
      actions: [{ playerId: "p2", type: "fold" }],
      finished: true,
      winners: ["p1"]
    }
  };
}
