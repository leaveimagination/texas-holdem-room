import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomRepository, hashToken } from "@/server/repositories/room-repository";

const { createMock, findFirstMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  findFirstMock: vi.fn()
}));

vi.mock("@/server/db", () => ({
  prisma: {
    roomParticipant: {
      create: createMock,
      findFirst: findFirstMock
    }
  }
}));

describe("RoomRepository participant tokens", () => {
  beforeEach(() => {
    createMock.mockReset();
    findFirstMock.mockReset();
  });

  it("creates a participant with a persisted token hash and returns the raw token once", async () => {
    createMock.mockResolvedValue({ id: "participant_1" });
    const repository = new RoomRepository();

    const participant = await repository.createParticipant("room_1", "Alice");

    expect(participant).toMatchObject({ participantId: "participant_1" });
    expect(participant.participantToken).toMatch(/^participant_/);
    expect(createMock).toHaveBeenCalledWith({
      data: {
        id: expect.stringMatching(/^participant_/),
        roomId: "room_1",
        displayName: "Alice",
        role: "player",
        tokenHash: hashToken(participant.participantToken)
      },
      select: { id: true }
    });
  });

  it("verifies participant tokens against the persisted hash", async () => {
    findFirstMock.mockResolvedValue({ id: "participant_1" });
    const repository = new RoomRepository();

    await expect(repository.verifyParticipantToken("room_1", "participant_secret")).resolves.toBe("participant_1");

    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        roomId: "room_1",
        tokenHash: hashToken("participant_secret")
      },
      select: { id: true }
    });
  });
});
