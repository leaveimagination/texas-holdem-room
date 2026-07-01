import { describe, expect, it } from "vitest";
import { canCompleteJoinAfterParticipantCreated } from "@/components/room/JoinRoomForm";

describe("JoinRoomForm", () => {
  it("does not complete a REST join if the realtime connection drops before the response returns", () => {
    expect(canCompleteJoinAfterParticipantCreated(false)).toBe(false);
  });
});
