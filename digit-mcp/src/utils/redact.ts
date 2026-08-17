/**
 * Recursive credential redaction for anything we persist or log.
 *
 * Both the access log and the session store record tool arguments. They each
 * used to compare four exact key names against top-level keys only, which meant
 * `{ auth: { username, password } }` — the shape the REST shim documents — was
 * written out verbatim, along with `apiKey`, `privateKey` and similar names.
 *
 * Matching is a case-insensitive substring test on the key, applied at every
 * depth, so it fails closed: a new credential-ish field name is redacted
 * without anyone remembering to add it.
 */

const SENSITIVE_KEY_PATTERNS = [
  'password', 'passwd', 'pwd', 'secret', 'token', 'credential',
  'apikey', 'api_key', 'privatekey', 'private_key', 'access_key', 'auth',
];

/** Guard against pathological nesting (and cycles, which JSON args can't have). */
const MAX_REDACT_DEPTH = 8;

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p));
}

export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth >= MAX_REDACT_DEPTH) return '[depth-limited]';
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? '***' : redactDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}
