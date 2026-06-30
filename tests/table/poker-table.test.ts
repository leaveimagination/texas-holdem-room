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
            { seatNumber: 2, displayName: "Villain", chips: 1980, status: "active", occupied: true },
            { seatNumber: 3, displayName: null, chips: 0, status: "empty", occupied: false }
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
    expect(html).toContain("poker-client-backdrop");
    expect(html).toContain("table-watermark");
    expect(html).toContain("table-status-bar");
    expect(html).toContain("Total Pot : 4 BB");
    expect(html).toContain("seat-nameplate");
    expect(html).toContain("chip-stack");
    expect(html).toContain("hero-seat-cluster");
    expect(html).toContain("is-empty-seat");
    expect(html).toContain("33%");
    expect(html).toContain("As");
    expect(html).toContain("6s");
    expect(html).not.toContain("Live felt");
    expect(html).not.toContain("<h2>Table</h2>");
  });

  it("keeps the table center quiet before cards are dealt", () => {
    const html = renderToStaticMarkup(
      createElement(PokerTable, {
        localParticipantId: "p1",
        localDisplayName: "Hero",
        playerControls: true,
        view: {
          status: "lobby",
          settings: { bigBlind: 20 },
          seats: [
            { seatNumber: 1, displayName: "Hero", chips: 2000, status: "seated", occupied: true },
            { seatNumber: 2, displayName: "Villain", chips: 2000, status: "seated", occupied: true }
          ],
          hand: {
            pot: 0,
            board: [],
            seats: []
          }
        }
      })
    );

    expect(html).toContain("table-watermark");
    expect(html).not.toContain("No pot yet");
    expect(html).not.toContain("Board waiting");
    expect(html).not.toContain("Waiting for deal");
  });
});
