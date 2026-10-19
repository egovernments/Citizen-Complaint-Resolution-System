import { request } from "../../modules/organizations/organization-service.js";
import type { UserRepresentation } from "../../modules/sync/keycloak-writer.js";

/**
 * Generic Keycloak Admin reads over organization-service's `request`, so
 * every caller shares its token, error mapping and test doubles.
 */

/** A Keycloak user by id. */
export async function readUser(userId: string): Promise<UserRepresentation> {
  return (await request(`/users/${encodeURIComponent(userId)}`)).json() as Promise<UserRepresentation>;
}

/** A Keycloak user by id, or null when it does not exist. */
export async function findUser(userId: string): Promise<UserRepresentation | null> {
  const response = await request(`/users/${encodeURIComponent(userId)}`, {}, [200, 404]);
  return response.status === 404 ? null : response.json() as Promise<UserRepresentation>;
}

/** The id Keycloak put in a create response's Location header. */
export function createdId(response: Response): string | undefined {
  return response.headers.get("location")?.split("/").filter(Boolean).pop();
}

/** Every page (100 per request) of a Keycloak Admin collection. */
export async function paged<T>(path: string): Promise<T[]> {
  const values: T[] = [];
  for (let first = 0; ; first += 100) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await request(`${path}${separator}first=${first}&max=100`);
    const page = await response.json() as T[];
    values.push(...page);
    if (page.length < 100) return values;
  }
}
