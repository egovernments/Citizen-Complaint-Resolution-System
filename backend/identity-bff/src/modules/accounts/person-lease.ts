import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";

/**
 * One renewable Redis lease per Keycloak person (design §6, D25/A2).
 *
 * Every read-modify-write of a person's Keycloak user, every `_select`, every
 * revocation and every binding change for that person runs inside it, so
 * issuing a token and revoking it can never interleave. Lock order:
 * operation → tenant → slug → person → phone → uuid. Shorter locks (phone,
 * uuid) are only taken inside this one.
 *
 * Inside one async call chain the lease is re-entrant for the same person.
 * Asking for a second person's lease while holding one throws: code that
 * touches several people takes their leases one after another.
 */

export const PERSON_LEASE_TTL_MS = 30_000;
export const PERSON_LEASE_RENEW_MS = 10_000;
export const PERSON_LEASE_WAIT_MS = 15_000;
const RETRY_MS = 100;

/** The person is busy in another request; retry later. */
export class LeaseBusyError extends Error {
  readonly status = 503;
  constructor(message = "This account is busy; retry") {
    super(message);
  }
}

/** The lease expired or moved while held. Abort and return nothing. */
export class LeaseLostError extends Error {
  readonly status = 503;
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

const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const RENEW = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
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
  lost = false;
  constructor(readonly subject: string, readonly token: string, private readonly key: string) {}

  async renew(): Promise<void> {
    if (this.lost) return;
    const renewed = await getRedis().eval(RENEW, 1, this.key, this.token, String(PERSON_LEASE_TTL_MS));
    if (renewed !== 1) this.lost = true;
  }

  async assertHeld(): Promise<void> {
    if (!this.lost && await getRedis().get(this.key) === this.token) return;
    this.lost = true;
    throw new LeaseLostError();
  }

  async fencedSet(key: string, value: string, expiresAtMs: number): Promise<boolean> {
    if (this.lost) return false;
    const written = await getRedis().eval(FENCED_SET, 2, this.key, key, this.token, value, String(Math.ceil(expiresAtMs)));
    if (written !== 1) this.lost = true;
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

  const key = personLeaseKey(subject);
  const token = randomUUID();
  const deadline = Date.now() + (options.waitMs ?? PERSON_LEASE_WAIT_MS);
  while (await getRedis().set(key, token, "PX", PERSON_LEASE_TTL_MS, "NX") !== "OK") {
    if (Date.now() >= deadline) throw new LeaseBusyError();
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }

  const lease = new RedisPersonLease(subject, token, key);
  const timer = setInterval(() => {
    lease.renew().catch(() => { lease.lost = true; });
  }, PERSON_LEASE_RENEW_MS);
  timer.unref();
  try {
    return await held.run(lease, () => operation(lease));
  } finally {
    clearInterval(timer);
    await getRedis().eval(RELEASE, 1, key, token).catch(() => undefined);
  }
}
