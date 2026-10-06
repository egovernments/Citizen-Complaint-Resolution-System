import type express from "express";
import { withPersonLease } from "../accounts/person-lease.js";
import { currentSession } from "../sessions/current-session.js";
import { AccountActionError, authorizeAccountAction } from "./account-service.js";
import { asyncRoute } from "../../app/async-route.js";
import { errorBody } from "../../contract/error-codes.js";
import { config } from "../../infrastructure/config.js";
import {
  applyVerifiedSignupIdentityProfile,
  IdentityAdminError,
} from "../organizations/organization-service.js";
import { boundTenantOf, routeForSlug } from "../access-context/tenant-route.js";
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
  sessionIdFromCookie,
  requireCurrentSession,
  saveIdentitySession,
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
  surfaceConfig,
  type BoundTenant,
} from "./surfaces.js";
import type {
  IdentityAuthIntent,
  IdentityAuthResult,
  IdentityAuthResultCode,
} from "./types.js";
import { returnDestination, withAuthResult } from "./redirects.js";

function requestedIntent(value: unknown): IdentityAuthIntent | null {
  return value === "signin" || value === "signup" ? value : null;
}

/** BCP 47-ish `ui_locales`, forwarded to Keycloak for display only. */
const UI_LOCALES = /^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*( [A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*)*$/;

/**
 * Relative paths stay on the BFF's public origin. Absolute development URLs
 * must use the same origin allowlist as credentialed CORS; this keeps one
 * deployment source of truth and avoids introducing a competing redirect list.
 */
const RESULT_COPY: Record<IdentityAuthResultCode, Omit<IdentityAuthResult, "code">> = {
  ACTION_COMPLETE: { status: "complete", actions: [] },
  ACTION_CANCELLED: { status: "failed", actions: ["TRY_AGAIN"] },
  ACTION_FAILED: { status: "failed", actions: ["TRY_AGAIN"] },
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

export function result(
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

/** Ends a login attempt: clears its cookie and redirects with a sign-in result. */
async function redirectWithResult(
  response: express.Response,
  surface: string,
  destination: string,
  code: IdentityAuthResultCode,
  intent: IdentityAuthIntent = "signin",
): Promise<void> {
  response.setHeader("Set-Cookie", clearedLoginCookie(surface));
  const id = await createAuthResult(result(code, intent));
  response.redirect(303, withAuthResult(destination, id));
}

export function registerAuthenticationRoutes(app: express.Application): void {
  app.get("/identity/v1/auth-methods", asyncRoute(async (request, response) => {
    const intent = request.query.intent === undefined
      ? "signin"
      : requestedIntent(request.query.intent);
    if (request.query.intent !== undefined && !intent) {
      return response.status(400).json({ error: "Unsupported authentication intent", code: "UNSUPPORTED_INTENT" });
    }
    const surface = parseSurface(request.query.surface);
    if (!surface) return response.status(400).json({ error: "Unsupported sign-in surface", code: "UNSUPPORTED_SURFACE" });
    try {
      return response.json({
        methods: await enabledIdentityMethods(intent || undefined, surface),
      });
    } catch (error) {
      if (error instanceof IdentityAdminError) {
        return response.status(503).json({ error: "Sign-in methods are temporarily unavailable", code: "SIGNIN_METHODS_UNAVAILABLE" });
      }
      throw error;
    }
  }));

  app.get("/identity/v1/authorize", asyncRoute(async (request, response) => {
    const action = request.query.action;
    if (action !== undefined && request.query.intent !== undefined) return response.status(400).json(errorBody("INVALID_REQUEST", "action and intent are mutually exclusive"));
    const intent = request.query.intent === undefined
      ? "signin"
      : requestedIntent(request.query.intent);
    if (!intent) {
      return response.status(400).json({ error: "Unsupported authentication intent", code: "UNSUPPORTED_INTENT" });
    }
    const surface = parseSurface(request.query.surface);
    if (!surface) return response.status(400).json({ error: "Unsupported sign-in surface", code: "UNSUPPORTED_SURFACE" });
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
    let returnTo: string | null;
    if (isTenantBoundSurface(surface)) {
      const tenant = await routeForSlug(tenantSlug);
      if ("status" in tenant) return response.status(tenant.status).json({ error: tenant.error });
      boundTenant = boundTenantOf(tenant);
      returnTo = returnDestination(request.query.returnTo, surfaceReturnPrefix(surface, tenant.urlSlug));
    } else {
      if (tenantSlug !== undefined) {
        return response.status(400).json({ error: "tenantSlug is not supported for this surface" });
      }
      returnTo = returnDestination(request.query.returnTo);
    }
    if (!returnTo) return response.status(400).json({ error: "Unsupported return destination" });

    let accountAction: { sid: string; sub: string; action: string } | undefined;
    let kcAction: string | undefined;
    let method: { id: string; type: import("./types.js").IdentityAuthMethod["type"]; idpHint?: string };
    if (action !== undefined) {
      const current = await currentSession(request.headers.cookie, surface);
      if (!current) return response.status(401).json(errorBody("SESSION_REQUIRED", "A signed-in session is required"));
      if (boundTenant && current.session.boundTenant?.tenantId !== boundTenant.tenantId) return response.status(400).json(errorBody("INVALID_REQUEST", "The session belongs to another tenant"));
      try {
        kcAction = await withPersonLease(current.session.claims.sub, async lease => {
          const session = await requireCurrentSession(lease, current.sessionId);
          return authorizeAccountAction(session, surface, action, request.query.credentialId, request.query.provider);
        });
      } catch (error) {
        if (error instanceof AccountActionError) return response.status(error.status).json({ code: error.code, error: error.message });
        throw error;
      }
      accountAction = { sid: current.sessionId, sub: current.session.claims.sub, action: String(action) };
      method = { id: "account_action", type: "hosted" };
    } else {
      let methods;
      try { methods = await enabledIdentityMethods(intent, surface); }
      catch (error) {
        if (error instanceof IdentityAdminError) return response.status(503).json(errorBody("SIGNIN_METHODS_UNAVAILABLE", "Sign-in methods are temporarily unavailable"));
        throw error;
      }
      const requestedMethod = typeof request.query.method === "string" ? request.query.method
        : methods.find(candidate => candidate.type !== "magic_link" && candidate.type !== "phone_otp")?.id;
      const selected = methods.find(candidate => candidate.id === requestedMethod);
      if (!selected || selected.type === "phone_otp" || selected.type === "magic_link") return response.status(400).json(errorBody("UNSUPPORTED_METHOD", "Unsupported sign-in method"));
      method = selected;
    }

    // The client follows from the surface alone, never from returnTo.
    const oidcClient = oidcClientForSurface(surface, method.type);
    if (!oidcClient) {
      return response.status(503).json({ error: "Sign-in methods are temporarily unavailable", code: "SIGNIN_METHODS_UNAVAILABLE" });
    }
    const { state, codeChallenge, nonce } = await createLoginAttempt({
      oidcClientId: oidcClient.clientId,
      intent,
      methodId: method.id,
      ...(accountAction && { accountAction }),
      returnTo,
      surface,
      ...(boundTenant && { boundTenant }),
    });
    const extraParams: Record<string, string> = boundTenant
      ? {
        // Display only: the theme shows the tenant's branding. Authority is
        // the tenant bound to this attempt, never a value echoed back.
        digit_tenant: boundTenant.urlSlug,
      }
      : {};
    const prompt = surfaceConfig(surface).prompt;
    if (prompt) extraParams.prompt = prompt;
    if (kcAction) extraParams.kc_action = kcAction;
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
    if (!state) return redirectWithResult(response, DEFAULT_SURFACE, config.identityPostLoginRedirect, "SIGN_IN_FAILED");

    const preview = await getLoginAttempt(state);
    const previewSurface = preview ? attemptSurface(preview) : DEFAULT_SURFACE;
    const loginCookieMatches =
      loginStateFromCookie(request.headers.cookie, previewSurface) === state;
    // OAuth/password redirects must remain bound to the browser that started
    // them. A signup magic link is deliberately cross-device: possession of
    // Keycloak's single-use emailed action token is the browser binding, so it
    // is the sole attempt type allowed to return without our login cookie.
    // Failures before the attempt is consumed still return to the surface
    // and tenant route it started from. That returnTo was validated against
    // the bound tenant's prefix when the attempt was created.
    const failureDestination = preview && isTenantBoundSurface(previewSurface)
      ? preview.returnTo
      : config.identityPostLoginRedirect;
    if (!loginCookieMatches && preview?.requiresLoginCookie !== false) {
      return redirectWithResult(response, previewSurface, failureDestination, "SIGN_IN_FAILED");
    }

    const attempt = await consumeLoginAttempt(state);
    if (!attempt) return redirectWithResult(response, previewSurface, failureDestination, "AUTH_ATTEMPT_EXPIRED");
    const surface = attemptSurface(attempt);
    if (request.query.error || !code) {
      return redirectWithResult(
        response,
        surface,
        attempt.returnTo,
        attempt.accountAction ? (request.query.kc_action_status === "cancelled" ? "ACTION_CANCELLED" : "ACTION_FAILED") : providerErrorCode(request.query.error, request.query.error_description),
        attempt.intent,
      );
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
      if (attempt.accountAction) {
        const binding = attempt.accountAction;
        if (claims.sub !== binding.sub || sessionIdFromCookie(request.headers.cookie, surface) !== binding.sid) throw new Error("Account action changed the initiating person or session");
        await withPersonLease(binding.sub, async lease => {
          const session = await requireCurrentSession(lease, binding.sid);
          if (session.surface && session.surface !== surface) throw new Error("Account action changed surface");
          await saveIdentitySession(binding.sid, tokens, claims,
            Math.max(1, Math.floor((session.sessionExpiresAt - Date.now()) / 1000)), attempt.oidcClientId,
            session.sessionExpiresAt, { surface, boundTenant: session.boundTenant });
        });
        const outcome = request.query.kc_action_status === "success" ? "ACTION_COMPLETE"
          : request.query.kc_action_status === "cancelled" ? "ACTION_CANCELLED" : "ACTION_FAILED";
        return redirectWithResult(response, surface, attempt.returnTo, outcome);
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
      response.setHeader("Set-Cookie", [
        sessionCookie(sessionId, maxAge, surface),
        clearedLoginCookie(surface),
      ]);
      return response.redirect(303, attempt.returnTo);
    } catch (error) {
      console.error("Identity callback failed:", (error as Error).message);
      return redirectWithResult(response, surface, attempt.returnTo, attempt.accountAction ? "ACTION_FAILED" : "SIGN_IN_FAILED", attempt.intent);
    }
  }));

  app.get("/identity/v1/auth-results/:id", asyncRoute(async (request, response) => {
    const id = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const authResult = await consumeAuthResult(id);
    if (!authResult) {
      return response.status(404).json(errorBody("AUTH_RESULT_NOT_FOUND", "Authentication result expired or was already read"));
    }
    return response.json(authResult);
  }));
}
