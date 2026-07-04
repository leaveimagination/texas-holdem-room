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
    expect(html).toContain("seat-action-ring is-subtle");
    expect(html).toContain("aria-hidden=\"true\"");
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

  it("recognizes the local seat before a hand starts", () => {
    const html = renderToStaticMarkup(
      createElement(SeatRing, {
        localParticipantId: "p3",
        view: {
          seats: [
            { seatNumber: 1, participantId: "p1", displayName: "A", chips: 1000, status: "seated", occupied: true },
            { seatNumber: 2, participantId: "p2", displayName: "B", chips: 1000, status: "seated", occupied: true },
            { seatNumber: 3, participantId: "p3", displayName: "Hero", chips: 1000, status: "seated", occupied: true }
          ],
          hand: null
        }
      })
    );

    expect(html).toContain("Seat 3 occupied by Hero");
    expect(html).toContain("seat-slot-5");
    expect(html).toContain("is-local-seat");
    expect(html).toContain("hero-seat-cluster");
  });

  it("shows the latest player action on that player's seat", () => {
    const html = renderToStaticMarkup(
      createElement(SeatRing, {
        bigBlind: 20,
        view: {
          seats: [
            { seatNumber: 1, participantId: "p1", displayName: "Alice", chips: 960, status: "active", occupied: true },
            { seatNumber: 2, participantId: "p2", displayName: "Bob", chips: 1040, status: "active", occupied: true }
          ],
          hand: {
            actorId: "p2",
            actions: [
              { playerId: "p1", type: "call", amount: 20 },
              { playerId: "p2", type: "raise", amountTo: 80 }
            ],
            seats: [
              { seatNumber: 1, participantId: "p1", streetCommitted: 20 },
              { seatNumber: 2, participantId: "p2", streetCommitted: 80 }
            ]
          }
        }
      })
    );

    expect(html).toContain("seat-last-action");
    expect(html).toContain("Raise 4 BB");
    expect(html).not.toContain("Call 1 BB");
  });

  it("marks all-in actions with a dedicated animation class", () => {
    const html = renderToStaticMarkup(
      createElement(SeatRing, {
        bigBlind: 20,
        view: {
          seats: [
            { seatNumber: 1, participantId: "p1", displayName: "Alice", chips: 0, status: "all-in", occupied: true },
            { seatNumber: 2, participantId: "p2", displayName: "Bob", chips: 1040, status: "active", occupied: true }
          ],
          hand: {
            actions: [
              { playerId: "p1", type: "all-in", amountTo: 2000 }
            ],
            seats: [
              { seatNumber: 1, participantId: "p1", streetCommitted: 2000 },
              { seatNumber: 2, participantId: "p2", streetCommitted: 20 }
            ]
          }
        }
      })
    );

    expect(html).toContain("seat-last-action");
    expect(html).toContain("is-all-in-action-label");
    expect(html).toContain("All in 100 BB");
  });

  it("supports a nine-handed table while keeping the local player bottom-center", () => {
    const seats = Array.from({ length: 9 }, (_, index) => ({
      seatNumber: index + 1,
      participantId: `p${index + 1}`,
      displayName: index === 8 ? "Hero" : `P${index + 1}`,
      chips: 1000,
      status: "active",
      occupied: true
    }));
    const handSeats = seats.map((seat) => ({
      seatNumber: seat.seatNumber,
      participantId: seat.participantId,
      ...(seat.participantId === "p9" ? { holeCards: ["As", "Ah"] } : {})
    }));

    const html = renderToStaticMarkup(
      createElement(SeatRing, {
        localParticipantId: "p9",
        view: {
          seats,
          hand: { seats: handSeats }
        }
      })
    );

    expect(html).toContain("Seat 9 occupied by Hero");
    expect(html).toContain("seat-slot-9");
    expect(html).toContain("seat-slot-5");
    expect(html).toContain("is-local-seat");
    expect(html).toContain("hero-seat-cluster");
    expect(html).toMatch(/seat-slot-6[\s\S]*Seat 1/);
    expect(html).toMatch(/seat-slot-7[\s\S]*Seat 2/);
    expect(html).toMatch(/seat-slot-1[\s\S]*Seat 3/);
    expect(html).toMatch(/seat-slot-2[\s\S]*Seat 4/);
    expect(html).toMatch(/seat-slot-8[\s\S]*Seat 5/);
    expect(html).toMatch(/seat-slot-3[\s\S]*Seat 6/);
    expect(html).toMatch(/seat-slot-4[\s\S]*Seat 7/);
    expect(html).toMatch(/seat-slot-9[\s\S]*Seat 8/);
  });
});
