import { describe, expect, it } from "vitest";
import { applyPlayerAction, createInitialRoomState, startHand, type RoomState } from "@/lib/poker/engine";
import { LiveRoomStore, type KeyValueStore } from "@/server/live-room-store";

class MemoryStore implements KeyValueStore {
  values = new Map<string, string>();
  sets: Array<{ key: string; value: string; mode?: string; ttlSeconds?: number }> = [];

  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string, mode?: string, ttlSeconds?: number) {
    this.sets.push({ key, value, mode, ttlSeconds });
    this.values.set(key, value);
  }
  async del(key: string) {
    this.values.delete(key);
  }
}

describe("LiveRoomStore", () => {
  it("saves and loads room state", async () => {
    const store = new LiveRoomStore(new MemoryStore());
    const room = createInitialRoomState(
      { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
      "r1"
    );

    await store.saveRoom(room);

    expect(await store.getRoom("r1")).toMatchObject({ roomId: "r1", mode: "cash" });
  });

  it("returns null for malformed room json", async () => {
    const memoryStore = new MemoryStore();
    memoryStore.values.set("room:r1", "{this is not valid json");

    const store = new LiveRoomStore(memoryStore);

    expect(await store.getRoom("r1")).toBeNull();
  });

  it("returns null for structurally invalid room state", async () => {
    const memoryStore = new MemoryStore();
    memoryStore.values.set("room:r1", JSON.stringify({ roomId: "r1", mode: "cash" }));

    const store = new LiveRoomStore(memoryStore);

    expect(await store.getRoom("r1")).toBeNull();
  });

  it("stores room with EX ttl", async () => {
    const memoryStore = new MemoryStore();
    const store = new LiveRoomStore(memoryStore);
    const room = createInitialRoomState(
      { mode: "cash", seats: 2, initialChips: 1000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
      "r1"
    );

    await store.saveRoom(room, 120);

    expect(memoryStore.sets).toContainEqual({
      key: "room:r1",
      value: JSON.stringify(room),
      mode: "EX",
      ttlSeconds: 120
    });
  });

  it("normalizes active room snapshots written before flow fields existed", async () => {
    const memoryStore = new MemoryStore();
    const started = startHand(createReadyRoom());
    const legacy = structuredClone(started) as unknown as Record<string, unknown>;
    const legacyHand = legacy.hand as Record<string, unknown>;
    delete legacy.flow;
    delete legacy.pendingTopUps;
    delete legacy.endAfterCurrentHand;
    delete legacy.sessionEndedAt;
    delete legacy.sessionSummary;
    delete legacy.removedParticipants;
    delete legacyHand.startingChipsByParticipantId;
    memoryStore.values.set("room:legacy-active", JSON.stringify(legacy));

    const restored = await new LiveRoomStore(memoryStore).getRoom("legacy-active");

    expect(restored).toMatchObject({
      pendingTopUps: {},
      endAfterCurrentHand: false,
      sessionEndedAt: null,
      sessionSummary: null,
      removedParticipants: {},
      flow: {
        phase: "betting",
        sequence: 0,
        deadlineAt: null,
        nextRunoutStep: null,
        handResult: null
      }
    });
    expect(restored?.hand?.startingChipsByParticipantId).toEqual({ p1: 1_000, p2: 1_000 });
    expect(restored?.hand?.board).toEqual(started.hand?.board);
    expect(restored?.hand?.deck).toEqual(started.hand?.deck);
  });

  it("restores a legacy finished hand at an expired summary boundary", async () => {
    const memoryStore = new MemoryStore();
    const started = startHand(createReadyRoom());
    const finished = applyPlayerAction(started, { type: "fold", playerId: started.hand!.actorId });
    const legacy = structuredClone(finished) as unknown as Record<string, unknown>;
    const legacyHand = legacy.hand as Record<string, unknown>;
    delete legacy.flow;
    delete legacy.pendingTopUps;
    delete legacy.endAfterCurrentHand;
    delete legacy.sessionEndedAt;
    delete legacy.sessionSummary;
    delete legacyHand.startingChipsByParticipantId;
    memoryStore.values.set("room:legacy-finished-hand", JSON.stringify(legacy));

    const restored = await new LiveRoomStore(memoryStore).getRoom("legacy-finished-hand");

    expect(restored?.flow).toEqual({
      phase: "hand-summary",
      sequence: 0,
      deadlineAt: 0,
      nextRunoutStep: null,
      handResult: null
    });
    expect(restored?.hand?.finished).toBe(true);
  });
});

function createReadyRoom(): RoomState {
  const room = createInitialRoomState(
    { mode: "cash", seats: 2, initialChips: 1_000, smallBlind: 10, bigBlind: 20, actionTimerSeconds: null },
    "legacy-active"
  );
  return {
    ...room,
    seats: room.seats.map((seat, index) => ({
      ...seat,
      participantId: `p${index + 1}`,
      displayName: `P${index + 1}`,
      chips: 1_000,
      cumulativeBuyIn: 1_000,
      status: "ready"
    }))
  };
}
