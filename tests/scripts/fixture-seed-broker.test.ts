import { afterEach, describe, expect, test, vi } from "vitest";

import { createInitialRoomState, type RoomState } from "@/lib/poker/engine";
import {
  DockerSiteTestStack,
  type DockerContainerInspect,
  type DockerProcessRunner,
  type DockerSiteTestStackSnapshot
} from "../../scripts/site-test/docker-stack";
import {
  startFixtureSeedBroker,
  type FixtureSeedBrokerHandle
} from "../../scripts/site-test/fixture-seed-broker";

const runId = "br5";
const nowMs = Date.parse("2026-07-17T13:00:00.000Z");
const roomId = "room-owned";
const participantIds = {
  button: "participant-button",
  small: "participant-small",
  big: "participant-big"
};
const rankedParticipantIds = {
  aces: "participant-aces",
  kings: "participant-kings",
  queens: "participant-queens",
  jacks: "participant-jacks"
};
const handles: FixtureSeedBrokerHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map(async (handle) => await handle.close()));
});

describe("run-scoped fixture seed broker", () => {
  test("accepts one fresh constrained request for an exact owned room", async () => {
    const { handle, seedNormalBetting, close } = await broker();
    const response = await send(handle, requestBody());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      roomId,
      fixtureId: "normal-betting",
      handNumber: null
    });
    expect(seedNormalBetting).toHaveBeenCalledWith(
      roomId,
      participantIds,
      expect.objectContaining({ timeoutMs: 5_000 })
    );

    await handle.close();
    expect(close).toHaveBeenCalledTimes(1);
    await expect(fetch(handle.endpoint, { method: "POST" })).rejects.toThrow();
  });

  test("rejects self-signed capability substitution and arbitrary target fields", async () => {
    const { handle, seedNormalBetting } = await broker();
    const body = {
      ...requestBody(),
      envelope: "attacker-self-signed-envelope",
      publicKey: "attacker-public-key",
      target: { redisUrl: "redis://127.0.0.1:6379/0" }
    };

    const response = await send(handle, body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid constrained fixture request" });
    expect(seedNormalBetting).not.toHaveBeenCalled();
  });

  test("accepts only the declared deterministic fixture union and rejects nested extras", async () => {
    const { handle, seedFixture } = await broker({
      liveSeats: 4,
      ownedParticipantIds: rankedParticipantIds
    });
    const accepted = await send(handle, requestBody({
      fixture: { kind: "four-player-all-in", participantIds: rankedParticipantIds }
    }));
    expect(accepted.status).toBe(200);
    expect(seedFixture).toHaveBeenCalledWith(
      roomId,
      { kind: "four-player-all-in", participantIds: rankedParticipantIds },
      expect.objectContaining({ timeoutMs: 5_000 })
    );

    for (const [requestId, fixture] of [
      ["FFFFFFFFFFFFFFFFFFFFFF", { kind: "forged", participantIds: rankedParticipantIds }],
      ["GGGGGGGGGGGGGGGGGGGGGG", { kind: "four-player-all-in", participantIds: rankedParticipantIds, redisUrl: "redis://127.0.0.1" }]
    ] as const) {
      const response = await send(handle, requestBody({ requestId, fixture }));
      expect(response.status).toBe(400);
    }
    expect(seedFixture).toHaveBeenCalledTimes(1);
  });

  test("rejects a wrong run, expired request, replay, and non-owned target room", async () => {
    const { handle, seedNormalBetting } = await broker();

    expect((await send(handle, requestBody({ runId: "other-run" }))).status).toBe(403);
    expect((await send(handle, requestBody({
      requestId: "BBBBBBBBBBBBBBBBBBBBBB",
      issuedAt: "2026-07-17T12:59:00.000Z"
    }))).status).toBe(410);

    const replay = requestBody({ requestId: "CCCCCCCCCCCCCCCCCCCCCC" });
    expect((await send(handle, replay)).status).toBe(200);
    expect((await send(handle, replay)).status).toBe(409);

    expect((await send(handle, requestBody({
      roomId: "room-not-owned",
      requestId: "DDDDDDDDDDDDDDDDDDDDDD"
    }))).status).toBe(403);
    expect(seedNormalBetting).toHaveBeenCalledTimes(1);
  });

  test("requires the parent-issued bearer and never exposes it from a public route", async () => {
    const { handle, seedNormalBetting } = await broker();
    const unauthorized = await fetch(handle.endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer attacker-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody())
    });
    const publicRead = await fetch(handle.endpoint);

    expect(unauthorized.status).toBe(401);
    expect(publicRead.status).toBe(404);
    expect(JSON.stringify(await publicRead.json())).not.toContain(handle.authorizationToken);
    expect(seedNormalBetting).not.toHaveBeenCalled();
  });

  test("bounds dependency work and force-closes an active request during cleanup", async () => {
    const readOwnedRoom = vi.fn(async () => await new Promise<never>(() => undefined));
    const { handle, close } = await broker({
      operationTimeoutMs: 20,
      dependencyOverrides: { readOwnedRoom }
    });

    const response = await send(handle, requestBody());
    expect(response.status).toBe(500);
    expect(readOwnedRoom).toHaveBeenCalledTimes(1);

    const pending = send(handle, requestBody({ requestId: "EEEEEEEEEEEEEEEEEEEEEE" }));
    await vi.waitFor(() => expect(readOwnedRoom).toHaveBeenCalledTimes(2));
    const startedAt = performance.now();
    await handle.close({ signal: new AbortController().signal, timeoutMs: 100 });

    expect(performance.now() - startedAt).toBeLessThan(150);
    expect(close).toHaveBeenCalledTimes(1);
    const pendingOutcome = await pending.then((result) => result.status, () => "disconnected");
    expect([500, "disconnected"]).toContain(pendingOutcome);
  });

  test("shares one in-flight close across concurrent callers", async () => {
    let releaseClose: (() => void) | undefined;
    const close = vi.fn(async () => await new Promise<void>((resolve) => {
      releaseClose = resolve;
    }));
    const { handle } = await broker({ dependencyOverrides: { close } });
    const control = { signal: new AbortController().signal, timeoutMs: 500 };

    const first = handle.close(control);
    const second = handle.close(control);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    releaseClose?.();

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("allows dependency cleanup to be retried after a failed close", async () => {
    const close = vi.fn()
      .mockRejectedValueOnce(new Error("disconnect failed"))
      .mockResolvedValueOnce(undefined);
    const { handle } = await broker({ dependencyOverrides: { close } });
    const control = { signal: new AbortController().signal, timeoutMs: 500 };

    await expect(handle.close(control)).rejects.toThrow(/disconnect failed/i);
    await expect(handle.close(control)).resolves.toBeUndefined();
    await expect(handle.close(control)).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });

  test("cancels startup before listening and still attempts dependency cleanup", async () => {
    const snapshot = await verifiedStackSnapshot();
    const close = vi.fn(async () => undefined);
    const controller = new AbortController();
    controller.abort(new Error("startup cancelled"));

    await expect(startFixtureSeedBroker({
      snapshot,
      databaseUrl: "postgresql://unused",
      runId,
      runStartedAt: "2026-07-17T12:59:55.000Z",
      dependencies: {
        readOwnedRoom: async () => null,
        readLiveRoom: async () => null,
        seedNormalBetting: async () => {
          throw new Error("not reached");
        },
        close
      }
    }, { signal: controller.signal, timeoutMs: 100 })).rejects.toThrow(/startup cancelled/i);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("closes a listener when cancellation wins immediately after listen", async () => {
    const snapshot = await verifiedStackSnapshot();
    const close = vi.fn(async () => undefined);
    const controller = new AbortController();
    let listenedPort: number | undefined;

    await expect(startFixtureSeedBroker({
      snapshot,
      databaseUrl: "postgresql://unused",
      runId,
      runStartedAt: "2026-07-17T12:59:55.000Z",
      onListening: (address) => {
        listenedPort = address.port;
        controller.abort(new Error("cancelled after listen"));
      },
      dependencies: {
        readOwnedRoom: async () => null,
        readLiveRoom: async () => null,
        seedNormalBetting: async () => {
          throw new Error("not reached");
        },
        close
      }
    }, { signal: controller.signal, timeoutMs: 100 })).rejects.toThrow(/cancelled after listen/i);

    expect(listenedPort).toEqual(expect.any(Number));
    expect(close).toHaveBeenCalledTimes(1);
    await expect(fetch(`http://127.0.0.1:${listenedPort}`)).rejects.toThrow();
  });
});

async function broker(options: {
  operationTimeoutMs?: number;
  liveSeats?: number;
  ownedParticipantIds?: Record<string, string>;
  dependencyOverrides?: Partial<{
    readOwnedRoom(roomId: string): Promise<ReturnType<typeof ownedRoom>>;
    readLiveRoom(roomId: string): Promise<RoomState | null>;
    seedNormalBetting(roomId: string, roles: typeof participantIds): Promise<RoomState>;
    close(): Promise<void>;
  }>;
} = {}) {
  const snapshot = await verifiedStackSnapshot();
  const liveRoom = createInitialRoomState({
    mode: "cash",
    seats: options.liveSeats ?? 3,
    smallBlind: 10,
    bigBlind: 20,
    initialChips: 200,
    actionTimerSeconds: null
  }, roomId);
  const seedNormalBetting = vi.fn(async () => liveRoom);
  const seedFixture = vi.fn(async () => liveRoom);
  const close = options.dependencyOverrides?.close ?? vi.fn(async () => undefined);
  const handle = await startFixtureSeedBroker({
    snapshot,
    databaseUrl: "postgresql://unused",
    runId,
    runStartedAt: "2026-07-17T12:59:55.000Z",
    now: () => nowMs,
    operationTimeoutMs: options.operationTimeoutMs,
    dependencies: {
      readOwnedRoom: options.dependencyOverrides?.readOwnedRoom ?? (async (requestedRoomId: string) =>
        requestedRoomId === roomId ? ownedRoom(options.ownedParticipantIds) : null),
      readLiveRoom: options.dependencyOverrides?.readLiveRoom ?? (async (requestedRoomId: string): Promise<RoomState | null> =>
        requestedRoomId === roomId ? liveRoom : null),
      seedNormalBetting: options.dependencyOverrides?.seedNormalBetting ?? seedNormalBetting,
      seedFixture,
      close
    }
  });
  handles.push(handle);
  return { handle, seedNormalBetting, seedFixture, close };
}

function ownedRoom(ids: Record<string, string> = participantIds) {
  return {
    id: roomId,
    createdAt: new Date("2026-07-17T12:59:56.000Z"),
    endedAt: null,
    participants: Object.entries(ids).map(([role, id]) => ({
      id,
      displayName: `SITE-${runId}-${role}`
    }))
  };
}

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    runId,
    roomId,
    requestId: "AAAAAAAAAAAAAAAAAAAAAA",
    issuedAt: new Date(nowMs).toISOString(),
    fixture: { kind: "normal-betting", participantIds },
    ...overrides
  };
}

async function send(handle: FixtureSeedBrokerHandle, body: unknown): Promise<Response> {
  return await fetch(handle.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${handle.authorizationToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function isolatedStackSnapshot(): DockerSiteTestStackSnapshot {
  const projectName = `holdem-site-${runId}`;
  const services = (["app", "postgres", "redis"] as const).map((service) => ({
    service,
    containerId: `${service}-container`,
    projectName,
    runLabel: runId,
    status: "running",
    health: "healthy",
    imageId: service === "app" ? "sha256:app-image" : `${service}-image`
  }));
  return {
    runId,
    projectName,
    image: "texas-holdem-friends-room:test",
    imageId: "sha256:app-image",
    ports: { app: 43_100, postgres: 43_102, redis: 43_101 },
    services
  };
}

async function verifiedStackSnapshot(): Promise<DockerSiteTestStackSnapshot> {
  const snapshot = isolatedStackSnapshot();
  const containers: DockerContainerInspect[] = snapshot.services.map((service) => ({
    Id: service.containerId,
    Image: service.imageId,
    Config: {
      Labels: {
        "com.docker.compose.project": snapshot.projectName,
        "com.docker.compose.service": service.service,
        "com.texas-holdem.site-test-run": snapshot.runId
      }
    },
    State: { Status: service.status, Health: { Status: service.health } }
  }));
  const run: DockerProcessRunner = async (_command, args) => {
    if (args[0] === "image" && args[1] === "inspect") {
      return { exitCode: 0, stdout: `${snapshot.imageId}\n`, stderr: "" };
    }
    if (args.includes("up")) return { exitCode: 0, stdout: "", stderr: "" };
    if (args.includes("ps")) {
      return {
        exitCode: 0,
        stdout: `${snapshot.services.map(({ containerId }) => containerId).join("\n")}\n`,
        stderr: ""
      };
    }
    if (args[0] === "inspect") {
      return { exitCode: 0, stdout: JSON.stringify(containers), stderr: "" };
    }
    throw new Error(`Unexpected Docker command: ${args.join(" ")}`);
  };
  return await new DockerSiteTestStack({
    runId,
    rootDirectory: process.cwd(),
    ports: snapshot.ports,
    postgresPassword: "unused",
    image: snapshot.image,
    run
  }).start();
}
