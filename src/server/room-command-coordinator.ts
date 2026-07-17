export type RoomCommandSource = "client" | "timer";

interface RoomQueue {
  tail: Promise<void>;
  pendingTotal: number;
  pendingClient: number;
}

export class RoomCommandError extends Error {
  readonly code = "SERVER_BUSY" as const;

  constructor() {
    super("The room is busy; retry the command shortly");
    this.name = "RoomCommandError";
  }
}

export class RoomCommandCoordinator {
  private readonly queues = new Map<string, RoomQueue>();

  constructor(private readonly maxPendingClientCommands = 256) {}

  run<T>(
    roomId: string,
    operation: () => Promise<T> | T,
    source: RoomCommandSource
  ): Promise<T> {
    const queue = this.queues.get(roomId) ?? {
      tail: Promise.resolve(),
      pendingTotal: 0,
      pendingClient: 0
    };
    if (source === "client" && queue.pendingClient >= this.maxPendingClientCommands) {
      return Promise.reject(new RoomCommandError());
    }
    if (!this.queues.has(roomId)) {
      this.queues.set(roomId, queue);
    }

    queue.pendingTotal += 1;
    if (source === "client") {
      queue.pendingClient += 1;
    }

    const result = queue.tail
      .catch(() => undefined)
      .then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined
    );
    queue.tail = settled;

    return result.finally(() => {
      queue.pendingTotal -= 1;
      if (source === "client") {
        queue.pendingClient -= 1;
      }
      if (queue.pendingTotal === 0 && queue.tail === settled && this.queues.get(roomId) === queue) {
        this.queues.delete(roomId);
      }
    });
  }
}
