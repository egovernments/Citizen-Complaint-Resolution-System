import { currentPersonLease } from "../accounts/person-lease.js";
import { request } from "../organizations/organization-service.js";

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
  delete body.enabled;
  await lease.assertHeld();
  await request(path, { method: "PUT", body: JSON.stringify(body) });
  await lease.assertHeld();
}
