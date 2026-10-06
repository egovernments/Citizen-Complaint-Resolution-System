import { withDigitAdmin } from "../managed-accounts/digit-admin-session.js";
import { searchAccounts, DigitUnavailableError, type DigitAccount } from "../managed-accounts/digit-user-client.js";
import { withinWorkspace } from "../bindings/tenant-scope.js";
import type { AccountEntry } from "./state.js";

/**
 * Read both account states: an inactive account is not a missing account. A staff entry's account may sit at a
 * child of its workspace tenant (D16, amended), which an exact egov-user tenant filter never returns, so staff are
 * searched by uuid alone and must come back at the workspace or a child. Citizens keep the exact tenant.
 */
export function readDigitAccount(entry: Pick<AccountEntry, "tenantId" | "uuid" | "kind">): Promise<DigitAccount | null> {
  return withDigitAdmin(async token => {
    const staff = entry.kind === "staff";
    const criteria = { ...(!staff && { tenantId: entry.tenantId }), uuid: [entry.uuid],
      userType: staff ? "EMPLOYEE" : "CITIZEN" };
    const active = await searchAccounts(token, { ...criteria, active: true });
    const inactive = await searchAccounts(token, { ...criteria, active: false });
    // The latter read wins if HRMS moved the account between the searches.
    const matches = [...active, ...inactive].filter(account => account.uuid === entry.uuid &&
      (staff ? withinWorkspace(account.tenantId, entry.tenantId) : account.tenantId === entry.tenantId) &&
      account.type === criteria.userType);
    const account = matches.at(-1) ?? null;
    if ([active, inactive].some(list => list.filter(item => item.uuid === entry.uuid).length > 1)) {
      throw new DigitUnavailableError("DIGIT account search was ambiguous");
    }
    return account;
  });
}
