import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { config } from "../../infrastructure/config.js";
import { privateRateKey, withinLimit as withinRateLimit } from "../../infrastructure/rate-limit.js";
import { errorBody } from "../../contract/error-codes.js";
import { routeForSlug } from "../access-context/tenant-route.js";
import {
  hasPasswordCredential,
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
import { returnDestination, withAuthResult } from "./redirects.js";
import { result } from "./routes.js";
import { isTenantBoundSurface, parseSurface, surfaceReturnPrefix } from "./surfaces.js";

const ACCEPTED = {
  message: "If an eligible account exists, a password setup email has been sent.",
};

export function normalizedEmail(value: unknown): string | null {
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

/** Records the attempt, then has Keycloak email the password (and, if needed, email) actions. */
export async function sendPasswordSetup(input: {
  userId: string;
  hadPassword: boolean;
  emailVerified: boolean;
  returnTo: string;
  clientId: string;
}): Promise<void> {
  const state = await createPasswordSetupAttempt({
    returnTo: input.returnTo, userId: input.userId, hadPassword: input.hadPassword,
  });
  await sendPasswordSetupEmail({
    userId: input.userId, emailVerified: input.emailVerified,
    redirectUri: completionRedirectUri(state), clientId: input.clientId,
  });
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
    await sendPasswordSetup({
      userId: account.userId, hadPassword: account.hasPassword, emailVerified: account.emailVerified,
      returnTo: input.returnTo, clientId: input.clientId,
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
    let returnTo: string | null;
    if (isTenantBoundSurface(surface)) {
      const tenant = await routeForSlug(request.body?.tenantSlug);
      if ("status" in tenant) return response.status(tenant.status).json(errorBody(tenant.code, tenant.error));
      returnTo = returnDestination(request.body?.returnTo, surfaceReturnPrefix(surface, tenant.urlSlug));
    } else {
      returnTo = returnDestination(request.body?.returnTo);
    }
    if (!returnTo) {
      return response.status(400).json(errorBody("UNSUPPORTED_RETURN_TO", "Unsupported return destination"));
    }

    const signedIn = await currentSession(request.headers.cookie, surface);
    const email = normalizedEmail(request.body?.email);
    if (!email && !signedIn) return response.status(202).json(ACCEPTED);

    const prefix = `${config.cachePrefix}:identity:password-setup-limit`;
    const accountRateKey = signedIn?.session.claims.sub || email!;
    const [ipAllowed, accountAllowed] = await Promise.all([
      withinLimit(`${prefix}:ip:${request.ip}`),
      withinLimit(`${prefix}:account:${privateRateKey("password-setup", accountRateKey)}`),
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
    const authResult = await createAuthResult(attempt ? result(passwordReady ? "PASSWORD_SETUP_COMPLETE" : "PASSWORD_SETUP_FAILED") : {
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
