import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SeatRing } from "@/components/table/SeatRing";

describe("SeatRing", () => {
  it("renders visible hole cards for the viewer seat", () => {
    const html = renderToStaticMarkup(
      createElement(SeatRing, {
        view: {
          seats: [
            { seatNumber: 1, displayName: "home", chips: 1980, status: "active", occupied: true },
            { seatNumber: 2, displayName: "fandao", chips: 1980, status: "active", occupied: true }
          ],
          hand: {
            seats: [
              { seatNumber: 1, participantId: "p1", holeCards: ["As", "Kd"] },
              { seatNumber: 2, participantId: "p2" }
            ]
          }
        }
      })
    );

    expect(html).toContain("As");
    expect(html).toContain("Kd");
    expect(html).toContain("Seat 1 hole cards");
  });

  it("marks the active actor seat for the current turn", () => {
    const html = renderToStaticMarkup(
      createElement(SeatRing, {
        view: {
          seats: [
            { seatNumber: 1, displayName: "Alice", chips: 1980, status: "active", occupied: true },
            { seatNumber: 2, displayName: "Bob", chips: 1980, status: "active", occupied: true }
          ],
          hand: {
            actorId: "p2",
            seats: [
              { seatNumber: 1, participantId: "p1" },
              { seatNumber: 2, participantId: "p2", holeCards: ["Ah", "Ad"] }
            ]
          }
        }
      })
    );

    expect(html).toContain("is-acting");
    expect(html).toContain("Seat 2 is acting");
  });

  it("renders dealer blind badges and committed chip markers", () => {
    const html = renderToStaticMarkup(
      createElement(SeatRing, {
        view: {
          seats: [
            { seatNumber: 1, displayName: "Alice", chips: 990, status: "active", occupied: true },
            { seatNumber: 2, displayName: "Bob", chips: 980, status: "active", occupied: true }
          ],
          hand: {
            actorId: "p1",
            seats: [
              { seatNumber: 1, participantId: "p1", role: "BTN/SB", committed: 10, streetCommitted: 10 },
              { seatNumber: 2, participantId: "p2", role: "BB", committed: 20, streetCommitted: 20 }
            ]
          }
        }
      })
    );

    expect(html).toContain("BTN/SB");
    expect(html).toContain("BB");
    expect(html).toContain("Bet 10");
    expect(html).toContain("Bet 20");
  });
});
