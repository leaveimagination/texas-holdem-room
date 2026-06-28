import { createServer } from "node:http";
import process from "node:process";
import next from "next";
import { loadLocalEnv } from "./env";
import { LiveRoomStore, type KeyValueStore } from "./live-room-store";
import { createGameServer, handleGameServerUpgrade } from "./realtime/game-server";
import { RoomRepository } from "./repositories/room-repository";
import { createRedisClient } from "./redis";

loadLocalEnv();

const requestedPort = Number(process.env.PORT ?? "3000");
const port = Number.isNaN(requestedPort) ? 3000 : requestedPort;
const host = process.env.HOST ?? "127.0.0.1";
const args = new Set(process.argv.slice(2));
const isExplicitDev = args.has("--dev");
const isExplicitProd = args.has("--prod");
const isDev = isExplicitProd
  ? false
  : isExplicitDev
  ? true
  : process.env.NODE_ENV !== "production";

let requestHandler: ReturnType<ReturnType<typeof next>["getRequestHandler"]> | null = null;
const server = createServer((req, res) => {
  void requestHandler?.(req, res);
});
const app = next({ dev: isDev, hostname: host, port, httpServer: server });

const redisClient = createRedisClient();
redisClient.on("error", () => undefined);

void (async () => {
  try {
    await app.prepare();

    requestHandler = app.getRequestHandler();
    const nextUpgradeHandler = app.getUpgradeHandler();
    const roomRepository = new RoomRepository();

    const gameServer = createGameServer({
      server,
      liveRooms: new LiveRoomStore(createKeyValueStore(redisClient)),
      auth: {
        verifyParticipantToken: (roomId, token) => roomRepository.verifyParticipantToken(roomId, token),
        verifyHostToken: (roomId, token) => roomRepository.verifyHostToken(roomId, token)
      }
    });
    server.on("upgrade", (req, socket, head) => {
      if (handleGameServerUpgrade(gameServer, req, socket, head)) {
        return;
      }

      void nextUpgradeHandler(req, socket, head);
    });

    server.listen(port, host, () => {
      console.log(`Server ready on http://${host}:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
})();

function createKeyValueStore(client: ReturnType<typeof createRedisClient>): KeyValueStore {
  return {
    get(key) {
      return client.get(key);
    },
    set(key, value, mode, ttlSeconds) {
      if (mode === "EX" && ttlSeconds !== undefined) {
        return client.set(key, value, "EX", ttlSeconds);
      }

      return client.set(key, value);
    },
    del(key) {
      return client.del(key);
    }
  };
}
