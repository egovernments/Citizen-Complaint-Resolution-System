import { createHmac } from "node:crypto";
import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";
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
import { safeIdentityReturnTo, withAuthResult } from "./redirects.js";

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

async function withinLimit(bucket: string): Promise<boolean> {
  const count = await getRedis().eval(
    `local current = redis.call('INCR', KEYS[1])
     if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
     return current`,
    1,
    bucket,
    config.identityPasswordSetupTtlSeconds,
  );
  return Number(count) <= config.identityPasswordSetupLimit;
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
      return response.status(403).json({ error: "Untrusted request origin" });
    }

    const signedIn = await currentSession(request.headers.cookie);
    const email = normalizedEmail(request.body?.email);
    const returnTo = safeIdentityReturnTo(request.body?.returnTo) || config.identityPostLoginRedirect;
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
