import { startRevocationWorkers } from "./workers.js";
export { startRevocationWorkers } from "./workers.js";
import { config } from "../../infrastructure/config.js";
import { acquireRedisLease, getRedis } from "../../infrastructure/redis.js";
import { key, drainTokenRetries } from "./inventory.js";
import { drainRevocationJobs, enqueueRevocation } from "./index.js";
import { listRevocationUsers } from "./keycloak.js";
import { keycloakEventSource, type EventSource, type EventStream, type KeycloakEvent } from "./event-source.js";
import { applyKeycloakEvent } from "./event-effects.js";

const OVERLAP_MS = 60_000;
const LEASE_MS = 60_000;
const PAGE_SIZE = 100;
export const checkpointKey = (stream: EventStream) => key(`kc-events:${stream}:checkpoint`);
export const seenKey = (stream: EventStream) => key(`kc-events:${stream}:seen`);
const leaseKey = () => key("kc-events:lease");
export class PollerLeaseLostError extends Error {}
interface PollerOptions {
  source?: EventSource;
  effect?: (stream: EventStream, event: KeycloakEvent) => Promise<void>;
  now?: number;
}
async function knownSubjects(): Promise<string[]> {
  const subjects = new Set((await listRevocationUsers()).map(user => user.id));
  // Include deleted users whose token/session inventories survive in Redis.
  for (const family of ["person-tokens:", "person-sessions:"]) {
    let cursor = "0";
    do {
      const page = await getRedis().scan(cursor, "MATCH", `${key(family)}*`, "COUNT", 100);
      cursor = page[0];
      for (const name of page[1]) subjects.add(name.slice(key(family).length));
    } while (cursor !== "0");
  }
  return [...subjects];
}

/** One replica polls. Every checkpoint mutation is fenced to its renewable lease. */
export async function pollKeycloakEvents(options: PollerOptions = {}): Promise<boolean> {
  const redis = getRedis();
  const lease = await acquireRedisLease(leaseKey(), { ttlMs: LEASE_MS, renewMs: LEASE_MS / 3 });
  if (!lease) return false;
  const token = lease.token;
  const assertHeld = async () => {
    if (!await lease.held()) throw new PollerLeaseLostError("Keycloak event poller lease was lost");
  };
  try {
    const source = options.source ?? keycloakEventSource;
    const effect = options.effect ?? applyKeycloakEvent;
    const now = options.now ?? Date.now();
    const retention = await source.retentionMs();
    let swept = false;
    for (const stream of ["user", "admin"] as const) {
      const checkpoint = await redis.hgetall(checkpointKey(stream));
      if (!checkpoint.time) {
        const saved = await redis.eval(`
          if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
          redis.call('hset', KEYS[2], 'time', ARGV[2], 'idsAtTime', '[]', 'startedAt', ARGV[2])
          return 1`, 2, leaseKey(), checkpointKey(stream), token, now);
        if (saved !== 1) throw new PollerLeaseLostError();
        console.info({ event: "KEYCLOAK_EVENT_CHECKPOINT_BOOTSTRAPPED", stream, time: now });
        continue;
      }
      const last = Number(checkpoint.time || 0);
      const gap = now - last > retention;
      if (gap && !swept) {
        for (const subject of await knownSubjects()) {
          await assertHeld();
          await enqueueRevocation(subject, "LOGOUT_ALL", { eventId: `retention-gap:${now}` });
        }
        swept = true;
      }
      // Keep overlap from replaying pre-bootstrap events on subsequent polls.
      const from = Math.max(Number(checkpoint.startedAt || 0), gap ? (Number.isFinite(retention) ? Math.max(0, now - retention) : 0) : Math.max(0, last - OVERLAP_MS));
      for (let first = 0; ; first += PAGE_SIZE) {
        await assertHeld();
        const events = await source.page(stream, from, now, first, PAGE_SIZE);
        events.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
        for (const event of events) {
          if (event.time < from || event.time > now) continue;
          const id = `${event.time}:${event.id}`;
          if (await redis.zscore(seenKey(stream), id) !== null) continue;
          await assertHeld();
          await effect(stream, event);
          // Persist effects/jobs first, then atomically mark seen and move the checkpoint.
          const result = await redis.eval(`
            if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
            redis.call('zadd', KEYS[2], ARGV[2], ARGV[3])
            local previous = tonumber(redis.call('hget', KEYS[3], 'time') or '0')
            if tonumber(ARGV[2]) > previous then
              redis.call('hset', KEYS[3], 'time', ARGV[2], 'idsAtTime', cjson.encode({ARGV[4]}))
            elseif tonumber(ARGV[2]) == previous then
              local ids = cjson.decode(redis.call('hget', KEYS[3], 'idsAtTime') or '[]')
              table.insert(ids, ARGV[4]); redis.call('hset', KEYS[3], 'idsAtTime', cjson.encode(ids))
            end
            return 1`, 3, leaseKey(), seenKey(stream), checkpointKey(stream), token, event.time, id, event.id);
          if (result !== 1) throw new PollerLeaseLostError();
        }
        if (events.length < PAGE_SIZE) break;
      }
      // A completed empty window also advances the high-water mark/readiness time.
      const saved = await redis.eval(`
        if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
        local previous = tonumber(redis.call('hget', KEYS[2], 'time') or '0')
        if tonumber(ARGV[2]) > previous then redis.call('hset', KEYS[2], 'time', ARGV[2], 'idsAtTime', '[]') end
        redis.call('zremrangebyscore', KEYS[3], '-inf', '(' .. ARGV[3])
        return 1`, 3, leaseKey(), checkpointKey(stream), seenKey(stream), token, now, now - OVERLAP_MS);
      if (saved !== 1) throw new PollerLeaseLostError();
    }
    await assertHeld();
    await drainRevocationJobs();
    await drainTokenRetries();
    return true;
  } finally {
    await lease.release().catch(() => undefined);
  }
}
export async function getPollerReadiness(): Promise<{ status: "ok" | "down" | "disabled"; lagSeconds: number | null }> {
  if (!config.keycloakOrganizationRealm) return { status: "disabled", lagSeconds: null };
  try {
    const times = await Promise.all((["user", "admin"] as const).map(stream => getRedis().hget(checkpointKey(stream), "time")));
    if (times.some(time => !time || !Number.isFinite(Number(time)))) return { status: "down", lagSeconds: null };
    const lagSeconds = Math.max(0, (Date.now() - Math.min(...times.map(Number))) / 1000);
    const configured = Number(process.env.IDENTITY_POLLER_MAX_LAG_SECONDS || 60);
    const maxLag = Number.isFinite(configured) && configured > 0 ? configured : 60;
    return { status: lagSeconds <= maxLag ? "ok" : "down", lagSeconds };
  } catch { return { status: "down", lagSeconds: null }; }
}
export function startKeycloakEventPoller(): () => void {
  const stopWorkers = startRevocationWorkers();
  let active = false; let stopped = false;
  const tick = async () => {
    if (active || stopped) return;
    active = true;
    try { await pollKeycloakEvents(); }
    catch { console.warn("Keycloak event poll failed; checkpoint retained for retry"); }
    finally { active = false; }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, 5_000); timer.unref();
  return () => { stopped = true; clearInterval(timer); stopWorkers(); };
}
