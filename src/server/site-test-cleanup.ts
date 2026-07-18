import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { KeyValueStore } from "./live-room-store";
import type { RoomRepository } from "./repositories/room-repository";

export interface SiteTestCleanupRequest {
  roomId?: string;
  runId?: string;
  cleanupAllowed?: string;
}

export interface SiteTestCleanupDependencies {
  redis: Pick<KeyValueStore, "get"> & {
    snapshotAndDelete(key: string): Promise<{ rawState: string | null; ttlSeconds: number }>;
    compareAndDelete(key: string, expectedRawState: string): Promise<boolean>;
    set(key: string, value: string, mode: "EX", ttlSeconds: number, condition: "NX"): Promise<unknown>;
  };
  repository: Pick<RoomRepository, "hasRunMarkerParticipant" | "deleteExactRoom">;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface SiteTestCleanupResult {
  deleted: boolean;
  retainedReason: string | null;
  roomId: string;
  runId: string;
  cleanupStatus: "deleted" | "retained" | "partial";
  failureReason: string | null;
}

export async function cleanupSiteTestRoom(
  request: SiteTestCleanupRequest,
  dependencies: SiteTestCleanupDependencies
): Promise<SiteTestCleanupResult> {
  const roomId = exactIdOrEmpty(request.roomId);
  const runId = exactIdOrEmpty(request.runId);
  const retainedReason = invalidRequestReason(request);

  if (retainedReason) {
    return retained(roomId, runId, retainedReason);
  }

  if (!(await dependencies.repository.hasRunMarkerParticipant(roomId, runId))) {
    return retained(roomId, runId, "ownership-marker-not-found");
  }

  const key = `room:${roomId}`;
  const { rawState, ttlSeconds } = await dependencies.redis.snapshotAndDelete(key);
  try {
    await dependencies.repository.deleteExactRoom(roomId);
  } catch {
    const durableRoomStillExists = await dependencies.repository
      .hasRunMarkerParticipant(roomId, runId)
      .catch(() => false);
    if (!durableRoomStillExists) {
      return partial(roomId, runId, "database-delete-outcome-ambiguous");
    }
    if (rawState === null) {
      return retained(roomId, runId, "database-delete-failed-redis-was-absent");
    }
    if (ttlSeconds <= 0) {
      return partial(roomId, runId, "redis-ttl-not-restorable");
    }
    const restored = await dependencies.redis
      .set(key, rawState, "EX", ttlSeconds, "NX")
      .catch(() => null);
    const verified = await dependencies.redis.get(key).catch(() => null);
    if (restored !== null && verified === rawState) {
      return retained(roomId, runId, "database-delete-failed-restored");
    }
    return partial(roomId, runId, "redis-restore-not-proven");
  }

  return await proveRedisQuiescence(key, roomId, runId, dependencies);
}

async function proveRedisQuiescence(
  key: string,
  roomId: string,
  runId: string,
  dependencies: SiteTestCleanupDependencies
): Promise<SiteTestCleanupResult> {
  const sleep = dependencies.sleep ?? (async (milliseconds: number) =>
    await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  let consecutiveAbsent = 0;
  for (let observation = 0; observation < 6; observation += 1) {
    let observed: string | null;
    try {
      observed = await dependencies.redis.get(key);
    } catch {
      return partial(roomId, runId, "redis-post-delete-read-failed");
    }
    if (observed === null) {
      consecutiveAbsent += 1;
      if (consecutiveAbsent === 3) {
        return { deleted: true, retainedReason: null, roomId, runId, cleanupStatus: "deleted", failureReason: null };
      }
    } else {
      consecutiveAbsent = 0;
      if (!rawStateHasExactRunOwner(observed, runId)) {
        return partial(roomId, runId, "redis-post-delete-unowned-recreation");
      }
      const removed = await dependencies.redis.compareAndDelete(key, observed).catch(() => false);
      if (!removed) {
        return partial(roomId, runId, "redis-post-delete-cas-failed");
      }
    }
    await sleep(10);
  }
  return partial(roomId, runId, "redis-post-delete-quiescence-budget-exhausted");
}

function rawStateHasExactRunOwner(rawState: string, runId: string): boolean {
  let parsed: unknown;
  try { parsed = JSON.parse(rawState); } catch { return false; }
  if (typeof parsed !== "object" || parsed === null || !("seats" in parsed) || !Array.isArray((parsed as { seats?: unknown }).seats)) {
    return false;
  }
  const exactPrefix = `SITE-${runId}-`;
  return (parsed as { seats: unknown[] }).seats.some((seat) =>
    typeof seat === "object" && seat !== null &&
    "displayName" in seat && typeof seat.displayName === "string" &&
    seat.displayName.startsWith(exactPrefix));
}

export async function runSiteTestCleanup(
  request: SiteTestCleanupRequest,
  dependencies: SiteTestCleanupDependencies,
  writeLine: (line: string) => void
): Promise<SiteTestCleanupResult> {
  let result: SiteTestCleanupResult;

  try {
    result = await cleanupSiteTestRoom(request, dependencies);
  } catch {
    result = failureResult(request);
  }

  writeLine(JSON.stringify(result));
  return result;
}

function invalidRequestReason(request: SiteTestCleanupRequest): string | null {
  if (request.cleanupAllowed !== "1") {
    return "cleanup-not-allowed";
  }
  if (!isExactId(request.roomId)) {
    return "missing-room-id";
  }
  if (!isExactId(request.runId)) {
    return "missing-run-id";
  }

  return null;
}

function exactIdOrEmpty(value: unknown): string {
  return isExactId(value) ? value : "";
}

function isExactId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function failureResult(request: SiteTestCleanupRequest): SiteTestCleanupResult {
  return {
    deleted: false,
    retainedReason: null,
    roomId: exactIdOrEmpty(request.roomId),
    runId: exactIdOrEmpty(request.runId),
    cleanupStatus: "partial",
    failureReason: "cleanup-failed"
  };
}

function retained(roomId: string, runId: string, reason: string): SiteTestCleanupResult {
  return { deleted: false, retainedReason: reason, roomId, runId, cleanupStatus: "retained", failureReason: null };
}

function partial(roomId: string, runId: string, reason: string): SiteTestCleanupResult {
  return { deleted: false, retainedReason: null, roomId, runId, cleanupStatus: "partial", failureReason: reason };
}

async function main(): Promise<void> {
  const [roomId, runId] = process.argv.slice(2);
  const request: SiteTestCleanupRequest = {
    roomId,
    runId,
    cleanupAllowed: process.env.SITE_TEST_CLEANUP_ALLOWED
  };
  let redisClient: Awaited<ReturnType<typeof createProductionDependencies>>["redisClient"] | undefined;
  let disconnectPrisma: (() => Promise<void>) | undefined;
  let result: SiteTestCleanupResult;

  try {
    const production = await createProductionDependencies();
    redisClient = production.redisClient;
    disconnectPrisma = production.disconnectPrisma;
    result = await cleanupSiteTestRoom(request, production.dependencies);
  } catch {
    result = failureResult(request);
  } finally {
    redisClient?.disconnect();
    await disconnectPrisma?.().catch(() => undefined);
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function createProductionDependencies() {
  const [redisModule, repositoryModule, dbModule] = await Promise.all([
    import("./redis"),
    import("./repositories/room-repository"),
    import("./db")
  ]);
  const redisClient = redisModule.createRedisClient();
  redisClient.on("error", () => undefined);

  return {
    redisClient,
    disconnectPrisma: () => dbModule.prisma.$disconnect(),
    dependencies: {
      redis: {
        get: (key: string) => redisClient.get(key),
        set: (key: string, value: string, mode: "EX", ttlSeconds: number, condition: "NX") =>
          redisClient.set(key, value, mode, ttlSeconds, condition),
        compareAndDelete: async (key: string, expectedRawState: string) =>
          Number(await redisClient.eval(
            "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
            1,
            key,
            expectedRawState
          )) === 1,
        snapshotAndDelete: async (key: string) => {
          const result = await redisClient.eval(
            "local v=redis.call('GET',KEYS[1]); local t=redis.call('TTL',KEYS[1]); if v then redis.call('DEL',KEYS[1]); end; return {v,t}",
            1,
            key
          );
          if (!Array.isArray(result) || result.length !== 2) {
            throw new Error("Redis snapshot/delete returned an invalid result");
          }
          return {
            rawState: typeof result[0] === "string" ? result[0] : null,
            ttlSeconds: Number(result[1])
          };
        }
      },
      repository: new repositoryModule.RoomRepository()
    }
  };
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && pathToFileURL(resolve(entryPath)).href === import.meta.url;
}

if (isDirectExecution()) {
  void main();
}
