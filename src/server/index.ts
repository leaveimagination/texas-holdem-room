import { createServer } from "node:http";
import process from "node:process";
import next from "next";
import { LiveRoomStore, type KeyValueStore } from "./live-room-store";
import { createGameServer } from "./realtime/game-server";
import { createRedisClient } from "./redis";

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

const app = next({ dev: isDev });

void (async () => {
  try {
    await app.prepare();

    const requestHandler = app.getRequestHandler();
    const server = createServer((req, res) => {
      void requestHandler(req, res);
    });

    createGameServer({
      server,
      liveRooms: new LiveRoomStore(createKeyValueStore(createRedisClient()))
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
