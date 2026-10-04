import { beforeEach, describe, expect, it, vi } from "vitest";
import { DigitUnavailableError } from "../../src/modules/managed-accounts/digit-user-client.js";
import { DigitValidationError, writeDigitIdentifiers } from "../../src/modules/accounts/digit-writer.js";

const api = vi.hoisted(() => ({ search: vi.fn(), update: vi.fn() }));
vi.mock("../../src/modules/managed-accounts/digit-admin-session.js", () => ({
  withDigitAdmin: (fn: (token: string) => unknown) => fn("admin-test-token"),
}));
vi.mock("../../src/modules/managed-accounts/digit-user-client.js", async (original) => ({
  ...await original<typeof import("../../src/modules/managed-accounts/digit-user-client.js")>(),
  searchAccounts: api.search, updateIdentifiers: api.update,
}));
const ref = { tenantId: "pg", uuid: "staff-uuid" };
const fresh = () => ({
  ...ref, userName: "employee", name: "HRMS Updated Name", type: "EMPLOYEE", active: true,
  gender: "FEMALE", emailId: "hrms@example.org", mobileNumber: "******1234", countryCode: "+254",
  pan: "TESTPAN", identificationMark: "mark", fatherOrHusbandName: "Guardian", relationship: "FATHER",
  dob: "1980-01-20", roles: [{ code: "GRO", tenantId: "pg" }], accountLocked: false,
  accountLockedDate: "date", pwdExpiryDate: "date", lastModifiedDate: "date",
  permanentAddress: "Street", permanentCity: "City", permanentPinCode: "12345", ignored: "ignored",
});
beforeEach(() => {
  vi.clearAllMocks();
  api.search.mockResolvedValue([fresh()]);
  api.update.mockImplementation(async (_token, user) => ({ ...fresh(), ...user }));
});

describe("safe DIGIT writer", () => {
  // 8c gate 2: egov-user saves active=false when `active` is absent, so every
  // credential write deactivated the account. The fresh value is copied as is.
  it("copies the fresh active flag unchanged, for active and inactive accounts", async () => {
    await writeDigitIdentifiers(ref, { password: "test-only-password" });
    expect(api.update.mock.calls[0][1]).toHaveProperty("active", true);
    api.search.mockReset();
    api.search.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...fresh(), active: false }]);
    // Identifier propagation still writes to an inactive account and must not reactivate it.
    await writeDigitIdentifiers(ref, { emailId: "verified-new@example.org" });
    expect(api.update.mock.calls[1][1]).toHaveProperty("active", false);
  });

  it("preserves fresh HRMS fields, roles and active; omits DOB and locks", async () => {
    expect((await writeDigitIdentifiers(ref, { password: "test-only-password" })).status).toBe("written");
    expect(api.search).toHaveBeenCalledWith("admin-test-token", { ...ref, uuid: [ref.uuid], active: true });
    const body = api.update.mock.calls[0][1];
    expect(body).toMatchObject({ name: "HRMS Updated Name", gender: "FEMALE", emailId: "hrms@example.org",
      permanentAddress: "Street", permanentCity: "City", permanentPinCode: "12345", roles: fresh().roles,
      active: true });
    for (const key of ["dob", "accountLocked", "accountLockedDate", "pwdExpiryDate",
      "lastModifiedDate", "mobileNumber", "countryCode", "type", "ignored"]) expect(body).not.toHaveProperty(key);
  });
  it("copies fresh roles unchanged and ignores caller attempts to change them", async () => {
    const roles = [
      { code: "EMPLOYEE", name: "Employee", tenantId: "pg" },
      { code: "GRO", name: "HRMS Updated Role", tenantId: "pg.city" },
    ];
    api.search.mockResolvedValue([{ ...fresh(), roles }]);
    const staleRef = { ...ref, roles: [{ code: "OLD_ROLE", tenantId: "pg" }] };
    const changes = { emailId: "verified@example.org", roles: [{ code: "SUPERUSER", tenantId: "pg" }] };
    await writeDigitIdentifiers(staleRef, changes);
    expect(api.update.mock.calls[0][1].roles).toEqual(roles);
  });
  it.each(["code", "name", "tenantId"])("skips masked copied role %s without writing", async (field) => {
    api.search.mockResolvedValue([{ ...fresh(), roles: [{ ...fresh().roles[0], [field]: "***masked***" }] }]);
    expect((await writeDigitIdentifiers(ref, { password: "test-only-password" })).status).toBe("skipped-masked");
    expect(api.update).not.toHaveBeenCalled();
  });
  it.each(["name", "gender", "emailId", "pan", "fatherOrHusbandName", "photo", "permanentCity"])(
    "skips a masked copied %s without writing", async (field) => {
      api.search.mockResolvedValue([{ ...fresh(), [field]: "***masked***" }]);
      expect((await writeDigitIdentifiers(ref, { password: "test-only-password" })).status).toBe("skipped-masked");
      expect(api.update).not.toHaveBeenCalled();
    });
  it("allows replacing a masked email with the verified identifier and preserves national phone format", async () => {
    api.search.mockResolvedValue([{ ...fresh(), emailId: "***@example.org" }]);
    await writeDigitIdentifiers(ref, { emailId: "verified@example.org", mobileNumber: "0712345678", countryCode: "+254" });
    expect(api.update.mock.calls[0][1]).toMatchObject({ emailId: "verified@example.org", mobileNumber: "0712345678", countryCode: "+254" });
  });
  it("does not clear identifiers or write unchanged values", async () => {
    expect((await writeDigitIdentifiers(ref, { emailId: "", mobileNumber: " " })).status).toBe("unchanged");
    expect((await writeDigitIdentifiers(ref, { emailId: "hrms@example.org" })).status).toBe("unchanged");
    expect(api.update).not.toHaveBeenCalled();
  });
  it("writes citizen identifiers with the same uuid-only search", async () => {
    api.search.mockResolvedValue([{ ...fresh(), type: "CITIZEN" }]);
    expect((await writeDigitIdentifiers(ref, { mobileNumber: "712345678" })).status).toBe("written");
    expect(api.search.mock.calls[0][1]).not.toHaveProperty("userType");
  });
  it("refuses password writes for freshly inactive or locked accounts", async () => {
    api.search.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...fresh(), active: false }]);
    await expect(writeDigitIdentifiers(ref, { password: "test-only-password" })).rejects.toMatchObject({ code: "DIGIT_ACCOUNT_INACTIVE" });
    api.search.mockResolvedValue([{ ...fresh(), accountLocked: true }]);
    await expect(writeDigitIdentifiers(ref, { password: "test-only-password" })).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
    expect(api.update).not.toHaveBeenCalled();
  });
  it("maps validation rejection to DIGIT_ACCOUNT_INVALID, not dependency errors", async () => {
    api.update.mockRejectedValue(new DigitUnavailableError("invalid field", 400));
    await expect(writeDigitIdentifiers(ref, { password: "test-only-password" })).rejects.toBeInstanceOf(DigitValidationError);
    await expect(writeDigitIdentifiers(ref, { password: "test-only-password" })).rejects.toMatchObject({ code: "DIGIT_ACCOUNT_INVALID" });
    api.update.mockRejectedValue(new DigitUnavailableError("unavailable", 503));
    await expect(writeDigitIdentifiers(ref, { password: "test-only-password" })).rejects.toBeInstanceOf(DigitUnavailableError);
  });
});
