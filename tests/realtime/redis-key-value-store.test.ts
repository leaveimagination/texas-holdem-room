import { describe, expect, it, vi } from "vitest";
import { createRedisKeyValueStore } from "@/server/redis-key-value-store";

describe("createRedisKeyValueStore", () => {
  it("maps get, expiring set, plain set, and del without changing values", async () => {
    const client = {
      get: vi.fn().mockResolvedValue("raw-value"),
      set: vi.fn()
        .mockResolvedValueOnce("ttl-result")
        .mockResolvedValueOnce("plain-result"),
      del: vi.fn().mockResolvedValue(2)
    };
    const store = createRedisKeyValueStore(client);

    await expect(store.get("room:one")).resolves.toBe("raw-value");
    await expect(store.set("room:one", "ttl-value", "EX", 45)).resolves.toBe("ttl-result");
    await expect(store.set("room:two", "plain-value")).resolves.toBe("plain-result");
    await expect(store.del("room:one")).resolves.toBe(2);

    expect(client.get).toHaveBeenCalledWith("room:one");
    expect(client.set).toHaveBeenNthCalledWith(1, "room:one", "ttl-value", "EX", 45);
    expect(client.set).toHaveBeenNthCalledWith(2, "room:two", "plain-value");
    expect(client.del).toHaveBeenCalledWith("room:one");
  });
});
