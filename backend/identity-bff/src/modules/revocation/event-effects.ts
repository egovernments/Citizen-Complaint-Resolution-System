import { propagateVerifiedIdentifiers } from "../sync/identifiers.js";
import { getRedis } from "../../infrastructure/redis.js";
import { listPersonSessions, subjectForKcSession } from "../sessions/session-store.js";
import { key } from "./inventory.js";
import { endKeycloakSessions, enqueueRevocation, revokeTenantMembers } from "./index.js";
import type { EventStream, KeycloakEvent } from "./event-source.js";

export interface IdentifierEffects {
  propagateVerifiedIdentifiers(subject: string): Promise<void>;
  requestReconcileNow(reason: string): Promise<void>;
}
// Required providers are loaded lazily until the sync PR lands. Failure is retryable;
// it never advances the event checkpoint and has no success fallback.
const identifierEffects: IdentifierEffects = {
  propagateVerifiedIdentifiers,
  async requestReconcileNow(reason) {
    // Imported lazily only to break the sync ↔ revocation module cycle; the
    // literal path keeps it type-checked.
    await (await import("../sync/reconcile.js")).requestReconcileNow(reason);
  },
};
function representation(event: KeycloakEvent): Record<string, any> {
  if (!event.representation) return {};
  const value = JSON.parse(event.representation);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
const eventId = (event: KeycloakEvent) => `${event.time}:${event.id}`;

/** Resolve only explicit event tenant metadata. Missing mappings force reconcile. */
function eventTenant(rep: Record<string, any>): string | undefined {
  const value = rep.attributes?.["digit.rootTenantId"];
  const tenant = Array.isArray(value) ? value[0] : value;
  return typeof tenant === "string" && tenant ? tenant : undefined;
}
export async function applyKeycloakEvent(stream: EventStream, event: KeycloakEvent, sync: IdentifierEffects = identifierEffects): Promise<void> {
  if (event.error) return;
  if (stream === "user") {
    const sub = event.userId;
    if (!sub) return;
    if (event.type === "UPDATE_CREDENTIAL" || event.type === "REMOVE_CREDENTIAL") {
      let keepSessionId: string | undefined;
      if (event.type === "UPDATE_CREDENTIAL" && event.details?.credential_type === "password" && event.details.code_id && event.clientId) {
        const matches = (await listPersonSessions(sub)).filter(session => session.kcSessionId === event.details!.code_id && session.oidcClientId === event.clientId);
        // Ambiguous matches are not enough evidence to exempt a session.
        if (matches.length === 1) keepSessionId = matches[0].sessionId;
      }
      // The Keycloak session that made the change proved the new credential (or the action
      // token) and survives whatever its client (§10). 26.7.3 puts it in code_id, not sessionId.
      const changeKcSessionId = event.sessionId ?? event.details?.code_id;
      await enqueueRevocation(sub, "CREDENTIAL_CHANGED", { eventId: eventId(event), keepSessionId, changedAt: event.time,
        ...(changeKcSessionId && { changeKcSessionId }) });
    } else if (event.type === "LOGOUT" && event.sessionId) {
      await endKeycloakSessions(event.sessionId, event.clientId, sub);
    } else if (event.type === "DELETE_ACCOUNT") {
      await auditDeletion(sub, event);
      await enqueueRevocation(sub, "KEYCLOAK_DELETED", { eventId: eventId(event) });
    } else if (event.type === "VERIFY_EMAIL" || event.type === "UPDATE_EMAIL") {
      await sync.propagateVerifiedIdentifiers(sub);
    }
    // UPDATE_PASSWORD is the 26.7.3 twin; UPDATE_CREDENTIAL handles it once.
    return;
  }
  const path = event.resourcePath || "";
  const user = /^users\/([^/]+)(?:\/(.*))?$/.exec(path);
  if (event.resourceType === "USER" && user) {
    const sub = user[1]; const action = user[2];
    if (event.operationType === "DELETE" && !action) {
      await auditDeletion(sub, event);
      await enqueueRevocation(sub, "KEYCLOAK_DELETED", { eventId: eventId(event) });
    } else if (event.operationType === "ACTION" && ["logout", "reset-password"].includes(action)) {
      await enqueueRevocation(sub, action === "logout" ? "LOGOUT_ALL" : "CREDENTIAL_CHANGED",
        { eventId: eventId(event), ...(action === "reset-password" && { changedAt: event.time }) });
    } else if (event.operationType === "UPDATE" && !action) {
      if (representation(event).enabled === false)
        await enqueueRevocation(sub, "KEYCLOAK_DISABLED", { eventId: eventId(event) });
      // Even our own mirror PUT must not suppress security or verified-identifier checks.
      await sync.propagateVerifiedIdentifiers(sub);
    }
    return;
  }
  const session = /^sessions\/([^/]+)$/.exec(path);
  if (event.resourceType === "USER_SESSION" && event.operationType === "DELETE" && session) {
    // O(1): the index written with the session, else the event's own user;
    // only a session with neither falls back to the realm scan.
    const rep = representation(event);
    const subject = await subjectForKcSession(session[1]) ?? (typeof rep.userId === "string" && rep.userId ? rep.userId : undefined);
    await endKeycloakSessions(session[1], undefined, subject); return;
  }
  const membership = /^organizations\/([^/]+)\/members\/([^/]+)$/.exec(path);
  if (event.resourceType === "ORGANIZATION_MEMBERSHIP" && event.operationType === "DELETE" && membership) {
    const tenantId = eventTenant(representation(event));
    if (tenantId) await enqueueRevocation(membership[2], "MEMBERSHIP_REMOVED", { tenantId, eventId: eventId(event) });
    else await sync.requestReconcileNow("membership-removed");
    return;
  }
  if (event.resourceType === "ORGANIZATION") {
    const rep = representation(event);
    const failed = rep.attributes?.["digit.lifecycle"]?.[0] === "FAILED";
    if (event.operationType !== "DELETE" && !(event.operationType === "UPDATE" && (rep.enabled === false || failed))) return;
    const tenantId = eventTenant(rep);
    if (tenantId) await revokeTenantMembers(tenantId, "ORGANIZATION_DISABLED");
    else await sync.requestReconcileNow(event.operationType === "DELETE" ? "organization-deleted" : "organization-disabled");
  }
}
async function auditDeletion(subject: string, event: KeycloakEvent): Promise<void> {
  const record = { event: "KEYCLOAK_USER_DELETED", subject, eventId: event.id, time: String(event.time) };
  await getRedis().xadd(key("audit"), "MAXLEN", "~", 100000, "*", ...Object.entries(record).flat());
  console.info(JSON.stringify({ audit: "identity", ...record }));
}
