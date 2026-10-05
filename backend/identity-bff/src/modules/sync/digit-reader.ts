import { withDigitAdmin } from "../managed-accounts/digit-admin-session.js";
import { searchAccounts, DigitUnavailableError, type DigitAccount } from "../managed-accounts/digit-user-client.js";
import type { AccountEntry } from "./state.js";

/** Read both account states: an inactive account is not a missing account. */
export function readDigitAccount(entry: Pick<AccountEntry, "tenantId" | "uuid" | "kind">): Promise<DigitAccount | null> {
  return withDigitAdmin(async token => {
    const criteria = { tenantId: entry.tenantId, uuid: [entry.uuid],
      userType: entry.kind === "staff" ? "EMPLOYEE" : "CITIZEN" };
    const active = await searchAccounts(token, { ...criteria, active: true });
    const inactive = await searchAccounts(token, { ...criteria, active: false });
    // The latter read wins if HRMS moved the account between the searches.
    const matches = [...active, ...inactive].filter(account => account.uuid === entry.uuid &&
      account.tenantId === entry.tenantId && account.type === criteria.userType);
    const account = matches.at(-1) ?? null;
    if ([active, inactive].some(list => list.filter(item => item.uuid === entry.uuid).length > 1)) {
      throw new DigitUnavailableError("DIGIT account search was ambiguous");
    }
    return account;
  });
}
