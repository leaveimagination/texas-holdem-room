import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomRepository, hashToken } from "@/server/repositories/room-repository";

const { buyInUpsertMock, createMock, findFirstMock, roomUpdateMock } = vi.hoisted(() => ({
  buyInUpsertMock: vi.fn(),
  createMock: vi.fn(),
  findFirstMock: vi.fn(),
  roomUpdateMock: vi.fn()
}));

vi.mock("@/server/db", () => ({
  prisma: {
    buyIn: {
      upsert: buyInUpsertMock
    },
    room: {
      update: roomUpdateMock
    },
    roomParticipant: {
      create: createMock,
      findFirst: findFirstMock
    }
  }
}));

describe("RoomRepository participant tokens", () => {
  beforeEach(() => {
    buyInUpsertMock.mockReset();
    createMock.mockReset();
    findFirstMock.mockReset();
    roomUpdateMock.mockReset();
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

  it("upserts one deterministic cumulative top-up per participant and target hand", async () => {
    const repository = new RoomRepository();

    await repository.recordTopUp("r1", {
      participantId: "p1",
      targetHandNumber: 2,
      amount: 800,
      requestCount: 2
    });

    expect(buyInUpsertMock).toHaveBeenCalledWith({
      where: { id: "buyin_r1_p1_hand_2" },
      create: {
        id: "buyin_r1_p1_hand_2",
        roomId: "r1",
        participantId: "p1",
        amount: 800
      },
      update: { amount: 800 }
    });
  });

  it("validates and persists the final room summary", async () => {
    const repository = new RoomRepository();
    const endedAt = new Date(10_000);
    const summary = [{
      participantId: "p1",
      displayName: "Ada",
      initialChips: 1_000,
      topUpChips: 500,
      finalChips: 1_800,
      netChips: 300
    }];

    await repository.finishRoom("r1", endedAt, summary);

    expect(roomUpdateMock).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { endedAt, sessionSummary: summary }
    });
  });

  it("rejects a malformed final room summary before persistence", async () => {
    const repository = new RoomRepository();

    await expect(repository.finishRoom("r1", new Date(10_000), [{
      participantId: "p1",
      displayName: "Ada",
      initialChips: 1_000,
      topUpChips: 0,
      finalChips: 1_000,
      netChips: Number.NaN
    }])).rejects.toThrow();
    expect(roomUpdateMock).not.toHaveBeenCalled();
  });
});
