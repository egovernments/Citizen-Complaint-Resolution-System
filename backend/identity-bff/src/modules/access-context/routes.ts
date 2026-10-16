import type express from "express";
import { asyncRoute, sendError as send } from "../../app/async-route.js";
import { errorStatus, isErrorCode, type HttpErrorCode } from "../../contract/error-codes.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { config } from "../../infrastructure/config.js";
import {
  digitCitizenTenantId,
  ManagedAccountError,
  managedIdentity,
  managedUserLogin,
} from "../managed-accounts/managed-account-service.js";
import type { DigitLogin } from "../managed-accounts/digit-user-client.js";
import { parseSurface, surfaceContextKind, surfaceConfig } from "../authentication/surfaces.js";
import { mobileValidationForRoute } from "../citizen-otp/mobile-validation.js";
import {
  CitizenContextError,
  ensureCitizenRegistration,
  splitE164,
} from "../citizens/citizen-registration.js";
import { isActiveDigitTenant } from "./tenant-directory.js";
import { DigitLoginRejectedError, DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { withPersonLease, type PersonLease } from "../accounts/person-lease.js";
import { staffLogin, StaffLoginError } from "../accounts/credential-service.js";
import { citizenAccess, staffAccess } from "../bindings/predicate.js";
import { readBindingUser } from "../bindings/store.js";
import { BindingError } from "../bindings/types.js";
import { readDigitAccount } from "../workspace-members/authority.js";
import { accountEntries } from "../sync/state.js";
import { ensureCitizenEntry, mirrorPerson } from "../sync/mirror.js";
import { cachedToken, recordToken, holdToken, runPendingRevocations } from "../revocation/index.js";
import { forgetToken, revokeInventoriedToken, type AccountRef } from "../revocation/inventory.js";
import { findManagedAccount } from "../managed-accounts/managed-account-service.js";
import { revokeToken } from "../managed-accounts/digit-user-client.js";
import { currentSession } from "../sessions/current-session.js";
import { requireCurrentSession, saveSelectedIdentityContext } from "../sessions/session-store.js";
import {
  IdentityAdminError,
  keycloakPhoneIsAdminControlled,
} from "../organizations/organization-service.js";
import type { TenantOption } from "./tenant-directory.js";
import { isLiveTenantRoute, resolvePublicTenantRoute } from "./tenant-route.js";
import { resolveTenantOption, resolveTenantOptions } from "./tenant-options.js";
import { AccountLinkError } from "../account-links/account-links.js";

// Registry context kinds preserve the core selection checks for every surface.
function staffSurfacePolicy(surface: ReturnType<typeof parseSurface>) {
  const kind = surface ? surfaceContextKind(surface) : null;
  return { supported: kind !== null && kind !== "citizen", tenantBound: kind === "employee" };
}

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

/** Cleanup must preserve the original failure, including when its lease expired. */
async function cleanupIssuedToken(lease: PersonLease, account: AccountRef, login: DigitLogin, kind: "staff" | "citizen") {
  try {
    await revokeInventoriedToken(account, { accessToken: login.accessToken, expiresAt: login.expiresAt,
      subject: lease.subject, mintedAt: Date.now(), kind }, "SELECT_FAILED");
  } catch {
    // Redis unavailable: attempt logout, but retain inventory for a later retry.
    await revokeToken(login.accessToken).catch(() => undefined);
    return;
  }
  // Revocation succeeded or has a durable retry. Compare-and-delete cannot erase
  // a replacement token, and lease loss leaves inventory for the current owner.
  await forgetToken(lease, account, login.accessToken).catch(() => undefined);
}

/**
 * Maps a failure to its stable code (item 6). A typed error without a code
 * falls back to "context unavailable" for its surface; the status always comes
 * from the catalogue, so a code is never sent with two statuses.
 */
function digitFailure(error: unknown, response: express.Response, message: string, citizen = false) {
  if (error instanceof StaffLoginError) return send(response, error.reason === "ACCOUNT_LOCKED" ? "ACCOUNT_LOCKED" : error.reason === "ACCOUNT_INACTIVE" ? "DIGIT_ACCOUNT_INACTIVE" : "DIGIT_UNAVAILABLE", error.reason === "ACCOUNT_LOCKED" ? "This account is locked" : error.reason === "ACCOUNT_INACTIVE" ? "This account is not active" : message);
  const typed = error as { code?: unknown };
  if (isErrorCode(typed?.code) && typeof errorStatus(typed.code as HttpErrorCode) === "number") return send(response, typed.code as HttpErrorCode, message);
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
      response.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
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
    const surfacePolicy = staffSurfacePolicy(surface);
    if (!surface || !surfacePolicy.supported) {
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
    if (surfacePolicy.tenantBound && current.session.boundTenant?.tenantId !== tenantId) {
      return send(response, "TENANT_CONTEXT_UNAVAILABLE", "Tenant context is not available");
    }

    try {
      const subject = current.session.claims.sub;
      const login = await withPersonLease(subject, async (lease) => {
        // A queued revocation could end this session or revoke the cached token (#2286).
        await runPendingRevocations(lease);
        await requireCurrentSession(lease, current.sessionId);
        const access = await staffAccess(subject, tenantId);
        if (!access.allowed) throw new BindingError(access.binding?.state === "pending" ? "PENDING_INVITATION" : surfacePolicy.tenantBound ? "EMPLOYEE_ACCOUNT_NOT_LINKED" : "TENANT_CONTEXT_UNAVAILABLE", "Tenant context is not available");
        const selected = await resolveTenantOption(subject, tenantId);
        if (!selected) throw new BindingError("TENANT_CONTEXT_UNAVAILABLE", "Tenant context is not available");
        const identity = managedIdentity(config.keycloakIssuer, subject, tenantId);
        const account = access.binding ? await readDigitAccount(tenantId, access.binding.uuid) : await findManagedAccount(identity);
        if (!account) throw new BindingError("DIGIT_ACCOUNT_NOT_FOUND", "The bound employee account is missing");
        if (!account.active) {
          await cachedToken(lease, account); // Invalidates any already-issued inactive account token; never mints.
          throw new BindingError("DIGIT_ACCOUNT_INACTIVE", "This account is not active");
        }
        let minted: DigitLogin | null = null;
        try {
          let token = await cachedToken(lease, account);
          if (!token) {
            const recorded = accountEntries(await readBindingUser(subject)).find((e) => e.kind === "staff" && e.tenantId === tenantId && e.uuid === account.uuid);
            token = access.binding ? await staffLogin({ tenantId, uuid: account.uuid, userName: account.userName, keyVersion: recorded?.credential?.keyVersion }, lease)
              : await managedUserLogin(identity, current.sessionId);
            minted = token;
            if (access.binding) await recordToken(lease, account, token, "staff");
          }
          await holdToken(lease, account, current.sessionId);
          if (access.binding) await mirrorPerson(subject);
          await lease.assertHeld();
          if (!await saveSelectedIdentityContext(current.sessionId, { organizationId: selected.organizationId,
            organizationAlias: selected.organizationAlias, tenantId, name: selected.name })) throw new BindingError("SESSION_REVOKED", "The identity session is no longer current");
          return token;
        } catch (error) {
          if (minted) await cleanupIssuedToken(lease, account, minted, "staff");
          throw error;
        }
      });
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
    const surface = parseSurface(requestedSurface ?? "citizen");
    if (!surface || surfaceContextKind(surface) !== "citizen") {
      return send(response, "UNSUPPORTED_SURFACE", "Unsupported sign-in surface");
    }
    const current = await currentSession(request.headers.cookie, surface);
    if (!current) {
      return send(response, "SESSION_REQUIRED", "Invalid or missing identity session");
    }
    const { claims, boundTenant } = current.session;
    if (!boundTenant || claims.azp !== surfaceConfig(surface).clientId ||
        current.session.oidcClientId !== surfaceConfig(surface).clientId) {
      return send(response, "CITIZEN_CONTEXT_UNAVAILABLE", "Citizen context is not available");
    }

    try {
      return await withPersonLease(claims.sub, async (lease) => {
        let issued: DigitLogin | null = null;
        let issuedAccount: AccountRef | null = null;
        try {
          await runPendingRevocations(lease); // #2286, as in employee _select
          await requireCurrentSession(lease, current.sessionId);
          const access = await citizenAccess(claims.sub);
          if (!access.allowed) return send(response, access.denial === "PHONE_NOT_VERIFIED" ? "PHONE_NOT_VERIFIED" : "CITIZEN_CONTEXT_UNAVAILABLE", "Citizen context is not available");
          const livePhone = (await readBindingUser(claims.sub)).attributes?.phoneNumber?.[0];
          if (!livePhone) return send(response, "PHONE_NOT_VERIFIED", "A verified phone number is required");
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
          const phone = splitE164(livePhone, rule);
          if (!phone) {
            return send(response, "CITIZEN_CONTEXT_UNAVAILABLE", "This phone number cannot be used for this tenant");
          }
          // Only a number the BFF proved, or one users cannot edit in Keycloak,
          // may link an existing DIGIT citizen (#2167).
          // A failed check is retryable (503), never "untrusted": treating it as
          // untrusted would create a new account and split a legacy citizen from
          // their existing one for good.
          // A phone_otp session proved only `claims.phone_number`: it vouches for
          // the live Keycloak phone only while the two are the same number.
          const phoneTrusted = (current.session.authMethod === "phone_otp" && claims.phone_number === livePhone) ||
            await keycloakPhoneIsAdminControlled();
          const { identity, registration } = await ensureCitizenRegistration({
            phoneTrusted,
            subject: claims.sub,
            tenant: boundTenant,
            name: claims.name?.trim() || phone.mobileNumber,
            ...phone,
          });
          issuedAccount = { tenantId: identity.tenantId, uuid: registration.digitUserUuid };
          await ensureCitizenEntry(claims.sub, issuedAccount);
          const login = await managedUserLogin(
            identity, current.sessionId, phone.mobileNumber, phone.countryCode,
          );
          issued = login;
          await lease.assertHeld();
          await requireCurrentSession(lease, current.sessionId);
          // egov-user issues every CITIZEN token at the state root, so the token
          // tenant is the bound tenant's citizen tenant (`identity.tenantId`),
          // never the city itself. Fail closed on anything else: another user
          // type, or a token for a different root than the session is bound to.
          if (login.user.type !== "CITIZEN" || login.user.tenantId !== identity.tenantId ||
              login.user.tenantId !== digitCitizenTenantId(boundTenant.tenantId)) {
            console.error("Citizen context: DIGIT returned a token for an unexpected account");
            throw new BindingError("DIGIT_ACCOUNT_MISMATCH", "Citizen context is temporarily unavailable");
          }
          // `tenant` is the bound route tenant: the client keeps using it for
          // business requests even though the token's home tenant is the root.
          return response.json({
            ...tokenResponse(login),
            tenant: { urlSlug: boundTenant.urlSlug, tenantId: boundTenant.tenantId },
          });
        } catch (error) {
          if (issued && issuedAccount) await cleanupIssuedToken(lease, issuedAccount, issued, "citizen");
          throw error;
        }
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
