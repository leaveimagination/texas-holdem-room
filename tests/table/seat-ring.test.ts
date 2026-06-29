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
        bigBlind: 20,
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
    expect(html).toContain("49.5 BB");
    expect(html).toContain("49 BB");
    expect(html).toContain("0.5 BB");
    expect(html).toContain("1 BB");
  });

  it("places the local player in the bottom-center seat slot", () => {
    const html = renderToStaticMarkup(
      createElement(SeatRing, {
        localParticipantId: "p3",
        view: {
          seats: [
            { seatNumber: 1, displayName: "A", chips: 1000, status: "active", occupied: true },
            { seatNumber: 2, displayName: "B", chips: 1000, status: "active", occupied: true },
            { seatNumber: 3, displayName: "Hero", chips: 1000, status: "active", occupied: true },
            { seatNumber: 4, displayName: "D", chips: 1000, status: "active", occupied: true },
            { seatNumber: 5, displayName: "E", chips: 1000, status: "active", occupied: true },
            { seatNumber: 6, displayName: "F", chips: 1000, status: "active", occupied: true }
          ],
          hand: {
            seats: [
              { seatNumber: 1, participantId: "p1" },
              { seatNumber: 2, participantId: "p2" },
              { seatNumber: 3, participantId: "p3", holeCards: ["As", "Ah"] },
              { seatNumber: 4, participantId: "p4" },
              { seatNumber: 5, participantId: "p5" },
              { seatNumber: 6, participantId: "p6" }
            ]
          }
        }
      })
    );

    expect(html).toContain("Seat 3 occupied by Hero");
    expect(html).toContain("seat-slot-5");
    expect(html).toContain("is-local-seat");
  });

  it("renders the local seat as a hero seat cluster with visible hero cards", () => {
    const html = renderToStaticMarkup(
      createElement(SeatRing, {
        localParticipantId: "p3",
        localDisplayName: "Hero",
        view: {
          seats: [
            { seatNumber: 1, displayName: "A", chips: 1000, status: "active", occupied: true },
            { seatNumber: 2, displayName: "B", chips: 1000, status: "active", occupied: true },
            { seatNumber: 3, displayName: "Hero", chips: 1000, status: "active", occupied: true }
          ],
          hand: {
            seats: [
              { seatNumber: 1, participantId: "p1" },
              { seatNumber: 2, participantId: "p2" },
              { seatNumber: 3, participantId: "p3", holeCards: ["As", "Ah"] }
            ]
          }
        }
      })
    );

    expect(html).toContain("hero-seat-cluster");
    expect(html).toContain("hero-hole-cards");
    expect(html).toMatch(/hero-seat-cluster[\s\S]*seat-avatar/);
    expect(html).toMatch(/hero-seat-cluster[\s\S]*seat-panel/);
    expect(html).toMatch(/hero-seat-cluster[\s\S]*hero-hole-cards/);
    expect(html).toContain("Seat 3 hole cards");
    expect(html).toContain("As");
    expect(html).toContain("Ah");
  });
});
