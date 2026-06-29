import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoomClient } from "@/app/room/[roomId]/RoomClient";

describe("RoomClient", () => {
  it("shows the join flow as a modal over the table", () => {
    const html = renderToStaticMarkup(createElement(RoomClient, { roomId: "room_test" }));

    expect(html).toContain("join-modal-backdrop");
    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
  });
});
