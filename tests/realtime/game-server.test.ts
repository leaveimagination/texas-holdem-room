import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import WebSocket from "ws";
import { createInitialRoomState, type RoomState } from "@/lib/poker/engine";
import { LiveRoomStore, type KeyValueStore } from "@/server/live-room-store";
import { createGameServer, handleGameServerUpgrade, type RealtimeAuth } from "@/server/realtime/game-server";
import { SessionRegistry } from "@/server/realtime/session-registry";

class MemoryStore implements KeyValueStore {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
  }
}

const socketsToClose = new Set<WebSocket>();
const serversToClose = new Set<HttpServer>();
const roomId = "room-1";
const validAuth: RealtimeAuth = {
  async verifyParticipantToken(roomIdToVerify, token) {
    if (roomIdToVerify !== roomId && roomIdToVerify !== "room-2") {
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

describe("SessionRegistry", () => {
  it("tracks sessions by room", () => {
    const registry = new SessionRegistry();
    const socket = { send: vi.fn() };

    registry.add("room1", "p1", socket);
    registry.broadcast("room1", (session) => ({
      type: "system_message",
      payload: { message: session.participantId ?? "unknown" }
    }));

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "system_message", payload: { message: "p1" } }));
  });
});

describe("createGameServer", () => {
  afterEach(async () => {
    vi.restoreAllMocks();

    await Promise.all([...socketsToClose].map(closeSocket));
    socketsToClose.clear();

    await Promise.all(
      [...serversToClose].map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }

              resolve();
            });
          })
      )
    );
    serversToClose.clear();
  });

  it("broadcasts participant-filtered snapshots for each session", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createReadyHeadsUpRoomState());

    const { url } = await startTestServer(liveRooms);
    const playerSocket = connect(url);
    const spectatorSocket = connect(url);

    await Promise.all([waitForOpen(playerSocket), waitForOpen(spectatorSocket)]);

    const playerJoin = nextMessage(playerSocket);
    playerSocket.send(
      JSON.stringify({ type: "join_room", roomId, participantToken: "p1-token", displayName: "Player 1" })
    );
    await expect(playerJoin).resolves.toMatchObject({ type: "room_snapshot", payload: { hand: null } });

    const playerAfterSpectatorJoin = nextMessage(playerSocket);
    const spectatorJoin = nextMessage(spectatorSocket);
    spectatorSocket.send(
      JSON.stringify({ type: "join_room", roomId, participantToken: null, displayName: "Spectator" })
    );
    await Promise.all([
      expect(playerAfterSpectatorJoin).resolves.toMatchObject({ type: "room_snapshot" }),
      expect(spectatorJoin).resolves.toMatchObject({ type: "room_snapshot", payload: { hand: null } })
    ]);

    const playerStarted = nextMessage(playerSocket);
    const spectatorStarted = nextMessage(spectatorSocket);
    playerSocket.send(JSON.stringify({ type: "start_room", roomId, hostToken: "host-token" }));

    const [playerSnapshot, spectatorSnapshot] = await Promise.all([playerStarted, spectatorStarted]);
    const playerSeat = getHandSeat(playerSnapshot, "p1");
    const spectatorSeat = getHandSeat(spectatorSnapshot, "p1");

    expect(playerSnapshot).toMatchObject({ type: "room_snapshot" });
    expect(playerSeat?.holeCards).toHaveLength(2);
    expect(spectatorSnapshot).toMatchObject({ type: "room_snapshot" });
    expect(spectatorSeat?.holeCards).toBeUndefined();
  });

  it("rejects spoofed player actions and leaves the hand unchanged", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createReadyHeadsUpRoomState());

    const { url } = await startTestServer(liveRooms);
    const playerSocket = connect(url);

    await waitForOpen(playerSocket);

    const joined = nextMessage(playerSocket);
    playerSocket.send(
      JSON.stringify({ type: "join_room", roomId, participantToken: "p1-token", displayName: "Player 1" })
    );
    await joined;

    const started = nextMessage(playerSocket);
    playerSocket.send(JSON.stringify({ type: "start_room", roomId, hostToken: "host-token" }));
    await started;

    const actionError = nextMessage(playerSocket);
    playerSocket.send(
      JSON.stringify({
        type: "player_action",
        roomId,
        participantToken: "p1-token",
        action: { type: "fold", playerId: "p2" }
      })
    );

    await expect(actionError).resolves.toMatchObject({
      type: "error",
      payload: { message: "Participant token does not match player action" }
    });

    const room = await liveRooms.getRoom(roomId);
    expect(room?.hand?.actions).toEqual([]);
  });

  it("rejects invalid JSON and unsupported schema-valid message types", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createReadyHeadsUpRoomState());

    const { url } = await startTestServer(liveRooms);
    const socket = connect(url);
    await waitForOpen(socket);

    const invalidJson = nextMessage(socket);
    socket.send("{");
    await expect(invalidJson).resolves.toMatchObject({ type: "error", payload: { message: "Invalid message" } });

    const unsupported = nextMessage(socket);
    socket.send(JSON.stringify({ type: "set_ready", roomId, participantToken: "p1-token" }));
    await expect(unsupported).resolves.toMatchObject({
      type: "error",
      payload: { message: "Unsupported message type: set_ready" }
    });
  });

  it("clears participant and host session state when switching rooms", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createReadyHeadsUpRoomState(roomId));
    await liveRooms.saveRoom(createReadyHeadsUpRoomState("room-2"));

    const { url } = await startTestServer(liveRooms);
    const socket = connect(url);
    await waitForOpen(socket);

    const hostSnapshot = nextMessage(socket);
    socket.send(JSON.stringify({ type: "start_room", roomId, hostToken: "host-token" }));
    await expect(hostSnapshot).resolves.toMatchObject({
      type: "room_snapshot",
      payload: { roomId, hostControls: true }
    });

    const roomTwoSnapshot = nextMessage(socket);
    socket.send(JSON.stringify({ type: "join_room", roomId: "room-2", participantToken: null, displayName: "Spectator" }));

    await expect(roomTwoSnapshot).resolves.toMatchObject({
      type: "room_snapshot",
      payload: { roomId: "room-2", hostControls: false, hand: null }
    });
  });

  it("rejects forged participant tokens before revealing private cards", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createReadyHeadsUpRoomState());

    const { url } = await startTestServer(liveRooms);
    const socket = connect(url);
    await waitForOpen(socket);

    const forgedJoin = nextMessage(socket);
    socket.send(JSON.stringify({ type: "join_room", roomId, participantToken: "p1", displayName: "Imposter" }));

    await expect(forgedJoin).resolves.toMatchObject({
      type: "error",
      payload: { message: "Invalid participant token" }
    });
  });

  it("rejects forged host tokens before starting a hand", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createReadyHeadsUpRoomState());

    const { url } = await startTestServer(liveRooms);
    const socket = connect(url);
    await waitForOpen(socket);

    const join = nextMessage(socket);
    socket.send(JSON.stringify({ type: "join_room", roomId, participantToken: "p1-token", displayName: "Player 1" }));
    await join;

    const forgedStart = nextMessage(socket);
    socket.send(JSON.stringify({ type: "start_room", roomId, hostToken: "forged-host-token" }));

    await expect(forgedStart).resolves.toMatchObject({
      type: "error",
      payload: { message: "Invalid host token" }
    });

    const room = await liveRooms.getRoom(roomId);
    expect(room?.hand).toBeNull();
  });

  it("automatically starts the next hand after a hand finishes when enough players remain", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createReadyHeadsUpRoomState());

    const recordHand = vi.fn().mockResolvedValue(undefined);
    const { url } = await startTestServer(liveRooms, validAuth, { recordHand, recordBuyIn: vi.fn() });
    const playerSocket = connect(url);

    await waitForOpen(playerSocket);

    const joined = nextMessage(playerSocket);
    playerSocket.send(
      JSON.stringify({ type: "join_room", roomId, participantToken: "p1-token", displayName: "Player 1" })
    );
    await joined;

    const started = nextMessage(playerSocket);
    playerSocket.send(JSON.stringify({ type: "start_room", roomId, hostToken: "host-token" }));
    await started;

    const actionSequence = nextMessages(playerSocket, 3);
    playerSocket.send(
      JSON.stringify({
        type: "player_action",
        roomId,
        participantToken: "p1-token",
        action: { type: "fold", playerId: "p1" }
      })
    );

    const [actionRecorded, handFinished, nextHandSnapshot] = await actionSequence;

    expect(actionRecorded).toMatchObject({
      type: "action_recorded",
      payload: {
        playerId: "p1",
        displayName: "P1",
        action: { type: "fold", playerId: "p1" }
      }
    });

    expect(handFinished).toMatchObject({
      type: "hand_finished",
      payload: {
        winners: [{ participantId: "p2", displayName: "P2" }],
        pot: 30,
        board: []
      }
    });

    expect(nextHandSnapshot).toMatchObject({
      type: "room_snapshot",
      payload: {
        status: "playing",
        hand: {
          number: 2,
          finished: false
        }
      }
    });
    expect(recordHand).toHaveBeenCalledOnce();

    const room = await liveRooms.getRoom(roomId);
    expect(room?.hand?.number).toBe(2);
    expect(room?.hand?.finished).toBe(false);
  });

  it("includes showdown hole cards in the hand finished event before the next hand snapshot", async () => {
    vi.spyOn(Math, "random").mockImplementation(seededRandom(1));

    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createReadyHeadsUpRoomState());

    const { url } = await startTestServer(liveRooms, validAuth, { recordHand: vi.fn(), recordBuyIn: vi.fn() });
    const p1Socket = connect(url);
    const p2Socket = connect(url);

    await Promise.all([waitForOpen(p1Socket), waitForOpen(p2Socket)]);

    const p1Joined = nextMessage(p1Socket);
    p1Socket.send(JSON.stringify({ type: "join_room", roomId, participantToken: "p1-token", displayName: "P1" }));
    await p1Joined;

    const p1AfterP2Join = nextMessage(p1Socket);
    const p2Joined = nextMessage(p2Socket);
    p2Socket.send(JSON.stringify({ type: "join_room", roomId, participantToken: "p2-token", displayName: "P2" }));
    await Promise.all([p1AfterP2Join, p2Joined]);

    const started = nextMessage(p1Socket);
    p1Socket.send(JSON.stringify({ type: "start_room", roomId, hostToken: "host-token" }));
    await started;

    const afterAllIn = nextMessages(p1Socket, 2);
    p1Socket.send(
      JSON.stringify({
        type: "player_action",
        roomId,
        participantToken: "p1-token",
        action: { type: "all-in", playerId: "p1" }
      })
    );
    await afterAllIn;

    const showdownMessages = nextMessages(p1Socket, 3);
    p2Socket.send(
      JSON.stringify({
        type: "player_action",
        roomId,
        participantToken: "p2-token",
        action: { type: "call", playerId: "p2" }
      })
    );

    const [, handFinished, finishedSnapshot] = await showdownMessages;
    expect(handFinished).toMatchObject({
      type: "hand_finished",
      payload: {
        showdownPlayers: [
          { participantId: "p1", displayName: "P1", seatNumber: 1 },
          { participantId: "p2", displayName: "P2", seatNumber: 2 }
        ]
      }
    });
    expect(getShowdownCards(handFinished, "p1")).toHaveLength(2);
    expect(getShowdownCards(handFinished, "p2")).toHaveLength(2);
    expect(finishedSnapshot).toMatchObject({ type: "room_snapshot", payload: { hand: { number: 1, finished: true } } });
  });

  it("automatically starts the next hand after a busted player rebuys", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createFinishedHeadsUpRoomWithBustedPlayer());

    const recordBuyIn = vi.fn().mockResolvedValue(undefined);
    const { url } = await startTestServer(liveRooms, validAuth, { recordHand: vi.fn(), recordBuyIn });
    const playerSocket = connect(url);

    await waitForOpen(playerSocket);

    const joined = nextMessage(playerSocket);
    playerSocket.send(
      JSON.stringify({ type: "join_room", roomId, participantToken: "p2-token", displayName: "Player 2" })
    );
    await joined;

    const firstMessage = nextMessage(playerSocket);
    playerSocket.send(JSON.stringify({ type: "rebuy", roomId, participantToken: "p2-token", amount: 1000 }));

    const nextHandSnapshot = await firstMessage;
    expect(nextHandSnapshot).toMatchObject({
      type: "room_snapshot",
      payload: {
        status: "playing",
        hand: {
          number: 2,
          finished: false
        }
      }
    });
    expect(recordBuyIn).toHaveBeenCalledWith(roomId, "p2", 1000);

    const room = await liveRooms.getRoom(roomId);
    expect(room?.hand?.number).toBe(2);
    expect(room?.hand?.finished).toBe(false);
    expect(room?.hand?.actorId).toBeTruthy();
  });
});

function createReadyHeadsUpRoomState(targetRoomId = roomId): RoomState {
  const state = createInitialRoomState(
    { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    targetRoomId
  );

  return {
    ...state,
    seats: state.seats.map((seat, index) => ({
      ...seat,
      participantId: `p${index + 1}`,
      displayName: `P${index + 1}`,
      chips: 1000,
      cumulativeBuyIn: 1000,
      status: "ready"
    }))
  };
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;

  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function createFinishedHeadsUpRoomWithBustedPlayer(): RoomState {
  const ready = createReadyHeadsUpRoomState();
  return {
    ...ready,
    status: "playing",
    handCounter: 1,
    buttonSeat: 1,
    seats: ready.seats.map((seat) =>
      seat.participantId === "p1"
        ? { ...seat, chips: 2000, status: "active" as const }
        : { ...seat, chips: 0, status: "all-in" as const }
    ),
    hand: {
      id: `${roomId}-1`,
      number: 1,
      street: "river",
      board: [],
      deck: [],
      actorId: "p1",
      betting: {
        street: "river",
        currentBet: 1000,
        minRaise: 20,
        actorId: "p1",
        players: [
          { id: "p1", stack: 2000, committed: 1000, streetCommitted: 1000, folded: false, allIn: false },
          { id: "p2", stack: 0, committed: 1000, streetCommitted: 1000, folded: false, allIn: true }
        ]
      },
      holeCardsByParticipantId: {},
      actions: [],
      finished: true,
      winners: ["p1"]
    }
  };
}

async function startTestServer(
  liveRooms: LiveRoomStore,
  auth: RealtimeAuth = validAuth,
  roomRepository?: Parameters<typeof createGameServer>[0]["roomRepository"]
): Promise<{ server: HttpServer; url: string }> {
  const server = createServer();
  const gameServer = createGameServer({ server, liveRooms, auth, roomRepository });
  server.on("upgrade", (request, socket, head) => {
    if (!handleGameServerUpgrade(gameServer, request, socket, head)) {
      socket.destroy();
    }
  });
  serversToClose.add(server);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an address with a port");
  }

  return {
    server,
    url: `ws://127.0.0.1:${address.port}/ws`
  };
}

function connect(url: string): WebSocket {
  const socket = new WebSocket(url);
  socketsToClose.add(socket);
  return socket;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message"));
    }, 2000);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    const onMessage = (data: WebSocket.RawData) => {
      cleanup();
      resolve(JSON.parse(data.toString()));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("Socket closed before receiving a message"));
    };

    socket.on("message", onMessage);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

function nextMessages(socket: WebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${count} websocket messages`));
    }, 2000);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    const onMessage = (data: WebSocket.RawData) => {
      messages.push(JSON.parse(data.toString()));
      if (messages.length >= count) {
        cleanup();
        resolve(messages);
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("Socket closed before receiving websocket messages"));
    };

    socket.on("message", onMessage);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

function getHandSeat(snapshot: unknown, participantId: string): { holeCards?: string[] } | undefined {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !("payload" in snapshot) ||
    !snapshot.payload ||
    typeof snapshot.payload !== "object" ||
    !("hand" in snapshot.payload) ||
    !snapshot.payload.hand ||
    typeof snapshot.payload.hand !== "object" ||
    !("seats" in snapshot.payload.hand) ||
    !Array.isArray(snapshot.payload.hand.seats)
  ) {
    return undefined;
  }

  return snapshot.payload.hand.seats.find(
    (seat): seat is { participantId: string; holeCards?: string[] } =>
      Boolean(seat) &&
      typeof seat === "object" &&
      "participantId" in seat &&
      seat.participantId === participantId
  );
}

function getShowdownCards(message: unknown, participantId: string): string[] | undefined {
  if (
    !message ||
    typeof message !== "object" ||
    !("payload" in message) ||
    !message.payload ||
    typeof message.payload !== "object" ||
    !("showdownPlayers" in message.payload) ||
    !Array.isArray(message.payload.showdownPlayers)
  ) {
    return undefined;
  }

  const player = message.payload.showdownPlayers.find((candidate) => {
    return typeof candidate === "object" && candidate !== null && "participantId" in candidate && candidate.participantId === participantId;
  });
  return typeof player === "object" && player !== null && "holeCards" in player && Array.isArray(player.holeCards)
    ? player.holeCards.filter((card: unknown): card is string => typeof card === "string")
    : undefined;
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
