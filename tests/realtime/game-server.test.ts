import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import WebSocket from "ws";
import { createInitialRoomState, type RoomState } from "@/lib/poker/engine";
import { LiveRoomStore, type KeyValueStore } from "@/server/live-room-store";
import { createGameServer } from "@/server/realtime/game-server";
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
      JSON.stringify({ type: "join_room", roomId, participantToken: "p1", displayName: "Player 1" })
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
      JSON.stringify({ type: "join_room", roomId, participantToken: "p1", displayName: "Player 1" })
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
        participantToken: "p1",
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
});

function createReadyHeadsUpRoomState(): RoomState {
  const state = createInitialRoomState(
    { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    roomId
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

async function startTestServer(liveRooms: LiveRoomStore): Promise<{ server: HttpServer; url: string }> {
  const server = createServer();
  createGameServer({ server, liveRooms });
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
    url: `ws://127.0.0.1:${address.port}`
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

function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
}
