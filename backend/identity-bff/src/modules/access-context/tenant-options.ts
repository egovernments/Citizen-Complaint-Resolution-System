import { config } from "../../infrastructure/config.js";
import type { KeycloakClaims } from "../authentication/types.js";
import {
  findManagedAccount,
  ManagedAccountError,
  managedIdentity,
} from "../managed-accounts/managed-account-service.js";
import {
  liveMembershipsForSubject,
  membershipsFromClaims,
  tenantOption,
  type TenantOption,
} from "./tenant-directory.js";

/**
 * Return only Organizations that also have a usable managed DIGIT account.
 * Discovery is read-only; creation and role projection happen during
 * provisioning or explicit context selection.
 */
export async function resolveTenantOptions(
  claims: KeycloakClaims,
  live = false,
): Promise<TenantOption[]> {
  const memberships = live
    ? await liveMembershipsForSubject(claims.sub)
    : await membershipsFromClaims(claims);
  const options: TenantOption[] = [];
  for (const membership of memberships) {
    const identity = managedIdentity(config.keycloakIssuer, claims.sub, membership.tenantId);
    const account = await findManagedAccount(identity).catch((error) => {
      if (error instanceof ManagedAccountError) return null;
      throw error;
    });
    const option = tenantOption(membership, account);
    if (option) options.push(option);
  }
  return options;
}
