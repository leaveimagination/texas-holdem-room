import type { RoomState } from "@/lib/poker/engine";

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export class LiveRoomStore {
  constructor(private readonly store: KeyValueStore) {}

  async getRoom(roomId: string): Promise<RoomState | null> {
    const raw = await this.store.get(this.key(roomId));
    return raw ? (JSON.parse(raw) as RoomState) : null;
  }

  async saveRoom(room: RoomState, ttlSeconds = 86400): Promise<void> {
    await this.store.set(this.key(room.roomId), JSON.stringify(room), "EX", ttlSeconds);
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.store.del(this.key(roomId));
  }

  private key(roomId: string): string {
    return `room:${roomId}`;
  }
}
