import { createHmac } from "node:crypto";

/**
 * Derived DIGIT credential for a bound staff account (design §6, D25/A5).
 *
 *   password = encode_v1(HMAC-SHA256(key[keyVersion], "v1\n" + uuid + "\n" + tenantId))
 *
 * The password is never stored. Anyone holding the key ring can recompute it,
 * which is what lets the BFF sign in as the account, repair it once, and find
 * grant-eligible staff again after the token inventory is lost.
 *
 * encode_v1 turns the 32-byte HMAC into a 15-character password that always
 * passes egov-user's default policy (egov.user.pwd.pattern: a digit, a lower-
 * case letter, an upper-case letter, one of @#$%, no whitespace, 8-15 chars):
 *
 * 1. Expand the HMAC with HKDF-Expand (RFC 5869, SHA-256, info below) into a
 *    byte stream. Bytes are read in order and never reused.
 * 2. Pick one character from each required class, then 11 from the union of
 *    all classes, in that order. Each pick uses rejection sampling: a byte is
 *    accepted only if it is below the largest multiple of the alphabet size
 *    that fits in 256, so no character is favoured.
 * 3. Shuffle the 15 characters with Fisher-Yates (i from 14 down to 1), taking
 *    each index j in [0, i] from the same stream with the same rejection rule.
 *
 * Changing anything here changes every staff password. Bump the version
 * (encode_v2) instead; the frozen test vectors guard v1.
 */

export const ENCODE_V1_LENGTH = 15;
export const ENCODE_V1_HKDF_INFO = "digit-identity-bff/encode_v1";

/** Look-alike characters (l, I, O, 0, 1) are left out. */
export const ENCODE_V1_CLASSES = {
  lower: "abcdefghijkmnopqrstuvwxyz", // 25
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ", // 24
  digit: "23456789", // 8
  special: "@#$%", // 4
} as const;

export const ENCODE_V1_ALPHABET =
  ENCODE_V1_CLASSES.lower + ENCODE_V1_CLASSES.upper + ENCODE_V1_CLASSES.digit + ENCODE_V1_CLASSES.special; // 61

/** Minimum key length in bytes for a key-ring entry. */
export const CREDENTIAL_KEY_MIN_BYTES = 32;

/** The HMAC input: fields separated by newlines so no two inputs collide. */
export function credentialInput(uuid: string, tenantId: string): string {
  for (const [name, value] of [["uuid", uuid], ["tenantId", tenantId]] as const) {
    if (!value || /[\r\n]/.test(value)) throw new Error(`encode_v1 ${name} must be non-empty and single-line`);
  }
  return `v1\n${uuid}\n${tenantId}`;
}

/** HMAC-SHA256(key, credentialInput(uuid, tenantId)). */
export function credentialHmac(key: Buffer, uuid: string, tenantId: string): Buffer {
  if (key.length < CREDENTIAL_KEY_MIN_BYTES) {
    throw new Error(`credential key must be at least ${CREDENTIAL_KEY_MIN_BYTES} bytes`);
  }
  return createHmac("sha256", key).update(credentialInput(uuid, tenantId), "utf8").digest();
}

/** RFC 5869 HKDF-Expand with SHA-256, read lazily one byte at a time. */
class HkdfStream {
  private block = Buffer.alloc(0);
  private offset = 0;
  private counter = 0;

  constructor(private readonly prk: Buffer, private readonly info: Buffer) {}

  next(): number {
    if (this.offset >= this.block.length) {
      // HKDF allows at most 255 blocks. A v1 password needs about 30 bytes, so
      // reaching this would take a broken HMAC.
      if (this.counter >= 255) throw new Error("encode_v1 HKDF stream exhausted");
      this.counter += 1;
      this.block = createHmac("sha256", this.prk)
        .update(this.block)
        .update(this.info)
        .update(Buffer.from([this.counter]))
        .digest();
      this.offset = 0;
    }
    return this.block[this.offset++]!;
  }

  /** A uniform integer in [0, size) by rejection sampling (size <= 256). */
  below(size: number): number {
    const limit = 256 - (256 % size);
    for (;;) {
      const byte = this.next();
      if (byte < limit) return byte % size;
    }
  }
}

/** encode_v1 over a 32-byte HMAC output. */
export function encodeV1(hmac: Buffer): string {
  if (hmac.length !== 32) throw new Error("encode_v1 expects a 32-byte HMAC-SHA256 output");
  const stream = new HkdfStream(hmac, Buffer.from(ENCODE_V1_HKDF_INFO, "utf8"));
  const pick = (alphabet: string) => alphabet[stream.below(alphabet.length)]!;

  const chars = [
    pick(ENCODE_V1_CLASSES.lower),
    pick(ENCODE_V1_CLASSES.upper),
    pick(ENCODE_V1_CLASSES.digit),
    pick(ENCODE_V1_CLASSES.special),
  ];
  while (chars.length < ENCODE_V1_LENGTH) chars.push(pick(ENCODE_V1_ALPHABET));

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = stream.below(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/** The derived DIGIT password of a staff account for one key version. */
export function derivedStaffPassword(key: Buffer, uuid: string, tenantId: string): string {
  return encodeV1(credentialHmac(key, uuid, tenantId));
}
