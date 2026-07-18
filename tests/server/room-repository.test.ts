import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomRepository, hashToken } from "@/server/repositories/room-repository";

const {
  buyInUpsertMock,
  createMock,
  findFirstMock,
  findManyMock,
  roomUpdateMock,
  transactionMock,
  potDeleteManyMock,
  handActionDeleteManyMock,
  handPlayerDeleteManyMock,
  handDeleteManyMock,
  buyInDeleteManyMock,
  tournamentResultDeleteManyMock,
  participantDeleteManyMock,
  roomDeleteMock
} = vi.hoisted(() => ({
  buyInUpsertMock: vi.fn(),
  createMock: vi.fn(),
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  roomUpdateMock: vi.fn(),
  transactionMock: vi.fn(),
  potDeleteManyMock: vi.fn(),
  handActionDeleteManyMock: vi.fn(),
  handPlayerDeleteManyMock: vi.fn(),
  handDeleteManyMock: vi.fn(),
  buyInDeleteManyMock: vi.fn(),
  tournamentResultDeleteManyMock: vi.fn(),
  participantDeleteManyMock: vi.fn(),
  roomDeleteMock: vi.fn()
}));

vi.mock("@/server/db", () => ({
  prisma: {
    $transaction: transactionMock,
    buyIn: {
      upsert: buyInUpsertMock
    },
    room: {
      update: roomUpdateMock
    },
    roomParticipant: {
      create: createMock,
      findFirst: findFirstMock,
      findMany: findManyMock
    }
  }
}));

describe("RoomRepository participant tokens", () => {
  beforeEach(() => {
    buyInUpsertMock.mockReset();
    createMock.mockReset();
    findFirstMock.mockReset();
    findManyMock.mockReset();
    roomUpdateMock.mockReset();
    transactionMock.mockReset();
    potDeleteManyMock.mockReset();
    handActionDeleteManyMock.mockReset();
    handPlayerDeleteManyMock.mockReset();
    handDeleteManyMock.mockReset();
    buyInDeleteManyMock.mockReset();
    tournamentResultDeleteManyMock.mockReset();
    participantDeleteManyMock.mockReset();
    roomDeleteMock.mockReset();
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

  it("finds only the exact smoke-player ownership marker within the exact room", async () => {
    findManyMock.mockResolvedValue([
      { displayName: "Guest" },
      { displayName: "SITE-run_exact-smoke-player" }
    ]);
    const repository = new RoomRepository();

    await expect(repository.hasRunMarkerParticipant("room_exact", "run_exact")).resolves.toBe(true);

    expect(findManyMock).toHaveBeenCalledWith({
      where: { roomId: "room_exact" },
      select: { displayName: true }
    });
  });

  it("rejects a same-run prefix marker belonging to a foreign actor", async () => {
    findManyMock.mockResolvedValue([{ displayName: "SITE-run_exact-foreign" }]);
    const repository = new RoomRepository();
    await expect(repository.hasRunMarkerParticipant("room_exact", "run_exact")).resolves.toBe(false);
  });

  it.each([
    ["run_id", "SITE-runXid-Alice"],
    ["run%id", "SITE-run-anything-id-Alice"],
    ["run*id", "SITE-runXid-Alice"],
    ["run?id", "SITE-runXid-Alice"],
    ["run[ab]id", "SITE-runaid-Alice"]
  ])("treats special characters literally when runId is %s", async (runId, differentMarker) => {
    findManyMock.mockResolvedValue([{ displayName: differentMarker }]);
    const repository = new RoomRepository();

    await expect(repository.hasRunMarkerParticipant("room_exact", runId)).resolves.toBe(false);

    expect(findManyMock).toHaveBeenCalledWith({
      where: { roomId: "room_exact" },
      select: { displayName: true }
    });
  });

  it("deletes only the exact room graph in relation-safe transaction order", async () => {
    transactionMock.mockImplementation(async (operation) => operation({
      pot: { deleteMany: potDeleteManyMock },
      handAction: { deleteMany: handActionDeleteManyMock },
      handPlayer: { deleteMany: handPlayerDeleteManyMock },
      hand: { deleteMany: handDeleteManyMock },
      buyIn: { deleteMany: buyInDeleteManyMock },
      tournamentResult: { deleteMany: tournamentResultDeleteManyMock },
      roomParticipant: { deleteMany: participantDeleteManyMock },
      room: { delete: roomDeleteMock }
    }));
    const repository = new RoomRepository();

    await repository.deleteExactRoom("room_exact");

    expect(potDeleteManyMock).toHaveBeenCalledWith({ where: { hand: { roomId: "room_exact" } } });
    expect(handActionDeleteManyMock).toHaveBeenCalledWith({ where: { hand: { roomId: "room_exact" } } });
    expect(handPlayerDeleteManyMock).toHaveBeenCalledWith({ where: { hand: { roomId: "room_exact" } } });
    expect(handDeleteManyMock).toHaveBeenCalledWith({ where: { roomId: "room_exact" } });
    expect(buyInDeleteManyMock).toHaveBeenCalledWith({ where: { roomId: "room_exact" } });
    expect(tournamentResultDeleteManyMock).toHaveBeenCalledWith({ where: { roomId: "room_exact" } });
    expect(participantDeleteManyMock).toHaveBeenCalledWith({ where: { roomId: "room_exact" } });
    expect(roomDeleteMock).toHaveBeenCalledWith({ where: { id: "room_exact" } });
    const deletionCallOrder = [
      potDeleteManyMock,
      handActionDeleteManyMock,
      handPlayerDeleteManyMock,
      handDeleteManyMock,
      buyInDeleteManyMock,
      tournamentResultDeleteManyMock,
      participantDeleteManyMock,
      roomDeleteMock
    ].map((mock) => mock.mock.invocationCallOrder[0]);
    expect(deletionCallOrder).toEqual([...deletionCallOrder].sort((left, right) => left - right));
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, ["room_exact"]])("rejects non-exact room IDs without opening a transaction", async (roomId) => {
    const repository = new RoomRepository();

    await expect(repository.deleteExactRoom(roomId as unknown as string)).rejects.toThrow(
      "An exact room ID is required"
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
