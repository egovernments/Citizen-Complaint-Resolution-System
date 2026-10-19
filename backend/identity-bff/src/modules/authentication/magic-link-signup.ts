import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { errorBody } from "../../contract/error-codes.js";
import { hasTrustedWriteOrigin } from "../../app/request-security.js";
import { config } from "../../infrastructure/config.js";
import { privateRateKey, withinLimit as withinRateLimit } from "../../infrastructure/rate-limit.js";
import { getAdminToken } from "../../integrations/keycloak/admin-session.js";
import { ensureMagicLinkSignupIdentity } from "../organizations/organization-service.js";
import { createLoginAttempt } from "../sessions/session-store.js";
import { enabledIdentityMethods } from "./methods.js";
import { returnDestination } from "./redirects.js";
import { normalizedEmail } from "./password-setup.js";
import type { IdentityAuthMethod } from "./types.js";

const ACCEPTED = {
  message: "Check your email for a link to continue creating your account.",
};

function normalizedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= 100 ? name : null;
}

function withinLimit(bucket: string): Promise<boolean> {
  return withinRateLimit(bucket, config.identityMagicLinkRequestLimit, config.identityMagicLinkRequestWindowSeconds);
}

async function sendSignupMagicLink(input: {
  email: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): Promise<void> {
  const token = await getAdminToken();
  const response = await fetch(
    `${config.keycloakAdminUrl}/realms/${encodeURIComponent(config.keycloakOrganizationRealm)}/magic-link`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        client_id: config.keycloakMagicLinkClientId,
        redirect_uri: config.identityRedirectUri,
        expiration_seconds: config.identityLoginTtlSeconds,
        force_create: false,
        update_profile: false,
        update_password: false,
        send_email: true,
        scope: config.identityScope,
        nonce: input.nonce,
        state: input.state,
        code_challenge: input.codeChallenge,
        code_challenge_method: "S256",
        reusable: false,
        response_mode: "query",
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Keycloak magic-link request failed: ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }
}

async function processSignupMagicLink(input: {
  email: string;
  firstName: string;
  lastName: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): Promise<void> {
  try {
    await ensureMagicLinkSignupIdentity(input);
    await sendSignupMagicLink(input);
    console.info("Signup magic-link request processed", { outcome: "sent" });
  } catch (error) {
    // The public response is deliberately identical for existing, disabled,
    // newly-created, and temporarily unavailable identities.
    console.warn("Signup magic-link request failed", { error: (error as Error).message });
  }
}

export function registerMagicLinkRoutes(app: express.Application): void {
  app.post("/identity/v1/authentication/magic-link-requests", asyncRoute(async (request, response) => {
    if (!hasTrustedWriteOrigin(request)) {
      return response.status(403).json(errorBody("UNTRUSTED_ORIGIN", "Untrusted request origin"));
    }

    const email = normalizedEmail(request.body?.email);
    const firstName = normalizedName(request.body?.firstName);
    const lastName = normalizedName(request.body?.lastName);
    const returnTo = returnDestination(request.body?.returnTo);
    if (!email || !firstName || !lastName) {
      return response.status(400).json(errorBody("INVALID_REQUEST", "First name, last name, and a valid email are required"));
    }
    if (!returnTo) return response.status(400).json(errorBody("UNSUPPORTED_RETURN_TO", "Unsupported return destination"));

    let magicMethod: IdentityAuthMethod | undefined;
    try {
      magicMethod = (await enabledIdentityMethods("signup"))
        .find((method) => method.type === "magic_link");
    } catch (error) {
      console.warn("Signup method lookup failed", { error: (error as Error).message });
      return response.status(503).json(errorBody("SIGNIN_METHODS_UNAVAILABLE", "Email sign-up is temporarily unavailable"));
    }
    if (!magicMethod) {
      return response.status(503).json(errorBody("SIGNUP_UNAVAILABLE", "Email sign-up is temporarily unavailable"));
    }

    const prefix = `${config.cachePrefix}:identity:magic-link-signup-limit`;
    const [ipAllowed, emailAllowed] = await Promise.all([
      withinLimit(`${prefix}:ip:${request.ip}`),
      withinLimit(`${prefix}:email:${privateRateKey("magic-link", email)}`),
    ]);
    if (!ipAllowed || !emailAllowed) return response.status(202).json(ACCEPTED);

    const attempt = await createLoginAttempt({
      oidcClientId: config.keycloakMagicLinkClientId,
      intent: "signup",
      methodId: magicMethod.id,
      returnTo,
      requiresLoginCookie: false,
      identityProfileDraft: { email, firstName, lastName },
    });
    response.status(202).json(ACCEPTED);
    setImmediate(() => void processSignupMagicLink({
      email,
      firstName,
      lastName,
      state: attempt.state,
      nonce: attempt.nonce,
      codeChallenge: attempt.codeChallenge,
    }));
  }));
}
