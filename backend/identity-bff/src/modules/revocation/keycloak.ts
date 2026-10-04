import { request } from "../organizations/organization-service.js";
import type { UserRepresentation } from "../sync/keycloak-writer.js";

export interface IdentityUser extends UserRepresentation { id: string }
export async function getRevocationUser(subject: string): Promise<IdentityUser | null> {
  const response = await request(`/users/${encodeURIComponent(subject)}`, {}, [200, 404]);
  return response.status === 404 ? null : response.json() as Promise<IdentityUser>;
}
export async function listRevocationUsers(): Promise<IdentityUser[]> { return pages<IdentityUser>("/users"); }
export async function listOrganizationMembers(organizationId: string): Promise<Array<{ id: string }>> {
  return pages(`/organizations/${encodeURIComponent(organizationId)}/members`);
}
export async function endKeycloakSession(sessionId: string): Promise<void> {
  await request(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }, [204, 404]);
}
export async function pages<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  for (let first = 0; ; first += 100) {
    const response = await request(`${path}${path.includes("?") ? "&" : "?"}first=${first}&max=100`);
    const page = await response.json() as T[];
    result.push(...page);
    if (page.length < 100) return result;
  }
}
