import type express from "express";
import { currentSession } from "../sessions/current-session.js";
import { propagateIdentifiers } from "../sync/identifiers.js";
import { endPhoneSessions } from "../revocation/index.js";
import { completePhoneProof, phoneSignIn, PhoneProofError, type PhoneEffects } from "./phone-service.js";
import { asyncRoute } from "../../app/async-route.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { boundTenantOf, routeForSlug, type PublicTenantRoute } from "../access-context/tenant-route.js";
import { enabledIdentityMethods } from "../authentication/methods.js";
import { mobileValidationForRoute } from "../citizen-otp/mobile-validation.js";
import { splitE164 } from "../citizens/citizen-registration.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import {
  IdentityAdminError,
} from "../organizations/organization-service.js";
import { sessionCookie } from "../sessions/session-store.js";
import { config } from "../../infrastructure/config.js";
import { audit } from "./audit.js";
import { fixedOtpCode, OtpDeliveryError, otpSender, phoneOtpAvailable } from "./otp-sender.js";
import {
  claimCode,
  createChallenge,
  deleteChallenge,
  privateRef,
  readChallenge,
  refundSend,
  releaseChallenge,
  replacePreviousChallenge,
  reserveSend,
  type CodeCheck,
  type OtpChallenge,
  type OtpPurpose,
} from "./otp-store.js";

const LOCALE = /^[a-z]{2,3}_[A-Z]{2}$/;
const CODE = /^\d{6}$/;
const CHALLENGE_ID = /^[A-Za-z0-9_-]{16,64}$/;

type Refusal = { status: number; body: { error: string; code: string; retryAfter?: number } };

function refuse(response: express.Response, refusal: Refusal) {
  if (refusal.body.retryAfter) response.setHeader("Retry-After", String(refusal.body.retryAfter));
  return response.status(refusal.status).json(refusal.body);
}


/**
 * Every response of these routes carries a stable `code`; `error` is display
 * text only and may change.
 *
 * The tenant comes from the route slug exactly as `/identity/v1/authorize`
 * resolves it: server-side, mapped and live, or refused.
 */
async function routeTenant(
  tenantSlug: unknown,
  response: express.Response,
): Promise<PublicTenantRoute | null> {
  const route = await routeForSlug(tenantSlug);
  if (!("status" in route)) return route;
  response.status(route.status).json({ error: route.error, code: route.code });
  return null;
}

async function phoneOtpEnabled(): Promise<boolean> {
  const methods = await enabledIdentityMethods("signin", "citizen");
  return methods.some((method) => method.type === "phone_otp");
}

async function requestContext(request: express.Request, response: express.Response) {
  const purpose = request.body?.purpose ?? "signin";
  if (!["signin", "stepup", "change_phone"].includes(purpose)) {
    response.status(400).json({ code: "INVALID_REQUEST", error: "Unsupported OTP purpose" }); return null;
  }
  const current = purpose === "signin" ? null : await currentSession(request.headers.cookie, "citizen");
  if (purpose !== "signin" && !current?.session.boundTenant) {
    response.status(401).json({ code: "SESSION_REQUIRED", error: "A citizen session is required" }); return null;
  }
  const route = await routeTenant(current?.session.boundTenant?.urlSlug ?? request.body?.tenantSlug, response);
  if (!route) return null;
  if (current && current.session.boundTenant?.tenantId !== route.tenantId) {
    response.status(404).json({ code: "TENANT_ROUTE_NOT_FOUND", error: "The session tenant route changed" }); return null;
  }
  return { purpose: purpose as OtpPurpose, current, route };
}

export function registerCitizenOtpRoutes(app: express.Application, phoneEffects: PhoneEffects = { endPhoneSessions, propagateIdentifiers }): void {
  /**
   * Sends a sign-in code to a mobile number valid for the route tenant. The
   * answer does not depend on whether the number has an account, for any
   * purpose: step-up and change refuse a number someone else owns only at
   * `_verify`.
   */
  app.post("/identity/v1/citizen/otp/_send", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return response.status(403).json({ error: "Untrusted request origin", code: "UNTRUSTED_ORIGIN" });
    }
    const context = await requestContext(request, response);
    if (!context) return;
    const { route, purpose, current } = context;
    const mobileNumber = request.body?.mobileNumber;
    const locale = request.body?.locale;
    if (typeof mobileNumber !== "string" || !/^\d{4,15}$/.test(mobileNumber) ||
        (locale !== undefined && (typeof locale !== "string" || !LOCALE.test(locale)))) {
      return response.status(400).json({ error: "A valid mobile number is required", code: "INVALID_REQUEST" });
    }
    const tenant = boundTenantOf(route);
    const ipRef = privateRef("ip", request.ip || "unknown");

    try {
      if (!(purpose === "signin" ? await phoneOtpEnabled() : phoneOtpAvailable())) {
        return response.status(400).json({ error: "Phone sign-in is not enabled", code: "PHONE_OTP_DISABLED" });
      }
      const rule = await mobileValidationForRoute(route);
      if (!rule) {
        console.warn("Citizen OTP: tenant has no MobileNumberValidation rule");
        return response.status(503).json({ error: "Citizen sign-in is not configured for this tenant", code: "CITIZEN_SIGNIN_NOT_CONFIGURED" });
      }
      const phoneNumber = `+${rule.countryCode.replace(/^\+/, "")}${mobileNumber}`;
      if (!splitE164(phoneNumber, rule)) {
        return response.status(400).json({
          error: "This mobile number cannot be used for this tenant",
          code: "INVALID_MOBILE_NUMBER",
        });
      }
      // Step-up and change do NOT check here whether another person owns the
      // number: a 409 before any rate charge let a signed-in caller list the
      // registered numbers. Ownership is enforced at `_verify`, under the
      // phone lock, once the caller has proved they hold the number.
      const phoneRef = privateRef("phone", phoneNumber);
      const base = { event: "OTP_SEND" as const, tenantId: tenant.tenantId, urlSlug: tenant.urlSlug, phoneRef, ipRef };

      const allowance = await reserveSend(phoneNumber, request.ip || "unknown");
      if (!allowance.allowed) {
        await audit({ ...base, outcome: "REFUSED", reason: `OTP_${allowance.reason}` });
        return refuse(response, {
          status: 429,
          body: {
            error: "Too many codes requested. Try again later.",
            code: allowance.reason === "COOLDOWN" ? "OTP_RESEND_TOO_SOON" : "OTP_RATE_LIMITED",
            retryAfter: allowance.retryAfter,
          },
        });
      }

      const { challenge, code } = await createChallenge(phoneNumber, tenant, { purpose, ...(current && { subject: current.session.claims.sub, sessionRef: privateRef("session", current.sessionId) }) }).catch(async (error) => {
        await refundSend(allowance.reservation);
        throw error;
      });
      let reason: string | undefined;
      try {
        await otpSender().send({
          challengeId: challenge.id,
          tenantId: tenant.tenantId,
          phoneNumber,
          purpose,
          code,
          expiresInSeconds: config.identityCitizenOtpTtlSeconds,
          ...(typeof locale === "string" && { locale }),
        });
      } catch (error) {
        if (!(error instanceof OtpDeliveryError) || fixedOtpCode() === null) {
          // Undelivered: the challenge goes, and so does what it cost.
          await deleteChallenge(challenge.id);
          await refundSend(allowance.reservation);
          if (!(error instanceof OtpDeliveryError)) throw error;
          console.warn("Citizen OTP delivery failed:", error.message);
          await audit({ ...base, challengeId: challenge.id, outcome: "FAILED", reason: error.code });
          if (error.code === "OTP_RATE_LIMITED") response.setHeader("Retry-After", String(Math.max(1, config.identityCitizenOtpResendSeconds)));
          return response.status(error.code === "OTP_RATE_LIMITED" ? 429 : 503).json({
            error: "The code could not be sent. Try again later.",
            code: error.code,
          });
        }
        // Fixed-code mode (development): the challenge stays usable undelivered.
        reason = "FIXED_CODE_ONLY";
      }
      // Only now that a code went out does it replace the previous one, so a
      // failed send never takes away a code the citizen already has.
      await replacePreviousChallenge(challenge);
      await audit({ ...base, challengeId: challenge.id, outcome: "SUCCESS", ...(reason && { reason }) });
      return response.status(202).json({
        challengeId: challenge.id,
        expiresIn: config.identityCitizenOtpTtlSeconds,
        resendAfter: config.identityCitizenOtpResendSeconds,
      });
    } catch (error) {
      if (error instanceof PhoneProofError) return response.status(error.status).json({ code: error.code, error: error.message });
      if (error instanceof IdentityAdminError || error instanceof DigitUnavailableError) {
        console.warn("Citizen OTP send failed:", error.message);
        return response.status(503).json({ error: "Citizen sign-in is temporarily unavailable", code: "IDENTITY_UNAVAILABLE" });
      }
      throw error;
    }
  }));

  /**
   * Checks a code and, once, opens a citizen session for the Keycloak user
   * who owns the number. The session holds no Keycloak tokens; the browser
   * continues with `contexts/citizen/_select` as after any citizen sign-in.
   */
  app.post("/identity/v1/citizen/otp/_verify", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return response.status(403).json({ error: "Untrusted request origin", code: "UNTRUSTED_ORIGIN" });
    }
    const context = await requestContext(request, response);
    if (!context) return;
    const { route, purpose, current } = context;
    const { challengeId, code } = request.body ?? {};
    if (typeof challengeId !== "string" || !CHALLENGE_ID.test(challengeId) ||
        typeof code !== "string" || !CODE.test(code)) {
      return response.status(400).json({ error: "A challenge and a six-digit code are required", code: "INVALID_REQUEST" });
    }
    const ipRef = privateRef("ip", request.ip || "unknown");
    const expired = () => response.status(400).json({
      error: "This code has expired. Request a new one.",
      code: "OTP_EXPIRED",
    });

    // Everything up to the code check runs inside one catch, so an MDMS or
    // Keycloak outage answers the JSON 503 contract error, never Express's
    // HTML page, and leaves the code unclaimed for a retry.
    let challenge: OtpChallenge | null;
    let national: ReturnType<typeof splitE164>;
    let check: CodeCheck;
    try {
      // Switching phone_otp off also stops codes already sent (e.g. after codes
      // leaked through the log sender), not only new ones.
      if (!(purpose === "signin" ? await phoneOtpEnabled() : phoneOtpAvailable())) {
        return response.status(400).json({ error: "Phone sign-in is not enabled", code: "PHONE_OTP_DISABLED" });
      }
      challenge = await readChallenge(challengeId);
      // A challenge is usable only from the tenant route it was sent for.
      if (!challenge || challenge.tenant.urlSlug !== route.urlSlug || challenge.tenant.tenantId !== route.tenantId ||
          challenge.purpose !== purpose || (current && (challenge.subject !== current.session.claims.sub || challenge.sessionRef !== privateRef("session", current.sessionId)))) {
        await audit({ event: "OTP_VERIFY", outcome: "REFUSED", reason: "OTP_EXPIRED", urlSlug: route.urlSlug, ipRef, challengeId });
        return expired();
      }
      const rule = await mobileValidationForRoute(route);
      national = rule && splitE164(challenge.phoneNumber, rule);
      if (!national) return expired();
      check = await claimCode(challenge, code, fixedOtpCode());
    } catch (error) {
      if (error instanceof PhoneProofError) return response.status(error.status).json({ code: error.code, error: error.message });
      if (error instanceof IdentityAdminError || error instanceof DigitUnavailableError) {
        console.warn("Citizen OTP verify failed:", error.message);
        return response.status(503).json({ error: "Citizen sign-in is temporarily unavailable", code: "IDENTITY_UNAVAILABLE" });
      }
      throw error;
    }
    const tenant = challenge.tenant;
    const phoneRef = privateRef("phone", challenge.phoneNumber);
    const base = { tenantId: tenant.tenantId, urlSlug: tenant.urlSlug, phoneRef, ipRef, challengeId };

    if (check.status === "MISSING") {
      await audit({ ...base, event: "OTP_VERIFY", outcome: "REFUSED", reason: "OTP_EXPIRED" });
      return expired();
    }
    if (check.status === "WRONG") {
      await audit({ ...base, event: "OTP_VERIFY", outcome: "REFUSED", reason: "OTP_INVALID" });
      return response.status(400).json({
        error: "That code is not correct.",
        code: check.attemptsRemaining > 0 ? "OTP_INVALID" : "OTP_EXPIRED",
        attemptsRemaining: check.attemptsRemaining,
      });
    }
    await audit({
      ...base, event: "OTP_VERIFY", outcome: "SUCCESS",
      ...(check.fixedCode && { reason: "FIXED_CODE" }),
    });

    // The claimed code is consumed only once a session exists. A transient
    // Keycloak failure releases it, so the citizen can retry the same code.
    let user;
    let session;
    try {
      if (current) {
        await completePhoneProof(challenge, current.sessionId, phoneEffects);
        await deleteChallenge(challenge.id);
        return response.json({ phoneNumber: challenge.phoneNumber, phoneNumberVerified: true });
      }
      const signedIn = await phoneSignIn(challenge.phoneNumber, tenant, national.mobileNumber);
      user = signedIn.user;
      session = signedIn.session;
    } catch (error) {
      const refused = error instanceof PhoneProofError || (error instanceof IdentityAdminError && (error.status === 403 || error.status === 409));
      if (refused) await deleteChallenge(challenge.id);
      else await releaseChallenge(challenge.id);
      if (error instanceof PhoneProofError) return response.status(error.status).json({ code: error.code, error: error.message });
      if (error instanceof DigitUnavailableError) {
        return response.status(503).json({ code: "IDENTITY_UNAVAILABLE", error: "Phone verification is temporarily unavailable" });
      }
      if (!(error instanceof IdentityAdminError)) throw error;
      const disabled = error.status === 403;
      console.warn("Citizen OTP identity resolution failed:", error.message);
      await audit({
        ...base, event: "SESSION_CREATE", outcome: refused ? "REFUSED" : "FAILED",
        reason: disabled ? "IDENTITY_DISABLED" : error.status === 409 ? "IDENTITY_CONFLICT" : "IDENTITY_UNAVAILABLE",
      });
      if (disabled) {
        return response.status(403).json({ error: "This account is disabled", code: "IDENTITY_DISABLED" });
      }
      return response.status(error.status === 409 ? 409 : 503).json({
        error: "Sign-in could not be completed. Please try again.",
        code: error.status === 409 ? "IDENTITY_CONFLICT" : "IDENTITY_UNAVAILABLE",
      });
    }
    await deleteChallenge(challenge.id);
    const { sessionId, maxAge } = session;
    await audit({
      ...base, event: "SESSION_CREATE", outcome: "SUCCESS", subject: user.id,
      sessionRef: privateRef("session", sessionId),
      ...(user.created && { reason: "IDENTITY_CREATED" }),
    });
    response.setHeader("Set-Cookie", sessionCookie(sessionId, maxAge, "citizen"));
    return response.json({
      authenticated: true,
      tenant: { urlSlug: tenant.urlSlug, tenantId: tenant.tenantId },
    });
  }));
}
