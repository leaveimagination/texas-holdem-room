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
    const snapshotAndDelete = vi.fn().mockResolvedValue({ rawState: '{"roomId":"room_exact"}', ttlSeconds: 120 });
    const getRedisKey = vi.fn().mockResolvedValue('{"roomId":"room_exact"}');
    const setRedisKey = vi.fn();
    const deleteExactRoom = vi.fn().mockResolvedValue(undefined);

    const result = await cleanupSiteTestRoom(
      { roomId: "room_exact", runId: "run_exact", cleanupAllowed: "1" },
      {
        redis: { snapshotAndDelete, get: getRedisKey, set: setRedisKey },
        repository: { hasRunMarkerParticipant, deleteExactRoom }
      }
    );

    expect(hasRunMarkerParticipant).toHaveBeenCalledWith("room_exact", "run_exact");
    expect(snapshotAndDelete).toHaveBeenCalledWith("room:room_exact");
    expect(deleteExactRoom).toHaveBeenCalledWith("room_exact");
    expect(snapshotAndDelete.mock.invocationCallOrder[0]).toBeLessThan(
      deleteExactRoom.mock.invocationCallOrder[0]
    );
    expect(result).toEqual({
      deleted: true,
      retainedReason: null,
      roomId: "room_exact",
      runId: "run_exact"
      ,cleanupStatus: "deleted",
      failureReason: null
    });
  });

  it("restores the exact Redis value and TTL when the database delete fails", async () => {
    const { cleanupSiteTestRoom } = await import("@/server/site-test-cleanup");
    const redis = {
      get: vi.fn().mockResolvedValue("raw-room"),
      snapshotAndDelete: vi.fn().mockResolvedValue({ rawState: "raw-room", ttlSeconds: 77 }),
      set: vi.fn().mockResolvedValue("OK")
    };
    const result = await cleanupSiteTestRoom(
      { roomId: "room_exact", runId: "run_exact", cleanupAllowed: "1" },
      { redis, repository: { hasRunMarkerParticipant: vi.fn().mockResolvedValue(true), deleteExactRoom: vi.fn().mockRejectedValue(new Error("db down")) } }
    );
    expect(redis.set).toHaveBeenCalledWith("room:room_exact", "raw-room", "EX", 77, "NX");
    expect(result).toMatchObject({ deleted: false, cleanupStatus: "retained", retainedReason: "database-delete-failed-restored", failureReason: null });
  });

  it("does not restore Redis when a rejected database delete may have committed", async () => {
    const { cleanupSiteTestRoom } = await import("@/server/site-test-cleanup");
    const hasRunMarkerParticipant = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const redis = {
      get: vi.fn(),
      snapshotAndDelete: vi.fn().mockResolvedValue({ rawState: "raw-room", ttlSeconds: 77 }),
      set: vi.fn()
    };
    const result = await cleanupSiteTestRoom(
      { roomId: "room_exact", runId: "run_exact", cleanupAllowed: "1" },
      { redis, repository: { hasRunMarkerParticipant, deleteExactRoom: vi.fn().mockRejectedValue(new Error("ack lost")) } }
    );
    expect(hasRunMarkerParticipant).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cleanupStatus: "partial", failureReason: "database-delete-outcome-ambiguous", retainedReason: null });
  });

  it.each([
    ["restore failure", "OK", "different-room"],
    ["concurrent replacement", null, "concurrent-room"]
  ])("reports partial cleanup on %s", async (_name, setResult, observed) => {
    const { cleanupSiteTestRoom } = await import("@/server/site-test-cleanup");
    const redis = {
      get: vi.fn().mockResolvedValue(observed),
      snapshotAndDelete: vi.fn().mockResolvedValue({ rawState: "raw-room", ttlSeconds: 77 }),
      set: vi.fn().mockResolvedValue(setResult)
    };
    const result = await cleanupSiteTestRoom(
      { roomId: "room_exact", runId: "run_exact", cleanupAllowed: "1" },
      { redis, repository: { hasRunMarkerParticipant: vi.fn().mockResolvedValue(true), deleteExactRoom: vi.fn().mockRejectedValue(new Error("db down")) } }
    );
    expect(result).toMatchObject({ deleted: false, cleanupStatus: "partial", retainedReason: null, failureReason: "redis-restore-not-proven" });
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
    const snapshotAndDelete = vi.fn();
    const deleteExactRoom = vi.fn();

    const result = await cleanupSiteTestRoom(request, {
      redis: { snapshotAndDelete, get: vi.fn(), set: vi.fn() },
      repository: { hasRunMarkerParticipant, deleteExactRoom }
    });

    expect(hasRunMarkerParticipant).not.toHaveBeenCalled();
    expect(snapshotAndDelete).not.toHaveBeenCalled();
    expect(deleteExactRoom).not.toHaveBeenCalled();
    expect(result.deleted).toBe(false);
    expect(result.retainedReason).toBe(retainedReason);
  });

  it("retains the room with zero deletes when the participant run marker does not match", async () => {
    const { cleanupSiteTestRoom } = await import("@/server/site-test-cleanup");
    const hasRunMarkerParticipant = vi.fn().mockResolvedValue(false);
    const snapshotAndDelete = vi.fn();
    const deleteExactRoom = vi.fn();

    const result = await cleanupSiteTestRoom(
      { roomId: "room_exact", runId: "different_run", cleanupAllowed: "1" },
      {
        redis: { snapshotAndDelete, get: vi.fn(), set: vi.fn() },
        repository: { hasRunMarkerParticipant, deleteExactRoom }
      }
    );

    expect(hasRunMarkerParticipant).toHaveBeenCalledWith("room_exact", "different_run");
    expect(snapshotAndDelete).not.toHaveBeenCalled();
    expect(deleteExactRoom).not.toHaveBeenCalled();
    expect(result).toEqual({
      deleted: false,
      retainedReason: "ownership-marker-not-found",
      roomId: "room_exact",
      runId: "different_run",
      cleanupStatus: "retained",
      failureReason: null
    });
  });

  it("writes one credential-free JSON result", async () => {
    const { runSiteTestCleanup } = await import("@/server/site-test-cleanup");
    const writeLine = vi.fn();

    await runSiteTestCleanup(
      { roomId: "room_exact", runId: "run_exact", cleanupAllowed: "1" },
      {
        redis: {
          get: vi.fn().mockResolvedValue("raw-room"),
          snapshotAndDelete: vi.fn().mockResolvedValue({ rawState: "raw-room", ttlSeconds: 120 }),
          set: vi.fn()
        },
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
      runId: "run_exact",
      cleanupStatus: "deleted",
      failureReason: null
    });
    expect(output).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(output).not.toMatch(/redis(?:s)?:\/\//i);
    expect(output).not.toContain("password");
  });
});
