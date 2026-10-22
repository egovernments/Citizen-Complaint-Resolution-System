import { describe, expect, it, vi } from "vitest";

// Both owner searches name "owner"; the identity it ensures is someone else, as when ownership moves between them.
vi.mock("../../src/modules/organizations/organization-service.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/modules/organizations/organization-service.js")>(),
  findVerifiedPhoneUsers: vi.fn(async () => [{ id: "owner" }]),
  ensurePhoneIdentityUser: vi.fn(async () => ({ id: "someone-else", created: false })),
}));
vi.mock("../../src/modules/accounts/person-lease.js", () => ({ withPersonLease: vi.fn(async (_: string, run: () => unknown) => run()) }));
vi.mock("../../src/modules/citizen-otp/phone-lock.js", () => ({
  withPhoneLock: vi.fn(async (_: string, run: (lock: object) => unknown) => run({ assertHeld: async () => {} })),
}));
vi.mock("../../src/modules/sessions/session-store.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/modules/sessions/session-store.js")>(),
  createPhoneOtpSession: vi.fn(),
}));
const { findVerifiedPhoneUsers, IdentityAdminError } = await import("../../src/modules/organizations/organization-service.js");
const { createPhoneOtpSession } = await import("../../src/modules/sessions/session-store.js");
const { phoneSignIn } = await import("../../src/modules/citizen-otp/phone-service.js");

describe("phone sign-in", () => {
  it("issues no session when the identity it ensures is not the owner it locked", async () => {
    const tenant = { urlSlug: "bomet-county", tenantId: "ke.bomet", rootTenantId: "ke", name: "Bomet" };
    const failed = await phoneSignIn("+254700000000", tenant, "700000000").catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(IdentityAdminError);
    expect(failed).toMatchObject({ status: 503, message: "Phone ownership changed; retry" });
    // The first attempt stops: not the retry loop running out.
    expect(findVerifiedPhoneUsers).toHaveBeenCalledTimes(2);
    expect(createPhoneOtpSession).not.toHaveBeenCalled();
  });
});
