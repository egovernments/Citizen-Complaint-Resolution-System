import { describe, expect, it } from "vitest";
import { linkRequestId } from "../../src/modules/bindings/link-request-id.js";

// Frozen in docs/identity-bff.md §9.2. Cross-checked against Python hashlib.
const ADMIN = "9c933e91-cf01-4599-9a25-d4def71134f2";

describe("workspace-members/_link request id", () => {
  it.each([
    { tenantId: "pg", uuid: "3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b", email: "Asha.K@Example.org ",
      id: "6a437d4c295ef4c8f605fa17bc90a569208584985c6d85cf94c7c4684892368f" },
    { tenantId: "bomet", uuid: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", email: "asha.k@example.org",
      id: "5ac31609d50d8c241d67e4646010905dc1e94e4ec0bfe94d37146881fe196ced" },
  ])("matches the frozen vector for $tenantId", ({ tenantId, uuid, email, id }) => {
    expect(linkRequestId(ADMIN, tenantId, uuid, email)).toBe(id);
  });

  it("normalizes the email, so a retry with different case resumes", () => {
    const uuid = "3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b";
    expect(linkRequestId(ADMIN, "pg", uuid, " ASHA.K@example.org")).toBe(linkRequestId(ADMIN, "pg", uuid, "asha.k@example.org"));
  });

  it("differs per admin, tenant, account and email", () => {
    const uuid = "3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b";
    const base = linkRequestId(ADMIN, "pg", uuid, "a@x.org");
    expect(new Set([
      base,
      linkRequestId("other-admin", "pg", uuid, "a@x.org"),
      linkRequestId(ADMIN, "ke", uuid, "a@x.org"),
      linkRequestId(ADMIN, "pg", "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "a@x.org"),
      linkRequestId(ADMIN, "pg", uuid, "b@x.org"),
    ]).size).toBe(5);
  });

  it("rejects empty and multi-line fields", () => {
    expect(() => linkRequestId("", "pg", "u", "a@x.org")).toThrow();
    expect(() => linkRequestId(ADMIN, "pg\nke", "u", "a@x.org")).toThrow();
  });
});
