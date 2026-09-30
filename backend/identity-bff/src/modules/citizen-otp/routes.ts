import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { resolvePublicTenantRoute, type PublicTenantRoute } from "../access-context/tenant-route.js";
import { enabledIdentityMethods } from "../authentication/methods.js";
import type { BoundTenant } from "../authentication/surfaces.js";
import { mobileValidationForRoute } from "../branding/tenant-branding.js";
import { splitE164 } from "../citizens/citizen-registration.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import {
  ensurePhoneIdentityUser,
  IdentityAdminError,
} from "../organizations/organization-service.js";
import { createPhoneOtpSession, sessionCookie } from "../sessions/session-store.js";
import { config } from "../../infrastructure/config.js";
import { audit } from "./audit.js";
import { fixedOtpCode, OtpDeliveryError, otpSender } from "./otp-sender.js";
import {
  checkCode,
  createChallenge,
  deleteChallenge,
  lockoutRemaining,
  privateRef,
  readChallenge,
  reserveSend,
} from "./otp-store.js";

const LOCALE = /^[a-z]{2,3}_[A-Z]{2}$/;
const CODE = /^\d{6}$/;
const CHALLENGE_ID = /^[A-Za-z0-9_-]{16,64}$/;

type Refusal = { status: number; body: { error: string; code: string; retryAfter?: number } };

function refuse(response: express.Response, refusal: Refusal) {
  if (refusal.body.retryAfter) response.setHeader("Retry-After", String(refusal.body.retryAfter));
  return response.status(refusal.status).json(refusal.body);
}

const locked = (retryAfter: number): Refusal => ({
  status: 429,
  body: { error: "Too many wrong codes for this number. Try again later.", code: "OTP_LOCKED", retryAfter },
});

/**
 * The tenant comes from the route slug exactly as `/identity/v1/authorize`
 * resolves it: server-side, mapped and live, or refused.
 */
async function routeTenant(
  tenantSlug: unknown,
  response: express.Response,
): Promise<PublicTenantRoute | null> {
  if (typeof tenantSlug !== "string" || !tenantSlug) {
    response.status(400).json({ error: "tenantSlug is required" });
    return null;
  }
  try {
    const tenant = await resolvePublicTenantRoute(tenantSlug);
    if (!tenant) response.status(404).json({ error: "Tenant route is not available" });
    return tenant;
  } catch (error) {
    if (error instanceof IdentityAdminError || error instanceof DigitUnavailableError) {
      console.warn("Tenant route resolution failed:", error.message);
      response.status(503).json({ error: "Tenant routes are temporarily unavailable" });
      return null;
    }
    throw error;
  }
}

function boundTenant(route: PublicTenantRoute): BoundTenant {
  return { urlSlug: route.urlSlug, tenantId: route.tenantId, rootTenantId: route.rootTenantId, name: route.name };
}

async function phoneOtpEnabled(): Promise<boolean> {
  const methods = await enabledIdentityMethods("signin", "citizen");
  return methods.some((method) => method.type === "phone_otp");
}

export function registerCitizenOtpRoutes(app: express.Application): void {
  /**
   * Sends a sign-in code to a mobile number valid for the route tenant. The
   * answer does not depend on whether the number has an account.
   */
  app.post("/identity/v1/citizen/otp/_send", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return response.status(403).json({ error: "Untrusted request origin" });
    }
    const route = await routeTenant(request.body?.tenantSlug, response);
    if (!route) return;
    const mobileNumber = request.body?.mobileNumber;
    const locale = request.body?.locale;
    if (typeof mobileNumber !== "string" || !/^\d{4,15}$/.test(mobileNumber) ||
        (locale !== undefined && (typeof locale !== "string" || !LOCALE.test(locale)))) {
      return response.status(400).json({ error: "A valid mobile number is required" });
    }
    const tenant = boundTenant(route);
    const ipRef = privateRef("ip", request.ip || "unknown");

    try {
      if (!await phoneOtpEnabled()) {
        return response.status(400).json({ error: "Unsupported sign-in method" });
      }
      const rule = await mobileValidationForRoute(route);
      if (!rule) {
        console.warn("Citizen OTP: tenant has no MobileNumberValidation rule");
        return response.status(503).json({ error: "Citizen sign-in is not configured for this tenant" });
      }
      const phoneNumber = `+${rule.countryCode.replace(/^\+/, "")}${mobileNumber}`;
      if (!splitE164(phoneNumber, rule)) {
        return response.status(400).json({
          error: "This mobile number cannot be used for this tenant",
          code: "INVALID_MOBILE_NUMBER",
        });
      }
      const phoneRef = privateRef("phone", phoneNumber);
      const base = { event: "OTP_SEND" as const, tenantId: tenant.tenantId, urlSlug: tenant.urlSlug, phoneRef, ipRef };

      const lockedFor = await lockoutRemaining(phoneNumber);
      if (lockedFor) {
        await audit({ ...base, outcome: "REFUSED", reason: "OTP_LOCKED" });
        return refuse(response, locked(lockedFor));
      }
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

      const { challenge, code } = await createChallenge(phoneNumber, tenant);
      const sender = otpSender();
      let delivered = false;
      try {
        if (!sender.configured) throw new OtpDeliveryError("No OTP channel is configured");
        await sender.send({
          challengeId: challenge.id,
          tenantId: tenant.tenantId,
          phoneNumber,
          code,
          expiresInSeconds: config.identityCitizenOtpTtlSeconds,
          ...(typeof locale === "string" && { locale }),
        });
        delivered = true;
      } catch (error) {
        if (!(error instanceof OtpDeliveryError)) {
          await deleteChallenge(challenge.id);
          throw error;
        }
        console.warn("Citizen OTP delivery failed:", error.message);
        // With the fixed code on, the challenge stays usable without delivery.
        if (fixedOtpCode() === null) {
          await deleteChallenge(challenge.id);
          await audit({ ...base, challengeId: challenge.id, outcome: "FAILED", reason: "OTP_CHANNEL_UNAVAILABLE" });
          return response.status(503).json({
            error: "The code could not be sent. Try again later.",
            code: "OTP_CHANNEL_UNAVAILABLE",
          });
        }
      }
      if (!delivered) {
        await audit({ ...base, challengeId: challenge.id, outcome: "SUCCESS", reason: "FIXED_CODE_ONLY" });
        return response.status(202).json({
          challengeId: challenge.id,
          expiresIn: config.identityCitizenOtpTtlSeconds,
          resendAfter: config.identityCitizenOtpResendSeconds,
        });
      }
      await audit({ ...base, challengeId: challenge.id, outcome: "SUCCESS" });
      return response.status(202).json({
        challengeId: challenge.id,
        expiresIn: config.identityCitizenOtpTtlSeconds,
        resendAfter: config.identityCitizenOtpResendSeconds,
      });
    } catch (error) {
      if (error instanceof IdentityAdminError || error instanceof DigitUnavailableError) {
        console.warn("Citizen OTP send failed:", error.message);
        return response.status(503).json({ error: "Citizen sign-in is temporarily unavailable" });
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
      return response.status(403).json({ error: "Untrusted request origin" });
    }
    const route = await routeTenant(request.body?.tenantSlug, response);
    if (!route) return;
    const { challengeId, code } = request.body ?? {};
    if (typeof challengeId !== "string" || !CHALLENGE_ID.test(challengeId) ||
        typeof code !== "string" || !CODE.test(code)) {
      return response.status(400).json({ error: "A challenge and a six-digit code are required" });
    }
    const ipRef = privateRef("ip", request.ip || "unknown");
    const expired = () => response.status(400).json({
      error: "This code has expired. Request a new one.",
      code: "OTP_EXPIRED",
    });

    const challenge = await readChallenge(challengeId);
    // A challenge is usable only from the tenant route it was sent for.
    if (!challenge || challenge.tenant.urlSlug !== route.urlSlug) {
      await audit({ event: "OTP_VERIFY", outcome: "REFUSED", reason: "OTP_EXPIRED", urlSlug: route.urlSlug, ipRef, challengeId });
      return expired();
    }
    const tenant = challenge.tenant;
    const phoneRef = privateRef("phone", challenge.phoneNumber);
    const base = { tenantId: tenant.tenantId, urlSlug: tenant.urlSlug, phoneRef, ipRef, challengeId };

    const lockedFor = await lockoutRemaining(challenge.phoneNumber);
    if (lockedFor) {
      await audit({ ...base, event: "OTP_VERIFY", outcome: "REFUSED", reason: "OTP_LOCKED" });
      return refuse(response, locked(lockedFor));
    }
    const check = await checkCode(challenge, code, fixedOtpCode());
    if (check.status === "MISSING") {
      await audit({ ...base, event: "OTP_VERIFY", outcome: "REFUSED", reason: "OTP_EXPIRED" });
      return expired();
    }
    if (check.status === "WRONG") {
      await audit({
        ...base, event: "OTP_VERIFY", outcome: "REFUSED",
        reason: check.locked ? "OTP_LOCKED" : "OTP_INVALID",
      });
      if (check.locked) return refuse(response, locked(config.identityCitizenOtpLockoutSeconds));
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

    let user;
    try {
      user = await ensurePhoneIdentityUser(challenge.phoneNumber);
    } catch (error) {
      if (!(error instanceof IdentityAdminError)) throw error;
      const disabled = error.status === 403;
      console.warn("Citizen OTP identity resolution failed:", error.message);
      await audit({
        ...base, event: "SESSION_CREATE", outcome: disabled ? "REFUSED" : "FAILED",
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

    const { sessionId, maxAge } = await createPhoneOtpSession({
      subject: user.id,
      name: user.name,
      phoneNumber: challenge.phoneNumber,
      boundTenant: tenant,
    });
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
