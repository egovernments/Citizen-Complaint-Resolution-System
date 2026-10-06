import { config } from "../../infrastructure/config.js";
import { withRedisLease } from "../../infrastructure/redis.js";
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
  return withRedisLease(uuidLockKey(tenantId, uuid), {
    ttlMs: UUID_LOCK_TTL_MS, renewMs: PERSON_LEASE_RENEW_MS, waitMs: options.waitMs ?? WAIT_MS,
    busy: () => new BindingBusyError(), quietRelease: true,
  }, (lease) => operation({
    async assertHeld() {
      if (!await lease.held()) throw new LeaseLostError("The DIGIT account lock was lost; retry");
    },
  }));
}
