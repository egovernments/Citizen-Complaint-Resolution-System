import {
  exportJWK,
  exportPKCS8,
  importPKCS8,
  generateKeyPair,
  SignJWT,
  type KeyLike,
} from "jose";
import express from "express";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

let privateKey: KeyLike;
let publicJwk: any;
const KID = "test-key-1";
const ISSUER = "http://localhost:9999/realms/digit-sandbox";
const KEY_FILE = join(
  import.meta.dirname || process.cwd(),
  ".test-private-key.pem",
);
const PUB_FILE = join(
  import.meta.dirname || process.cwd(),
  ".test-public-key.json",
);

export async function initKeys() {
  if (existsSync(KEY_FILE) && existsSync(PUB_FILE)) {
    // Load existing keys (shared between globalSetup and worker)
    const pem = readFileSync(KEY_FILE, "utf-8");
    privateKey = await importPKCS8(pem, "RS256");
    publicJwk = JSON.parse(readFileSync(PUB_FILE, "utf-8"));
  } else {
    // Generate new keys and persist for sharing
    const keys = await generateKeyPair("RS256");
    privateKey = keys.privateKey;
    const pem = await exportPKCS8(keys.privateKey);
    writeFileSync(KEY_FILE, pem);
    const pub = await exportJWK(keys.publicKey);
    publicJwk = { ...pub, kid: KID, use: "sig", alg: "RS256" };
    writeFileSync(PUB_FILE, JSON.stringify(publicJwk));
  }
}

export function cleanupKeys() {
  try {
    if (existsSync(KEY_FILE)) unlinkSync(KEY_FILE);
    if (existsSync(PUB_FILE)) unlinkSync(PUB_FILE);
  } catch {}
}

export function getIssuer() {
  return ISSUER;
}

export async function signJwt(
  claims: Record<string, unknown>,
  opts?: { expiresIn?: string },
) {
  return new SignJWT(claims as any)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(opts?.expiresIn || "1h")
    .sign(privateKey);
}

/** `${clientId}:${secret}` -> surface of each confidential client the tests use. */
const CLIENT_SURFACES = new Map([
  ["digit-identity-bff:test-bff-secret", "configurator"],
  ["digit-identity-bff-magic-link:test-magic-secret", "configurator"],
  ["digit-ui-employee:test-employee-secret", "employee"],
  ["digit-ui-citizen:test-citizen-secret", "citizen"],
]);

/**
 * Citizen tokens with a verified phone: no email, an E.164 phone number and
 * `phone_number_verified`. Profiles: "" (verified Kenyan number),
 * "unverified", "foreign" (a verified non-Kenyan number) and "other" (a
 * second citizen).
 */
function citizenClaims(profile: string): Record<string, unknown> & { sub: string; name: string; email?: string } {
  const subject = profile === "other" ? "citizen-user-2" : "citizen-user-1";
  return {
    sub: subject,
    name: profile === "other" ? "Second Citizen" : "Wanjiku Citizen",
    preferred_username: profile === "foreign" ? "+14155550100" : "+254712345678",
    phone_number: profile === "foreign" ? "+14155550100" : profile === "other" ? "+254722000111"
      // "newphone": the same citizen after verifying a different number.
      : profile === "newphone" ? "+254712345679" : "+254712345678",
    phone_number_verified: profile !== "unverified",
  };
}

export function createJwksApp() {
  const app = express();
  app.use(express.json());
  app.get(
    "/realms/digit-sandbox/protocol/openid-connect/certs",
    (_req, res) => {
      res.json({ keys: [publicJwk] });
    },
  );
  app.post(
    "/realms/digit-sandbox/protocol/openid-connect/token",
    express.urlencoded({ extended: false }),
    async (req, res) => {
      const grantType = req.body.grant_type;
      const clientId = String(req.body.client_id);
      const surface = CLIENT_SURFACES.get(`${clientId}:${req.body.client_secret}`);
      const code = String(req.body.code || "");
      // Codes are `valid-code:<nonce>` or `valid-code-<profile>:<nonce>`;
      // refresh tokens carry the profile forward.
      const codeMatch = /^valid-code(?:-([a-z]+))?:(.+)$/.exec(code);
      const refreshMatch = /^refresh-1(?::([a-z]+))?$/.exec(String(req.body.refresh_token || ""));
      const nonce = grantType === "authorization_code" ? codeMatch?.[2] || "" : "";
      const profile = (grantType === "authorization_code" ? codeMatch?.[1] : refreshMatch?.[1]) || "";
      const validGrant = grantType === "authorization_code"
        ? Boolean(nonce) && Boolean(req.body.code_verifier)
        : grantType === "refresh_token"
          ? Boolean(refreshMatch)
          : false;
      if (!surface || !validGrant) {
        return res.status(400).json({ error: "invalid_grant" });
      }

      const claims = surface === "citizen"
        ? citizenClaims(profile)
        : {
          sub: "identity-user-1",
          email: "person@example.com",
          name: "Demo Person",
          preferred_username: "demo.person",
          email_verified: true,
          phone_number: "0712345678",
          // Only the configurator client requests the organization scope.
          ...(surface === "configurator" && {
            organization: {
              bomet: {
                id: "org-bomet-id",
                resource_access: { "digit-ui": { roles: ["GRO"] } },
              },
              kisumu: {
                id: "org-kisumu-id",
                resource_access: { "digit-ui": { roles: ["PGR_VIEWER", "NOT_ALLOWLISTED"] } },
              },
            },
          }),
        };
      const accessToken = await signJwt({
        ...claims,
        azp: clientId,
        aud: "digit-identity-bff",
      });
      const idToken = await signJwt({
        sub: claims.sub,
        ...(claims.email && { email: claims.email }),
        name: claims.name,
        aud: clientId,
        nonce: grantType === "authorization_code" ? nonce : undefined,
      });
      return res.json({
        access_token: accessToken,
        refresh_token: profile ? `refresh-1:${profile}` : "refresh-1",
        id_token: idToken,
        expires_in: grantType === "authorization_code" ? 1 : 300,
        refresh_expires_in: 3600,
        token_type: "Bearer",
      });
    },
  );
  app.post(
    "/realms/digit-sandbox/protocol/openid-connect/logout",
    express.urlencoded({ extended: false }),
    (_req, res) => res.status(204).end(),
  );

  return app;
}
