import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { config } from "../../infrastructure/config.js";
import { resolveTenantOptions } from "../access-context/tenant-options.js";
import {
  applyVerifiedSignupIdentityProfile,
  IdentityAdminError,
} from "../organizations/organization-service.js";
import {
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
  oidcClientForMethod,
  verifyIdentityAccessToken,
  verifyIdentityIdToken,
} from "./oidc.js";
import type {
  IdentityAuthIntent,
  IdentityAuthResult,
  IdentityAuthResultCode,
} from "./types.js";
import { safeIdentityReturnTo, withAuthResult } from "./redirects.js";

function requestedIntent(value: unknown): IdentityAuthIntent | null {
  return value === "signin" || value === "signup" ? value : null;
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
    try {
      return response.json({ methods: await enabledIdentityMethods(intent || undefined) });
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
    const requestedReturnTo = request.query.returnTo === undefined
      ? null
      : safeIdentityReturnTo(request.query.returnTo);
    if (request.query.returnTo !== undefined && !requestedReturnTo) {
      return response.status(400).json({ error: "Unsupported return destination" });
    }
    const returnTo = requestedReturnTo || config.identityPostLoginRedirect;
    const requestedMethod = typeof request.query.method === "string"
      ? request.query.method
      : "password";
    let methods;
    try {
      methods = await enabledIdentityMethods(intent);
    } catch (error) {
      if (error instanceof IdentityAdminError) {
        return response.status(503).json({ error: "Sign-in methods are temporarily unavailable" });
      }
      throw error;
    }
    const method = methods.find((candidate) => candidate.id === requestedMethod);
    if (!method) return response.status(400).json({ error: "Unsupported sign-in method" });
    if (method.type === "magic_link") {
      return response.status(400).json({
        error: "Email sign-up must be started through the magic-link request API",
      });
    }

    const oidcClient = oidcClientForMethod(method.type);
    const { state, codeChallenge, nonce } = await createLoginAttempt({
      oidcClientId: oidcClient.clientId,
      intent,
      methodId: method.id,
      returnTo,
    });
    response.setHeader("Set-Cookie", loginCookie(state));
    return response.redirect(
      302,
      authorizationUrl(state, codeChallenge, nonce, oidcClient.clientId, method.idpHint),
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
    const loginCookieMatches = loginStateFromCookie(request.headers.cookie) === state;
    // OAuth/password redirects must remain bound to the browser that started
    // them. A signup magic link is deliberately cross-device: possession of
    // Keycloak's single-use emailed action token is the browser binding, so it
    // is the sole attempt type allowed to return without our login cookie.
    if (!loginCookieMatches && preview?.requiresLoginCookie !== false) {
      response.setHeader("Set-Cookie", clearedLoginCookie());
      await redirectWithResult(response, config.identityPostLoginRedirect, "SIGN_IN_FAILED");
      return;
    }

    const attempt = await consumeLoginAttempt(state);
    if (!attempt) {
      response.setHeader("Set-Cookie", clearedLoginCookie());
      await redirectWithResult(
        response,
        config.identityPostLoginRedirect,
        "AUTH_ATTEMPT_EXPIRED",
      );
      return;
    }
    if (request.query.error || !code) {
      response.setHeader("Set-Cookie", clearedLoginCookie());
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
      );
      await resolveTenantOptions(sessionClaims).catch((error) => {
        console.warn("DIGIT account resolution after sign-in failed:", (error as Error).message);
      });
      response.setHeader("Set-Cookie", [
        sessionCookie(sessionId, maxAge),
        clearedLoginCookie(),
      ]);
      return response.redirect(303, attempt.returnTo);
    } catch (error) {
      console.error("Identity callback failed:", (error as Error).message);
      response.setHeader("Set-Cookie", clearedLoginCookie());
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
