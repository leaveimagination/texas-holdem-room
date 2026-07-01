import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HandResultPanel } from "@/components/table/HandResultPanel";

describe("HandResultPanel", () => {
  it("summarizes the finished hand with winner names, pot, and board cards", () => {
    const html = renderToStaticMarkup(
      createElement(HandResultPanel, {
        view: {
          settings: { bigBlind: 20 },
          seats: [
            { seatNumber: 1, participantId: "p1", displayName: "Alice", chips: 1120, occupied: true },
            { seatNumber: 2, participantId: "p2", displayName: "Bob", chips: 880, occupied: true }
          ],
          hand: {
            finished: true,
            pot: 120,
            board: ["Ah", "Kd", "7c", "2s", "9d"],
            winners: ["p1"]
          }
        }
      })
    );

    expect(html).toContain("hand-result-card");
    expect(html).toContain("Alice wins");
    expect(html).toContain("6 BB");
    expect(html).toContain("Ah Kd 7c 2s 9d");
    expect(html).not.toContain("Winner: p1");
  });

  it("does not keep an old result visible after the next hand starts", () => {
    const html = renderToStaticMarkup(
      createElement(HandResultPanel, {
        view: {
          settings: { bigBlind: 20 },
          handResult: {
            handNumber: 1,
            pot: 120,
            board: ["Ah", "Kd", "7c"],
            winners: [{ participantId: "p1", displayName: "Alice" }]
          },
          hand: {
            number: 2,
            finished: false,
            pot: 30,
            board: [],
            winners: []
          }
        }
      })
    );

    expect(html).not.toContain("hand-result-card");
    expect(html).not.toContain("Alice wins");
  });
});
