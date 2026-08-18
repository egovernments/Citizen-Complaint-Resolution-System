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

const SENSITIVE_WORDS = [
  'password', 'passwd', 'pwd', 'secret', 'token', 'credential', 'credentials',
  'apikey', 'privatekey', 'passphrase', 'authorization', 'auth',
];

/**
 * A key is sensitive when one of its WORDS is a credential word — where words
 * are the camelCase / snake_case / kebab-case segments of the name.
 *
 * A plain substring test over-matched badly: `auth` swallowed `author` and
 * `authority`, `token` swallowed `tokenize`. Those are ordinary tool arguments,
 * and redacting them makes the audit trail less useful without making it safer.
 * Segmenting keeps `access_token`, `apiKey` and `X-Auth-Token` while leaving
 * `author` alone.
 */
const SENSITIVE_WORD_SET = new Set(SENSITIVE_WORDS);

/**
 * Depth budget. Generous because it bounds a real payload, not an attack:
 * `mdms_create` / `tenant_bootstrap` arguments nest deeply, and the previous
 * limit of 8 replaced genuine data with a placeholder in both the access log
 * and the events table — discarding exactly the arguments worth auditing.
 * Cycles are handled separately, so this only has to stop runaway recursion.
 */
const MAX_REDACT_DEPTH = 64;

/** Split a key into lower-cased words across camelCase and separators. */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

export function isSensitiveKey(key: string): boolean {
  const words = keyWords(key);
  if (words.some((w) => SENSITIVE_WORD_SET.has(w))) return true;
  // Catch glued spellings a segmenter can't split, e.g. `mypassword`.
  const collapsed = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_WORDS.some((w) => w.length >= 6 && collapsed.includes(w));
}

export function redactDeep(value: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (depth >= MAX_REDACT_DEPTH) return '[depth-limited]';
  if (!value || typeof value !== 'object') return value;

  // The session store is fed from server.ts as well as the REST shim, so the
  // "JSON args can't have cycles" assumption doesn't hold for every caller.
  const visited = seen ?? new WeakSet<object>();
  if (visited.has(value as object)) return '[circular]';
  visited.add(value as object);

  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1, visited));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? '***' : redactDeep(v, depth + 1, visited);
  }
  return out;
}
