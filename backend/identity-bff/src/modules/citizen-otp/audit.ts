import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";

export type CitizenOtpAuditEvent = "OTP_SEND" | "OTP_VERIFY" | "SESSION_CREATE";

export interface CitizenOtpAuditRecord {
  event: CitizenOtpAuditEvent;
  outcome: "SUCCESS" | "REFUSED" | "FAILED";
  /** Stable machine reason for a refusal or failure, e.g. `OTP_LOCKED`. */
  reason?: string;
  tenantId?: string;
  urlSlug?: string;
  /** Keyed hashes from `privateRef`: never a raw phone, IP or session id. */
  phoneRef?: string;
  ipRef?: string;
  sessionRef?: string;
  challengeId?: string;
  subject?: string;
}

export function auditStreamKey(): string {
  return `${config.cachePrefix}:identity:audit`;
}

/**
 * One record per send, verify and session. It goes to a capped Redis stream
 * (queryable, survives restarts) and to stdout for the log pipeline. An audit
 * write never fails the request it describes.
 */
export async function audit(record: CitizenOtpAuditRecord): Promise<void> {
  const entry = { at: new Date().toISOString(), ...record };
  console.info(JSON.stringify({ audit: "identity.citizen_otp", ...entry }));
  const fields = Object.entries(entry).flatMap(([key, value]) =>
    value === undefined ? [] : [key, String(value)]);
  try {
    await getRedis().xadd(
      auditStreamKey(), "MAXLEN", "~", String(config.identityAuditStreamMaxLength), "*", ...fields,
    );
  } catch (error) {
    console.warn("Identity audit write failed:", (error as Error).message);
  }
}
