import { describe, expect, it } from "vitest";
import { createInitialRoomState } from "@/lib/poker/engine";
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
});
