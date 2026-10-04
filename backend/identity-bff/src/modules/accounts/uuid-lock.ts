import { randomUUID } from "node:crypto";
import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";
import { currentPersonLease, LeaseLostError, PERSON_LEASE_RENEW_MS } from "./person-lease.js";

/**
 * Short lock on one DIGIT account while a binding to it is created, accepted
 * or removed (design §3). Together with the `digit.boundUuids` search it keeps
 * one DIGIT uuid bound to at most one person. Last in the lock order, so it is
 * only taken inside a person lease. Like the person lease it is renewed while
 * held; call `assertHeld()` right before the write it protects.
 */

export const UUID_LOCK_TTL_MS = 30_000;
const WAIT_MS = 15_000;
/** The uuid lock wait timed out (503 BINDING_BUSY). */
export class BindingBusyError extends Error {
  readonly status = 503;
  readonly code = "BINDING_BUSY";
  constructor(message = "This DIGIT account is busy; retry") {
    super(message);
  }
}

const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const RENEW = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

export interface UuidLock {
  /** Throws LeaseLostError unless this uuid lock is still held. */
  assertHeld(): Promise<void>;
}

export const uuidLockKey = (tenantId: string, uuid: string) =>
  `${config.cachePrefix}:identity:uuid-lock:${tenantId}:${uuid}`;

export async function withUuidLock<T>(
  tenantId: string,
  uuid: string,
  operation: (lock: UuidLock) => Promise<T>,
  options: { waitMs?: number } = {},
): Promise<T> {
  if (!currentPersonLease()) throw new Error("The uuid lock is only taken inside a person lease");
  const key = uuidLockKey(tenantId, uuid);
  const token = randomUUID();
  const deadline = Date.now() + (options.waitMs ?? WAIT_MS);
  while (await getRedis().set(key, token, "PX", UUID_LOCK_TTL_MS, "NX") !== "OK") {
    if (Date.now() >= deadline) throw new BindingBusyError();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  let lost = false;
  const renew = async () => {
    if (lost) return;
    if (await getRedis().eval(RENEW, 1, key, token, String(UUID_LOCK_TTL_MS)) !== 1) lost = true;
  };
  const timer = setInterval(() => { renew().catch(() => { lost = true; }); }, PERSON_LEASE_RENEW_MS);
  timer.unref();
  const lock: UuidLock = {
    async assertHeld() {
      if (!lost && await getRedis().get(key) === token) return;
      lost = true;
      throw new LeaseLostError("The DIGIT account lock was lost; retry");
    },
  };
  try {
    return await operation(lock);
  } finally {
    clearInterval(timer);
    await getRedis().eval(RELEASE, 1, key, token).catch(() => undefined);
  }
}
