import { createHmac } from "node:crypto";
import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { config } from "../../infrastructure/config.js";
import { withinLimit as withinRateLimit } from "../../infrastructure/rate-limit.js";
import { errorBody } from "../../contract/error-codes.js";
import { resolvePublicTenantRoute } from "../access-context/tenant-route.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import {
  hasPasswordCredential,
  IdentityAdminError,
  inspectPasswordSetupAccount,
  inspectPasswordSetupAccountById,
  sendPasswordSetupEmail,
} from "../organizations/organization-service.js";
import { currentSession } from "../sessions/current-session.js";
import {
  consumePasswordSetupAttempt,
  createAuthResult,
  createPasswordSetupAttempt,
  getPasswordSetupAttempt,
} from "../sessions/session-store.js";
import { oidcClientForSurface } from "./oidc.js";
import { safeIdentityReturnTo, tenantBoundReturnTo, withAuthResult } from "./redirects.js";
import { isTenantBoundSurface, parseSurface, surfaceReturnPrefix } from "./surfaces.js";

const ACCEPTED = {
  message: "If an eligible account exists, a password setup email has been sent.",
};

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

function completionRedirectUri(state: string): string {
  const callback = new URL(config.identityRedirectUri);
  // Keycloak 26 does not apply a trailing redirect wildcard to a query string
  // for execute-actions-email. A path segment is both allowlistable and opaque.
  callback.pathname = `${callback.pathname.replace(/\/callback$/, "/password/setup-complete")}/${encodeURIComponent(state)}`;
  callback.search = "";
  return callback.toString();
}

function withinLimit(bucket: string): Promise<boolean> {
  return withinRateLimit(bucket, config.identityPasswordSetupLimit, config.identityPasswordSetupTtlSeconds);
}

function privateRateLimitKey(identifier: string): string {
  const rateLimitKey = createHmac("sha256", config.keycloakBffClientSecret)
    .update("digit.identity.password-setup.rate-limit.v1")
    .digest();
  return createHmac("sha256", rateLimitKey)
    .update(identifier)
    .digest("hex");
}

async function processPasswordSetup(input: {
  email: string | null;
  authenticatedUserId: string | null;
  returnTo: string;
  clientId: string;
}): Promise<void> {
  try {
    const account = input.authenticatedUserId
      ? await inspectPasswordSetupAccountById(input.authenticatedUserId)
      : input.email
        ? await inspectPasswordSetupAccount(input.email)
        : null;
    // A provider-only account whose provider has not established email
    // ownership cannot be recovered by an unauthenticated email request. The
    // user must first authenticate with that provider; that live session then
    // proves ownership without exposing provider/account state to the caller.
    const unsafeUnauthenticatedFederatedAccount = !input.authenticatedUserId &&
      account && !account.emailVerified && !account.hasPassword &&
      account.federatedProviders.length > 0;
    if (!account || unsafeUnauthenticatedFederatedAccount) {
      console.info("Password setup request processed", { outcome: "ineligible" });
      return;
    }
    const state = await createPasswordSetupAttempt({
      returnTo: input.returnTo,
      userId: account.userId,
      hadPassword: account.hasPassword,
    });
    await sendPasswordSetupEmail({
      userId: account.userId,
      emailVerified: account.emailVerified,
      redirectUri: completionRedirectUri(state),
      clientId: input.clientId,
    });
    console.info("Password setup request processed", {
      outcome: "sent",
      authenticated: Boolean(input.authenticatedUserId),
      hadPassword: account.hasPassword,
      federatedIdentityCount: account.federatedProviders.length,
    });
  } catch (error) {
    console.warn("Password setup request failed", { error: (error as Error).message });
  }
}

export function registerPasswordSetupRoutes(app: express.Application): void {
  app.post("/identity/v1/password/setup-requests", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return response.status(403).json(errorBody("UNTRUSTED_ORIGIN", "Untrusted request origin"));
    }
    // The surface picks the Keycloak client of the email (item 5), so the
    // action pages use that surface's theme, and the return path.
    const surface = parseSurface(request.body?.surface);
    const client = surface && oidcClientForSurface(surface, "password");
    if (!surface || !client) {
      return response.status(400).json(errorBody("UNSUPPORTED_SURFACE", "Unsupported sign-in surface"));
    }
    let returnTo: string;
    if (isTenantBoundSurface(surface)) {
      const tenantSlug = request.body?.tenantSlug;
      if (typeof tenantSlug !== "string" || !tenantSlug) {
        return response.status(400).json(errorBody("INVALID_REQUEST", "tenantSlug is required"));
      }
      let tenant;
      try {
        tenant = await resolvePublicTenantRoute(tenantSlug);
      } catch (error) {
        if (error instanceof IdentityAdminError || error instanceof DigitUnavailableError) {
          console.warn("Tenant route resolution failed:", error.message);
          return response.status(503).json(errorBody("TENANT_ROUTE_UNAVAILABLE", "Tenant routes are temporarily unavailable"));
        }
        throw error;
      }
      if (!tenant) return response.status(404).json(errorBody("TENANT_ROUTE_NOT_FOUND", "Tenant route is not available"));
      const prefix = surfaceReturnPrefix(surface, tenant.urlSlug);
      const requested = request.body?.returnTo === undefined
        ? prefix
        : tenantBoundReturnTo(request.body.returnTo, prefix);
      if (!requested) {
        return response.status(400).json(errorBody("UNSUPPORTED_RETURN_TO", "Unsupported return destination"));
      }
      returnTo = requested;
    } else {
      const requestedReturnTo = request.body?.returnTo === undefined
        ? null
        : safeIdentityReturnTo(request.body.returnTo);
      if (request.body?.returnTo !== undefined && !requestedReturnTo) {
        return response.status(400).json(errorBody("UNSUPPORTED_RETURN_TO", "Unsupported return destination"));
      }
      returnTo = requestedReturnTo || config.identityPostLoginRedirect;
    }

    const signedIn = await currentSession(request.headers.cookie, surface);
    const email = normalizedEmail(request.body?.email);
    if (!email && !signedIn) return response.status(202).json(ACCEPTED);

    const prefix = `${config.cachePrefix}:identity:password-setup-limit`;
    const accountRateKey = signedIn?.session.claims.sub || email!;
    const [ipAllowed, accountAllowed] = await Promise.all([
      withinLimit(`${prefix}:ip:${request.ip}`),
      withinLimit(`${prefix}:account:${privateRateLimitKey(accountRateKey)}`),
    ]);
    if (!ipAllowed || !accountAllowed) {
      console.info("Password setup request suppressed", { reason: "rate_limited" });
      return response.status(202).json(ACCEPTED);
    }

    response.status(202).json(ACCEPTED);
    // Keep account lookup and SMTP timing out of the public response. This is
    // best-effort recovery work: errors are logged and the public contract
    // remains deliberately non-enumerating.
    setImmediate(() => void processPasswordSetup({
      email,
      authenticatedUserId: signedIn?.session.claims.sub || null,
      returnTo,
      clientId: client.clientId,
    }));
  }));

  app.get("/identity/v1/password/setup-complete/:state", asyncRoute(async (request, response) => {
    const rawState = request.params.state;
    const state = typeof rawState === "string" ? rawState : "";
    const preview = state ? await getPasswordSetupAttempt(state) : null;
    // Do not burn the one-use state during a transient Admin API outage. A
    // refresh can retry the credential check; GETDEL below still makes a
    // successful completion single-consumer.
    const passwordReady = preview
      ? preview.hadPassword || await hasPasswordCredential(preview.userId)
      : false;
    const attempt = preview ? await consumePasswordSetupAttempt(state) : null;
    const authResult = await createAuthResult(attempt && passwordReady ? {
      status: "complete",
      code: "PASSWORD_SETUP_COMPLETE",
      message: "Your password is ready. You can now sign in with email and password.",
      actions: ["TRY_AGAIN"],
    } : attempt ? {
      status: "failed",
      code: "PASSWORD_SETUP_FAILED",
      message: "Password setup was not completed. Request another link when you are ready.",
      actions: ["SETUP_PASSWORD"],
    } : {
      status: "failed",
      code: "AUTH_ATTEMPT_EXPIRED",
      message: "That password setup link expired or was already used. Please request another.",
      actions: ["SETUP_PASSWORD"],
    });
    return response.redirect(303, withAuthResult(
      attempt?.returnTo || config.identityPostLoginRedirect,
      authResult,
    ));
  }));
}
