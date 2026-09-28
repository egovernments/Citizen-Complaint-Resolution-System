import { config } from "../../infrastructure/config.js";
import {
  type DigitAccount,
  type DigitLogin,
  DigitUnavailableError,
  passwordLogin,
} from "./digit-user-client.js";

/**
 * Obtains a normal user-scoped DIGIT token for one BFF-managed CITIZEN
 * account (#2167).
 *
 * Employees get theirs by rotating the managed account's password and
 * password-granting once. That does not work for citizens: with
 * `citizen.login.password.otp.enabled=true` (the upstream default) egov-user
 * validates a CITIZEN password grant's password as an egov-otp one-time code,
 * not against the stored BCrypt hash. The minter is an interface so that
 * mechanism can be replaced (for example by a dedicated egov-user grant)
 * without touching sign-in, caching or logout.
 *
 * Hard rule for every implementation: never use egov-user's `isInternal`
 * form parameter, which skips credential validation entirely.
 */
export interface CitizenTokenMinter {
  /**
   * `verifiedMobileNumber` is the national number from the session's
   * verified phone claim. Search responses may mask `account.mobileNumber`.
   */
  mint(account: DigitAccount, verifiedMobileNumber: string): Promise<DigitLogin>;
}

function requestInfo() {
  return { apiId: "digit-identity-bff", ver: "1.0", ts: Date.now() };
}

/**
 * Default minter: create an OTP directly at egov-otp's INTERNAL
 * `/otp/v1/_create` (no SMS is sent; the response carries the code), then
 * spend it on egov-user `/user/oauth/token` as the password of a CITIZEN
 * password grant.
 *
 * egov-user's `UserService.validateOtp` validates a CITIZEN grant's OTP for
 * `user.getMobileNumber()` at `user.getTenantId()`, so the identity is the
 * mobile number by default (`DIGIT_CITIZEN_OTP_IDENTITY=mobileNumber`),
 * taken from the verified session phone rather than a possibly-masked
 * search response. `userName` remains available as an override.
 *
 * The OTP tenant is the account's own tenant: citizen accounts live at the
 * state root (`digitCitizenTenantId`), which is also where egov-user looks the
 * user up and validates the OTP, whatever city route the citizen came from.
 *
 * Still UNVERIFIED against a live egov-user: the live spike must confirm the
 * OTP grant end to end and that `DIGIT_OTP_CREATE_URL` is reachable only on
 * the internal network.
 * The OTP value is never logged, cached or returned.
 */
export class EgovOtpCitizenTokenMinter implements CitizenTokenMinter {
  async mint(account: DigitAccount, verifiedMobileNumber: string): Promise<DigitLogin> {
    if (!config.digitOtpCreateUrl) {
      throw new DigitUnavailableError("DIGIT citizen token minting is not configured");
    }
    const identity = config.digitCitizenOtpIdentity === "userName"
      ? account.userName
      : verifiedMobileNumber;
    if (!identity) throw new DigitUnavailableError("DIGIT citizen account has no OTP identity");

    let response: Response;
    try {
      response = await fetch(config.digitOtpCreateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          RequestInfo: requestInfo(),
          otp: { identity, tenantId: account.tenantId },
        }),
        signal: AbortSignal.timeout(config.digitTimeoutMs),
      });
    } catch {
      throw new DigitUnavailableError("DIGIT OTP create request failed");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DigitUnavailableError(`DIGIT OTP create returned ${response.status}`);
    }
    let body: { otp?: { otp?: unknown } };
    try {
      body = await response.json() as { otp?: { otp?: unknown } };
    } catch {
      throw new DigitUnavailableError("DIGIT OTP create returned invalid JSON");
    }
    const otp = body.otp?.otp;
    if (typeof otp !== "string" || !otp) {
      throw new DigitUnavailableError("DIGIT OTP create returned no OTP");
    }
    try {
      return await passwordLogin({
        username: account.userName,
        password: otp,
        tenantId: account.tenantId,
        userType: "CITIZEN",
      });
    } catch (error) {
      // A rejected OTP grant is a platform integration failure, not a
      // citizen error: surface it as unavailability.
      throw error instanceof DigitUnavailableError && error.status === 503
        ? error
        : new DigitUnavailableError("DIGIT citizen login failed");
    }
  }
}

let minter: CitizenTokenMinter = new EgovOtpCitizenTokenMinter();

export function citizenTokenMinter(): CitizenTokenMinter {
  return minter;
}

/** Swap the minting mechanism (alternative grant, tests). */
export function setCitizenTokenMinter(next: CitizenTokenMinter): void {
  minter = next;
}
