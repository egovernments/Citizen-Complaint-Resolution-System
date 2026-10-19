import { afterEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "../../src/modules/sessions/current-session.js";
import { InvalidGrantError, IdentityUnavailableError, refreshIdentityTokens } from "../../src/modules/authentication/oidc.js";
import { getIdentitySession, deleteIdentitySession } from "../../src/modules/sessions/session-store.js";
vi.mock("../../src/modules/accounts/person-lease.js", async original => ({ ...await original<typeof import("../../src/modules/accounts/person-lease.js")>(), withPersonLease: async (_sub: string, operation: () => Promise<unknown>) => operation() }));
vi.mock("../../src/modules/authentication/oidc.js", async original => ({ ...await original<typeof import("../../src/modules/authentication/oidc.js")>(), refreshIdentityTokens: vi.fn() }));
vi.mock("../../src/modules/sessions/session-store.js", async original => ({ ...await original<typeof import("../../src/modules/sessions/session-store.js")>(), getIdentitySession: vi.fn(), deleteIdentitySession: vi.fn() }));
afterEach(() => vi.resetAllMocks());
describe("refresh failure classification", () => {
  const prepare = () => vi.mocked(getIdentitySession).mockResolvedValue({ claims: { sub: "person", email: "test@example.test" }, accessToken: "expired", refreshToken: "refresh", accessExpiresAt: 0, sessionExpiresAt: Date.now() + 60_000 } as Awaited<ReturnType<typeof getIdentitySession>>);
  it.each([new TypeError("network failure"), new IdentityUnavailableError("503"), new Error("malformed token")])("keeps the stored session on dependency failure: %s", async error => {
    prepare(); vi.mocked(refreshIdentityTokens).mockRejectedValue(error);
    await expect(currentSession("digit_identity_session=sid")).rejects.toBeInstanceOf(IdentityUnavailableError);
    expect(deleteIdentitySession).not.toHaveBeenCalled();
  });
  it("ends the session only on invalid_grant", async () => {
    prepare(); vi.mocked(refreshIdentityTokens).mockRejectedValue(new InvalidGrantError());
    expect(await currentSession("digit_identity_session=sid")).toBeNull();
    expect(deleteIdentitySession).toHaveBeenCalledWith("sid");
  });
});
