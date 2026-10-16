import { describe, expect, it } from "vitest";
import {
  ENCODE_V1_ALPHABET,
  ENCODE_V1_CLASSES,
  credentialHmac,
  credentialInput,
  derivedStaffPassword,
  encodeV1,
} from "../../src/modules/accounts/credential.js";

// Test keys only. Real keys come from the deploy key ring and are never committed.
const K1 = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const K2 = Buffer.alloc(32, 0xab);

// Frozen in docs/identity-bff.md §"Derived staff credential". Cross-checked
// against an independent Python implementation when they were frozen.
const VECTORS = [
  { key: K1, uuid: "00000000-0000-4000-8000-000000000001", tenantId: "pg",
    hmac: "af3993b634002e81bec3eebe81116c9c4eee4ce5ae716e3a79a576635628925e", password: "W8%$wiVkCM39sks" },
  { key: K1, uuid: "3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b", tenantId: "pg",
    hmac: "e3f76de39a836f107c50416fb08406857f83305d35cd3da866561ac8aff1f43c", password: "W6RgS$HeadQrdYN" },
  { key: K1, uuid: "3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b", tenantId: "ke",
    hmac: "306cd3b8552cb8c4116c6341d9cce98ef2db5a5fa0d58c12bfd6feda038eeaee", password: "%@uYT8MwZkS$J4q" },
  { key: K2, uuid: "3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b", tenantId: "pg",
    hmac: "06b4508a015652bf1c412cb091ae877e10b21c8106843a6599a55347d1d83be1", password: "@rQXAhqy6Tz6R5b" },
  { key: K2, uuid: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", tenantId: "bomet-county",
    hmac: "0287838160bbdc66bd28d6ab0cc510988ed30454819aef0e32c079d8c4cd2a12", password: "rQuGP8HDAhM2c@E" },
];

// egov-user application.properties: egov.user.pwd.pattern plus min/max length,
// applied as UserService.validatePassword does (length check + Matcher.find()).
const EGOV_USER_PWD_PATTERN = /((?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[@#$%])(?=\S+$).*$)/;
function passesEgovUserPolicy(password: string): boolean {
  return password.length >= 8 && password.length <= 15 && EGOV_USER_PWD_PATTERN.test(password);
}

describe("encode_v1 derived staff credential", () => {
  it.each(VECTORS)("matches the frozen vector for $tenantId/$uuid", (vector) => {
    expect(credentialHmac(vector.key, vector.uuid, vector.tenantId).toString("hex")).toBe(vector.hmac);
    expect(derivedStaffPassword(vector.key, vector.uuid, vector.tenantId)).toBe(vector.password);
  });

  it("every frozen vector passes egov-user's password policy", () => {
    for (const vector of VECTORS) expect(passesEgovUserPolicy(vector.password)).toBe(true);
  });

  it("10,000 derived passwords all pass egov-user's password policy", () => {
    for (let i = 0; i < 10_000; i += 1) {
      const uuid = `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
      const password = derivedStaffPassword(K1, uuid, i % 2 ? "pg" : "ke");
      expect(password).toHaveLength(15);
      expect(passesEgovUserPolicy(password)).toBe(true);
      for (const char of password) expect(ENCODE_V1_ALPHABET).toContain(char);
    }
  });

  it("separates input fields with newlines so shifted fields don't collide", () => {
    expect(credentialInput("ab", "c")).toBe("v1\nab\nc");
    expect(derivedStaffPassword(K1, "ab", "c")).not.toBe(derivedStaffPassword(K1, "a", "bc"));
  });

  it("depends on the key, the uuid and the tenant", () => {
    const base = derivedStaffPassword(K1, VECTORS[1]!.uuid, "pg");
    expect(derivedStaffPassword(K2, VECTORS[1]!.uuid, "pg")).not.toBe(base);
    expect(derivedStaffPassword(K1, VECTORS[0]!.uuid, "pg")).not.toBe(base);
    expect(derivedStaffPassword(K1, VECTORS[1]!.uuid, "ke")).not.toBe(base);
  });

  it("rejects short keys, empty or multi-line inputs and wrong-size HMACs", () => {
    expect(() => credentialHmac(Buffer.alloc(31), "u", "t")).toThrow(/at least 32 bytes/);
    expect(() => credentialInput("", "pg")).toThrow(/uuid/);
    expect(() => credentialInput("u", "p\ng")).toThrow(/tenantId/);
    expect(() => encodeV1(Buffer.alloc(16))).toThrow(/32-byte/);
  });

  it("uses look-alike-free class alphabets of the documented sizes", () => {
    expect(ENCODE_V1_CLASSES.lower).toHaveLength(25);
    expect(ENCODE_V1_CLASSES.upper).toHaveLength(24);
    expect(ENCODE_V1_CLASSES.digit).toHaveLength(8);
    expect(ENCODE_V1_CLASSES.special).toHaveLength(4);
    expect(new Set(ENCODE_V1_ALPHABET).size).toBe(61);
    for (const char of "lIO01") expect(ENCODE_V1_ALPHABET).not.toContain(char);
  });

  it("picks characters without visible bias (chi-square over 20,000 passwords)", () => {
    const counts = new Map<string, number>();
    let filler = 0;
    for (let i = 0; i < 20_000; i += 1) {
      for (const char of derivedStaffPassword(K2, `uuid-${i}`, "pg")) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
        filler += 1;
      }
    }
    // Each lower-case letter gets 1/25 of the 20,000 forced picks plus 1/61 of the
    // 220,000 filler picks. Compare observed counts against that expectation.
    const forced = (size: number) => 20_000 / size;
    const fromFiller = 220_000 / 61;
    let chiSquare = 0;
    for (const [alphabet, size] of [
      [ENCODE_V1_CLASSES.lower, 25], [ENCODE_V1_CLASSES.upper, 24],
      [ENCODE_V1_CLASSES.digit, 8], [ENCODE_V1_CLASSES.special, 4],
    ] as const) {
      for (const char of alphabet) {
        const expected = forced(size) + fromFiller;
        chiSquare += ((counts.get(char) ?? 0) - expected) ** 2 / expected;
      }
    }
    expect(filler).toBe(300_000);
    // 60 degrees of freedom; p = 0.001 critical value is about 99.6.
    expect(chiSquare).toBeLessThan(99.6);
  });
});
