import { withDigitAdmin } from "../managed-accounts/digit-admin-session.js";
import {
  DigitUnavailableError, searchAccounts, updateIdentifiers,
  type DigitAccount, type DigitIdentifierUpdate,
} from "../managed-accounts/digit-user-client.js";
import { currentPersonLease } from "./person-lease.js";
import { StaffLoginError } from "./credential-errors.js";

export class DigitValidationError extends Error {
  readonly status = 503;
  readonly code = "DIGIT_ACCOUNT_INVALID";
  constructor() { super("DIGIT rejected a stored account field"); }
}

export interface DigitIdentifierChanges {
  emailId?: string;
  mobileNumber?: string;
  countryCode?: string;
  password?: string;
}

export interface DigitWriteResult {
  status: "written" | "unchanged" | "skipped-masked";
  account: DigitAccount;
}

// UserRepository.update writes these values as sent, including null/absent.
// Everything else is deliberately omitted (especially DOB, roles and locks).
const COPIED_FIELDS = [
  "id", "uuid", "tenantId", "userName", "name", "gender", "emailId",
  "altContactNumber", "alternatemobilenumber", "pan", "aadhaarNumber",
  "salutation", "signature", "identificationMark", "locale", "fatherOrHusbandName",
  "relationship", "photo", "permanentAddress", "permanentCity", "permanentPinCode",
  "correspondenceAddress", "correspondenceCity", "correspondencePinCode",
] as const;

/**
 * Fresh read, explicit field map, then update. A concurrent HRMS edit after
 * this search can still be overwritten: egov-user has no conditional update.
 * No caller snapshot is ever spread back, and identifiers are never cleared.
 */
export async function writeDigitIdentifiers(
  ref: { tenantId: string; uuid: string },
  changes: DigitIdentifierChanges,
): Promise<DigitWriteResult> {
  const supplied = Object.entries(changes).filter(([field, value]) =>
    ["emailId", "mobileNumber", "countryCode", "password"].includes(field) &&
    typeof value === "string" && value.trim().length > 0);
  return withDigitAdmin(async (token) => {
    const criteria = { tenantId: ref.tenantId, uuid: [ref.uuid] };
    const active = await searchAccounts(token, { ...criteria, active: true });
    const accounts = active.length ? active : await searchAccounts(token, { ...criteria, active: false });
    const account = accounts.find((entry) => entry.uuid === ref.uuid && entry.tenantId === ref.tenantId);
    if (!account) throw new DigitUnavailableError("DIGIT account was not found");
    if (!supplied.length || supplied.every(([field, value]) =>
      field !== "password" && (account as unknown as Record<string, unknown>)[field] === value)) {
      return { status: "unchanged", account };
    }
    if (supplied.some(([field]) => field === "password")) {
      if (!account.active) throw new StaffLoginError("ACCOUNT_INACTIVE");
      if (account.accountLocked) throw new StaffLoginError("ACCOUNT_LOCKED");
    }
    const raw = account as unknown as Record<string, unknown>;
    const user = Object.fromEntries(COPIED_FIELDS.filter((field) => field in raw)
      .map((field) => [field, raw[field]]));
    Object.assign(user, Object.fromEntries(supplied));
    if (Object.values(user).some((value) => typeof value === "string" && /\*{2,}/.test(value))) {
      return { status: "skipped-masked", account };
    }
    await currentPersonLease()?.assertHeld();
    try {
      const updated = await updateIdentifiers(token, user as DigitIdentifierUpdate);
      return { status: "written", account: updated };
    } catch (error) {
      if (error instanceof DigitUnavailableError && [400, 422].includes(error.status)) {
        throw new DigitValidationError();
      }
      throw error;
    }
  });
}
