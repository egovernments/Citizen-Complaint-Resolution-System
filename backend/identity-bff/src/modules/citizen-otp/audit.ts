import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";

export type CitizenOtpAuditEvent =
  | "OTP_SEND" | "OTP_VERIFY" | "SESSION_CREATE"
  | "ACCOUNT_LINK_CREATE" | "ACCOUNT_LINK_REFUSED" | "ACCOUNT_LINK_REVOKE"
  | "TENANT_ROUTE_BACKFILL";

export interface CitizenOtpAuditRecord {
  event: CitizenOtpAuditEvent;
  outcome: "SUCCESS" | "REFUSED" | "FAILED";
  /** Stable machine reason for a refusal or failure, e.g. `OTP_RATE_LIMITED`. */
  reason?: string;
  tenantId?: string;
  urlSlug?: string;
  /** Keyed hashes from `privateRef`: never a raw phone, IP or session id. */
  phoneRef?: string;
  ipRef?: string;
  sessionRef?: string;
  challengeId?: string;
  subject?: string;
  /** Account links: how ownership was proved, and by whom. */
  method?: "ADMIN" | "VERIFIED_PHONE";
  actor?: string;
  userType?: string;
  digitUserUuid?: string;
  /** Short machine-readable summary, e.g. backfill counts. */
  detail?: string;
}

export function auditStreamKey(): string {
  return `${config.cachePrefix}:identity:audit`;
}

/**
 * One record per OTP send, verify and session, account link and tenant-route
 * backfill. It goes to a capped Redis stream
 * (queryable, survives restarts) and to stdout for the log pipeline. An audit
 * write never fails the request it describes.
 */
export async function audit(record: CitizenOtpAuditRecord): Promise<void> {
  const entry = { at: new Date().toISOString(), ...record };
  console.info(JSON.stringify({ audit: "identity", ...entry }));
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
