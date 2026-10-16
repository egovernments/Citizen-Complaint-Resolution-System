import { describe, it, expect, beforeAll } from "vitest";
import { initJwks, validateJwt } from "../../src/modules/authentication/token-verifier.js";
import { getIssuer, signJwt } from "../helpers.js";

const ISSUER = getIssuer();

beforeAll(() => {
  initJwks(process.env.KEYCLOAK_JWKS_URI);
});

describe("validateJwt", () => {
  it("returns claims for a valid JWT", async () => {
    const token = await signJwt({
      sub: "user-1",
      email: "a@b.com",
      name: "Alice",
    });
    const claims = await validateJwt(`Bearer ${token}`);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("user-1");
    expect(claims!.email).toBe("a@b.com");
    expect(claims!.name).toBe("Alice");
  });

  it("passes Keycloak's session id (sid) through", async () => {
    const token = await signJwt({ sub: "user-1", email: "a@b.com", sid: "kc-session-1", azp: "client" });
    expect(await validateJwt(`Bearer ${token}`)).toMatchObject({ sid: "kc-session-1", azp: "client" });
  });

  it("passes Keycloak's auth_time through", async () => {
    const token = await signJwt({ sub: "user-1", email: "a@b.com", auth_time: 1791184848 });
    expect(await validateJwt(`Bearer ${token}`)).toMatchObject({ auth_time: 1791184848 });
  });

  it("returns null for missing auth header", async () => {
    expect(await validateJwt(undefined)).toBeNull();
  });

  it("returns null for non-Bearer header", async () => {
    expect(await validateJwt("Basic abc123")).toBeNull();
  });

  it("returns null for expired JWT", async () => {
    const token = await signJwt(
      { sub: "user-1", email: "a@b.com" },
      { expiresIn: "0s" },
    );
    await new Promise((r) => setTimeout(r, 1100));
    expect(await validateJwt(`Bearer ${token}`)).toBeNull();
  });

  it("uses a stable internal email when Keycloak omits the claim", async () => {
    const token = await signJwt({ sub: "user-1" });
    expect(await validateJwt(`Bearer ${token}`)).toMatchObject({
      sub: "user-1",
      email: "user-1@digit-sandbox.kc.local",
    });
  });

  it("returns null for garbage token", async () => {
    expect(await validateJwt("Bearer not.a.real.jwt")).toBeNull();
  });

  it("validates JWT from a non-default realm issuer", async () => {
    const token = await signJwt({ sub: "user-1", email: "a@b.com" });
    const claims = await validateJwt(`Bearer ${token}`);
    expect(claims).not.toBeNull();
  });

  it("extracts realm name from issuer", async () => {
    const token = await signJwt({ sub: "u1", email: "a@b.com" });
    const claims = await validateJwt(`Bearer ${token}`);
    expect(claims).not.toBeNull();
    // The issuer in test is ".../realms/digit-sandbox"
    // so realm should be "digit-sandbox"
    expect(claims!.realm).toBe("digit-sandbox");
  });

  it("can pin the issuer and audience for identity endpoints", async () => {
    const token = await signJwt({
      sub: "user-1",
      email: "a@b.com",
      aud: "digit-ui",
    });
    const claims = await validateJwt(`Bearer ${token}`, {
      issuer: ISSUER,
      audience: "digit-ui",
    });
    expect(claims?.sub).toBe("user-1");
  });

  it("rejects another issuer or audience when pinned", async () => {
    const token = await signJwt({
      sub: "user-1",
      email: "a@b.com",
      aud: "digit-ui",
    });
    expect(await validateJwt(`Bearer ${token}`, {
      issuer: "https://issuer.example/realms/other",
      audience: "digit-ui",
    })).toBeNull();
    expect(await validateJwt(`Bearer ${token}`, {
      issuer: ISSUER,
      audience: "other-client",
    })).toBeNull();
  });
});
