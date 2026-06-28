import { createServer } from "node:http";
import process from "node:process";
import next from "next";
import { WebSocketServer } from "ws";

const requestedPort = Number(process.env.PORT ?? "3000");
const port = Number.isNaN(requestedPort) ? 3000 : requestedPort;
const host = process.env.HOST ?? "127.0.0.1";
const isDev = process.env.NODE_ENV !== "production";

const app = next({ dev: isDev });
const websocket = new WebSocketServer({ noServer: true });

void (async () => {
  try {
    await app.prepare();

    const requestHandler = app.getRequestHandler();
    const server = createServer((req, res) => {
      void requestHandler(req, res);
    });

    // Future task hook: route upgrade requests here for custom WebSocket handling.
    server.on("upgrade", (request, socket, head) => {
      websocket.handleUpgrade(request, socket, head, (client) => {
        websocket.emit("connection", client, request);
      });
    });

    server.listen(port, host, () => {
      console.log(`Server ready on http://${host}:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
})();
