import { describe, expect, it } from "vitest";
import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JoinRoomForm } from "@/components/room/JoinRoomForm";
import { RoomClient, TableEventToast, readVisibleParticipantId } from "@/app/room/[roomId]/RoomClient";

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

  it("renders an in-room invite button that shares the player link without host credentials", () => {
    const html = renderToStaticMarkup(createElement(RoomClient, { roomId: "room_share" }));

    expect(html).toContain("room-share");
    expect(html).toContain("Invite");
    expect(html).toContain("/room/room_share");
    expect(html).not.toContain("?host=");
  });

  it("does not infer local identity from showdown snapshots with multiple visible hands", () => {
    const participantId = readVisibleParticipantId({
      hand: {
        seats: [
          { participantId: "hero", holeCards: ["Ah", "Ad"] },
          { participantId: "bot2", holeCards: ["Kh", "Kd"] }
        ]
      }
    });

    expect(participantId).toBeNull();
  });

  it("keeps join controls disabled until the realtime connection is ready", () => {
    const html = renderToStaticMarkup(
      createElement(JoinRoomForm as ComponentType<{ roomId: string; connected: boolean }>, {
        roomId: "room_test",
        connected: false
      })
    );

    expect(html).toContain("Connecting to room");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Join<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Spectate<\/button>/);
  });
});
