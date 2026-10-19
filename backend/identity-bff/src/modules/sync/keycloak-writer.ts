import { currentPersonLease } from "../accounts/person-lease.js";
import { request } from "../organizations/organization-service.js";
import { config } from "../../infrastructure/config.js";

export interface UserRepresentation {
  id?: string;
  username?: string;
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  attributes?: Record<string, string[]>;
  requiredActions?: string[];
  [key: string]: unknown;
}

export class KeycloakConflictError extends Error {
  readonly status = 409;
  readonly code = "IDENTITY_EMAIL_CHANGED";
  constructor() { super("The email address belongs to another identity"); }
}

/**
 * Authorship suppresses mirror reruns only.
 * It must NEVER suppress security checks or verified-identifier propagation:
 * binding/phone writes use the same client. Their idempotent effects still run.
 */
export async function isMirrorOnlyAdminEvent(event: {
  authDetails?: { clientId?: string };
  representation?: string;
  resourceType?: string;
  operationType?: string;
  resourcePath?: string;
}): Promise<boolean> {
  return Boolean(config.keycloakAdminClientSecret &&
    event.authDetails?.clientId === config.keycloakAdminClientId &&
    event.resourceType === "USER" && event.operationType === "UPDATE" &&
    /^users\/[^/]+$/.test(event.resourcePath ?? ""));
}

/**
 * Attribute/name updates share the person lease and use a fresh profile.
 * The callback receives a copy: even in-place edits cannot change the identity
 * fields we preserve. Never send enabled, so an admin disable cannot be undone.
 * Keycloak has no conditional user PUT; external profile edits between GET and
 * PUT remain a race, even though cooperating BFF writers are serialized.
 */
export async function updateKeycloakUser(
  subject: string,
  change: (user: UserRepresentation) => UserRepresentation | null,
  options: { allowEmailChange?: boolean } = {},
): Promise<void> {
  const lease = currentPersonLease();
  if (!lease || lease.subject !== subject) {
    throw new Error("Keycloak user updates require that person's lease");
  }
  await lease.assertHeld();
  const path = `/users/${encodeURIComponent(subject)}`;
  const current = await (await request(path)).json() as UserRepresentation;
  const changed = change(structuredClone(current));
  if (changed === null) return;

  const body: UserRepresentation = { ...current };
  for (const field of ["attributes", "firstName", "lastName"] as const) {
    if (Object.hasOwn(changed, field)) Object.assign(body, { [field]: changed[field] });
  }
  if (options.allowEmailChange) {
    if (typeof changed.email !== "string" || !changed.email.trim() || changed.emailVerified !== false) {
      throw new Error("An email change requires a nonempty email and emailVerified=false");
    }
    body.email = changed.email.trim();
    body.emailVerified = false;
  }
  delete body.enabled;
  await lease.assertHeld();
  try {
    await request(path, { method: "PUT", body: JSON.stringify(body) });
  } catch (error) {
    if (options.allowEmailChange && (error as { status?: number })?.status === 409) throw new KeycloakConflictError();
    throw error;
  }
  await lease.assertHeld();
}
