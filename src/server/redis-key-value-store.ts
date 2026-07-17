import type { KeyValueStore } from "./live-room-store";

export interface RedisKeyValueClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export function createRedisKeyValueStore(client: RedisKeyValueClient): KeyValueStore {
  return {
    get(key) {
      return client.get(key);
    },
    set(key, value, mode, ttlSeconds) {
      if (mode === "EX" && ttlSeconds !== undefined) {
        return client.set(key, value, "EX", ttlSeconds);
      }

      return client.set(key, value);
    },
    del(key) {
      return client.del(key);
    }
  };
}
