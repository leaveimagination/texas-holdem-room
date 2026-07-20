import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import WebSocket from "ws";
import { parseCard } from "@/lib/poker/cards";
import {
  applyPlayerAction,
  advanceDuePhase,
  createInitialRoomState,
  startHand,
  type RoomState
} from "@/lib/poker/engine";
import { LiveRoomStore, type KeyValueStore } from "@/server/live-room-store";
import { RoomCommandCoordinator } from "@/server/room-command-coordinator";
import {
  createGameServer,
  handleGameServerUpgrade,
  type GameServerOptions,
  type RealtimeAuth
} from "@/server/realtime/game-server";

const roomId = "flow-room";
const fixedDeck = "As Ah Kd Kh Qs Qh Jd Jh Tc Td 9s 9h 8d 8h 7s 7h 6d 6h 5s 5h 4d 4h 3s 3h 2d 2h Ac Ad Kc Ks Qc Qd Jc Js Ts Th 9c 9d 8c 8s 7c 7d 6c 6s 5c 5d 4c 4s 3c 3d 2c 2s"
  .split(" ")
  .map(parseCard);
const socketsToClose = new Set<WebSocket>();
const serversToClose = new Set<HttpServer>();

class MemoryStore implements KeyValueStore {
  readonly values = new Map<string, string>();
  failNextSet = false;
  setCount = 0;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error("redis unavailable");
    }
    this.setCount += 1;
    this.values.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class ManualTimers {
  now = 0;
  private readonly entries: Array<{ callback: () => void; delay: number; cleared: boolean }> = [];

  readonly setTimer = (callback: () => void, delay: number): object => {
    const entry = { callback, delay, cleared: false };
    this.entries.push(entry);
    return entry;
  };

  readonly clearTimer = (handle: unknown): void => {
    const entry = handle as { cleared?: boolean };
    entry.cleared = true;
  };

  async runNext(): Promise<void> {
    const entry = this.entries.find((candidate) => !candidate.cleared);
    if (!entry) {
      throw new Error("No active timer");
    }
    entry.cleared = true;
    this.now += entry.delay;
    entry.callback();
    await flushAsyncWork();
  }

  peekNextCallback(): () => void {
    const entry = this.entries.find((candidate) => !candidate.cleared);
    if (!entry) {
      throw new Error("No active timer");
    }
    return entry.callback;
  }
}

const auth: RealtimeAuth = {
  async verifyParticipantToken(roomIdToVerify, token) {
    if (roomIdToVerify !== roomId) {
      return null;
    }
    return new Map([
      ["p1-token", "p1"],
      ["p2-token", "p2"]
    ]).get(token) ?? null;
  },
  async verifyHostToken(roomIdToVerify, token) {
    return roomIdToVerify === roomId && token === "host-token";
  }
};

describe("authoritative realtime room flow", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([...socketsToClose].map(closeSocket));
    socketsToClose.clear();
    await Promise.all([...serversToClose].map(closeServer));
    serversToClose.clear();
  });

  it("advances the installed room timer under a fake server clock", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createReadyRoom());
    const { url } = await startTestServer(liveRooms, repositoryMocks(), { now: () => Date.now() });
    const p1 = connect(url);
    const p2 = connect(url);
    await Promise.all([waitForOpen(p1), waitForOpen(p2)]);
    await join(p1, "p1-token", "P1");
    await join(p2, "p2-token", "P2");

    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const started = nextTypedMessage(p1, "hand_started");
      p1.send(JSON.stringify({ type: "start_room", roomId, hostToken: "host-token" }));
      await started;
      const firstAction = nextTypedMessage(p1, "action_recorded");
      p1.send(JSON.stringify({
        type: "player_action",
        roomId,
        participantToken: "p1-token",
        action: { type: "all-in", playerId: "p1" }
      }));
      await firstAction;
      const showdown = nextTypedMessage(p1, "showdown_started");
      p2.send(JSON.stringify({
        type: "player_action",
        roomId,
        participantToken: "p2-token",
        action: { type: "call", playerId: "p2" }
      }));
      await showdown;

      const runout = nextTypedMessage(p1, "runout_card_revealed", 10_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(runout).resolves.toMatchObject({ payload: { street: "flop", cardIndex: 0 } });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("emits timed showdown/runout events, queues cumulative top-ups, and accepts a final-hand request", async () => {
    const memory = new MemoryStore();
    const liveRooms = new LiveRoomStore(memory);
    await liveRooms.saveRoom(createReadyRoom());
    const timers = new ManualTimers();
    const repository = repositoryMocks();
    const { url } = await startTestServer(liveRooms, repository, {
      now: () => timers.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });
    const p1 = connect(url);
    const p2 = connect(url);
    await Promise.all([waitForOpen(p1), waitForOpen(p2)]);
    await join(p1, "p1-token", "P1");
    await join(p2, "p2-token", "P2");

    const started = nextTypedMessage(p1, "hand_started");
    p1.send(JSON.stringify({ type: "start_room", roomId, hostToken: "host-token" }));
    await expect(started).resolves.toMatchObject({ payload: { handNumber: 1 } });

    const firstAction = nextTypedMessage(p1, "action_recorded");
    p1.send(JSON.stringify({
      type: "player_action",
      roomId,
      participantToken: "p1-token",
      action: { type: "all-in", playerId: "p1" }
    }));
    await firstAction;

    const showdown = nextTypedMessage(p1, "showdown_started");
    p2.send(JSON.stringify({
      type: "player_action",
      roomId,
      participantToken: "p2-token",
      action: { type: "call", playerId: "p2" }
    }));
    await expect(showdown).resolves.toMatchObject({
      payload: { handNumber: 1, phaseSequence: 1, deadline: 2_000, revealedParticipantIds: ["p1", "p2"] }
    });
    expect((await liveRooms.getRoom(roomId))?.hand?.board).toHaveLength(0);
    expect(repository.recordHand).not.toHaveBeenCalled();

    const blocked = nextTypedMessage(p1, "error");
    p1.send(JSON.stringify({
      type: "player_action",
      roomId,
      participantToken: "p1-token",
      action: { type: "fold", playerId: "p1" }
    }));
    await expect(blocked).resolves.toMatchObject({ payload: { code: "PRESENTATION_IN_PROGRESS" } });

    const firstFlopCard = nextTypedMessage(p1, "runout_card_revealed");
    await timers.runNext();
    await expect(firstFlopCard).resolves.toMatchObject({
      payload: { handNumber: 1, phaseSequence: 2, street: "flop", cardIndex: 0, deadline: 3_000 }
    });
    expect((await liveRooms.getRoom(roomId))?.hand?.board).toHaveLength(1);

    const queued500 = nextTypedMessage(p2, "top_up_queued");
    p1.send(JSON.stringify({ type: "rebuy", roomId, participantToken: "p1-token", amount: 500 }));
    await expect(queued500).resolves.toMatchObject({ payload: { submittedAmount: 500, pendingTotal: 500, targetHandNumber: 2 } });

    const queued300 = nextTypedMessage(p2, "top_up_queued");
    p1.send(JSON.stringify({ type: "rebuy", roomId, participantToken: "p1-token", amount: 300 }));
    await expect(queued300).resolves.toMatchObject({ payload: { submittedAmount: 300, pendingTotal: 800, targetHandNumber: 2 } });

    const ending = nextTypedMessage(p2, "room_end_requested");
    p1.send(JSON.stringify({ type: "end_room", roomId, hostToken: "host-token" }));
    await expect(ending).resolves.toMatchObject({ payload: { finalHandNumber: 1 } });
    expect(repository.recordTopUp).not.toHaveBeenCalled();

    const finished = nextTypedMessage(p2, "room_finished");
    for (let transition = 0; transition < 6; transition += 1) {
      await timers.runNext();
    }
    await expect(finished).resolves.toMatchObject({ payload: { players: expect.any(Array) } });
    expect(repository.recordHand).toHaveBeenCalledOnce();
    expect(repository.finishRoom).toHaveBeenCalledOnce();
    expect(repository.recordTopUp).not.toHaveBeenCalled();
    expect(await liveRooms.getRoom(roomId)).toMatchObject({
      status: "finished",
      pendingTopUps: {},
      flow: { phase: "session-summary" }
    });
  });

  it("catches up an overdue all-in before sending a reconnect snapshot", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createAllInRoom());
    const repository = repositoryMocks();
    const { url } = await startTestServer(liveRooms, repository, { now: () => 10_000 });
    const socket = connect(url);
    await waitForOpen(socket);

    const snapshot = nextTypedMessage(socket, "room_snapshot");
    socket.send(JSON.stringify({ type: "join_room", roomId, participantToken: "p1-token", displayName: "P1" }));

    await expect(snapshot).resolves.toMatchObject({ payload: { hand: { board: expect.any(Array), finished: true } } });
    expect((await liveRooms.getRoom(roomId))?.hand?.board).toHaveLength(5);
    expect(repository.recordHand).toHaveBeenCalledOnce();
  });

  it("does not broadcast or mutate live state when saving a transition fails", async () => {
    const memory = new MemoryStore();
    const liveRooms = new LiveRoomStore(memory);
    await liveRooms.saveRoom(createReadyRoom());
    const { url } = await startTestServer(liveRooms, repositoryMocks());
    const socket = connect(url);
    await waitForOpen(socket);
    await join(socket, "p1-token", "P1");
    const started = nextTypedMessage(socket, "hand_started");
    socket.send(JSON.stringify({ type: "start_room", roomId, hostToken: "host-token" }));
    await started;

    memory.failNextSet = true;
    const failure = nextTypedMessage(socket, "error");
    socket.send(JSON.stringify({
      type: "player_action",
      roomId,
      participantToken: "p1-token",
      action: { type: "fold", playerId: "p1" }
    }));

    await expect(failure).resolves.toMatchObject({ payload: { code: "SERVER_BUSY" } });
    expect((await liveRooms.getRoom(roomId))?.hand?.actions).toEqual([]);
  });

  it("keeps the room at its final hand when durable session finalization fails", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    const summaryRoom = createFinishedSummaryRoom();
    await liveRooms.saveRoom(summaryRoom);
    const repository = repositoryMocks();
    repository.finishRoom.mockRejectedValueOnce(new Error("postgres unavailable"));
    const { url } = await startTestServer(liveRooms, repository, { now: () => 1_000 });
    const socket = connect(url);
    await waitForOpen(socket);

    const failure = nextTypedMessage(socket, "error");
    socket.send(JSON.stringify({ type: "end_room", roomId, hostToken: "host-token" }));
    await expect(failure).resolves.toMatchObject({ payload: { code: "SERVER_BUSY" } });

    const saved = await liveRooms.getRoom(roomId);
    expect(saved?.status).toBe("playing");
    expect(saved?.flow.phase).toBe("hand-summary");
    expect(saved?.sessionSummary).toBeNull();
  });

  it("leaves a waiting hand and queued chips unchanged when top-up persistence fails", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createWaitingBustedRoom());
    const repository = repositoryMocks();
    repository.recordTopUp.mockRejectedValueOnce(new Error("postgres unavailable"));
    const { url } = await startTestServer(liveRooms, repository);
    const socket = connect(url);
    await waitForOpen(socket);
    await join(socket, "p2-token", "P2");

    const failure = nextTypedMessage(socket, "error");
    socket.send(JSON.stringify({ type: "rebuy", roomId, participantToken: "p2-token", amount: 1_000 }));
    await expect(failure).resolves.toMatchObject({ payload: { code: "SERVER_BUSY" } });

    expect(await liveRooms.getRoom(roomId)).toMatchObject({
      hand: { number: 1, finished: true },
      pendingTopUps: {},
      seats: [expect.objectContaining({ participantId: "p1", chips: 2_000 }), expect.objectContaining({ participantId: "p2", chips: 0 })]
    });
  });

  it("ignores a stale timer callback after a newer flow sequence is saved", async () => {
    const memory = new MemoryStore();
    const liveRooms = new LiveRoomStore(memory);
    const locked = createAllInRoom();
    await liveRooms.saveRoom(locked);
    const timers = new ManualTimers();
    const repository = repositoryMocks();
    const { url } = await startTestServer(liveRooms, repository, {
      now: () => timers.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer
    });
    const socket = connect(url);
    await waitForOpen(socket);
    await join(socket, "p1-token", "P1");
    const staleCallback = timers.peekNextCallback();

    timers.now = 2_000;
    const newer = advanceDuePhase(locked, timers.now);
    await liveRooms.saveRoom(newer);
    const setsBeforeStaleCallback = memory.setCount;
    staleCallback();
    await flushAsyncWork();

    expect(memory.setCount).toBe(setsBeforeStaleCallback);
    expect((await liveRooms.getRoom(roomId))?.flow.sequence).toBe(newer.flow.sequence);
    expect(repository.recordHand).not.toHaveBeenCalled();
  });

  it("uses the bounded coordinator and a 16 KiB websocket payload limit", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createReadyRoom());
    const server = createServer();
    const gameServer = createGameServer({
      server,
      liveRooms,
      auth,
      roomRepository: repositoryMocks(),
      coordinator: new RoomCommandCoordinator(0)
    });
    expect(gameServer.options.maxPayload).toBe(16 * 1024);
    attachUpgrade(server, gameServer);
    const url = await listen(server);
    const socket = connect(url);
    await waitForOpen(socket);

    const busy = nextTypedMessage(socket, "error");
    socket.send(JSON.stringify({ type: "join_room", roomId, participantToken: "p1-token", displayName: "P1" }));
    await expect(busy).resolves.toMatchObject({ payload: { code: "SERVER_BUSY" } });
  });
});

function createReadyRoom(): RoomState {
  const room = createInitialRoomState(
    { mode: "cash", seats: 2, initialChips: 1_000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    roomId
  );
  return {
    ...room,
    seats: room.seats.map((seat, index) => ({
      ...seat,
      participantId: `p${index + 1}`,
      displayName: `P${index + 1}`,
      chips: 1_000,
      cumulativeBuyIn: 1_000,
      status: "ready"
    }))
  };
}

function createAllInRoom(): RoomState {
  const started = startHand(createReadyRoom(), fixedDeck, 0);
  const shoved = applyPlayerAction(started, { type: "all-in", playerId: started.hand!.actorId }, 0);
  return applyPlayerAction(shoved, { type: "call", playerId: shoved.hand!.actorId }, 0);
}

function createFinishedSummaryRoom(): RoomState {
  const started = startHand(createReadyRoom(), fixedDeck, 0);
  return applyPlayerAction(started, { type: "fold", playerId: started.hand!.actorId }, 0);
}

function createWaitingBustedRoom(): RoomState {
  const finished = createFinishedSummaryRoom();
  return {
    ...finished,
    seats: finished.seats.map((seat) => seat.participantId === "p1"
      ? { ...seat, chips: 2_000, status: "active" as const }
      : { ...seat, chips: 0, status: "eliminated" as const }),
    flow: {
      phase: "betting",
      sequence: finished.flow.sequence + 1,
      deadlineAt: null,
      nextRunoutStep: null,
      handResult: null
    }
  };
}

function repositoryMocks() {
  return {
    recordHand: vi.fn().mockResolvedValue(undefined),
    recordBuyIn: vi.fn().mockResolvedValue(undefined),
    recordTopUp: vi.fn().mockResolvedValue(undefined),
    finishRoom: vi.fn().mockResolvedValue(undefined),
    kickParticipant: vi.fn().mockResolvedValue(true)
  };
}

async function startTestServer(
  liveRooms: LiveRoomStore,
  roomRepository: ReturnType<typeof repositoryMocks>,
  overrides: Partial<GameServerOptions> = {}
): Promise<{ url: string }> {
  const server = createServer();
  const gameServer = createGameServer({ server, liveRooms, auth, roomRepository, ...overrides });
  attachUpgrade(server, gameServer);
  return { url: await listen(server) };
}

function attachUpgrade(server: HttpServer, gameServer: ReturnType<typeof createGameServer>): void {
  server.on("upgrade", (request, socket, head) => {
    if (!handleGameServerUpgrade(gameServer, request, socket, head)) {
      socket.destroy();
    }
  });
}

async function listen(server: HttpServer): Promise<string> {
  serversToClose.add(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected test server address");
  }
  return `ws://127.0.0.1:${address.port}/ws`;
}

function connect(url: string): WebSocket {
  const socket = new WebSocket(url);
  socketsToClose.add(socket);
  return socket;
}

async function join(socket: WebSocket, token: string, displayName: string): Promise<void> {
  const snapshot = nextTypedMessage(socket, "room_snapshot");
  socket.send(JSON.stringify({ type: "join_room", roomId, participantToken: token, displayName }));
  await snapshot;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return socket.readyState === WebSocket.OPEN
    ? Promise.resolve()
    : new Promise((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
}

function nextTypedMessage(
  socket: WebSocket,
  type: string,
  timeoutMs = 2_000
): Promise<{ type: string; payload: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as { type?: string; payload?: Record<string, unknown> };
      if (message.type !== type || !message.payload) {
        return;
      }
      cleanup();
      resolve({ type, payload: message.payload });
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
