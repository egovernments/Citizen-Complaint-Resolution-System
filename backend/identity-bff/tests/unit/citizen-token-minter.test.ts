import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";

vi.mock("../../src/modules/managed-accounts/digit-user-client.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/modules/managed-accounts/digit-user-client.js")>(),
  passwordLogin: vi.fn(async () => ({ access_token: "citizen-token" })),
}));
const { passwordLogin } = await import("../../src/modules/managed-accounts/digit-user-client.js");
const { EgovOtpCitizenTokenMinter } = await import("../../src/modules/managed-accounts/citizen-token-minter.js");

const saved = { ...config };
afterEach(() => { Object.assign(config, saved); vi.unstubAllGlobals(); vi.mocked(passwordLogin).mockClear(); });
const account = { uuid: "u", userName: "citizen-1", tenantId: "ke", type: "CITIZEN" } as never;

describe("citizen token minter", () => {
  it("uses the fixed OTP without egov-otp when the fixed code is enabled", async () => {
    Object.assign(config, { citizenLoginPasswordOtpFixedEnabled: true, citizenLoginPasswordOtpFixedValue: "123456", digitOtpCreateUrl: "" });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await new EgovOtpCitizenTokenMinter().mint(account, "+254712345678");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(passwordLogin).toHaveBeenCalledWith(expect.objectContaining({ username: "citizen-1", password: "123456", userType: "CITIZEN" }));
  });
  it("creates a one-time code through egov-otp otherwise", async () => {
    Object.assign(config, { citizenLoginPasswordOtpFixedEnabled: false, digitOtpCreateUrl: "http://egov-otp.test/otp/v1/_create" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ otp: { otp: "908172" } }), { status: 200 })));
    await new EgovOtpCitizenTokenMinter().mint(account, "+254712345678");
    expect(passwordLogin).toHaveBeenCalledWith(expect.objectContaining({ password: "908172" }));
  });
});
