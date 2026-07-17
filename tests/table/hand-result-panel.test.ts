import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HandResultPanel } from "@/components/table/HandResultPanel";

const result = {
  handNumber: 19,
  board: ["Ah", "Kd", "7c", "2s", "9d"],
  winnerParticipantIds: ["p1", "p3"],
  players: [
    { participantId: "p1", displayName: "Alice", seatNumber: 1, startingChips: 1_000, committedChips: 1_000, potAward: 1_800, insuranceDelta: 0, endingChips: 1_800, netChips: 800 },
    { participantId: "p2", displayName: "Bob", seatNumber: 2, startingChips: 1_000, committedChips: 500, potAward: 0, insuranceDelta: 0, endingChips: 500, netChips: -500 },
    { participantId: "p3", displayName: "Cara", seatNumber: 3, startingChips: 1_000, committedChips: 700, potAward: 700, insuranceDelta: 0, endingChips: 1_000, netChips: 0 },
    { participantId: "p4", displayName: "Dan", seatNumber: 4, startingChips: 1_000, committedChips: 300, potAward: 0, insuranceDelta: 0, endingChips: 700, netChips: -300 }
  ],
  pots: [
    { potIndex: 0, amount: 1_800, eligibleParticipantIds: ["p1", "p2", "p3", "p4"], awardsByParticipantId: { p1: 1_800 } },
    { potIndex: 1, amount: 700, eligibleParticipantIds: ["p1", "p3"], awardsByParticipantId: { p3: 700 } }
  ]
};

describe("HandResultPanel", () => {
  it("renders every dealt-in player, signed net chips, board, and exact pot winners", () => {
    const html = renderToStaticMarkup(createElement(HandResultPanel, {
      view: { flow: { phase: "hand-summary", handResult: result } }
    }));

    expect(html).toContain("hand-result-card");
    expect(html).toContain("Hand 19 result");
    expect(html).toContain("Ah Kd 7c 2s 9d");
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain("Cara");
    expect(html).toContain("Dan");
    expect(html).toContain("+800");
    expect(html).toContain("-500");
    expect(html).toContain("Main pot");
    expect(html).toContain("Side pot 1");
  });

  it("renders only during the authoritative hand-summary phase", () => {
    const html = renderToStaticMarkup(createElement(HandResultPanel, {
      view: { flow: { phase: "runout", handResult: result } }
    }));

    expect(html).not.toContain("hand-result-card");
    expect(html).not.toContain("Alice");
  });
});
