import { describe, expect, it } from "vitest";
import { schemaErrors } from "./harness.js";

const UUID = "3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b";
const UUID2 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

const staff = {
  kind: "staff", tenantId: "pg", uuid: UUID, boundAt: 1791100000000, active: true,
  roles: [{ code: "EMPLOYEE", tenantId: "pg" }, { code: "GRO", tenantId: "pg" }],
  userName: "EMP-PG-0001", credential: { keyVersion: 2, setAt: 1791100000500 },
};
const citizen = {
  kind: "citizen", tenantId: "pg", uuid: UUID2, boundAt: 1791000000000, active: true,
  roles: [{ code: "CITIZEN", tenantId: "pg" }],
};

describe("digit.accounts v1", () => {
  it("accepts a staff and a citizen entry", () => {
    expect(schemaErrors("digit.accounts", { v: 1, mirroredAt: 1791100001000, entries: [staff, citizen] })).toEqual([]);
  });

  it("accepts a missing account and a legacy dotted role tenant", () => {
    const entry = { ...staff, missing: true, roles: [{ code: "EMPLOYEE", tenantId: "pg.citya" }] };
    expect(schemaErrors("digit.accounts", { v: 1, entries: [entry] })).toEqual([]);
  });

  it.each([
    ["a citizen credential", { v: 1, entries: [{ ...citizen, credential: { keyVersion: 1 } }] }],
    ["an unknown kind", { v: 1, entries: [{ ...staff, kind: "managed" }] }],
    ["a sub-tenant entry (D16)", { v: 1, entries: [{ ...staff, tenantId: "pg.citya" }] }],
    ["a missing roles array", { v: 1, entries: [{ ...staff, roles: undefined }] }],
    ["a lower-case role code", { v: 1, entries: [{ ...staff, roles: [{ code: "gro", tenantId: "pg" }] }] }],
    ["key version 0", { v: 1, entries: [{ ...staff, credential: { keyVersion: 0 } }] }],
    ["missing: false (omit it instead)", { v: 1, entries: [{ ...staff, missing: false }] }],
    ["an extra field", { v: 1, entries: [{ ...staff, locale: "en_IN" }] }],
    ["another version", { v: 2, entries: [] }],
  ])("rejects %s", (_name, value) => {
    expect(schemaErrors("digit.accounts", JSON.parse(JSON.stringify(value)))).not.toEqual([]);
  });
});

describe("digit.bindings v1", () => {
  const active = {
    tenantId: "pg", uuid: UUID, state: "active", invitationVersion: 1, createdAt: 1791100000000,
    createdBy: { kind: "workload", operationId: "op-1", restartNo: 0 }, boundAt: 1791100000000,
  };
  const pending = {
    tenantId: "bomet", uuid: UUID2, state: "pending", invitationVersion: 2, createdAt: 1791100000000,
    createdBy: { kind: "browser", subject: "admin-sub", requestId: "6a437d4c295ef4c8f605fa17bc90a569208584985c6d85cf94c7c4684892368f" },
    expiresAt: 1792309600000,
  };
  const removed = {
    tenantId: "ke", uuid: UUID2, state: "removed", invitationVersion: 1, createdAt: 1791100000000,
    createdBy: { kind: "conversion" }, removedAt: 1791200000000, removedBy: { kind: "expiry" },
  };

  it("accepts active, pending and removed bindings", () => {
    expect(schemaErrors("digit.bindings", { v: 1, bindings: [active, pending, removed] })).toEqual([]);
  });

  it.each([
    ["a pending binding without expiresAt", { ...pending, expiresAt: undefined }],
    ["an active binding without boundAt", { ...active, boundAt: undefined }],
    ["a removed binding without removedBy", { ...removed, removedBy: undefined }],
    ["an unknown state", { ...active, state: "invited" }],
    ["invitation version 0", { ...active, invitationVersion: 0 }],
    ["a sub-tenant binding (D16)", { ...active, tenantId: "pg.citya" }],
    ["an unknown creator kind", { ...active, createdBy: { kind: "migration" } }],
    ["a short requestId", { ...pending, createdBy: { kind: "browser", requestId: "abc" } }],
  ])("rejects %s", (_name, binding) => {
    expect(schemaErrors("digit.bindings", JSON.parse(JSON.stringify({ v: 1, bindings: [binding] })))).not.toEqual([]);
  });
});

describe("digit.boundUuids values", () => {
  it("accepts <tenantId>|<uuid>", () => {
    expect(schemaErrors("digit.boundUuids", `pg|${UUID}`)).toEqual([]);
  });

  it.each([`pg.citya|${UUID}`, UUID, `pg|not-a-uuid`, `EMPLOYEE|pg|${UUID}`])("rejects %s", (value) => {
    expect(schemaErrors("digit.boundUuids", value)).not.toEqual([]);
  });
});

describe("digit.bindingTenants values", () => {
  it("accepts a plain tenant id", () => expect(schemaErrors("digit.bindingTenants", "pg")).toEqual([]));
  it.each(["pg.citya", `pg|${UUID}`, ""])("rejects %s", (value) => {
    expect(schemaErrors("digit.bindingTenants", value)).not.toEqual([]);
  });
});

describe("digit.linkPending v1", () => {
  const marker = {
    v: 1, tenantId: "pg", digitUuid: UUID, email: "asha.k@example.org", actor: "admin-sub", createdAt: 1791100000000,
    requestId: "6a437d4c295ef4c8f605fa17bc90a569208584985c6d85cf94c7c4684892368f",
  };

  it("accepts a marker", () => {
    expect(schemaErrors("digit.linkPending", marker)).toEqual([]);
  });

  it.each([
    ["an upper-case email", { ...marker, email: "Asha.K@example.org" }],
    ["a missing requestId", { ...marker, requestId: undefined }],
    ["an extra field", { ...marker, steps: ["binding"] }],
  ])("rejects %s", (_name, value) => {
    expect(schemaErrors("digit.linkPending", JSON.parse(JSON.stringify(value)))).not.toEqual([]);
  });
});

describe("error envelope", () => {
  it("accepts {code, error, ...details}", () => {
    expect(schemaErrors("error-envelope", { code: "OTP_INVALID", error: "Wrong code", attemptsRemaining: 2 })).toEqual([]);
  });

  it.each([[{ error: "text only" }], [{ code: "OTP_INVALID" }], [{ code: "otp_invalid", error: "x" }]])("rejects %j", (value) => {
    expect(schemaErrors("error-envelope", value)).not.toEqual([]);
  });
});
