import { createHmac } from "node:crypto";
import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";
import {
  inspectPasswordSetupAccount,
  sendPasswordSetupEmail,
} from "../organizations/organization-service.js";
import {
  consumePasswordSetupAttempt,
  createAuthResult,
  createPasswordSetupAttempt,
} from "../sessions/session-store.js";

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

function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "/configurator/login";
  const candidate = value.trim();
  if (/^\/(?!\/)[^\u0000-\u001f\u007f\\]*$/.test(candidate)) return candidate;
  try {
    const parsed = new URL(candidate);
    if (config.identityAllowedOrigins.includes(parsed.origin)) return parsed.toString();
  } catch {
    // Fall through to the fixed same-origin login route.
  }
  return "/configurator/login";
}

function completionRedirectUri(state: string): string {
  const callback = new URL(config.identityRedirectUri);
  callback.pathname = callback.pathname.replace(/\/callback$/, "/password/setup-complete");
  callback.search = new URLSearchParams({ state }).toString();
  return callback.toString();
}

function appendResult(destination: string, id: string): string {
  if (destination.startsWith("/") && !destination.startsWith("//")) {
    return `${destination}${destination.includes("?") ? "&" : "?"}authResult=${encodeURIComponent(id)}`;
  }
  const url = new URL(destination);
  url.searchParams.set("authResult", id);
  return url.toString();
}

async function withinLimit(bucket: string): Promise<boolean> {
  const redis = getRedis();
  const count = await redis.incr(bucket);
  if (count === 1) await redis.expire(bucket, config.identityPasswordSetupTtlSeconds);
  return count <= config.identityPasswordSetupLimit;
}

function privateEmailKey(email: string): string {
  return createHmac("sha256", config.keycloakBffClientSecret)
    .update(email)
    .digest("hex");
}

export function registerPasswordSetupRoutes(app: express.Application): void {
  app.post("/identity/v1/password/setup-requests", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return response.status(403).json({ error: "Untrusted request origin" });
    }

    const email = normalizedEmail(request.body?.email);
    if (!email) return response.status(202).json(ACCEPTED);

    const prefix = `${config.cachePrefix}:identity:password-setup-limit`;
    const [ipAllowed, emailAllowed] = await Promise.all([
      withinLimit(`${prefix}:ip:${request.ip}`),
      withinLimit(`${prefix}:email:${privateEmailKey(email)}`),
    ]);
    if (!ipAllowed || !emailAllowed) {
      console.info("Password setup request suppressed", { reason: "rate_limited" });
      return response.status(202).json(ACCEPTED);
    }

    try {
      const account = await inspectPasswordSetupAccount(email);
      if (account) {
        const state = await createPasswordSetupAttempt(safeReturnTo(request.body?.returnTo));
        await sendPasswordSetupEmail({
          userId: account.userId,
          emailVerified: account.emailVerified,
          redirectUri: completionRedirectUri(state),
        });
        console.info("Password setup request processed", {
          outcome: "sent",
          hadPassword: account.hasPassword,
          federatedIdentityCount: account.federatedProviders.length,
        });
      } else {
        console.info("Password setup request processed", { outcome: "ineligible" });
      }
    } catch (error) {
      // Recovery is intentionally non-enumerating. Dependency detail stays in
      // server logs while the caller gets the same accepted response.
      console.warn("Password setup request failed", { error: (error as Error).message });
    }
    return response.status(202).json(ACCEPTED);
  }));

  app.get("/identity/v1/password/setup-complete", asyncRoute(async (request, response) => {
    const state = typeof request.query.state === "string" ? request.query.state : "";
    const returnTo = state ? await consumePasswordSetupAttempt(state) : null;
    const actionStatus = typeof request.query.kc_action_status === "string"
      ? request.query.kc_action_status
      : "";
    const authResult = await createAuthResult(returnTo && actionStatus === "success" ? {
      status: "complete",
      code: "PASSWORD_SETUP_COMPLETE",
      message: "Your password is ready. You can now sign in with email and password.",
      actions: ["TRY_AGAIN"],
    } : returnTo ? {
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
    return response.redirect(303, appendResult(returnTo || "/configurator/login", authResult));
  }));
}
