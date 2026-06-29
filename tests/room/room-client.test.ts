import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoomClient, TableEventToast } from "@/app/room/[roomId]/RoomClient";

describe("RoomClient", () => {
  it("shows the join flow as a modal over the table", () => {
    const html = renderToStaticMarkup(createElement(RoomClient, { roomId: "room_test" }));

    expect(html).toContain("join-modal-backdrop");
    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
    expect(html).not.toContain("System log");
    expect(html).not.toContain("Quick phrases");
  });

  it("surfaces rebuy messages as a visible table event", () => {
    const html = renderToStaticMarkup(createElement(TableEventToast, {
      messages: [
        { type: "system_message", payload: { message: "Player 1 added 500 chips" } }
      ]
    }));

    expect(html).toContain("table-event-toast");
    expect(html).toContain("Player 1 added 500 chips");
  });
});
