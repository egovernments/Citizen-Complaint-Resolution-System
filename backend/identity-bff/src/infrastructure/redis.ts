import { Redis } from "ioredis";
import { config } from "./config.js";

let redis: Redis;

export function initCache(redisUrl?: string) {
  redis = redisUrl
    ? new Redis(redisUrl)
    : new Redis({ host: config.redisHost, port: config.redisPort });
  return redis;
}

export function getRedis() {
  return redis;
}

export async function closeCache(): Promise<void> {
  await redis?.quit();
}
