import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { errorBody, errorStatus, isErrorCode, type HttpErrorCode } from "../../contract/error-codes.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { config } from "../../infrastructure/config.js";
import {
  digitCitizenTenantId,
  ManagedAccountError,
  managedIdentity,
  managedUserLogin,
} from "../managed-accounts/managed-account-service.js";
import type { DigitLogin } from "../managed-accounts/digit-user-client.js";
import { parseSurface } from "../authentication/surfaces.js";
import { mobileValidationForRoute } from "../branding/tenant-branding.js";
import {
  CitizenContextError,
  ensureCitizenRegistration,
  splitE164,
} from "../citizens/citizen-registration.js";
import { isActiveDigitTenant } from "./tenant-directory.js";
import { DigitLoginRejectedError, DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { syncSubjectTenant } from "../reconciliation/subject-sync.js";
import { currentSession } from "../sessions/current-session.js";
import { saveSelectedIdentityContext } from "../sessions/session-store.js";
import {
  IdentityAdminError,
  keycloakPhoneIsAdminControlled,
  readTenantMappingForTenant,
} from "../organizations/organization-service.js";
import type { TenantOption } from "./tenant-directory.js";
import { isLiveTenantRoute, resolvePublicTenantRoute } from "./tenant-route.js";
import { resolveTenantOption, resolveTenantOptions } from "./tenant-options.js";
import { AccountLinkError, EMPLOYEE_USER_TYPE, linkedIdentityFor } from "../account-links/account-links.js";

function publicTenant({ organizationId: _organizationId, ...tenant }: TenantOption) {
  return tenant;
}

function tokenResponse(login: DigitLogin) {
  return {
    access_token: login.accessToken,
    token_type: "bearer",
    expires_in: Math.max(1, Math.floor((login.expiresAt - Date.now()) / 1000)),
    scope: "read",
    UserRequest: login.user,
  };
}

function send(response: express.Response, code: HttpErrorCode, message: string) {
  return response.status(errorStatus(code)).json(errorBody(code, message));
}

/**
 * Maps a failure to its stable code (item 6). A typed error without a code
 * falls back to "context unavailable" for its surface; the status always comes
 * from the catalogue, so a code is never sent with two statuses.
 */
function digitFailure(error: unknown, response: express.Response, message: string, citizen = false) {
  if (error instanceof CitizenContextError || error instanceof ManagedAccountError ||
      error instanceof AccountLinkError) {
    const code = isErrorCode(error.code) && errorStatus(error.code as HttpErrorCode) === error.status
      ? error.code as HttpErrorCode
      : error.status === 503
        ? "DIGIT_UNAVAILABLE"
        : citizen ? "CITIZEN_CONTEXT_UNAVAILABLE" : "TENANT_CONTEXT_UNAVAILABLE";
    return send(response, code, error.message);
  }
  // egov-user's own refusal of the sign-in (§6): no credential repair here.
  if (error instanceof DigitLoginRejectedError && error.reason === "locked") {
    return send(response, "ACCOUNT_LOCKED", "This account is locked");
  }
  if (error instanceof DigitLoginRejectedError && error.reason === "inactive") {
    return send(response, "DIGIT_ACCOUNT_INACTIVE", "This account is not active");
  }
  if (error instanceof DigitUnavailableError && error.digitCodes.includes("INVALID_ROLE")) {
    // egov-user rejects a role that is not defined at the tenant. Seeding
    // roles is the platform baseline's job (#2169), not the BFF's.
    console.warn(`${message}: DIGIT roles are not installed for this tenant`);
    return send(response, "TENANT_ROLES_MISSING", "This tenant is not ready for sign-in yet");
  }
  if (error instanceof DigitUnavailableError ||
      (error instanceof IdentityAdminError && error.status >= 500)) {
    // Keycloak Admin or DIGIT unreachable: a retryable 503, never a bare 500.
    console.warn(`${message}:`, error.message);
    return send(response, error instanceof IdentityAdminError ? "IDENTITY_UNAVAILABLE" : "DIGIT_UNAVAILABLE", message);
  }
  // Anything else, including a Keycloak 400/404/409 (a misconfiguration, not
  // an outage), is not worth retrying and stays a 500.
  throw error;
}

export function registerAccessContextRoutes(app: express.Application): void {
  // Public route context contains only already-public tenant metadata. It lets
  // every application resolve /{urlSlug}/... before React, MDMS or auth starts
  // without exposing Keycloak Organization ids or using email/membership as a
  // tenant-directory query. Authorization still happens in `_select`.
  app.get("/identity/v1/tenant-contexts/:urlSlug", asyncRoute(async (request, response) => {
    const rawUrlSlug = request.params.urlSlug;
    try {
      const tenant = await resolvePublicTenantRoute(
        Array.isArray(rawUrlSlug) ? rawUrlSlug[0] : rawUrlSlug,
      );
      if (!tenant) {
        return response.status(404).json({ error: "Tenant route is not available" });
      }
      return response.json({ tenant });
    } catch (error) {
      return digitFailure(error, response, "Tenant routes are temporarily unavailable");
    }
  }));

  app.get("/identity/v1/tenants", asyncRoute(async (request, response) => {
    const current = await currentSession(request.headers.cookie);
    if (!current) {
      return response.status(401).json({ error: "Invalid or missing identity session" });
    }
    try {
      const tenants = await resolveTenantOptions(current.session.claims, true);
      return response.json({
        tenants: tenants.map(publicTenant),
        selectionRequired: tenants.length > 1,
        onboardingRequired: tenants.length === 0,
      });
    } catch (error) {
      return digitFailure(error, response, "Tenant options are temporarily unavailable");
    }
  }));

  app.post("/identity/v1/contexts/_select", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return send(response, "UNTRUSTED_ORIGIN", "Untrusted request origin");
    }
    const surface = parseSurface(request.body?.surface ?? request.query.surface);
    if (!surface || surface === "citizen") {
      return send(response, "UNSUPPORTED_SURFACE", "Unsupported sign-in surface");
    }
    const current = await currentSession(request.headers.cookie, surface);
    if (!current) {
      return send(response, "SESSION_REQUIRED", "Invalid or missing identity session");
    }
    const tenantId = typeof request.body?.tenantId === "string"
      ? request.body.tenantId.trim()
      : "";
    if (!tenantId) return send(response, "INVALID_REQUEST", "tenantId is required");
    // An employee session is bound to the tenant of the route it signed in
    // on; it can never select another tenant, whatever its memberships.
    if (surface === "employee" && current.session.boundTenant?.tenantId !== tenantId) {
      return send(response, "TENANT_CONTEXT_UNAVAILABLE", "Tenant context is not available");
    }

    try {
      const subject = current.session.claims.sub;
      // An existing DIGIT employee linked by an admin (#2167) signs in to that
      // account as it is: its own uuid, roles and history, re-checked active
      // on every _select. The link itself authorizes the bound tenant.
      const linked = surface === "employee"
        ? await linkedIdentityFor(subject, EMPLOYEE_USER_TYPE, tenantId)
        : null;
      if (linked) {
        const login = await managedUserLogin(linked, current.sessionId);
        const mapping = await readTenantMappingForTenant(tenantId);
        const saved = await saveSelectedIdentityContext(current.sessionId, {
          organizationId: mapping?.organizationId || "",
          organizationAlias: mapping?.alias || "",
          tenantId,
          name: current.session.boundTenant?.name || mapping?.name || tenantId,
        });
        if (!saved) return send(response, "SESSION_EXPIRED", "Identity session expired");
        return response.json(tokenResponse(login));
      }
      // Only the requested tenant is resolved, and its live Organization
      // membership is what authorizes the switch.
      const selected = await resolveTenantOption(subject, tenantId);
      if (!selected) {
        return surface === "employee"
          ? send(response, "EMPLOYEE_ACCOUNT_NOT_LINKED", "Tenant context is not available")
          : send(response, "TENANT_CONTEXT_UNAVAILABLE", "Tenant context is not available");
      }
      const outcome = await syncSubjectTenant(
        subject,
        selected.tenantId,
        current.session.claims.phone_number,
      );
      if (!outcome.account) {
        return send(response, "TENANT_CONTEXT_UNAVAILABLE", "Tenant context is not available");
      }
      if (!outcome.account.active) {
        return send(response, "DIGIT_ACCOUNT_INACTIVE", "This account is not active");
      }
      const identity = managedIdentity(config.keycloakIssuer, subject, selected.tenantId);
      const login = await managedUserLogin(identity, current.sessionId);
      const saved = await saveSelectedIdentityContext(current.sessionId, {
        organizationId: selected.organizationId,
        organizationAlias: selected.organizationAlias,
        tenantId: selected.tenantId,
        name: selected.name,
      });
      if (!saved) {
        return send(response, "SESSION_EXPIRED", "Identity session expired");
      }
      return response.json(tokenResponse(login));
    } catch (error) {
      return digitFailure(error, response, "Sign-in context is temporarily unavailable");
    }
  }));

  // Citizen context (#2167, #2071). The tenant comes only from the session,
  // which bound it from the route before the Keycloak redirect; the body
  // selects nothing. No Organization membership is read or required.
  app.post("/identity/v1/contexts/citizen/_select", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return send(response, "UNTRUSTED_ORIGIN", "Untrusted request origin");
    }
    const requestedSurface = request.body?.surface ?? request.query.surface;
    if (requestedSurface !== undefined && requestedSurface !== "citizen") {
      return send(response, "UNSUPPORTED_SURFACE", "Unsupported sign-in surface");
    }
    const current = await currentSession(request.headers.cookie, "citizen");
    if (!current) {
      return send(response, "SESSION_REQUIRED", "Invalid or missing identity session");
    }
    const { claims, boundTenant } = current.session;
    if (!boundTenant || claims.azp !== config.keycloakCitizenClientId ||
        current.session.oidcClientId !== config.keycloakCitizenClientId) {
      return send(response, "CITIZEN_CONTEXT_UNAVAILABLE", "Citizen context is not available");
    }
    // A DIGIT citizen account is keyed by a verified mobile number. How a
    // citizen without one gets a DIGIT account is open (#2189): fail closed.
    if (claims.phone_number_verified !== true || !claims.phone_number) {
      return send(response, "PHONE_NOT_VERIFIED", "A verified phone number is required");
    }

    try {
      // Like employee `_select`, re-read the tenant's Organization (or group)
      // live: disabling or unmapping it stops citizen sign-in at once, not
      // when the session expires.
      if (!await isLiveTenantRoute(boundTenant) || !await isActiveDigitTenant(boundTenant.tenantId)) {
        return send(response, "CITIZEN_CONTEXT_UNAVAILABLE", "Citizen context is not available");
      }
      const rule = await mobileValidationForRoute({
        urlSlug: boundTenant.urlSlug,
        tenantId: boundTenant.tenantId,
        rootTenantId: boundTenant.rootTenantId,
        parentTenantId: null,
        fallbackTenantIds: [],
        name: boundTenant.name,
      });
      if (!rule) {
        console.warn("Citizen context: tenant has no MobileNumberValidation rule");
        return send(response, "CITIZEN_SIGNIN_NOT_CONFIGURED", "Citizen sign-in is not configured for this tenant");
      }
      const phone = splitE164(claims.phone_number, rule);
      if (!phone) {
        return send(response, "CITIZEN_CONTEXT_UNAVAILABLE", "This phone number cannot be used for this tenant");
      }
      // Only a number the BFF proved, or one users cannot edit in Keycloak,
      // may link an existing DIGIT citizen (#2167).
      // A failed check is retryable (503), never "untrusted": treating it as
      // untrusted would create a new account and split a legacy citizen from
      // their existing one for good.
      const phoneTrusted = current.session.authMethod === "phone_otp" ||
        await keycloakPhoneIsAdminControlled();
      const { identity } = await ensureCitizenRegistration({
        phoneTrusted,
        subject: claims.sub,
        tenant: boundTenant,
        name: claims.name?.trim() || "Citizen",
        ...phone,
      });
      const login = await managedUserLogin(
        identity, current.sessionId, phone.mobileNumber, phone.countryCode,
      );
      // egov-user issues every CITIZEN token at the state root, so the token
      // tenant is the bound tenant's citizen tenant (`identity.tenantId`),
      // never the city itself. Fail closed on anything else: another user
      // type, or a token for a different root than the session is bound to.
      if (login.user.type !== "CITIZEN" || login.user.tenantId !== identity.tenantId ||
          login.user.tenantId !== digitCitizenTenantId(boundTenant.tenantId)) {
        console.error("Citizen context: DIGIT returned a token for an unexpected account");
        return send(response, "DIGIT_ACCOUNT_MISMATCH", "Citizen context is temporarily unavailable");
      }
      // `tenant` is the bound route tenant: the client keeps using it for
      // business requests even though the token's home tenant is the root.
      return response.json({
        ...tokenResponse(login),
        tenant: { urlSlug: boundTenant.urlSlug, tenantId: boundTenant.tenantId },
      });
    } catch (error) {
      if (error instanceof IdentityAdminError) {
        console.warn("Citizen context failed:", error.message);
        return send(response, "IDENTITY_UNAVAILABLE", "Citizen context is temporarily unavailable");
      }
      return digitFailure(error, response, "Citizen context is temporarily unavailable", true);
    }
  }));
}
