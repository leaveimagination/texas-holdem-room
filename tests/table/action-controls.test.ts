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
        playerControls: true
      })
    );

    expect(html).toContain("Your turn");
  });
});
