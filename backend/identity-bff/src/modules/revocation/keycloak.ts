import { request } from "../organizations/organization-service.js";
import { findUser, paged } from "../../integrations/keycloak/admin-api.js";
import type { UserRepresentation } from "../sync/keycloak-writer.js";

export interface IdentityUser extends UserRepresentation { id: string }
export async function getRevocationUser(subject: string): Promise<IdentityUser | null> {
  return findUser(subject) as Promise<IdentityUser | null>;
}
export async function listRevocationUsers(): Promise<IdentityUser[]> { return paged<IdentityUser>("/users"); }
export async function listOrganizationMembers(organizationId: string): Promise<Array<{ id: string }>> {
  return paged(`/organizations/${encodeURIComponent(organizationId)}/members`);
}
export async function endKeycloakSession(sessionId: string): Promise<void> {
  await request(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }, [204, 404]);
}
