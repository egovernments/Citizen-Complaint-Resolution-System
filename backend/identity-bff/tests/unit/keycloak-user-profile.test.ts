import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { identityErrorHandler } from "../../src/app/create-app.js";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { IdentityAdminError, updateAccountLinkValues } from "../../src/modules/organizations/organization-service.js";
import { updateKeycloakUser } from "../../src/modules/sync/keycloak-writer.js";

vi.mock("../../src/integrations/keycloak/admin-session.js", () => ({ getAdminToken: vi.fn(async () => "admin-token"), resetAdminToken: vi.fn() }));

const src = fileURLToPath(new URL("../../src", import.meta.url));
const realm = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../keycloak/realm.json", import.meta.url)), "utf8"));
const declared: Record<string, { permissions?: unknown; multivalued?: boolean; validations?: { length?: { max?: number } } }> =
  realm.userProfile.attributes;

// digit.* attributes the BFF keeps on Organizations, their groups and clients,
// not on users: the user profile does not apply to them.
const NOT_USER_ATTRIBUTES = new Set([
  "digit.accountCode", "digit.fallbackTenantIds", "digit.lifecycle", "digit.lifecycleRestartNo",
  "digit.operationHash", "digit.operationId", "digit.replacementPending", "digit.restartNo",
  "digit.rootTenantId", "digit.supersededBy", "digit.urlSlug",
  "digit.displayName", "digit.organizationId", "digit.parentTenantId", "digit.tenantId",
  "digit.auth.account.actions", "digit.auth.signin.methods", "digit.auth.signup.methods", "digit.auth.surface",
]);

function attributeNamesInCode(dir: string): Set<string> {
  const names = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) attributeNamesInCode(path).forEach(name => names.add(name));
    else if (entry.name.endsWith(".ts")) {
      for (const match of readFileSync(path, "utf8").matchAll(/"(digit\.[A-Za-z.]+)"/g)) names.add(match[1]);
    }
  }
  return names;
}

describe("keycloak/realm.json declares every digit.* user attribute (§5.1)", () => {
  const userAttributes = [...attributeNamesInCode(src)].filter(name => !NOT_USER_ATTRIBUTES.has(name)).sort();

  it("finds the attributes the code writes", () => {
    expect(userAttributes).toEqual(expect.arrayContaining(["digit.accounts", "digit.bindings", "digit.boundUuids", "digit.linkPending"]));
  });

  // A new digit.* name in src fails here until it is declared, or listed above as not a user attribute.
  it.each(userAttributes)("%s is declared admin-only with a length limit", name => {
    expect(declared[name], `${name} is missing from keycloak/realm.json userProfile`).toBeDefined();
    expect(declared[name].permissions).toEqual({ view: ["admin"], edit: ["admin"] });
    // 2048 is Keycloak's limit for an undeclared attribute: never lower it, or a stored value becomes invalid.
    expect(declared[name].validations?.length?.max).toBeGreaterThanOrEqual(2048);
  });

  it("the multivalued attributes are declared multivalued, the JSON documents single-valued", () => {
    for (const name of ["digit.boundUuids", "digit.accountLinks", "digit.accountLinkBlocks", "digit.citizenRegistrations", "digit.managedTenants"]) {
      expect(declared[name].multivalued, name).toBe(true);
    }
    for (const name of ["digit.accounts", "digit.bindings", "digit.linkPending"]) expect(declared[name].multivalued, name).toBeFalsy();
  });

  it("the limits fit 64 records of the largest shape the v1 schemas allow", () => {
    const n = Number.MAX_SAFE_INTEGER, tenant = "t".repeat(50), uuid = "00000000-0000-4000-8000-000000000000", subject = "s".repeat(64);
    const binding = { tenantId: tenant, uuid, state: "pending", invitationVersion: n, createdAt: n,
      createdBy: { kind: "browser", subject, requestId: "a".repeat(64), operationId: subject, restartNo: n },
      expiresAt: n, acceptedAt: n, boundAt: n, removedAt: n, removedBy: { kind: "operator", subject } };
    const role = { code: "C".repeat(64), tenantId: [tenant, tenant, tenant, tenant].join(".") };
    const entry = { kind: "citizen", tenantId: tenant, uuid, boundAt: n, active: false, roles: Array(128).fill(role),
      userName: "u".repeat(180), missing: true, credential: { keyVersion: n, setAt: n } };
    const linkPending = { v: 1, tenantId: tenant, digitUuid: uuid, email: "e".repeat(254), requestId: "a".repeat(64), actor: subject, createdAt: n };
    expect(declared["digit.bindings"].validations!.length!.max)
      .toBeGreaterThan(JSON.stringify({ v: 1, bindings: Array(64).fill(binding) }).length);
    expect(declared["digit.accounts"].validations!.length!.max)
      .toBeGreaterThan(JSON.stringify({ v: 1, mirroredAt: n, entries: Array(64).fill(entry) }).length);
    expect(declared["digit.linkPending"].validations!.length!.max).toBeGreaterThan(JSON.stringify(linkPending).length);
  });
});

describe("a digit.* write Keycloak refuses as too long", () => {
  const prefix = `keycloak-user-profile-${process.pid}`;
  let refusal: { field: string; status: number } = { field: "digit.bindings", status: 400 };
  beforeAll(() => {
    Object.assign(config, { cachePrefix: prefix });
    initCache(`redis://localhost:${process.env.REDIS_PORT || "16379"}`);
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    refusal = { field: "digit.bindings", status: 400 };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => init?.method === "PUT"
      ? new Response(JSON.stringify({ field: refusal.field, errorMessage: "error-invalid-length",
        params: [refusal.field, 0, 2048] }), { status: refusal.status })
      : Response.json({ id: "person", email: "person@example.invalid", attributes: {} }));
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    const keys = await getRedis().keys(`${prefix}:*`);
    if (keys.length) await getRedis().del(...keys);
    await closeCache();
  });

  const writeBindings = () => withPersonLease("person", () => updateKeycloakUser("person", user =>
    ({ ...user, attributes: { ...user.attributes, "digit.bindings": ["x".repeat(2049)] } })));

  it("is logged and answers IDENTITY_UNAVAILABLE, not a 400 blamed on the caller", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = await writeBindings().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IdentityAdminError);
    expect((error as IdentityAdminError).status).toBe(503);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/PUT \/users\/person: digit\.bindings is longer than the realm allows.*keycloak\/realm\.json/));

    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
    identityErrorHandler(error, {} as express.Request, res as unknown as express.Response, vi.fn());
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "IDENTITY_UNAVAILABLE" }));
  });

  it("covers the list-valued writers too", async () => {
    refusal = { field: "digit.accountLinks", status: 400 };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(updateAccountLinkValues("person", values => [...values, "EMPLOYEE|pg|uuid"]))
      .rejects.toMatchObject({ status: 503 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("digit.accountLinks"));
  });

  it("leaves other 400s as they are", async () => {
    refusal = { field: "firstName", status: 400 };
    await expect(writeBindings()).rejects.toMatchObject({ status: 400 });
  });
});
