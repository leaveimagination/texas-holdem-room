import Redis from "ioredis";
import { loadLocalEnv } from "./env";

export function createRedisClient(): Redis {
  loadLocalEnv();
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true });
}
