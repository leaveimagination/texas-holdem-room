import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PokerTable } from "@/components/table/PokerTable";

describe("PokerTable", () => {
  it("frames the table like a fullscreen poker client with BB pot units", () => {
    const html = renderToStaticMarkup(
      createElement(PokerTable, {
        localParticipantId: "p1",
        localDisplayName: "Hero",
        playerControls: true,
        view: {
          status: "playing",
          settings: { bigBlind: 20 },
          seats: [
            { seatNumber: 1, displayName: "Hero", chips: 2000, status: "active", occupied: true },
            { seatNumber: 2, displayName: "Villain", chips: 1980, status: "active", occupied: true }
          ],
          hand: {
            pot: 80,
            actorId: "p1",
            board: ["Ac", "Kd", "7h"],
            seats: [
              { seatNumber: 1, participantId: "p1", holeCards: ["As", "6s"], streetCommitted: 20 },
              { seatNumber: 2, participantId: "p2", streetCommitted: 60 }
            ],
            legalActions: { actions: [{ type: "fold" }, { type: "call" }, { type: "raise" }] }
          }
        }
      })
    );

    expect(html).toContain("poker-client-shell");
    expect(html).toContain("Total Pot : 4 BB");
    expect(html).toContain("33%");
    expect(html).toContain("As");
    expect(html).toContain("6s");
  });
});
