import { config } from "../../infrastructure/config.js";
import { oneTimePassword } from "../managed-accounts/managed-account-service.js";
import { passwordLogin, revokeToken, type DigitLogin } from "../managed-accounts/digit-user-client.js";
import { derivedStaffPassword } from "./credential.js";
import { StaffLoginError } from "./credential-errors.js";
import { credentialPorts } from "./credential-ports.js";
import { writeDigitIdentifiers } from "./digit-writer.js";
import type { PersonLease } from "./person-lease.js";

export { StaffLoginError, type StaffLoginFailure } from "./credential-errors.js";

export interface StaffAccountRef {
  tenantId: string;
  uuid: string;
  userName: string;
  keyVersion?: number;
}

const repaired = new WeakSet<PersonLease>();

export function staffCredentialMode(): "rotate" | "derived" {
  return config.identityStaffCredentialMode;
}

function passwordFor(account: StaffAccountRef, version: number): string {
  const key = config.identityCredentialKeys.get(version);
  if (!key) throw new StaffLoginError("DEPENDENCY", "Staff credential key is unavailable");
  return derivedStaffPassword(key, account.uuid, account.tenantId);
}

async function writePassword(account: StaffAccountRef, password: string, lease: PersonLease): Promise<void> {
  await lease.assertHeld();
  const result = await writeDigitIdentifiers(account, { password });
  if (result.status === "skipped-masked") {
    throw Object.assign(new Error("DIGIT account contains masked fields"), { status: 503, code: "DIGIT_PII_MASKED" });
  }
  await lease.assertHeld();
}

async function login(account: StaffAccountRef, password: string, lease?: PersonLease): Promise<DigitLogin> {
  await lease?.assertHeld();
  const minted = await passwordLogin({
    username: account.userName, tenantId: account.tenantId, userType: "EMPLOYEE", password,
  });
  try {
    await lease?.assertHeld();
    return minted;
  } catch (error) {
    await revokeToken(minted.accessToken);
    throw error;
  }
}

async function mirror(account: StaffAccountRef, lease: PersonLease, keyVersion: number): Promise<void> {
  await lease.assertHeld();
  try {
    await credentialPorts.mirrorPerson(lease.subject, {
      credential: { tenantId: account.tenantId, keyVersion, setAt: Date.now() },
    });
  } catch {
    // A mirror retry must not undo a successfully changed DIGIT credential.
    // Do not log the error body: it can include credentials or profile data.
    console.warn("Staff credential was set but its Keycloak mirror failed");
  }
}

/** Caller has authorized an active binding; pending bindings must never call this. */
export async function activateStaffCredential(
  account: StaffAccountRef,
  lease: PersonLease,
): Promise<{ keyVersion: number }> {
  if (staffCredentialMode() !== "derived") throw new StaffLoginError("DEPENDENCY", "Derived staff credentials are disabled");
  const keyVersion = config.identityCredentialKeyCurrent;
  const password = passwordFor(account, keyVersion);
  await writePassword(account, password, lease);
  const existing = await login(account, password, lease);
  // egov-user reuses the native token on password grant. End it exactly once.
  await revokeToken(existing.accessToken);
  await mirror(account, lease, keyVersion);
  return { keyVersion };
}

export async function staffLogin(
  account: StaffAccountRef,
  lease: PersonLease,
): Promise<DigitLogin & { keyVersion?: number }> {
  if (staffCredentialMode() === "rotate") {
    const password = oneTimePassword();
    await writePassword(account, password, lease);
    return login(account, password, lease);
  }
  const keyVersion = config.identityCredentialKeyCurrent;
  const password = passwordFor(account, keyVersion);
  // Missing/retired/older versions all adopt the current key before any grant.
  // No request probes multiple keys (which could trip egov-user's lockout).
  if (account.keyVersion !== keyVersion) {
    await activateStaffCredential(account, lease);
    return { ...await login(account, password, lease), keyVersion };
  }
  try {
    return { ...await login(account, password, lease), keyVersion };
  } catch (error) {
    if (!(error instanceof StaffLoginError) || error.reason !== "INVALID_CREDENTIALS" || repaired.has(lease)) {
      throw error;
    }
    repaired.add(lease);
    await writePassword(account, password, lease);
    const minted = await login(account, password, lease);
    try {
      await mirror(account, lease, keyVersion);
      await lease.assertHeld();
    } catch (failure) {
      await revokeToken(minted.accessToken);
      throw failure;
    }
    return { ...minted, keyVersion };
  }
}

/** Read-only password grant for revocation; never writes, repairs or activates. */
export async function findLiveStaffToken(account: StaffAccountRef): Promise<DigitLogin | null> {
  if (staffCredentialMode() !== "derived" || account.keyVersion === undefined ||
      !config.identityCredentialKeys.has(account.keyVersion)) return null;
  try {
    return await login(account, passwordFor(account, account.keyVersion));
  } catch (error) {
    if (error instanceof StaffLoginError && error.reason !== "DEPENDENCY") return null;
    throw error;
  }
}
