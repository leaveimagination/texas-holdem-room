import { describe, expect, it } from "vitest";
import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JoinRoomForm } from "@/components/room/JoinRoomForm";
import { RoomClient, TableEventToast, createEndRoomMessage, readVisibleParticipantId } from "@/app/room/[roomId]/RoomClient";

describe("RoomClient", () => {
  it("shows the join flow as a modal over the table", () => {
    const html = renderToStaticMarkup(createElement(RoomClient, { roomId: "room_test" }));

    expect(html).toContain("join-modal-backdrop");
    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
    expect(html).not.toContain("System log");
    expect(html).not.toContain("Quick phrases");
  });

  it("surfaces queued top-ups as a visible table event", () => {
    const html = renderToStaticMarkup(createElement(TableEventToast, {
      messages: [
        { type: "top_up_queued", payload: { participantId: "p1", displayName: "Player 1", submittedAmount: 500, pendingTotal: 800, targetHandNumber: 3 } }
      ]
    }));

    expect(html).toContain("table-event-toast");
    expect(html).toContain("Player 1 queued 500 chips");
    expect(html).toContain("800 pending for hand 3");
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

  it("uses snapshot-driven hand results and builds the host end command", () => {
    const source = readFileSync(join(process.cwd(), "src", "app", "room", "[roomId]", "RoomClient.tsx"), "utf8");

    expect(source).not.toContain("HAND_RESULT_ANIMATION_MS");
    expect(source).not.toContain("visibleHandResult");
    expect(source).not.toContain("attachHandResult");
    expect(createEndRoomMessage("r1", "host-secret")).toEqual({ type: "end_room", roomId: "r1", hostToken: "host-secret" });
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
