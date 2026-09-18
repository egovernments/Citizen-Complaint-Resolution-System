import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { config } from "../../infrastructure/config.js";
import { resolveTenantOptions } from "../access-context/tenant-options.js";
import { IdentityAdminError } from "../organizations/organization-service.js";
import {
  clearedLoginCookie,
  consumeLoginAttempt,
  createIdentitySession,
  createLoginAttempt,
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

export function registerAuthenticationRoutes(app: express.Application): void {
  app.get("/identity/v1/auth-methods", asyncRoute(async (_request, response) => {
    try {
      return response.json({ methods: await enabledIdentityMethods() });
    } catch (error) {
      if (error instanceof IdentityAdminError) {
        return response.status(503).json({ error: "Sign-in methods are temporarily unavailable" });
      }
      throw error;
    }
  }));

  app.get("/identity/v1/authorize", asyncRoute(async (request, response) => {
    const requestedMethod = typeof request.query.method === "string"
      ? request.query.method
      : "password";
    let methods;
    try {
      methods = await enabledIdentityMethods();
    } catch (error) {
      if (error instanceof IdentityAdminError) {
        return response.status(503).json({ error: "Sign-in methods are temporarily unavailable" });
      }
      throw error;
    }
    const method = methods.find((candidate) => candidate.id === requestedMethod);
    if (!method) return response.status(400).json({ error: "Unsupported sign-in method" });

    const oidcClient = oidcClientForMethod(method.type);
    const { state, codeChallenge, nonce } = await createLoginAttempt(oidcClient.clientId);
    response.setHeader("Set-Cookie", loginCookie(state));
    return response.redirect(
      302,
      authorizationUrl(state, codeChallenge, nonce, oidcClient.clientId, method.idpHint),
    );
  }));

  app.get("/identity/v1/callback", asyncRoute(async (request, response) => {
    const code = typeof request.query.code === "string" ? request.query.code : null;
    const state = typeof request.query.state === "string" ? request.query.state : null;
    if (!state || loginStateFromCookie(request.headers.cookie) !== state) {
      response.setHeader("Set-Cookie", clearedLoginCookie());
      return response.status(400).json({ error: "Invalid sign-in callback" });
    }

    const attempt = await consumeLoginAttempt(state);
    if (!attempt || !code || request.query.error) {
      response.setHeader("Set-Cookie", clearedLoginCookie());
      return response.status(400).json({ error: "Sign-in attempt expired or was already used" });
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
      const { sessionId, maxAge } = await createIdentitySession(
        tokens,
        claims,
        attempt.oidcClientId,
      );
      await resolveTenantOptions(claims).catch((error) => {
        console.warn("DIGIT account resolution after sign-in failed:", (error as Error).message);
      });
      response.setHeader("Set-Cookie", [
        sessionCookie(sessionId, maxAge),
        clearedLoginCookie(),
      ]);
      return response.redirect(303, config.identityPostLoginRedirect);
    } catch (error) {
      console.error("Identity callback failed:", (error as Error).message);
      response.setHeader("Set-Cookie", clearedLoginCookie());
      return response.status(502).json({ error: "Sign-in failed" });
    }
  }));
}
