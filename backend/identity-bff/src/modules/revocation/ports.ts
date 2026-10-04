import { bindingsFor } from "../bindings/store.js";
import { findLiveStaffToken } from "../accounts/credential-service.js";
import { readOrganizationByTenant } from "../onboarding/organization-reader.js";
import { request } from "../organizations/organization-service.js";
import type { AccountRef } from "./inventory.js";

export interface StaffAccount extends AccountRef { userName: string; keyVersion?: number }
export interface AccountEntry extends AccountRef {
  kind: "staff" | "citizen";
  userName?: string;
  active?: boolean;
  credential?: { keyVersion: number };
}
export interface IdentityUser { id: string; attributes?: Record<string, string[]> }

export const revocationPorts = {
  findLiveStaffToken,
  bindingsFor,
  readOrganizationByTenant,
  async user(subject: string): Promise<IdentityUser | null> {
    const response = await request(`/users/${encodeURIComponent(subject)}`, {}, [200, 404]);
    return response.status === 404 ? null : response.json() as Promise<IdentityUser>;
  },
  async users(): Promise<IdentityUser[]> { return pages<IdentityUser>("/users"); },
  async members(organizationId: string): Promise<Array<{ id: string }>> {
    return pages(`/organizations/${encodeURIComponent(organizationId)}/members`);
  },
  async endKeycloakSession(sessionId: string): Promise<void> {
    await request(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }, [204, 404]);
  },
};
export async function pages<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  for (let first = 0; ; first += 100) {
    const response = await request(`${path}${path.includes("?") ? "&" : "?"}first=${first}&max=100`);
    const page = await response.json() as T[];
    result.push(...page);
    if (page.length < 100) return result;
  }
}
export function accountsFromUser(user: IdentityUser | null): AccountEntry[] {
  const raw = user?.attributes?.["digit.accounts"]?.[0];
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { v: number; entries: AccountEntry[] };
  if (parsed.v !== 1 || !Array.isArray(parsed.entries)) throw new Error("Invalid digit.accounts inventory");
  return parsed.entries;
}
