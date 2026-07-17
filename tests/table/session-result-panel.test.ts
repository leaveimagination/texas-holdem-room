import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionResultPanel } from "@/components/table/SessionResultPanel";

describe("SessionResultPanel", () => {
  it("renders a non-expiring final accounting table from the session snapshot", () => {
    const html = renderToStaticMarkup(createElement(SessionResultPanel, {
      view: {
        flow: { phase: "session-summary" },
        sessionSummary: [
          { participantId: "p1", displayName: "Alice", initialChips: 1_000, topUpChips: 500, finalChips: 1_800, netChips: 300 },
          { participantId: "p2", displayName: "Bob", initialChips: 1_000, topUpChips: 0, finalChips: 700, netChips: -300 }
        ]
      }
    }));

    expect(html).toContain("session-result-overlay");
    expect(html).toContain("Session results");
    expect(html).toContain("Initial");
    expect(html).toContain("Top-ups");
    expect(html).toContain("Final");
    expect(html).toContain("Net");
    expect(html).toContain("Alice");
    expect(html).toContain("+300");
    expect(html).toContain("-300");
  });

  it("stays hidden before the room reaches session summary", () => {
    const html = renderToStaticMarkup(createElement(SessionResultPanel, {
      view: { flow: { phase: "hand-summary" }, sessionSummary: [] }
    }));

    expect(html).not.toContain("session-result-overlay");
  });
});
