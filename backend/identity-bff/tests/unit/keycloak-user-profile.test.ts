import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
