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
  redis: Pick<KeyValueStore, "del">;
  repository: Pick<RoomRepository, "hasRunMarkerParticipant" | "deleteExactRoom">;
}

export interface SiteTestCleanupResult {
  deleted: boolean;
  retainedReason: string | null;
  roomId: string;
  runId: string;
}

export async function cleanupSiteTestRoom(
  request: SiteTestCleanupRequest,
  dependencies: SiteTestCleanupDependencies
): Promise<SiteTestCleanupResult> {
  const roomId = exactIdOrEmpty(request.roomId);
  const runId = exactIdOrEmpty(request.runId);
  const retainedReason = invalidRequestReason(request);

  if (retainedReason) {
    return { deleted: false, retainedReason, roomId, runId };
  }

  if (!(await dependencies.repository.hasRunMarkerParticipant(roomId, runId))) {
    return {
      deleted: false,
      retainedReason: "ownership-marker-not-found",
      roomId,
      runId
    };
  }

  await dependencies.redis.del(`room:${roomId}`);
  await dependencies.repository.deleteExactRoom(roomId);

  return { deleted: true, retainedReason: null, roomId, runId };
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
    retainedReason: "cleanup-failed",
    roomId: exactIdOrEmpty(request.roomId),
    runId: exactIdOrEmpty(request.runId)
  };
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
  const [redisModule, adapterModule, repositoryModule, dbModule] = await Promise.all([
    import("./redis"),
    import("./redis-key-value-store"),
    import("./repositories/room-repository"),
    import("./db")
  ]);
  const redisClient = redisModule.createRedisClient();
  redisClient.on("error", () => undefined);

  return {
    redisClient,
    disconnectPrisma: () => dbModule.prisma.$disconnect(),
    dependencies: {
      redis: adapterModule.createRedisKeyValueStore(redisClient),
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
