import Redis from "ioredis";
import { createSiteTestRunIdentity } from "../../../scripts/site-test/contracts";
import {
  assertVerifiedDockerSiteTestStackSnapshot,
  type DockerSiteTestStackSnapshot
} from "../../../scripts/site-test/docker-stack";
import {
  claimSeat,
  createInitialRoomState,
  startHand,
  type RoomState
} from "@/lib/poker/engine";
import { LiveRoomStore } from "@/server/live-room-store";
import {
  createRedisKeyValueStore,
  type RedisKeyValueClient
} from "@/server/redis-key-value-store";
import { RunResourceRecordSchema } from "../evidence/contracts";
import type {
  CreatedRoomIdentity,
  FixtureRunResourceRecord,
  FixtureTargetEnvironment,
  JoinedPlayerIdentity,
  PokerFixture
} from "./types";

interface FixtureRedisClient extends RedisKeyValueClient {
  disconnect(): void;
  on?(event: "error", listener: (error: unknown) => void): unknown;
}

interface FixtureRuntimeOptions {
  targetEnvironment: FixtureTargetEnvironment;
  redisFactory?: (url: string) => FixtureRedisClient;
}

const verifiedIsolatedTargets = new WeakSet<object>();

export function createFixtureTargetEnvironment(
  snapshot: DockerSiteTestStackSnapshot
): FixtureTargetEnvironment {
  assertVerifiedDockerSiteTestStackSnapshot(snapshot);
  const identity = createSiteTestRunIdentity(snapshot.runId);
  if (
    snapshot.runId !== identity.runId ||
    snapshot.projectName !== identity.projectName
  ) {
    throw new Error("Fixture target does not match the exact isolated stack identity");
  }

  for (const serviceName of ["app", "postgres", "redis"] as const) {
    const matchingServices = snapshot.services.filter(({ service }) => service === serviceName);
    if (
      matchingServices.length !== 1 ||
      matchingServices[0].projectName !== identity.projectName ||
      matchingServices[0].runLabel !== identity.runLabel ||
      matchingServices[0].status !== "running" ||
      matchingServices[0].health !== "healthy"
    ) {
      throw new Error(`Fixture target lacks a healthy owned ${serviceName} service`);
    }
  }

  if (!isPort(snapshot.ports.app) || !isPort(snapshot.ports.redis)) {
    throw new Error("Fixture target has an invalid loopback port");
  }

  const target: FixtureTargetEnvironment = Object.freeze({
    name: identity.projectName,
    kind: "isolated",
    runId: identity.runId,
    baseUrl: `http://127.0.0.1:${snapshot.ports.app}`,
    redisUrl: `redis://127.0.0.1:${snapshot.ports.redis}/0`
  });
  verifiedIsolatedTargets.add(target);
  return target;
}

export class FixtureRuntime {
  private readonly redisFactory: (url: string) => FixtureRedisClient;

  constructor(private readonly options: FixtureRuntimeOptions) {
    assertVerifiedIsolatedEnvironment(options.targetEnvironment);
    this.redisFactory = options.redisFactory ?? defaultRedisFactory;
  }

  async seedRoom(roomId: string, fixture: PokerFixture): Promise<RoomState> {
    let room = createInitialRoomState(fixture.settings, roomId);
    for (const fixtureParticipant of fixture.participants) {
      room = claimSeat(
        room,
        fixtureParticipant.participantId,
        fixtureParticipant.displayName,
        fixtureParticipant.seatNumber
      );
    }

    room = {
      ...room,
      seats: room.seats.map((seat) => {
        const fixtureParticipant = fixture.participants.find(
          (candidate) => candidate.participantId === seat.participantId
        );
        if (!fixtureParticipant) {
          return seat;
        }
        return {
          ...seat,
          chips: fixtureParticipant.startingChips,
          cumulativeBuyIn: fixture.settings.mode === "cash"
            ? fixtureParticipant.startingChips
            : fixture.settings.initialChips,
          status: "ready" as const
        };
      })
    };

    const seeded = fixture.startHand ? startHand(room, fixture.deck, 0) : room;
    const redis = this.redisFactory(this.options.targetEnvironment.redisUrl);
    redis.on?.("error", () => undefined);
    try {
      await new LiveRoomStore(createRedisKeyValueStore(redis)).saveRoom(seeded);
      return seeded;
    } finally {
      redis.disconnect();
    }
  }
}

export function buildRunResourceRecord(input: {
  runId: string;
  room: CreatedRoomIdentity;
  participants: readonly JoinedPlayerIdentity[];
  targetEnvironment: FixtureTargetEnvironment;
}): FixtureRunResourceRecord {
  assertVerifiedIsolatedEnvironment(input.targetEnvironment);
  if (input.runId !== input.targetEnvironment.runId) {
    throw new Error("Run resource ID does not match its verified isolated stack");
  }
  const participantIds: Record<string, string> = {};
  const ownershipMarkers: Record<string, string> = {};

  for (const participant of input.participants) {
    if (participantIds[participant.role]) {
      throw new Error(`Duplicate resource role: ${participant.role}`);
    }
    const expectedMarker = `SITE-${input.runId}-${participant.role}`;
    if (participant.displayName !== expectedMarker) {
      throw new Error(`Participant ${participant.role} does not use ownership marker ${expectedMarker}`);
    }
    participantIds[participant.role] = participant.participantId;
    ownershipMarkers[participant.role] = participant.displayName;
  }

  return RunResourceRecordSchema.parse({
    runId: input.runId,
    resourceType: "poker-room",
    resourceId: input.room.roomId,
    ownerRunId: input.runId,
    cleanupStatus: "pending",
    details: {
      targetEnvironment: input.targetEnvironment.name,
      participantIds,
      ownershipMarkers
    }
  });
}

function assertVerifiedIsolatedEnvironment(environment: FixtureTargetEnvironment): void {
  if (!verifiedIsolatedTargets.has(environment)) {
    throw new Error("FixtureRuntime requires a target derived from a verified isolated stack");
  }
  const baseUrl = new URL(environment.baseUrl);
  const redisUrl = new URL(environment.redisUrl);
  if (baseUrl.hostname !== "127.0.0.1" || redisUrl.hostname !== "127.0.0.1") {
    throw new Error("FixtureRuntime requires loopback-only application and Redis endpoints");
  }
}

function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function defaultRedisFactory(url: string): FixtureRedisClient {
  return new Redis(url, { lazyConnect: true });
}
