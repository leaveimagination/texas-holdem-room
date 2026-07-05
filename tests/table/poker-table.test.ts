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
    expect(html).toContain("HOLD&#x27;EM");
    expect(html).toContain("table-status-bar");
    expect(html).toContain("board is-featured-board");
    expect(html).toContain("pot-display");
    expect(html).toContain("pot-label");
    expect(html).toContain("pot-amount");
    expect(html).toContain("pot-screen-reader-text");
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

  it("marks each live hand as a deal sequence so a new hand can replay card motion", () => {
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
            { seatNumber: 2, displayName: "Villain", chips: 2000, status: "active", occupied: true }
          ],
          hand: {
            number: 12,
            pot: 30,
            board: ["Ac", "Kd", "7h"],
            seats: [
              { seatNumber: 1, participantId: "p1", holeCards: ["As", "6s"] },
              { seatNumber: 2, participantId: "p2" }
            ]
          }
        }
      })
    );

    expect(html).toContain("deal-sequence");
    expect(html).toContain("data-hand-number=\"12\"");
    expect(html).toContain("style=\"--board-deal-offset:4\"");
    expect(html).toContain("style=\"--deal-index:4\"");
    expect(html).toContain("style=\"--deal-index:5\"");
    expect(html).toContain("style=\"--deal-index:6\"");
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

  it("uses refreshed snapshot legal actions after a rebuy instead of stale action messages", () => {
    const html = renderToStaticMarkup(
      createElement(PokerTable, {
        localParticipantId: "p1",
        localDisplayName: "Hero",
        playerControls: true,
        legalActions: { actions: [] },
        view: {
          status: "playing",
          settings: { bigBlind: 20 },
          seats: [
            { seatNumber: 1, displayName: "Hero", chips: 500, status: "active", occupied: true },
            { seatNumber: 2, displayName: "Villain", chips: 1500, status: "active", occupied: true }
          ],
          hand: {
            pot: 80,
            currentBet: 20,
            actorId: "p1",
            board: [],
            seats: [
              { seatNumber: 1, participantId: "p1", holeCards: ["As", "Kd"], streetCommitted: 10 },
              { seatNumber: 2, participantId: "p2", streetCommitted: 20 }
            ],
            legalActions: [
              { type: "fold" },
              { type: "call", amount: 10 },
              { type: "raise", minAmountTo: 40, maxAmountTo: 500 },
              { type: "all-in", amountTo: 500 }
            ]
          }
        }
      })
    );

    expect(html).toContain("YOUR TURN");
    expect(html).toContain(">Fold<");
    expect(html).toContain(">Call<");
    expect(html).toContain(">Raise to<");
    expect(html).toContain(">All in<");
  });

  it("shows an insurance offer to the covered all-in favorite", () => {
    const html = renderToStaticMarkup(
      createElement(PokerTable, {
        localParticipantId: "p1",
        localDisplayName: "Hero",
        playerControls: true,
        connected: true,
        view: {
          status: "playing",
          settings: { bigBlind: 20 },
          seats: [
            { seatNumber: 1, displayName: "Hero", chips: 0, status: "all-in", occupied: true },
            { seatNumber: 2, displayName: "Villain", chips: 0, status: "all-in", occupied: true }
          ],
          hand: {
            pot: 200,
            actorId: "p1",
            board: ["2c", "7d", "9h", "3s"],
            seats: [
              { seatNumber: 1, participantId: "p1", holeCards: ["As", "Ah"], streetCommitted: 100 },
              { seatNumber: 2, participantId: "p2", streetCommitted: 100 }
            ],
            legalActions: [],
            insuranceOffer: {
              status: "pending",
              offeredTo: "p1",
              potAmount: 200,
              equityPct: 88.9,
              coverage: 177,
              premium: 24
            }
          }
        }
      })
    );

    expect(html).toContain("insurance-panel");
    expect(html).toContain("All-in insurance");
    expect(html).toContain("88.9%");
    expect(html).toContain("Coverage");
    expect(html).toContain("Pay 1.2 BB now");
    expect(html).toContain("If you get outdrawn");
    expect(html).toContain("If you still win");
    expect(html).toContain("Buy insurance");
    expect(html).toContain("Run it");
  });

  it("does not keep a stale actor prompt after a hand has finished", () => {
    const html = renderToStaticMarkup(
      createElement(PokerTable, {
        localParticipantId: "p1",
        localDisplayName: "Hero",
        playerControls: true,
        view: {
          status: "playing",
          settings: { bigBlind: 20 },
          seats: [
            { seatNumber: 1, displayName: "Hero", chips: 0, status: "all-in", occupied: true },
            { seatNumber: 2, displayName: "Winner", chips: 4000, status: "active", occupied: true }
          ],
          hand: {
            number: 4,
            pot: 4000,
            currentBet: 20,
            actorId: "p1",
            board: ["Qc", "8c", "3h", "6c", "Jc"],
            seats: [
              { seatNumber: 1, participantId: "p1", streetCommitted: 20 },
              { seatNumber: 2, participantId: "p2", streetCommitted: 20 }
            ],
            legalActions: [],
            finished: true,
            winners: ["p2"]
          }
        }
      })
    );

    expect(html).not.toContain("Hero to act");
    expect(html).not.toContain("Syncing actions");
    expect(html).toContain("Add chips");
  });

  it("renders a showdown reveal and collect-pot animation when a hand finishes at showdown", () => {
    const html = renderToStaticMarkup(
      createElement(PokerTable, {
        localParticipantId: "p1",
        localDisplayName: "Hero",
        playerControls: true,
        view: {
          status: "playing",
          settings: { bigBlind: 20 },
          seats: [
            { seatNumber: 1, displayName: "Hero", chips: 1120, status: "active", occupied: true },
            { seatNumber: 2, displayName: "Villain", chips: 880, status: "all-in", occupied: true }
          ],
          hand: {
            number: 8,
            finished: true,
            pot: 240,
            board: ["Ah", "Kd", "7c", "2s", "9d"],
            seats: [
              { seatNumber: 1, participantId: "p1", holeCards: ["As", "Ad"] },
              { seatNumber: 2, participantId: "p2", holeCards: ["Kh", "Kc"] }
            ],
            winners: ["p1"]
          }
        }
      })
    );

    expect(html).toContain("showdown-overlay");
    expect(html).toContain("Showdown");
    expect(html).toContain("showdown-card-strip");
    expect(html).toContain("Hero");
    expect(html).toContain("Villain");
    expect(html).toContain("collect-pot-burst");
    expect(html).toContain("collect-pot-flight collect-pot-flight-0");
    expect(html).toContain("aria-label=\"Pot collected by Hero\"");
  });

  it("does not force a showdown reveal for a fold-win hand with one visible hand", () => {
    const html = renderToStaticMarkup(
      createElement(PokerTable, {
        localParticipantId: "p1",
        localDisplayName: "Hero",
        playerControls: true,
        view: {
          status: "playing",
          settings: { bigBlind: 20 },
          seats: [
            { seatNumber: 1, displayName: "Hero", chips: 1120, status: "active", occupied: true },
            { seatNumber: 2, displayName: "Villain", chips: 880, status: "folded", occupied: true }
          ],
          hand: {
            number: 9,
            finished: true,
            pot: 80,
            board: ["Ah", "Kd", "7c"],
            seats: [
              { seatNumber: 1, participantId: "p1", holeCards: ["As", "Ad"] },
              { seatNumber: 2, participantId: "p2" }
            ],
            winners: ["p1"]
          }
        }
      })
    );

    expect(html).not.toContain("showdown-overlay");
    expect(html).toContain("collect-pot-burst");
  });

  it("keeps the recent showdown and collect animation visible after the next hand snapshot arrives", () => {
    const html = renderToStaticMarkup(
      createElement(PokerTable, {
        localParticipantId: "p1",
        localDisplayName: "Hero",
        playerControls: true,
        view: {
          status: "playing",
          settings: { bigBlind: 20 },
          seats: [
            { seatNumber: 1, displayName: "Hero", chips: 1120, status: "active", occupied: true },
            { seatNumber: 2, displayName: "Villain", chips: 880, status: "active", occupied: true }
          ],
          handResult: {
            handNumber: 8,
            pot: 240,
            board: ["Ah", "Kd", "7c", "2s", "9d"],
            winners: [{ participantId: "p1", displayName: "Hero", seatNumber: 1 }],
            showdownPlayers: [
              { participantId: "p1", displayName: "Hero", seatNumber: 1, holeCards: ["As", "Ad"] },
              { participantId: "p2", displayName: "Villain", seatNumber: 2, holeCards: ["Kh", "Kc"] }
            ]
          },
          hand: {
            number: 9,
            finished: false,
            pot: 30,
            board: [],
            seats: [
              { seatNumber: 1, participantId: "p1", holeCards: ["2c", "3c"] },
              { seatNumber: 2, participantId: "p2" }
            ],
            winners: []
          }
        }
      })
    );

    expect(html).toContain("showdown-overlay");
    expect(html).toContain("Showdown");
    expect(html).toContain("Hero");
    expect(html).toContain("Villain");
    expect(html).toContain("collect-pot-burst");
  });
});
