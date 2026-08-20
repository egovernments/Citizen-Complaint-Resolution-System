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
  'apikey', 'privatekey', 'passphrase', 'authorization', 'auth', 'bearer',
  'jwt', 'signature', 'sig', 'otp',
];

/**
 * Words that are only credential-ish next to a qualifier. `key` alone is far
 * too common to redact on (`schemaKey`, `sortKey`), but `access_key`,
 * `secretKey` and `signingKey` are credentials.
 */
const QUALIFIED_WORDS: Record<string, string[]> = {
  key: ['access', 'secret', 'private', 'signing', 'encryption', 'api', 'session', 'hmac', 'client'],
};

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

/**
 * Ordinary English words that merely CONTAIN a credential word. Without this
 * list, substring matching redacts `author` (auth), `authority` (auth),
 * `tokenize` (token) and `secretary` (secret) out of the audit trail — which is
 * the over-redaction this module was rewritten to stop. Listing the exceptions
 * is what lets the substring test stay aggressive everywhere else.
 */
const BENIGN_WORDS = new Set([
  'author', 'authors', 'authored', 'authoring', 'authorship',
  'authority', 'authorities', 'authoritative',
  'authentic', 'authenticity',
  'tokenize', 'tokenized', 'tokenizer', 'tokenization', 'tokens',
  'secretary', 'secretariat',
]);

export function isSensitiveKey(key: string): boolean {
  const words = keyWords(key);

  // A qualified word: `key` alone is far too common to redact on (`sortKey`,
  // `schemaKey`), but `access_key` / `secretKey` / `signingKey` are credentials.
  for (const [word, qualifiers] of Object.entries(QUALIFIED_WORDS)) {
    if (words.includes(word) && words.some((w) => qualifiers.includes(w))) return true;
  }

  return words.some((word) => {
    if (SENSITIVE_WORD_SET.has(word)) return true;
    if (BENIGN_WORDS.has(word)) return false;
    // Glued spellings a segmenter cannot split: `authtoken`, `accesstoken`,
    // `userpwd`, `mypassword`, `oauth`. Checked per WORD rather than over the
    // whole key, so one benign word cannot mask a credential word beside it.
    return SENSITIVE_WORDS.some((w) => word.includes(w));
  });
}

export function redactDeep(value: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (depth >= MAX_REDACT_DEPTH) return '[depth-limited]';
  if (!value || typeof value !== 'object') return value;

  // The session store is fed from server.ts as well as the REST shim, so the
  // "JSON args can't have cycles" assumption doesn't hold for every caller.
  const onPath = seen ?? new WeakSet<object>();
  if (onPath.has(value as object)) return '[circular]';

  // Marked on the way down and UNMARKED on the way back up, so this tracks the
  // current path rather than everything seen. A shared-but-acyclic object —
  // `{ source: t, target: t }` — is not a cycle, and reporting the second
  // occurrence as '[circular]' silently deleted real audit data.
  onPath.add(value as object);
  try {
    if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1, onPath));

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? '***' : redactDeep(v, depth + 1, onPath);
    }
    return out;
  } finally {
    onPath.delete(value as object);
  }
}
