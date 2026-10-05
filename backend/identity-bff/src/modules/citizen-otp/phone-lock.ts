import { config } from "../../infrastructure/config.js";
import { withRedisLease } from "../../infrastructure/redis.js";
import { currentPersonLease, LeaseBusyError, LeaseLostError } from "../accounts/person-lease.js";
import { privateRef } from "./otp-store.js";

export const phoneLockKey = (phone: string) => `${config.cachePrefix}:identity:phone-lock:${privateRef("phone", phone)}`;
export interface PhoneLock { assertHeld(): Promise<void> }

/** Person then normalized phone. Renewal and held checks protect slow Admin calls. */
export async function withPhoneLock<T>(phone: string, operation: (lock: PhoneLock) => Promise<T>, options: { waitMs?: number } = {}): Promise<T> {
  const person = currentPersonLease();
  if (!person) throw new Error("The phone lock requires a person lease");
  if (!/^\+[1-9]\d{3,14}$/.test(phone)) throw new Error("The phone lock requires normalized E.164");
  await person.assertHeld();
  return withRedisLease(phoneLockKey(phone), {
    ttlMs: 30_000, renewMs: 10_000, waitMs: options.waitMs ?? 15000,
    busy: () => new LeaseBusyError("The phone number is busy; retry"), quietRelease: true,
  }, (lease) => operation({ async assertHeld() {
    await person.assertHeld();
    if (!await lease.held()) throw new LeaseLostError("The phone number lock was lost; retry");
  } }));
}
