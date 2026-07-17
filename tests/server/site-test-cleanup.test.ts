import { beforeEach, describe, expect, it, vi } from "vitest";

describe("site test cleanup", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("is safe to import without running cleanup", async () => {
    const createRedisClient = vi.fn();
    const deleteExactRoom = vi.fn();
    const roomRepositoryConstructor = vi.fn(() => ({
      hasRunMarkerParticipant: vi.fn(),
      deleteExactRoom
    }));
    vi.doMock("@/server/redis", () => ({ createRedisClient }));
    vi.doMock("@/server/repositories/room-repository", () => ({
      RoomRepository: roomRepositoryConstructor
    }));

    await import("@/server/site-test-cleanup");

    expect(createRedisClient).not.toHaveBeenCalled();
    expect(roomRepositoryConstructor).not.toHaveBeenCalled();
    expect(deleteExactRoom).not.toHaveBeenCalled();
  });

  it("deletes the exact Redis key and durable room after proving run ownership", async () => {
    const { cleanupSiteTestRoom } = await import("@/server/site-test-cleanup");
    const hasRunMarkerParticipant = vi.fn().mockResolvedValue(true);
    const deleteRedisKey = vi.fn().mockResolvedValue(1);
    const deleteExactRoom = vi.fn().mockResolvedValue(undefined);

    const result = await cleanupSiteTestRoom(
      { roomId: "room_exact", runId: "run_exact", cleanupAllowed: "1" },
      {
        redis: { del: deleteRedisKey },
        repository: { hasRunMarkerParticipant, deleteExactRoom }
      }
    );

    expect(hasRunMarkerParticipant).toHaveBeenCalledWith("room_exact", "run_exact");
    expect(deleteRedisKey).toHaveBeenCalledWith("room:room_exact");
    expect(deleteExactRoom).toHaveBeenCalledWith("room_exact");
    expect(deleteRedisKey.mock.invocationCallOrder[0]).toBeLessThan(
      deleteExactRoom.mock.invocationCallOrder[0]
    );
    expect(result).toEqual({
      deleted: true,
      retainedReason: null,
      roomId: "room_exact",
      runId: "run_exact"
    });
  });

  it.each([
    {
      name: "the app-container marker is not exactly one",
      request: { roomId: "room_exact", runId: "run_exact", cleanupAllowed: "true" },
      retainedReason: "cleanup-not-allowed"
    },
    {
      name: "the exact room ID is missing",
      request: { runId: "run_exact", cleanupAllowed: "1" },
      retainedReason: "missing-room-id"
    },
    {
      name: "the exact run ID is missing",
      request: { roomId: "room_exact", cleanupAllowed: "1" },
      retainedReason: "missing-run-id"
    },
    {
      name: "the room ID is an array",
      request: {
        roomId: ["room_exact"] as unknown as string,
        runId: "run_exact",
        cleanupAllowed: "1"
      },
      retainedReason: "missing-room-id"
    },
    {
      name: "the run ID is an array",
      request: {
        roomId: "room_exact",
        runId: ["run_exact"] as unknown as string,
        cleanupAllowed: "1"
      },
      retainedReason: "missing-run-id"
    }
  ])("retains the room with zero deletes when $name", async ({ request, retainedReason }) => {
    const { cleanupSiteTestRoom } = await import("@/server/site-test-cleanup");
    const hasRunMarkerParticipant = vi.fn().mockResolvedValue(true);
    const deleteRedisKey = vi.fn();
    const deleteExactRoom = vi.fn();

    const result = await cleanupSiteTestRoom(request, {
      redis: { del: deleteRedisKey },
      repository: { hasRunMarkerParticipant, deleteExactRoom }
    });

    expect(hasRunMarkerParticipant).not.toHaveBeenCalled();
    expect(deleteRedisKey).not.toHaveBeenCalled();
    expect(deleteExactRoom).not.toHaveBeenCalled();
    expect(result.deleted).toBe(false);
    expect(result.retainedReason).toBe(retainedReason);
  });

  it("retains the room with zero deletes when the participant run marker does not match", async () => {
    const { cleanupSiteTestRoom } = await import("@/server/site-test-cleanup");
    const hasRunMarkerParticipant = vi.fn().mockResolvedValue(false);
    const deleteRedisKey = vi.fn();
    const deleteExactRoom = vi.fn();

    const result = await cleanupSiteTestRoom(
      { roomId: "room_exact", runId: "different_run", cleanupAllowed: "1" },
      {
        redis: { del: deleteRedisKey },
        repository: { hasRunMarkerParticipant, deleteExactRoom }
      }
    );

    expect(hasRunMarkerParticipant).toHaveBeenCalledWith("room_exact", "different_run");
    expect(deleteRedisKey).not.toHaveBeenCalled();
    expect(deleteExactRoom).not.toHaveBeenCalled();
    expect(result).toEqual({
      deleted: false,
      retainedReason: "ownership-marker-not-found",
      roomId: "room_exact",
      runId: "different_run"
    });
  });

  it("writes one credential-free JSON result", async () => {
    const { runSiteTestCleanup } = await import("@/server/site-test-cleanup");
    const writeLine = vi.fn();

    await runSiteTestCleanup(
      { roomId: "room_exact", runId: "run_exact", cleanupAllowed: "1" },
      {
        redis: { del: vi.fn().mockResolvedValue(1) },
        repository: {
          hasRunMarkerParticipant: vi.fn().mockResolvedValue(true),
          deleteExactRoom: vi.fn().mockResolvedValue(undefined)
        }
      },
      writeLine
    );

    expect(writeLine).toHaveBeenCalledTimes(1);
    const output = writeLine.mock.calls[0][0] as string;
    expect(JSON.parse(output)).toEqual({
      deleted: true,
      retainedReason: null,
      roomId: "room_exact",
      runId: "run_exact"
    });
    expect(output).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(output).not.toMatch(/redis(?:s)?:\/\//i);
    expect(output).not.toContain("password");
  });
});
