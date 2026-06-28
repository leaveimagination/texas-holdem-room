import { describe, expect, it } from "vitest";
import { createInitialRoomState } from "@/lib/poker/engine";
import { LiveRoomStore, type KeyValueStore } from "@/server/live-room-store";

class MemoryStore implements KeyValueStore {
  values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
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
});
