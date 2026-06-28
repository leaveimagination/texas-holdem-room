import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import WebSocket from "ws";
import { createInitialRoomState, startHand, type RoomState } from "@/lib/poker/engine";
import { LiveRoomStore, type KeyValueStore } from "@/server/live-room-store";
import { createGameServer, handleGameServerUpgrade, type RealtimeAuth } from "@/server/realtime/game-server";

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

describe("spectator and disconnect realtime rules", () => {
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

  it("allows authenticated cash players to rebuy without revealing cards to spectators", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createBustedCashRoom());
    const { url } = await startTestServer(liveRooms);
    const playerSocket = connect(url);
    const spectatorSocket = connect(url);
    await Promise.all([waitForOpen(playerSocket), waitForOpen(spectatorSocket)]);

    const playerJoin = nextMessage(playerSocket);
    playerSocket.send(JSON.stringify({ type: "join_room", roomId, participantToken: "p1-token", displayName: "Player 1" }));
    await playerJoin;

    const playerAfterSpectatorJoin = nextMessage(playerSocket);
    const spectatorJoin = nextMessage(spectatorSocket);
    spectatorSocket.send(JSON.stringify({ type: "join_room", roomId, participantToken: null, displayName: "Rail" }));
    await Promise.all([playerAfterSpectatorJoin, spectatorJoin]);

    const playerRebuy = nextMessage(playerSocket);
    const spectatorRebuy = nextMessage(spectatorSocket);
    playerSocket.send(JSON.stringify({ type: "rebuy", roomId, participantToken: "p1-token", amount: 500 }));

    const [playerSnapshot, spectatorSnapshot] = await Promise.all([playerRebuy, spectatorRebuy]);

    expect(getSeat(playerSnapshot, 1)).toMatchObject({ chips: 500, cumulativeBuyIn: 1500 });
    expect(getSeat(spectatorSnapshot, 1)).toMatchObject({ chips: 500, cumulativeBuyIn: 1500 });
    expect(getHandSeat(spectatorSnapshot, "p1")?.holeCards).toBeUndefined();
  });

  it("keeps the requested display name when a player claims a seat", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createInitialRoomState(
      { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
      roomId
    ));
    const { url } = await startTestServer(liveRooms);
    const socket = connect(url);
    await waitForOpen(socket);

    const claimed = nextMessage(socket);
    socket.send(JSON.stringify({ type: "claim_seat", roomId, participantToken: "p1-token", displayName: "Alice", seatNumber: 1 }));

    const snapshot = await claimed;
    expect(getSeat(snapshot, 1)).toMatchObject({ displayName: "Alice", chips: 1000, cumulativeBuyIn: 1000 });
  });

  it("rejects forged rebuy participant tokens", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(createReadyCashRoom());
    const { url } = await startTestServer(liveRooms);
    const socket = connect(url);
    await waitForOpen(socket);

    const rebuyError = nextMessage(socket);
    socket.send(JSON.stringify({ type: "rebuy", roomId, participantToken: "forged-token", amount: 500 }));

    await expect(rebuyError).resolves.toMatchObject({
      type: "error",
      payload: { message: "Invalid participant token" }
    });
  });

  it("allows the authenticated host to pause an active hand for a disconnected player", async () => {
    const liveRooms = new LiveRoomStore(new MemoryStore());
    await liveRooms.saveRoom(startHand(createReadyCashRoom()));
    const { url } = await startTestServer(liveRooms);
    const socket = connect(url);
    await waitForOpen(socket);

    const paused = nextMessage(socket);
    socket.send(JSON.stringify({ type: "handle_disconnect", roomId, hostToken: "host-token", participantId: "p1", handling: "pause" }));

    const snapshot = await paused;
    expect(snapshot).toMatchObject({ type: "room_snapshot", payload: { status: "paused" } });
    expect(getSeat(snapshot, 1)).toMatchObject({ status: "disconnected" });

    const saved = await liveRooms.getRoom(roomId);
    expect(saved?.status).toBe("paused");
    expect(saved?.seats[0].status).toBe("disconnected");
  });
});

function createReadyCashRoom(): RoomState {
  const state = createInitialRoomState(
    { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    roomId
  );

  return {
    ...state,
    seats: state.seats.map((seat, index) => ({
      ...seat,
      participantId: `p${index + 1}`,
      displayName: `Player ${index + 1}`,
      chips: 1000,
      cumulativeBuyIn: 1000,
      status: "ready" as const
    }))
  };
}

function createBustedCashRoom(): RoomState {
  const state = createReadyCashRoom();
  return {
    ...state,
    seats: state.seats.map((seat) => (seat.participantId === "p1" ? { ...seat, chips: 0, status: "seated" as const } : seat))
  };
}

async function startTestServer(liveRooms: LiveRoomStore): Promise<{ server: HttpServer; url: string }> {
  const server = createServer();
  const gameServer = createGameServer({ server, liveRooms, auth });
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

function getSeat(snapshot: unknown, seatNumber: number): { chips?: number; cumulativeBuyIn?: number; status?: string; displayName?: string } | undefined {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !("payload" in snapshot) ||
    !snapshot.payload ||
    typeof snapshot.payload !== "object" ||
    !("seats" in snapshot.payload) ||
    !Array.isArray(snapshot.payload.seats)
  ) {
    return undefined;
  }

  return snapshot.payload.seats.find(
    (seat): seat is { seatNumber: number; chips?: number; cumulativeBuyIn?: number; status?: string; displayName?: string } =>
      Boolean(seat) && typeof seat === "object" && "seatNumber" in seat && seat.seatNumber === seatNumber
  );
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
