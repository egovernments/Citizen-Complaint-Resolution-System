import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { config } from "../../infrastructure/config.js";
import { resolveTenantOptions } from "../access-context/tenant-options.js";
import {
  applyVerifiedSignupIdentityProfile,
  IdentityAdminError,
} from "../organizations/organization-service.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { resolvePublicTenantRoute } from "../access-context/tenant-route.js";
import {
  attemptSurface,
  clearedLoginCookie,
  consumeAuthResult,
  consumeLoginAttempt,
  createAuthResult,
  createIdentitySession,
  createLoginAttempt,
  getLoginAttempt,
  loginCookie,
  loginStateFromCookie,
  sessionCookie,
} from "../sessions/session-store.js";
import { enabledIdentityMethods } from "./methods.js";
import {
  authorizationUrl,
  exchangeAuthorizationCode,
  oidcClientForSurface,
  verifyIdentityAccessToken,
  verifyIdentityIdToken,
} from "./oidc.js";
import {
  DEFAULT_SURFACE,
  isTenantBoundSurface,
  parseSurface,
  surfaceReturnPrefix,
  type BoundTenant,
} from "./surfaces.js";
import type {
  IdentityAuthIntent,
  IdentityAuthResult,
  IdentityAuthResultCode,
} from "./types.js";
import { safeIdentityReturnTo, withAuthResult } from "./redirects.js";

function requestedIntent(value: unknown): IdentityAuthIntent | null {
  return value === "signin" || value === "signup" ? value : null;
}

/** BCP 47-ish `ui_locales`, forwarded to Keycloak for display only. */
const UI_LOCALES = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*( [A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*)*$/;

/**
 * Relative destinations under the surface's own tenant route. Normalization
 * (dot segments, percent-encoding) happens first, so `/slug/digit-ui/employee/../x`
 * cannot escape the prefix.
 */
function tenantBoundReturnTo(value: unknown, prefix: string): string | null {
  const safe = safeIdentityReturnTo(value);
  if (!safe || !safe.startsWith("/") || safe.startsWith("//")) return null;
  const path = new URL(safe, "http://identity.invalid").pathname;
  return path.startsWith(prefix) ? safe : null;
}

/**
 * Relative paths stay on the BFF's public origin. Absolute development URLs
 * must use the same origin allowlist as credentialed CORS; this keeps one
 * deployment source of truth and avoids introducing a competing redirect list.
 */
const RESULT_COPY: Record<IdentityAuthResultCode, Omit<IdentityAuthResult, "code">> = {
  AUTH_CANCELLED: {
    status: "failed",
    message: "Sign-in was cancelled. No changes were made to your account.",
    actions: ["TRY_AGAIN"],
  },
  AUTH_ATTEMPT_EXPIRED: {
    status: "failed",
    message: "That sign-in attempt expired or was already used. Please start again.",
    actions: ["TRY_AGAIN"],
  },
  IDENTITY_PROVIDER_UNAVAILABLE: {
    status: "failed",
    message: "That sign-in provider is temporarily unavailable. Try another method or try again later.",
    actions: ["TRY_AGAIN", "TRY_EXISTING_METHOD"],
  },
  ACCOUNT_LINK_REQUIRED: {
    status: "failed",
    message: "An account already uses this email. Verify the existing account to link this sign-in method.",
    actions: ["TRY_EXISTING_METHOD", "SETUP_PASSWORD"],
  },
  ACCOUNT_LINK_FAILED: {
    status: "failed",
    message: "We could not link that sign-in method. Your existing account was not changed.",
    actions: ["TRY_EXISTING_METHOD", "SETUP_PASSWORD"],
  },
  IDENTITY_ALREADY_LINKED: {
    status: "failed",
    message: "That sign-in identity is already connected to another account. Contact an administrator for recovery.",
    actions: ["TRY_EXISTING_METHOD"],
  },
  EMAIL_VERIFICATION_REQUIRED: {
    status: "failed",
    message: "Verify the email on the existing account before linking another sign-in method.",
    actions: ["TRY_EXISTING_METHOD", "SETUP_PASSWORD"],
  },
  SIGN_IN_FAILED: {
    status: "failed",
    message: "Sign-in could not be completed. Please try again.",
    actions: ["TRY_AGAIN", "TRY_EXISTING_METHOD"],
  },
  PASSWORD_SETUP_FAILED: {
    status: "failed",
    message: "Password setup was not completed. Request another link when you are ready.",
    actions: ["SETUP_PASSWORD"],
  },
  PASSWORD_SETUP_COMPLETE: {
    status: "complete",
    message: "Your password is ready. You can now sign in with email and password.",
    actions: ["TRY_AGAIN"],
  },
};

function result(
  code: IdentityAuthResultCode,
  intent: IdentityAuthIntent = "signin",
): IdentityAuthResult {
  const base = { code, ...RESULT_COPY[code] };
  if (intent === "signup" && code === "AUTH_CANCELLED") {
    return { ...base, message: "Sign-up was cancelled. No changes were made to your account." };
  }
  if (intent === "signup" && code === "SIGN_IN_FAILED") {
    return { ...base, message: "Sign-up could not be completed. Please try again." };
  }
  return base;
}

function providerErrorCode(error: unknown, description: unknown): IdentityAuthResultCode {
  const detail = `${typeof error === "string" ? error : ""} ${
    typeof description === "string" ? description : ""
  }`.toLowerCase();
  if (detail.includes("already linked") || detail.includes("federated_identity_exists")) {
    return "IDENTITY_ALREADY_LINKED";
  }
  if (detail.includes("verify") && detail.includes("email")) return "EMAIL_VERIFICATION_REQUIRED";
  if (detail.includes("existing account") || detail.includes("account_exists")) {
    return "ACCOUNT_LINK_REQUIRED";
  }
  if (detail.includes("link")) return "ACCOUNT_LINK_FAILED";
  if (error === "access_denied") return "AUTH_CANCELLED";
  return "IDENTITY_PROVIDER_UNAVAILABLE";
}

async function redirectWithResult(
  response: express.Response,
  destination: string,
  code: IdentityAuthResultCode,
  intent: IdentityAuthIntent = "signin",
): Promise<void> {
  const id = await createAuthResult(result(code, intent));
  response.redirect(303, withAuthResult(destination, id));
}

export function registerAuthenticationRoutes(app: express.Application): void {
  app.get("/identity/v1/auth-methods", asyncRoute(async (request, response) => {
    const intent = request.query.intent === undefined
      ? undefined
      : requestedIntent(request.query.intent);
    if (request.query.intent !== undefined && !intent) {
      return response.status(400).json({ error: "Unsupported authentication intent" });
    }
    const surface = parseSurface(request.query.surface);
    if (!surface) return response.status(400).json({ error: "Unsupported sign-in surface" });
    try {
      return response.json({
        methods: await enabledIdentityMethods(intent || undefined, surface),
      });
    } catch (error) {
      if (error instanceof IdentityAdminError) {
        return response.status(503).json({ error: "Sign-in methods are temporarily unavailable" });
      }
      throw error;
    }
  }));

  app.get("/identity/v1/authorize", asyncRoute(async (request, response) => {
    const intent = request.query.intent === undefined
      ? "signin"
      : requestedIntent(request.query.intent);
    if (!intent) {
      return response.status(400).json({ error: "Unsupported authentication intent" });
    }
    const surface = parseSurface(request.query.surface);
    if (!surface) return response.status(400).json({ error: "Unsupported sign-in surface" });
    const tenantSlug = request.query.tenantSlug;
    if (tenantSlug !== undefined && typeof tenantSlug !== "string") {
      return response.status(400).json({ error: "Unsupported tenant route" });
    }
    const uiLocales = request.query.ui_locales;
    if (uiLocales !== undefined &&
        (typeof uiLocales !== "string" || uiLocales.length > 64 || !UI_LOCALES.test(uiLocales))) {
      return response.status(400).json({ error: "Unsupported ui_locales" });
    }

    // The tenant of an employee/citizen sign-in comes ONLY from the route the
    // browser is on, resolved here, server-side, before Keycloak is involved.
    let boundTenant: BoundTenant | undefined;
    let returnTo: string;
    if (isTenantBoundSurface(surface)) {
      if (!tenantSlug) return response.status(400).json({ error: "tenantSlug is required" });
      let tenant;
      try {
        tenant = await resolvePublicTenantRoute(tenantSlug);
      } catch (error) {
        if (error instanceof IdentityAdminError || error instanceof DigitUnavailableError) {
          console.warn("Tenant route resolution failed:", error.message);
          return response.status(503).json({ error: "Tenant routes are temporarily unavailable" });
        }
        throw error;
      }
      if (!tenant) return response.status(404).json({ error: "Tenant route is not available" });
      boundTenant = {
        urlSlug: tenant.urlSlug,
        tenantId: tenant.tenantId,
        rootTenantId: tenant.rootTenantId,
        name: tenant.name,
      };
      const prefix = surfaceReturnPrefix(surface, tenant.urlSlug);
      const requested = request.query.returnTo === undefined
        ? prefix
        : tenantBoundReturnTo(request.query.returnTo, prefix);
      if (!requested) return response.status(400).json({ error: "Unsupported return destination" });
      returnTo = requested;
    } else {
      if (tenantSlug !== undefined) {
        return response.status(400).json({ error: "tenantSlug is not supported for this surface" });
      }
      const requestedReturnTo = request.query.returnTo === undefined
        ? null
        : safeIdentityReturnTo(request.query.returnTo);
      if (request.query.returnTo !== undefined && !requestedReturnTo) {
        return response.status(400).json({ error: "Unsupported return destination" });
      }
      returnTo = requestedReturnTo || config.identityPostLoginRedirect;
    }

    let methods;
    try {
      methods = await enabledIdentityMethods(intent, surface);
    } catch (error) {
      if (error instanceof IdentityAdminError) {
        return response.status(503).json({ error: "Sign-in methods are temporarily unavailable" });
      }
      throw error;
    }
    const requestedMethod = typeof request.query.method === "string"
      ? request.query.method
      : surface === DEFAULT_SURFACE ? "password" : methods[0]?.id;
    const method = methods.find((candidate) => candidate.id === requestedMethod);
    if (!method) return response.status(400).json({ error: "Unsupported sign-in method" });
    if (method.type === "magic_link") {
      return response.status(400).json({
        error: "Email sign-up must be started through the magic-link request API",
      });
    }

    // The client follows from the surface alone, never from returnTo.
    const oidcClient = oidcClientForSurface(surface, method.type);
    if (!oidcClient) {
      return response.status(503).json({ error: "Sign-in methods are temporarily unavailable" });
    }
    const { state, codeChallenge, nonce } = await createLoginAttempt({
      oidcClientId: oidcClient.clientId,
      intent,
      methodId: method.id,
      returnTo,
      ...(boundTenant && { surface, boundTenant }),
    });
    const extraParams: Record<string, string> = boundTenant
      ? {
        // Display only: the theme shows the tenant's branding. Authority is
        // the tenant bound to this attempt, never a value echoed back.
        digit_tenant: boundTenant.urlSlug,
        // No cross-client SSO for digit-ui: always ask for credentials.
        prompt: "login",
      }
      : {};
    if (typeof uiLocales === "string") extraParams.ui_locales = uiLocales;
    response.setHeader("Set-Cookie", loginCookie(state, surface));
    return response.redirect(
      302,
      authorizationUrl(state, codeChallenge, nonce, oidcClient.clientId, {
        scope: oidcClient.scope,
        idpHint: method.idpHint,
        extraParams,
      }),
    );
  }));

  app.get("/identity/v1/callback", asyncRoute(async (request, response) => {
    const code = typeof request.query.code === "string" ? request.query.code : null;
    const state = typeof request.query.state === "string" ? request.query.state : null;
    if (!state) {
      response.setHeader("Set-Cookie", clearedLoginCookie());
      await redirectWithResult(response, config.identityPostLoginRedirect, "SIGN_IN_FAILED");
      return;
    }

    const preview = await getLoginAttempt(state);
    const previewSurface = preview ? attemptSurface(preview) : DEFAULT_SURFACE;
    const loginCookieMatches =
      loginStateFromCookie(request.headers.cookie, previewSurface) === state;
    // OAuth/password redirects must remain bound to the browser that started
    // them. A signup magic link is deliberately cross-device: possession of
    // Keycloak's single-use emailed action token is the browser binding, so it
    // is the sole attempt type allowed to return without our login cookie.
    if (!loginCookieMatches && preview?.requiresLoginCookie !== false) {
      response.setHeader("Set-Cookie", clearedLoginCookie(previewSurface));
      await redirectWithResult(response, config.identityPostLoginRedirect, "SIGN_IN_FAILED");
      return;
    }

    const attempt = await consumeLoginAttempt(state);
    if (!attempt) {
      response.setHeader("Set-Cookie", clearedLoginCookie(previewSurface));
      await redirectWithResult(
        response,
        config.identityPostLoginRedirect,
        "AUTH_ATTEMPT_EXPIRED",
      );
      return;
    }
    const surface = attemptSurface(attempt);
    if (request.query.error || !code) {
      response.setHeader("Set-Cookie", clearedLoginCookie(surface));
      await redirectWithResult(
        response,
        attempt.returnTo,
        providerErrorCode(request.query.error, request.query.error_description),
        attempt.intent,
      );
      return;
    }

    try {
      const tokens = await exchangeAuthorizationCode(
        code,
        attempt.codeVerifier,
        attempt.oidcClientId,
      );
      const claims = await verifyIdentityAccessToken(tokens.accessToken, attempt.oidcClientId);
      const idClaims = await verifyIdentityIdToken(
        tokens.idToken,
        attempt.nonce,
        attempt.oidcClientId,
      );
      if (idClaims.sub !== claims.sub) {
        throw new Error("Keycloak token subjects do not match");
      }
      let sessionClaims = claims;
      if (attempt.identityProfileDraft) {
        const draft = attempt.identityProfileDraft;
        if (attempt.intent !== "signup" ||
            claims.email.trim().toLowerCase() !== draft.email ||
            claims.email_verified !== true) {
          throw new Error("Magic-link identity does not match the signup draft");
        }
        const profileApplied = await applyVerifiedSignupIdentityProfile({
          userId: claims.sub,
          ...draft,
        });
        if (profileApplied) {
          sessionClaims = {
            ...claims,
            name: `${draft.firstName} ${draft.lastName}`,
          };
        }
      }
      const { sessionId, maxAge } = await createIdentitySession(
        tokens,
        sessionClaims,
        attempt.oidcClientId,
        { surface, boundTenant: attempt.boundTenant },
      );
      // Organization tenant options are a configurator concept: digit-ui
      // sessions are already bound to their route tenant.
      if (surface === DEFAULT_SURFACE) {
        await resolveTenantOptions(sessionClaims).catch((error) => {
          console.warn("DIGIT account resolution after sign-in failed:", (error as Error).message);
        });
      }
      response.setHeader("Set-Cookie", [
        sessionCookie(sessionId, maxAge, surface),
        clearedLoginCookie(surface),
      ]);
      return response.redirect(303, attempt.returnTo);
    } catch (error) {
      console.error("Identity callback failed:", (error as Error).message);
      response.setHeader("Set-Cookie", clearedLoginCookie(surface));
      await redirectWithResult(response, attempt.returnTo, "SIGN_IN_FAILED", attempt.intent);
      return;
    }
  }));

  app.get("/identity/v1/auth-results/:id", asyncRoute(async (request, response) => {
    const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const authResult = await consumeAuthResult(id);
    if (!authResult) {
      return response.status(404).json({ error: "Authentication result expired or was already read" });
    }
    return response.json(authResult);
  }));
}
