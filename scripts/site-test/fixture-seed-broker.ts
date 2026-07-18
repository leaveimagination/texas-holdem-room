import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

import { PrismaClient } from "@prisma/client";
import { z } from "zod";

import type { RoomState } from "@/lib/poker/engine";
import { buildFourPlayerAllInFixture, buildNormalBettingFixture, buildSidePotFixture, buildSplitPotFixture, buildTopUpAccountingFixture } from "../../tests/experience/fixtures/builders";
import {
  createFixtureTargetEnvironment,
  FixtureRuntime
} from "../../tests/experience/fixtures/runtime";
import type { DockerSiteTestStackSnapshot } from "./docker-stack";

const REQUEST_TTL_MS = 30_000;
const FUTURE_SKEW_MS = 5_000;
const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_OPERATION_TIMEOUT_MS = 5_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;
const CLOSE_GRACE_MS = 10;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const idsFor = <T extends readonly [string, ...string[]]>(roles: T) => z.object(
  Object.fromEntries(roles.map((role) => [role, z.string().min(1).max(128)])) as { [K in T[number]]: z.ZodString }
).strict();
const FixtureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("normal-betting"), participantIds: idsFor(["button", "small", "big"]) }).strict(),
  z.object({ kind: z.literal("four-player-all-in"), participantIds: idsFor(["aces", "kings", "queens", "jacks"]) }).strict(),
  z.object({ kind: z.literal("side-pot"), participantIds: idsFor(["aces", "kings", "queens", "jacks"]) }).strict(),
  z.object({ kind: z.literal("split-pot"), participantIds: idsFor(["left", "right"]) }).strict(),
  z.object({ kind: z.literal("top-up-accounting"), participantIds: idsFor(["target", "opponent"]) }).strict()
]);

const SeedRequestSchema = z.object({
  runId: z.string().min(1).max(64),
  roomId: z.string().regex(ROOM_ID_PATTERN),
  requestId: z.string().regex(REQUEST_ID_PATTERN),
  issuedAt: z.string().datetime({ offset: true }),
  fixture: FixtureSchema
}).strict();

type SeedRequest = z.infer<typeof SeedRequestSchema>;

export interface FixtureSeedBrokerClient {
  endpoint: string;
  authorizationToken: string;
}

export interface FixtureSeedBrokerHandle extends FixtureSeedBrokerClient {
  close(control?: FixtureSeedBrokerControl): Promise<void>;
}

export interface FixtureSeedBrokerControl {
  signal: AbortSignal;
  timeoutMs: number;
}

interface OwnedRoomParticipant {
  id: string;
  displayName: string;
}

interface OwnedRoom {
  id: string;
  createdAt: Date;
  endedAt: Date | null;
  participants: readonly OwnedRoomParticipant[];
}

interface FixtureSeedBrokerDependencies {
  readOwnedRoom(roomId: string, control?: FixtureSeedBrokerControl): Promise<OwnedRoom | null>;
  readLiveRoom(roomId: string, control?: FixtureSeedBrokerControl): Promise<RoomState | null>;
  seedNormalBetting(
    roomId: string,
    participantIds: Extract<SeedRequest["fixture"], { kind: "normal-betting" }>["participantIds"],
    control?: FixtureSeedBrokerControl
  ): Promise<RoomState>;
  seedFixture?(roomId: string, fixture: SeedRequest["fixture"], control?: FixtureSeedBrokerControl): Promise<RoomState>;
  close(): Promise<void>;
}

export interface StartFixtureSeedBrokerInput {
  snapshot: DockerSiteTestStackSnapshot;
  databaseUrl: string;
  runId: string;
  runStartedAt: string;
  now?: () => number;
  requestTtlMs?: number;
  operationTimeoutMs?: number;
  dependencies?: FixtureSeedBrokerDependencies;
  onListening?: (address: AddressInfo) => void;
}

export async function startFixtureSeedBroker(
  input: StartFixtureSeedBrokerInput,
  control: FixtureSeedBrokerControl = defaultControl(DEFAULT_CLOSE_TIMEOUT_MS)
): Promise<FixtureSeedBrokerHandle> {
  const target = createFixtureTargetEnvironment(input.snapshot);
  if (target.runId !== input.runId) {
    throw new Error(`Fixture seed broker run ${input.runId} does not match verified target ${target.runId}`);
  }
  const runStartedAtMs = Date.parse(input.runStartedAt);
  if (!Number.isFinite(runStartedAtMs)) {
    throw new Error("Fixture seed broker requires a valid run start time");
  }
  const dependencies = input.dependencies ?? defaultDependencies(target, input.databaseUrl);
  if (control.signal.aborted) {
    await closeDependenciesWithinBudget(dependencies, control.timeoutMs).catch(() => undefined);
    throw abortReason(control.signal);
  }
  const now = input.now ?? Date.now;
  const requestTtlMs = input.requestTtlMs ?? REQUEST_TTL_MS;
  const operationTimeoutMs = input.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  const tokenBytes = randomBytes(32);
  const authorizationToken = tokenBytes.toString("base64url");
  const consumedRequestIds = new Set<string>();
  let fullyClosed = false;
  let closing = false;
  let closeAttempt: Promise<void> | undefined;
  const activeRequestControllers = new Set<AbortController>();
  const activeSockets = new Set<Socket>();

  const server = createServer((request, response) => {
    const requestController = new AbortController();
    activeRequestControllers.add(requestController);
    request.once("aborted", () => requestController.abort(new Error("Fixture broker client disconnected")));
    void handleRequest(request, response, {
      authorizationToken,
      consumedRequestIds,
      dependencies,
      signal: requestController.signal,
      operationTimeoutMs,
      isClosing: () => closing,
      now,
      requestTtlMs,
      runId: input.runId,
      runStartedAtMs
    }).finally(() => activeRequestControllers.delete(requestController));
  });
  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.once("close", () => activeSockets.delete(socket));
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  try {
    await listenLoopback(server, control.signal);
    input.onListening?.(server.address() as AddressInfo);
    control.signal.throwIfAborted();
  } catch (error) {
    closing = true;
    abortRequests(activeRequestControllers, error);
    try {
      await closeServerWithinBudget(
        server,
        activeSockets,
        activeRequestControllers,
        0,
        Math.max(1, control.timeoutMs)
      );
    } catch {
      // The original startup failure remains authoritative; force close below.
    } finally {
      forceCloseServer(server, activeSockets);
    }
    tokenBytes.fill(0);
    await closeDependenciesWithinBudget(dependencies, control.timeoutMs).catch(() => undefined);
    throw error;
  }
  const address = server.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/seed`,
    authorizationToken,
    async close(closeControl = defaultControl(DEFAULT_CLOSE_TIMEOUT_MS)) {
      if (fullyClosed) return;
      if (closeAttempt !== undefined) return await closeAttempt;
      const attempt = closeBroker({
        server,
        sockets: activeSockets,
        activeRequestControllers,
        dependencies,
        control: closeControl,
        onClosing: () => {
          closing = true;
        }
      }).then(() => {
        consumedRequestIds.clear();
        tokenBytes.fill(0);
        fullyClosed = true;
      }).finally(() => {
        if (!fullyClosed) closeAttempt = undefined;
      });
      closeAttempt = attempt;
      return await attempt;
    }
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: {
    authorizationToken: string;
    consumedRequestIds: Set<string>;
    dependencies: FixtureSeedBrokerDependencies;
    signal: AbortSignal;
    operationTimeoutMs: number;
    isClosing(): boolean;
    now(): number;
    requestTtlMs: number;
    runId: string;
    runStartedAtMs: number;
  }
): Promise<void> {
  try {
    if (context.isClosing()) {
      return json(response, 503, { error: "fixture seed broker is closing" });
    }
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      return json(response, 403, { error: "loopback clients only" });
    }
    if (request.method !== "POST" || request.url !== "/v1/seed") {
      return json(response, 404, { error: "unknown broker operation" });
    }
    if (!authorized(request.headers.authorization, context.authorizationToken)) {
      return json(response, 401, { error: "invalid broker authorization" });
    }
    const parsed = SeedRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return json(response, 400, { error: "invalid constrained fixture request" });
    }
    const seedRequest = parsed.data;
    if (seedRequest.runId !== context.runId) {
      return json(response, 403, { error: "fixture request belongs to a different run" });
    }
    const issuedAtMs = Date.parse(seedRequest.issuedAt);
    const ageMs = context.now() - issuedAtMs;
    if (!Number.isFinite(issuedAtMs) || ageMs > context.requestTtlMs || ageMs < -FUTURE_SKEW_MS) {
      return json(response, 410, { error: "fixture request is expired or not yet valid" });
    }
    if (context.consumedRequestIds.has(seedRequest.requestId)) {
      return json(response, 409, { error: "fixture request was already consumed" });
    }
    context.consumedRequestIds.add(seedRequest.requestId);

    const ownedRoom = await runDependencyOperation(
      context.signal,
      context.operationTimeoutMs,
      async (operationControl) =>
        await context.dependencies.readOwnedRoom(seedRequest.roomId, operationControl)
    );
    const liveRoom = await runDependencyOperation(
      context.signal,
      context.operationTimeoutMs,
      async (operationControl) =>
        await context.dependencies.readLiveRoom(seedRequest.roomId, operationControl)
    );
    if (!isOwnedRoom(ownedRoom, liveRoom, seedRequest, context.runStartedAtMs)) {
      return json(response, 403, { error: "fixture request does not own the exact isolated room" });
    }

    const seeded = await runDependencyOperation(
      context.signal,
      context.operationTimeoutMs,
      async (operationControl) => seedRequest.fixture.kind === "normal-betting"
        ? await context.dependencies.seedNormalBetting(seedRequest.roomId, seedRequest.fixture.participantIds, operationControl)
        : await requiredSeedFixture(context.dependencies)(seedRequest.roomId, seedRequest.fixture, operationControl)
    );
    return json(response, 200, {
      ok: true,
      roomId: seedRequest.roomId,
      fixtureId: seedRequest.fixture.kind,
      handNumber: seeded.hand?.number ?? null
    });
  } catch {
    return json(response, 500, { error: "fixture seed operation failed" });
  }
}

function defaultDependencies(
  target: ReturnType<typeof createFixtureTargetEnvironment>,
  databaseUrl: string
): FixtureSeedBrokerDependencies {
  const prisma = new PrismaClient({ datasourceUrl: boundedPostgresUrl(databaseUrl) });
  const runtime = new FixtureRuntime({ targetEnvironment: target });
  return {
    async readOwnedRoom(roomId, control) {
      return await withOperationDeadline(prisma.room.findUnique({
        where: { id: roomId },
        select: {
          id: true,
          createdAt: true,
          endedAt: true,
          participants: { select: { id: true, displayName: true } }
        }
      }), control ?? defaultControl(DEFAULT_OPERATION_TIMEOUT_MS));
    },
    async readLiveRoom(roomId, control) {
      return await runtime.readRoom(roomId, control);
    },
    async seedNormalBetting(roomId, participantIds, control) {
      return await runtime.seedRoom(
        roomId,
        buildNormalBettingFixture({ runId: target.runId, participantIds: participantIds as { button: string; small: string; big: string } }),
        control
      );
    },
    async seedFixture(roomId, fixture, control) {
      const built = fixture.kind === "four-player-all-in"
        ? buildFourPlayerAllInFixture({ runId: target.runId, participantIds: fixture.participantIds as { aces: string; kings: string; queens: string; jacks: string } })
        : fixture.kind === "side-pot"
          ? buildSidePotFixture({ runId: target.runId, participantIds: fixture.participantIds as { aces: string; kings: string; queens: string; jacks: string } })
          : fixture.kind === "split-pot"
            ? buildSplitPotFixture({ runId: target.runId, participantIds: fixture.participantIds as { left: string; right: string } })
            : buildTopUpAccountingFixture({ runId: target.runId, participantIds: fixture.participantIds as { target: string; opponent: string } });
      return await runtime.seedRoom(roomId, built as never, control);
    },
    async close() {
      await prisma.$disconnect();
    }
  };
}

function isOwnedRoom(
  ownedRoom: OwnedRoom | null,
  liveRoom: RoomState | null,
  request: SeedRequest,
  runStartedAtMs: number
): boolean {
  if (
    !ownedRoom ||
    !liveRoom ||
    ownedRoom.id !== request.roomId ||
    liveRoom.roomId !== request.roomId ||
    ownedRoom.endedAt !== null ||
    ownedRoom.createdAt.getTime() < runStartedAtMs - FUTURE_SKEW_MS ||
    liveRoom.status !== "lobby" ||
    liveRoom.settings.seats !== Object.keys(request.fixture.participantIds).length
  ) {
    return false;
  }
  const requestedIds = Object.values(request.fixture.participantIds);
  const roles = Object.keys(request.fixture.participantIds);
  if (new Set(requestedIds).size !== roles.length) return false;
  const participants = new Map(ownedRoom.participants.map((participant) => [participant.id, participant]));
  return roles.every((role) => {
    const participant = participants.get(request.fixture.participantIds[role as keyof typeof request.fixture.participantIds]);
    return participant?.displayName === `SITE-${request.runId}-${role}`;
  });
}

function requiredSeedFixture(dependencies: FixtureSeedBrokerDependencies): NonNullable<FixtureSeedBrokerDependencies["seedFixture"]> {
  if (!dependencies.seedFixture) throw new Error("Fixture seed dependency is unavailable");
  return dependencies.seedFixture;
}

function authorized(value: string | undefined, expectedToken: string): boolean {
  if (!value?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(value.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("fixture request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: object): void {
  if (response.writableEnded) return;
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function isLoopbackAddress(value: string | undefined): boolean {
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}

async function listenLoopback(server: Server, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      signal.removeEventListener("abort", onAbort);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      server.off("error", onError);
      server.off("listening", onListening);
      reject(abortReason(signal));
    };
    server.once("error", onError);
    server.once("listening", onListening);
    signal.addEventListener("abort", onAbort, { once: true });
    server.listen(0, "127.0.0.1");
  });
}

async function closeBroker(input: {
  server: Server;
  sockets: Set<Socket>;
  activeRequestControllers: Set<AbortController>;
  dependencies: FixtureSeedBrokerDependencies;
  control: FixtureSeedBrokerControl;
  onClosing(): void;
}): Promise<void> {
  input.onClosing();
  const startedAt = Date.now();
  const remainingMs = () => Math.max(1, input.control.timeoutMs - (Date.now() - startedAt));
  const force = () => {
    abortRequests(input.activeRequestControllers, abortReason(input.control.signal));
    forceCloseServer(input.server, input.sockets);
  };
  input.control.signal.addEventListener("abort", force, { once: true });
  if (input.control.signal.aborted) force();
  try {
    await closeServerWithinBudget(
      input.server,
      input.sockets,
      input.activeRequestControllers,
      Math.min(CLOSE_GRACE_MS, remainingMs()),
      remainingMs()
    );
    await closeDependenciesWithinBudget(input.dependencies, remainingMs());
  } finally {
    input.control.signal.removeEventListener("abort", force);
    force();
  }
}

async function closeServerWithinBudget(
  server: Server,
  sockets: Set<Socket>,
  activeRequestControllers: Set<AbortController>,
  graceMs: number,
  timeoutMs: number
): Promise<void> {
  let closeError: Error | undefined;
  const closed = new Promise<void>((resolve) => {
    server.close((error) => {
      closeError = error ?? undefined;
      resolve();
    });
    server.closeIdleConnections?.();
  });
  const graceful = await settlesWithin(closed, graceMs);
  if (!graceful) {
    abortRequests(activeRequestControllers, new Error("Fixture seed broker is closing"));
    forceCloseServer(server, sockets);
  }
  await withinTimeout(closed, timeoutMs, "Fixture seed broker server cleanup timed out");
  if (closeError !== undefined && (closeError as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
    throw closeError;
  }
}

function forceCloseServer(server: Server, sockets: Set<Socket>): void {
  server.closeAllConnections?.();
  for (const socket of sockets) socket.destroy();
}

function abortRequests(controllers: Set<AbortController>, reason: unknown): void {
  for (const controller of controllers) controller.abort(reason);
}

async function closeDependenciesWithinBudget(
  dependencies: FixtureSeedBrokerDependencies,
  timeoutMs: number
): Promise<void> {
  await withinTimeout(
    Promise.resolve().then(async () => await dependencies.close()),
    Math.max(1, timeoutMs),
    "Fixture seed broker dependency cleanup timed out"
  );
}

async function withOperationDeadline<T>(
  operation: Promise<T>,
  control: FixtureSeedBrokerControl
): Promise<T> {
  if (control.signal.aborted) throw abortReason(control.signal);
  let rejectOnAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => reject(abortReason(control.signal));
    control.signal.addEventListener("abort", rejectOnAbort, { once: true });
  });
  try {
    return await withinTimeout(
      Promise.race([operation, aborted]),
      control.timeoutMs,
      "Fixture seed broker dependency operation timed out"
    );
  } finally {
    if (rejectOnAbort !== undefined) {
      control.signal.removeEventListener("abort", rejectOnAbort);
    }
    void operation.catch(() => undefined);
  }
}

async function runDependencyOperation<T>(
  parentSignal: AbortSignal,
  timeoutMs: number,
  operation: (control: FixtureSeedBrokerControl) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const propagateAbort = () => controller.abort(abortReason(parentSignal));
  parentSignal.addEventListener("abort", propagateAbort, { once: true });
  if (parentSignal.aborted) propagateAbort();
  const timer = setTimeout(
    () => controller.abort(new Error("Fixture seed broker dependency operation timed out")),
    Math.max(1, timeoutMs)
  );
  timer.unref?.();
  const control = { signal: controller.signal, timeoutMs };
  try {
    return await withOperationDeadline(
      Promise.resolve().then(async () => await operation(control)),
      control
    );
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", propagateAbort);
  }
}

async function withinTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs));
    timer.unref?.();
  });
  try {
    return await Promise.race([operation, timedOut]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function settlesWithin(operation: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function defaultControl(timeoutMs: number): FixtureSeedBrokerControl {
  return { signal: new AbortController().signal, timeoutMs };
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Fixture seed broker operation aborted");
}

function boundedPostgresUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "5");
  if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "5");
  if (!url.searchParams.has("socket_timeout")) url.searchParams.set("socket_timeout", "5");
  return url.toString();
}
