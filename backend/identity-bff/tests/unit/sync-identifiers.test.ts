import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, initCache } from "../../src/infrastructure/redis.js";
import { currentPersonLease } from "../../src/modules/accounts/person-lease.js";
import { propagateIdentifiers } from "../../src/modules/sync/identifiers.js";

const mocks = vi.hoisted(() => ({ request: vi.fn(), write: vi.fn(), mobile: vi.fn() }));
vi.mock("../../src/modules/organizations/organization-service.js", () => ({ request: mocks.request }));
vi.mock("../../src/modules/accounts/digit-writer.js", () => ({ writeDigitIdentifiers: mocks.write }));
vi.mock("../../src/modules/citizen-otp/mobile-validation.js", () => ({ mobileValidationForRoute: mocks.mobile }));
let user: any;
beforeAll(() => {
  Object.assign(config, { cachePrefix: `identifiers-${process.pid}` });
  initCache(`redis://127.0.0.1:${process.env.REDIS_PORT || 16379}`);
});
afterAll(closeCache);
beforeEach(() => {
  vi.clearAllMocks();
  user = { email: "verified@example.test", emailVerified: true, attributes: {
    phoneNumber: ["+254712345678"], phoneNumberVerified: ["true"],
    "digit.bindings": [JSON.stringify({ v: 1, bindings: [{ tenantId: "tenant", uuid: "staff", state: "active", boundAt: 1, invitationVersion: 1 }] })],
    "digit.accounts": [JSON.stringify({ v: 1, entries: [{ kind: "citizen", tenantId: "tenant", uuid: "citizen", boundAt: 1,
      active: true, roles: [] }] })],
  } };
  mocks.request.mockImplementation(async () => new Response(JSON.stringify(user)));
  mocks.write.mockImplementation(async () => {
    expect(currentPersonLease()?.subject).toBe("subject");
    return { status: "written" };
  });
  mocks.mobile.mockResolvedValue({ countryCode: "+254", mobileNumberRegex: "^[17][0-9]{8}$" });
});

describe("verified identifier propagation", () => {
  it("writes staff email and citizen national phone to the proper accounts under the lease", async () => {
    expect(await propagateIdentifiers("subject")).toEqual({ written: 2, unchanged: 0, skipped: 0 });
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ uuid: "staff" }), { emailId: "verified@example.test" });
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ uuid: "citizen" }),
      { countryCode: "+254", mobileNumber: "712345678" });
  });
  it("does not propagate unverified email or phone, and never clears identifiers", async () => {
    user.emailVerified = false;
    user.attributes.phoneNumberVerified = ["false"];
    expect((await propagateIdentifiers("subject")).skipped).toBe(2);
    user.email = "";
    user.emailVerified = true;
    await propagateIdentifiers("subject");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("re-reads the identity each pass and retries drift even after an earlier successful write", async () => {
    await propagateIdentifiers("subject");
    user.email = "changed@example.test";
    mocks.write.mockResolvedValue({ status: "unchanged" });
    expect((await propagateIdentifiers("subject")).unchanged).toBe(2);
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ uuid: "staff" }), { emailId: "changed@example.test" });
    expect(mocks.request).toHaveBeenCalledTimes(4);
  });
  it("counts masked skips and refuses a phone outside the deployment rule", async () => {
    user.attributes.phoneNumber = ["+917123456789"];
    mocks.write.mockResolvedValue({ status: "skipped-masked" });
    expect(await propagateIdentifiers("subject")).toEqual({ written: 0, unchanged: 0, skipped: 2 });
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("does not propagate staff identifiers to a removed binding", async () => {
    user.attributes["digit.bindings"] = ['{"v":1,"bindings":[]}'];
    await propagateIdentifiers("subject");
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0][0].uuid).toBe("citizen");
  });
  it("keeps dependency errors retryable instead of treating them as success", async () => {
    mocks.write.mockRejectedValue(new Error("dependency unavailable"));
    await expect(propagateIdentifiers("subject")).rejects.toThrow("dependency unavailable");
  });
});
