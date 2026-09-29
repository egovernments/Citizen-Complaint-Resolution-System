import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
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
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { syncSubjectTenant } from "../reconciliation/subject-sync.js";
import { currentSession } from "../sessions/current-session.js";
import { saveSelectedIdentityContext } from "../sessions/session-store.js";
import { IdentityAdminError } from "../organizations/organization-service.js";
import type { TenantOption } from "./tenant-directory.js";
import { resolvePublicTenantRoute } from "./tenant-route.js";
import { resolveTenantOption, resolveTenantOptions } from "./tenant-options.js";

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

function digitFailure(error: unknown, response: express.Response, message: string) {
  if (error instanceof CitizenContextError) {
    return response.status(error.status).json({ error: error.message });
  }
  if (error instanceof ManagedAccountError) {
    return response.status(error.status).json({ error: error.message });
  }
  if (error instanceof DigitUnavailableError) {
    console.warn(`${message}:`, error.message);
    return response.status(503).json({ error: message });
  }
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
      if (error instanceof IdentityAdminError) {
        console.warn("Tenant route resolution failed:", error.message);
        return response.status(503).json({ error: "Tenant routes are temporarily unavailable" });
      }
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
      return response.status(403).json({ error: "Untrusted request origin" });
    }
    const surface = parseSurface(request.body?.surface ?? request.query.surface);
    if (!surface || surface === "citizen") {
      return response.status(400).json({ error: "Unsupported sign-in surface" });
    }
    const current = await currentSession(request.headers.cookie, surface);
    if (!current) {
      return response.status(401).json({ error: "Invalid or missing identity session" });
    }
    const tenantId = typeof request.body?.tenantId === "string"
      ? request.body.tenantId.trim()
      : "";
    if (!tenantId) return response.status(400).json({ error: "tenantId is required" });
    // An employee session is bound to the tenant of the route it signed in
    // on; it can never select another tenant, whatever its memberships.
    if (surface === "employee" && current.session.boundTenant?.tenantId !== tenantId) {
      return response.status(403).json({ error: "Tenant context is not available" });
    }

    try {
      const subject = current.session.claims.sub;
      // Only the requested tenant is resolved, and its live Organization
      // membership is what authorizes the switch.
      const selected = await resolveTenantOption(subject, tenantId);
      if (!selected) {
        return response.status(403).json({ error: "Tenant context is not available" });
      }
      const outcome = await syncSubjectTenant(
        subject,
        selected.tenantId,
        current.session.claims.phone_number,
      );
      if (!outcome.account?.active) {
        return response.status(403).json({ error: "Tenant context is not available" });
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
        return response.status(401).json({ error: "Identity session expired" });
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
      return response.status(403).json({ error: "Untrusted request origin" });
    }
    const requestedSurface = request.body?.surface ?? request.query.surface;
    if (requestedSurface !== undefined && requestedSurface !== "citizen") {
      return response.status(400).json({ error: "Unsupported sign-in surface" });
    }
    const current = await currentSession(request.headers.cookie, "citizen");
    if (!current) {
      return response.status(401).json({ error: "Invalid or missing identity session" });
    }
    const { claims, boundTenant } = current.session;
    if (!boundTenant || claims.azp !== config.keycloakCitizenClientId ||
        current.session.oidcClientId !== config.keycloakCitizenClientId) {
      return response.status(403).json({ error: "Citizen context is not available" });
    }
    // A DIGIT citizen account is keyed by a verified mobile number. How a
    // citizen without one gets a DIGIT account is open (#2189): fail closed.
    if (claims.phone_number_verified !== true || !claims.phone_number) {
      return response.status(403).json({ error: "A verified phone number is required" });
    }

    try {
      if (!await isActiveDigitTenant(boundTenant.tenantId)) {
        return response.status(403).json({ error: "Citizen context is not available" });
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
        return response.status(503).json({ error: "Citizen sign-in is not configured for this tenant" });
      }
      const phone = splitE164(claims.phone_number, rule);
      if (!phone) {
        return response.status(403).json({ error: "This phone number cannot be used for this tenant" });
      }
      const { identity } = await ensureCitizenRegistration({
        subject: claims.sub,
        tenant: boundTenant,
        name: claims.name?.trim() || "Citizen",
        ...phone,
      });
      const login = await managedUserLogin(identity, current.sessionId, phone.mobileNumber);
      // egov-user issues every CITIZEN token at the state root, so the token
      // tenant is the bound tenant's citizen tenant (`identity.tenantId`),
      // never the city itself. Fail closed on anything else: another user
      // type, or a token for a different root than the session is bound to.
      if (login.user.type !== "CITIZEN" || login.user.tenantId !== identity.tenantId ||
          login.user.tenantId !== digitCitizenTenantId(boundTenant.tenantId)) {
        console.error("Citizen context: DIGIT returned a token for an unexpected account");
        return response.status(502).json({ error: "Citizen context is temporarily unavailable" });
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
        return response.status(503).json({ error: "Citizen context is temporarily unavailable" });
      }
      return digitFailure(error, response, "Citizen context is temporarily unavailable");
    }
  }));
}
