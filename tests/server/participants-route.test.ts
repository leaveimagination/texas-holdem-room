import { beforeEach, describe, expect, it, vi } from "vitest";

const { createParticipantMock } = vi.hoisted(() => ({
  createParticipantMock: vi.fn()
}));

vi.mock("@/server/repositories/room-repository", () => ({
  RoomRepository: vi.fn(() => ({
    createParticipant: createParticipantMock
  }))
}));

describe("POST /api/rooms/:roomId/participants", () => {
  beforeEach(() => {
    createParticipantMock.mockReset();
  });

  it("creates a participant token for a nickname", async () => {
    createParticipantMock.mockResolvedValue({
      participantId: "participant_1",
      participantToken: "participant_secret"
    });
    const { POST } = await import("@/app/api/rooms/[roomId]/participants/route");

    const response = await POST(
      new Request("http://localhost/api/rooms/room_1/participants", {
        method: "POST",
        body: JSON.stringify({ displayName: " Alice " })
      }),
      { params: Promise.resolve({ roomId: "room_1" }) }
    );

    await expect(response.json()).resolves.toEqual({
      participantId: "participant_1",
      participantToken: "participant_secret"
    });
    expect(response.status).toBe(201);
    expect(createParticipantMock).toHaveBeenCalledWith("room_1", "Alice");
  });

  it("rejects blank nicknames", async () => {
    const { POST } = await import("@/app/api/rooms/[roomId]/participants/route");

    const response = await POST(
      new Request("http://localhost/api/rooms/room_1/participants", {
        method: "POST",
        body: JSON.stringify({ displayName: " " })
      }),
      { params: Promise.resolve({ roomId: "room_1" }) }
    );

    expect(response.status).toBe(400);
    expect(createParticipantMock).not.toHaveBeenCalled();
  });
});
