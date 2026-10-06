import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../../infrastructure/config.js";
import { getRedis, withRedisLease, type RedisLease } from "../../infrastructure/redis.js";

/**
 * One renewable Redis lease per Keycloak person (design §6, D25/A2).
 *
 * Every read-modify-write of a person's Keycloak user, every `_select`, every
 * revocation and every binding change for that person runs inside it, so
 * issuing a token and revoking it can never interleave. Lock order:
 * operation → tenant → slug → person → phone → uuid. Shorter locks (phone,
 * uuid) are only taken inside this one.
 *
 * The contract (§2.5) says code that holds the lease passes it down rather
 * than taking it again. As a safety net, a nested call for the same person in
 * the same async call chain gets the held lease back instead of deadlocking.
 * Asking for a second person's lease while holding one throws: code that
 * touches several people takes their leases one after another.
 */

export const PERSON_LEASE_TTL_MS = 30_000;
export const PERSON_LEASE_RENEW_MS = 10_000;
export const PERSON_LEASE_WAIT_MS = 15_000;
const RETRY_MS = 100;

/** The person is busy in another request; routes answer 503 with Retry-After. */
export class LeaseBusyError extends Error {
  readonly status = 503;
  readonly code = "IDENTITY_BUSY";
  constructor(message = "This account is busy; retry") {
    super(message);
  }
}

/** The lease expired or moved while held. Abort and return nothing. */
export class LeaseLostError extends Error {
  readonly status = 503;
  readonly code = "IDENTITY_BUSY";
  constructor(message = "The account lease was lost; retry") {
    super(message);
  }
}

export interface PersonLease {
  readonly subject: string;
  readonly token: string;
  /** Throws LeaseLostError unless this lease is still held in Redis. */
  assertHeld(): Promise<void>;
  /** SET key value, expiring at expiresAtMs, only while this lease is held. */
  fencedSet(key: string, value: string, expiresAtMs: number): Promise<boolean>;
}

const FENCED_SET = [
  "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end",
  "redis.call('set', KEYS[2], ARGV[2], 'PXAT', ARGV[3])",
  "return 1",
].join("\n");

export const personLeaseKey = (subject: string) =>
  `${config.cachePrefix}:identity:subject-lease:${subject}`;

const held = new AsyncLocalStorage<PersonLease>();

/** The person lease held by the current async call chain, or null. */
export function currentPersonLease(): PersonLease | null {
  return held.getStore() ?? null;
}

class RedisPersonLease implements PersonLease {
  constructor(readonly subject: string, private readonly lease: RedisLease) {}
  get token(): string { return this.lease.token; }

  async assertHeld(): Promise<void> {
    if (!await this.lease.held()) throw new LeaseLostError();
  }

  async fencedSet(key: string, value: string, expiresAtMs: number): Promise<boolean> {
    if (this.lease.lost) return false;
    const written = await getRedis().eval(FENCED_SET, 2, this.lease.key, key, this.token, value, String(Math.ceil(expiresAtMs)));
    if (written !== 1) this.lease.lost = true;
    return written === 1;
  }
}

export async function withPersonLease<T>(
  subject: string,
  operation: (lease: PersonLease) => Promise<T>,
  options: { waitMs?: number } = {},
): Promise<T> {
  if (!subject) throw new Error("A person lease needs a subject");
  const current = currentPersonLease();
  if (current) {
    if (current.subject === subject) return operation(current);
    throw new Error("Already holding another person's lease; take person leases one at a time");
  }
  return withRedisLease(personLeaseKey(subject), {
    ttlMs: PERSON_LEASE_TTL_MS, renewMs: PERSON_LEASE_RENEW_MS, waitMs: options.waitMs ?? PERSON_LEASE_WAIT_MS,
    retryMs: RETRY_MS, busy: () => new LeaseBusyError(), quietRelease: true,
  }, (redisLease) => {
    const lease = new RedisPersonLease(subject, redisLease);
    return held.run(lease, () => operation(lease));
  });
}
