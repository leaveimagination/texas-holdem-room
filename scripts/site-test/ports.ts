import { createServer } from "node:net";

const LOOPBACK_HOST = "127.0.0.1";

export interface LoopbackPortReservation {
  port: number;
  release(): Promise<void>;
}

export interface LoopbackPortDependencies {
  bind?(host: string): Promise<LoopbackPortReservation>;
}

export async function reserveLoopbackPorts(
  count: number,
  dependencies: LoopbackPortDependencies = {}
): Promise<number[]> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 64) {
    throw new RangeError("Loopback port reservation count must be an integer between 1 and 64");
  }

  const bind = dependencies.bind ?? bindAvailableLoopbackPort;
  const reservations: LoopbackPortReservation[] = [];
  const ports = new Set<number>();
  const maximumAttempts = count * 10;

  try {
    for (let attempt = 0; ports.size < count && attempt < maximumAttempts; attempt += 1) {
      const reservation = await bind(LOOPBACK_HOST);
      if (!isValidPort(reservation.port)) {
        await reservation.release();
        throw new Error(`Loopback binder returned an invalid port: ${reservation.port}`);
      }
      if (ports.has(reservation.port)) {
        await reservation.release();
        continue;
      }
      ports.add(reservation.port);
      reservations.push(reservation);
    }

    if (ports.size !== count) {
      throw new Error(`Unable to reserve ${count} distinct loopback ports`);
    }

    return [...ports];
  } finally {
    await Promise.allSettled(reservations.map((reservation) => reservation.release()));
  }
}

async function bindAvailableLoopbackPort(host: string): Promise<LoopbackPortReservation> {
  return await new Promise<LoopbackPortReservation>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host, port: 0, exclusive: true }, () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Loopback listener did not expose a TCP port"));
        return;
      }

      let released = false;
      resolve({
        port: address.port,
        release: async () => {
          if (released) {
            return;
          }
          released = true;
          await new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          });
        }
      });
    });
  });
}

function isValidPort(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 65_535;
}
