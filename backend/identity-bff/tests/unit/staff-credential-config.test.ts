import { describe, expect, it } from "vitest";
import { parseStaffCredentialConfig } from "../../src/infrastructure/staff-credential-config.js";
const key = Buffer.alloc(32, 0xab).toString("base64");
describe("staff credential configuration", () => {
  it("defaults to rotate without requiring derived keys", () => {
    expect(parseStaffCredentialConfig({}).identityStaffCredentialMode).toBe("rotate");
  });
  it("reads an explicit current key and retained versions", () => {
    const value = parseStaffCredentialConfig({ IDENTITY_STAFF_CREDENTIAL_MODE: "derived", IDENTITY_CREDENTIAL_KEYS: `1:${key},2:${key}`, IDENTITY_CREDENTIAL_KEY_CURRENT: "2" });
    expect(value.identityCredentialKeys.size).toBe(2);
    expect(value.identityCredentialKeyCurrent).toBe(2);
  });
  it.each([
    { IDENTITY_STAFF_CREDENTIAL_MODE: "other" },
    { IDENTITY_STAFF_CREDENTIAL_MODE: "derived" },
    { IDENTITY_CREDENTIAL_KEYS: "1:YWJj", IDENTITY_CREDENTIAL_KEY_CURRENT: "1" },
    { IDENTITY_CREDENTIAL_KEYS: `1:${key},1:${key}`, IDENTITY_CREDENTIAL_KEY_CURRENT: "1" },
    { IDENTITY_CREDENTIAL_KEYS: `1:${key}`, IDENTITY_CREDENTIAL_KEY_CURRENT: "2" },
    { IDENTITY_CREDENTIAL_KEYS: "1:not-base64!", IDENTITY_CREDENTIAL_KEY_CURRENT: "1" },
  ])("rejects invalid config without echoing the key ring", (env) => {
    expect(() => parseStaffCredentialConfig(env)).toThrow();
    try { parseStaffCredentialConfig(env); } catch (error) {
      if (env.IDENTITY_CREDENTIAL_KEYS) expect((error as Error).message).not.toContain(env.IDENTITY_CREDENTIAL_KEYS);
    }
  });
});
