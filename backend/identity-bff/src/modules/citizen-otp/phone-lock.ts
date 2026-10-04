import { randomUUID } from "node:crypto";
import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";
import { currentPersonLease, LeaseBusyError, LeaseLostError } from "../accounts/person-lease.js";
import { privateRef } from "./otp-store.js";

const TTL_MS = 30_000;
const RENEW = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
export const phoneLockKey = (phone: string) => `${config.cachePrefix}:identity:phone-lock:${privateRef("phone", phone)}`;
export interface PhoneLock { assertHeld(): Promise<void> }

/** Person then normalized phone. Renewal and held checks protect slow Admin calls. */
export async function withPhoneLock<T>(phone: string, operation: (lock: PhoneLock) => Promise<T>, options: { waitMs?: number } = {}): Promise<T> {
  const person = currentPersonLease();
  if (!person) throw new Error("The phone lock requires a person lease");
  if (!/^\+[1-9]\d{3,14}$/.test(phone)) throw new Error("The phone lock requires normalized E.164");
  await person.assertHeld();
  const key = phoneLockKey(phone);
  const token = randomUUID();
  const deadline = Date.now() + (options.waitMs ?? 15000);
  while (await getRedis().set(key, token, "PX", TTL_MS, "NX") !== "OK") {
    if (Date.now() >= deadline) throw new LeaseBusyError("The phone number is busy; retry");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  let lost = false;
  const timer = setInterval(() => {
    void getRedis().eval(RENEW, 1, key, token, TTL_MS).then(result => { if (result !== 1) lost = true; }, () => { lost = true; });
  }, 10000);
  timer.unref();
  const lock: PhoneLock = { async assertHeld() {
    await person.assertHeld();
    if (lost || await getRedis().get(key) !== token) throw new LeaseLostError("The phone number lock was lost; retry");
  } };
  try { return await operation(lock); }
  finally { clearInterval(timer); await getRedis().eval(RELEASE, 1, key, token).catch(() => undefined); }
}
