import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionControls } from "@/components/table/ActionControls";

describe("ActionControls", () => {
  it("disables betting actions when the local participant is not the actor", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: "p2",
        localParticipantId: "p1",
        playerControls: true
      })
    );

    expect(html).toContain("Waiting for another player");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it("shows a turn prompt when the local participant is the actor", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: "p1",
        localParticipantId: "p1",
        playerControls: true,
        heroCards: ["As", "Kh"],
        heroName: "home",
        heroStack: 1980
      })
    );

    expect(html).toContain("YOUR TURN");
    expect(html).toContain("home");
    expect(html).toContain("1,980");
    expect(html).toContain("A");
    expect(html).toContain("K");
  });

  it("renders quick bet controls and keeps add chips as a secondary panel", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: "p1",
        localParticipantId: "p1",
        playerControls: true,
        legalActions: { actions: [{ type: "fold" }, { type: "call" }, { type: "raise" }] }
      })
    );

    expect(html).toContain("2BB");
    expect(html).toContain("40");
    expect(html).toContain("3BB");
    expect(html).toContain("60");
    expect(html).toContain("1/2 Pot");
    expect(html).toContain("Pot");
    expect(html).toContain("Add chips");
    expect(html).toContain("<details class=\"rebuy-popover\"");
  });

  it("hides betting buttons while waiting for the host to start", () => {
    const html = renderToStaticMarkup(
      createElement(ActionControls, {
        actorId: null,
        localParticipantId: "p1",
        playerControls: true,
        tableStatus: "lobby"
      })
    );

    expect(html).toContain("Waiting for host to deal");
    expect(html).not.toContain(">Fold<");
    expect(html).not.toContain(">Call<");
    expect(html).not.toContain(">Raise<");
  });
});
