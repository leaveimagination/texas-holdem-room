import { createServer } from "node:http";
import process from "node:process";
import next from "next";

const requestedPort = Number(process.env.PORT ?? "3000");
const port = Number.isNaN(requestedPort) ? 3000 : requestedPort;
const host = process.env.HOST ?? "127.0.0.1";
const isDev = process.env.NODE_ENV !== "production";

const app = next({ dev: isDev });

void (async () => {
  try {
    await app.prepare();

    const requestHandler = app.getRequestHandler();
    const server = createServer((req, res) => {
      void requestHandler(req, res);
    });

    server.listen(port, host, () => {
      console.log(`Server ready on http://${host}:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
})();
