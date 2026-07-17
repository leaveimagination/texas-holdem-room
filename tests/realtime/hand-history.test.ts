import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@prisma/client";
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
      board: [
        { rank: "A", suit: "s" },
        { rank: "K", suit: "d" },
        { rank: "Q", suit: "c" },
        { rank: "2", suit: "h" },
        { rank: "9", suit: "s" }
      ],
      players: [
        {
          holeCards: ["Ah", "Ad"],
          startingChips: 1_000,
          endingChips: 1_150,
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

    expect(Object.keys(publicHand)).toEqual(["handNumber", "board", "winners", "players", "potSize", "actions"]);
    expect(publicHand).toEqual({
      handNumber: 3,
      board: ["As", "Kd", "Qc", "2h", "9s"],
      winners: [{ participantId: "p1", displayName: "Ada", seatNumber: 1 }],
      players: [{
        participantId: "p1",
        displayName: "Ada",
        seatNumber: 1,
        startingChips: 1_000,
        endingChips: 1_150,
        netChips: 150
      }],
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
        players: [{ participantId: "p1", displayName: "Ada", seatNumber: 1, startingChips: 1_000, endingChips: 1_120, netChips: 120 }],
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
    expect(details.players.every((player) => player.holeCards === Prisma.NullableJsonNullValueInput.JsonNull)).toBe(true);
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

  it("uses authoritative starting stacks and per-pot awards for side pots", () => {
    const details = createHandPersistenceDetails(finishedSidePotRoom());

    expect(details.players).toEqual(expect.arrayContaining([
      expect.objectContaining({ participantId: "p1", startingChips: 50, endingChips: 150 }),
      expect.objectContaining({ participantId: "p2", startingChips: 100, endingChips: 100 }),
      expect.objectContaining({ participantId: "p3", startingChips: 100, endingChips: 0 })
    ]));
    expect(details.pots).toEqual([
      expect.objectContaining({
        amount: 150,
        eligibleParticipantIds: ["p1", "p2", "p3"],
        winnerParticipantIds: ["p1"]
      }),
      expect.objectContaining({
        amount: 100,
        eligibleParticipantIds: ["p2", "p3"],
        winnerParticipantIds: ["p2"]
      })
    ]);
  });

  it("renders public hand history on the review page", async () => {
    vi.spyOn(RoomRepository.prototype, "listPublicHandReviews").mockResolvedValue([
      {
        handNumber: 1,
        board: ["As", "Kd", "Qc"],
        winners: [{ participantId: "p1", displayName: "Ada", seatNumber: 1 }],
        players: [{ participantId: "p1", displayName: "Ada", seatNumber: 1, startingChips: 1_000, endingChips: 1_120, netChips: 120 }],
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
    flow: {
      phase: "hand-summary",
      sequence: 1,
      deadlineAt: 2_000,
      nextRunoutStep: null,
      handResult: {
        handNumber: 1,
        board: [],
        winnerParticipantIds: ["p1"],
        players: [
          { participantId: "p1", displayName: "Ada", seatNumber: 1, startingChips: 1000, committedChips: 10, potAward: 40, insuranceDelta: 0, endingChips: 1030, netChips: 30 },
          { participantId: "p2", displayName: "Linus", seatNumber: 2, startingChips: 1000, committedChips: 20, potAward: 0, insuranceDelta: 0, endingChips: 980, netChips: -20 }
        ],
        pots: [{ potIndex: 0, amount: 20, eligibleParticipantIds: ["p1"], awardsByParticipantId: { p1: 20 } }]
      }
    },
    pendingTopUps: {},
    endAfterCurrentHand: false,
    sessionEndedAt: null,
    sessionSummary: null,
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
      holeCardsByParticipantId: {
        p1: [
          { rank: "A", suit: "s" },
          { rank: "A", suit: "d" }
        ],
        p2: [
          { rank: "2", suit: "c" },
          { rank: "7", suit: "h" }
        ]
      },
      startingChipsByParticipantId: { p1: 1000, p2: 1000 },
      actions: [{ playerId: "p2", type: "fold", street: "preflop" }],
      finished: true,
      winners: ["p1"]
    }
  };
}

function finishedSidePotRoom(): RoomState {
  const room = finishedRoom();
  return {
    ...room,
    settings: { ...room.settings, seats: 3 },
    seats: [
      { seatNumber: 1, participantId: "p1", displayName: "Ada", chips: 150, status: "all-in", cumulativeBuyIn: 50 },
      { seatNumber: 2, participantId: "p2", displayName: "Linus", chips: 100, status: "all-in", cumulativeBuyIn: 100 },
      { seatNumber: 3, participantId: "p3", displayName: "Grace", chips: 0, status: "eliminated", cumulativeBuyIn: 100 }
    ],
    flow: {
      ...room.flow,
      handResult: {
        handNumber: 1,
        board: ["2c", "3d", "4h", "7s", "9c"],
        winnerParticipantIds: ["p1", "p2"],
        players: [
          { participantId: "p1", displayName: "Ada", seatNumber: 1, startingChips: 50, committedChips: 50, potAward: 150, insuranceDelta: 0, endingChips: 150, netChips: 100 },
          { participantId: "p2", displayName: "Linus", seatNumber: 2, startingChips: 100, committedChips: 100, potAward: 100, insuranceDelta: 0, endingChips: 100, netChips: 0 },
          { participantId: "p3", displayName: "Grace", seatNumber: 3, startingChips: 100, committedChips: 100, potAward: 0, insuranceDelta: 0, endingChips: 0, netChips: -100 }
        ],
        pots: [
          { potIndex: 0, amount: 150, eligibleParticipantIds: ["p1", "p2", "p3"], awardsByParticipantId: { p1: 150 } },
          { potIndex: 1, amount: 100, eligibleParticipantIds: ["p2", "p3"], awardsByParticipantId: { p2: 100 } }
        ]
      }
    },
    hand: {
      ...room.hand!,
      street: "river",
      board: [
        { rank: "2", suit: "c" },
        { rank: "3", suit: "d" },
        { rank: "4", suit: "h" },
        { rank: "7", suit: "s" },
        { rank: "9", suit: "c" }
      ],
      startingChipsByParticipantId: { p1: 50, p2: 100, p3: 100 },
      betting: {
        street: "river",
        currentBet: 100,
        minRaise: 20,
        actorId: "p3",
        players: [
          { id: "p1", stack: 0, committed: 50, streetCommitted: 50, folded: false, allIn: true },
          { id: "p2", stack: 0, committed: 100, streetCommitted: 100, folded: false, allIn: true },
          { id: "p3", stack: 0, committed: 100, streetCommitted: 100, folded: false, allIn: true }
        ]
      },
      actions: []
    }
  };
}
