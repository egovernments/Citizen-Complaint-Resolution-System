/**
 * Unit tests for the MCP security boundary (tracked in #1641).
 *
 * These cover the invariants the hardening work established, so a later
 * refactor breaks a test rather than the boundary:
 *
 *   1. auth mode derivation      — HTTP defaults to token, stdio to ambient
 *   2. tool access tiers         — citizen / employee / admin, per identity
 *   3. tool classification       — no tool is public by accident
 *   4. deep redaction            — credentials at any depth, any casing
 *   5. artifact path confinement — traversal, siblings, absolutes
 *   6. base_url allow-list       — SSRF / credential-exfiltration guard
 *   7. X-Forwarded-For trust     — IPv4 and IPv6, CIDR and literal
 *   8. request isolation         — concurrent callers can't see each other
 *
 * No DIGIT API needed: everything here is pure logic or in-process state.
 *
 * Run: npm run test:security
 */

import assert from 'node:assert/strict';
import {
  adminRoleCodes,
  allowedBaseUrlHosts,
  checkBaseUrlAllowed,
  checkToolAccess,
  getAuthMode,
  isAdminCaller,
  parseBearer,
  resolveArtifactPath,
  resolveClientIp,
} from './src/services/auth.js';
import { digitApi, runWithIsolatedClient } from './src/services/digit-api.js';
import { getRequestContext, runWithRequestContext } from './src/services/request-context.js';
import { ToolRegistry } from './src/tools/registry.js';
import { registerAllTools } from './src/tools/index.js';
import type { ToolAccess, UserInfo } from './src/types/index.js';
import { isSensitiveKey, redactDeep } from './src/utils/redact.js';

// --- Test runner (same pattern as test-agent-safety.ts) ---

const passed: string[] = [];
const failed: string[] = [];

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    passed.push(name);
    console.log(`  \x1b[32mPASS\x1b[0m  ${name} \x1b[90m(${Date.now() - start}ms)\x1b[0m`);
  } catch (err) {
    failed.push(name);
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name} \x1b[90m(${Date.now() - start}ms)\x1b[0m`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Run `fn` with env vars applied, restoring whatever was there before. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const user = (userName: string, roles: string[], tenantId = 'pg'): UserInfo => ({
  userName,
  name: userName,
  tenantId,
  roles: roles.map((code) => ({ code, name: code })),
});

const CITIZEN = user('citizen-1', ['CITIZEN']);
const EMPLOYEE = user('gro-1', ['GRO', 'PGR_LME']);
const ADMIN = user('admin-1', ['SUPERUSER']);
const ROLELESS = user('ghost', []);

// =====================================================================
// 1. Auth mode derivation
// =====================================================================

console.log('\n\x1b[1m1. Auth mode\x1b[0m');

await test('1.1 HTTP transport defaults to token mode', () => {
  withEnv({ MCP_TRANSPORT: 'http', MCP_AUTH_MODE: undefined }, () => {
    assert.equal(getAuthMode(), 'token');
  });
});

await test('1.2 stdio transport defaults to ambient mode', () => {
  withEnv({ MCP_TRANSPORT: undefined, MCP_AUTH_MODE: undefined }, () => {
    assert.equal(getAuthMode(), 'ambient');
  });
});

await test('1.3 MCP_AUTH_MODE overrides the derivation in both directions', () => {
  withEnv({ MCP_TRANSPORT: 'http', MCP_AUTH_MODE: 'ambient' }, () => {
    assert.equal(getAuthMode(), 'ambient');
  });
  withEnv({ MCP_TRANSPORT: undefined, MCP_AUTH_MODE: 'token' }, () => {
    assert.equal(getAuthMode(), 'token');
  });
});

await test('1.4 an unrecognised MCP_AUTH_MODE falls back to the transport default', () => {
  withEnv({ MCP_TRANSPORT: 'http', MCP_AUTH_MODE: 'yes-please' }, () => {
    assert.equal(getAuthMode(), 'token', 'a typo must not silently disable auth');
  });
});

await test('1.5 parseBearer accepts only a non-empty Bearer credential', () => {
  assert.equal(parseBearer('Bearer abc123'), 'abc123');
  assert.equal(parseBearer('bearer abc123'), 'abc123', 'scheme is case-insensitive');
  assert.equal(parseBearer('Bearer   '), null, 'whitespace-only is not a token');
  assert.equal(parseBearer('Basic abc123'), null);
  assert.equal(parseBearer(undefined), null);
});

// =====================================================================
// 2. Tool access tiers
// =====================================================================

console.log('\n\x1b[1m2. Tool access tiers\x1b[0m');

const inToken = (fn: () => void) => withEnv({ MCP_TRANSPORT: 'http', MCP_AUTH_MODE: 'token' }, fn);

await test('2.1 ambient mode skips authorization entirely', () => {
  withEnv({ MCP_TRANSPORT: undefined, MCP_AUTH_MODE: 'ambient' }, () => {
    assert.equal(checkToolAccess('tenant_cleanup', 'admin', null), null);
  });
});

await test('2.2 public tools need no identity', () => {
  inToken(() => {
    assert.equal(checkToolAccess('docs_search', 'public', null), null);
    assert.equal(checkToolAccess('docs_search', 'public', CITIZEN), null);
  });
});

await test('2.3 a citizen-only account is refused employee tools', () => {
  inToken(() => {
    const denial = checkToolAccess('pgr_create', 'employee', CITIZEN);
    assert.ok(denial, 'expected a denial');
    assert.match(denial!, /staff \(non-citizen\) account/);
  });
});

await test('2.4 a roleless account is refused employee tools', () => {
  inToken(() => {
    assert.ok(checkToolAccess('pgr_create', 'employee', ROLELESS));
  });
});

await test('2.5 staff roles pass the employee tier but not the admin tier', () => {
  inToken(() => {
    assert.equal(checkToolAccess('pgr_create', 'employee', EMPLOYEE), null);
    assert.ok(checkToolAccess('tenant_cleanup', 'admin', EMPLOYEE));
  });
});

await test('2.6 an admin role passes every tier', () => {
  inToken(() => {
    for (const tier of ['public', 'employee', 'admin'] as ToolAccess[]) {
      assert.equal(checkToolAccess('t', tier, ADMIN), null, `admin should pass ${tier}`);
    }
  });
});

await test('2.7 omitted access defaults to employee, never public', () => {
  inToken(() => {
    assert.ok(checkToolAccess('newly_added_tool', undefined, CITIZEN),
      'a tool that forgets to declare access must not be reachable by a citizen');
    assert.equal(checkToolAccess('newly_added_tool', undefined, EMPLOYEE), null);
  });
});

await test('2.8 a missing user is refused anything above public', () => {
  inToken(() => {
    assert.ok(checkToolAccess('pgr_create', 'employee', null));
    assert.ok(checkToolAccess('tenant_cleanup', 'admin', null));
  });
});

await test('2.9 authorization keys on roles, not user.type', () => {
  inToken(() => {
    // pgr_create provisions citizens with type EMPLOYEE so they can use
    // password auth. If the check ever regresses to user.type, this passes
    // a citizen straight into staff tooling.
    const provisioned: UserInfo = { ...CITIZEN, type: 'EMPLOYEE' };
    assert.ok(checkToolAccess('user_search', 'employee', provisioned),
      'type=EMPLOYEE must not by itself confer staff access');
  });
});

await test('2.10 MCP_ADMIN_ROLES overrides the default admin role set', () => {
  withEnv({ MCP_TRANSPORT: 'http', MCP_AUTH_MODE: 'token', MCP_ADMIN_ROLES: 'TENANT_ADMIN' }, () => {
    assert.deepEqual(adminRoleCodes(), ['TENANT_ADMIN']);
    assert.ok(checkToolAccess('tenant_cleanup', 'admin', ADMIN), 'SUPERUSER is no longer admin');
    assert.equal(checkToolAccess('tenant_cleanup', 'admin', user('t', ['TENANT_ADMIN'])), null);
  });
});

await test('2.11 a denial names both the required and the held roles', () => {
  inToken(() => {
    const denial = checkToolAccess('tenant_cleanup', 'admin', EMPLOYEE)!;
    assert.match(denial, /SUPERUSER/, 'should name what is required');
    assert.match(denial, /GRO/, 'should name what the caller holds');
  });
});

await test('2.12 isAdminCaller matches checkToolAccess on the admin tier', () => {
  inToken(() => {
    for (const u of [CITIZEN, EMPLOYEE, ADMIN, ROLELESS]) {
      assert.equal(
        isAdminCaller(u),
        checkToolAccess('t', 'admin', u) === null,
        `disagreement for ${u.userName} — /api/* and tool dispatch would diverge`,
      );
    }
    assert.equal(isAdminCaller(null), false);
  });
});

// =====================================================================
// 3. Tool classification
// =====================================================================

console.log('\n\x1b[1m3. Tool classification\x1b[0m');

const registry = new ToolRegistry();
registerAllTools(registry);
const allTools = registry.getAllTools();

/** Tools intentionally reachable without any role. Additions need review. */
const EXPECTED_PUBLIC = new Set([
  'api_catalog', 'discover_tools', 'docs_search',
  'get_environment_info', 'init', 'session_checkpoint',
]);

await test('3.1 every tool declares a valid access tier or omits it', () => {
  const valid = new Set(['public', 'employee', 'admin', undefined]);
  for (const t of allTools) {
    assert.ok(valid.has(t.access), `${t.name} has access="${t.access}"`);
  }
});

await test('3.2 the public surface is exactly the reviewed list', () => {
  const actual = new Set(allTools.filter((t) => t.access === 'public').map((t) => t.name));
  assert.deepEqual(
    [...actual].sort(),
    [...EXPECTED_PUBLIC].sort(),
    'a tool became public (or stopped being) — that is a boundary change, not a refactor',
  );
});

/**
 * The two session tools are public AND write: they record a session row, which
 * any authenticated caller may legitimately do. Everything else public must be
 * read-only. Listing the exceptions explicitly is what makes this test able to
 * fail — excluding all of EXPECTED_PUBLIC made it a tautology, since 3.2
 * already pins that set.
 */
const PUBLIC_WRITE_EXCEPTIONS = new Set(['init', 'session_checkpoint']);

await test('3.3 no public tool is write-risk except the session recorders', () => {
  const offenders = allTools
    .filter((t) => t.access === 'public' && t.risk === 'write' && !PUBLIC_WRITE_EXCEPTIONS.has(t.name))
    .map((t) => t.name);
  assert.deepEqual(offenders, [], 'a public tool gained write risk');
});

await test('3.3b the tier census matches what the docs claim', () => {
  // Pinned so prose and code cannot drift: the PR body and README quote these
  // numbers, and they have already gone stale once. If this fails, a tier
  // moved — update the docs in the same commit, not the number here alone.
  const census = { public: 0, employee: 0, admin: 0 } as Record<string, number>;
  for (const t of allTools) census[t.access ?? 'employee']++;
  assert.equal(allTools.length, 70, 'tool count changed');
  assert.deepEqual(census, { public: 6, employee: 30, admin: 34 });
});

await test('3.4 destructive and PII tools are admin-tier', () => {
  const mustBeAdmin = [
    'tenant_cleanup', 'tenant_destroy', 'decrypt_data', 'encrypt_data',
    'user_create', 'user_role_add', 'employee_create', 'employee_update',
    'configure', 'snapshot_capture', 'db_counts', 'filestore_upload',
  ];
  for (const name of mustBeAdmin) {
    const tool = allTools.find((t) => t.name === name);
    assert.ok(tool, `${name} is not registered`);
    assert.equal(tool!.access, 'admin', `${name} must be admin-tier`);
  }
});

await test('3.5 decrypt_data marks its output sensitive', () => {
  const tool = allTools.find((t) => t.name === 'decrypt_data')!;
  assert.equal(tool.sensitiveOutput, true, 'plaintext PII must not reach the events table');
});

await test('3.6 mutating tools are labelled risk: write', () => {
  // A client that auto-approves read-risk tools relies on this being honest.
  for (const name of ['configure', 'snapshot_capture', 'tenant_cleanup', 'user_create']) {
    assert.equal(allTools.find((t) => t.name === name)!.risk, 'write', `${name} mutates state`);
  }
});

// =====================================================================
// 4. Deep redaction
// =====================================================================

console.log('\n\x1b[1m4. Redaction\x1b[0m');

await test('4.1 a credential-shaped envelope is redacted whole', () => {
  // `auth` matches at the top level, so this does NOT exercise depth — 4.2 does.
  const out = redactDeep({ auth: { username: 'admin', password: 'hunter2' } }) as any;
  assert.equal(out.auth, '***', 'the whole auth envelope is credential-shaped');
});

await test('4.2 credentials nested below a benign key are still redacted', () => {
  const out = redactDeep({ config: { db: { password: 'hunter2', host: 'localhost' } } }) as any;
  assert.equal(out.config.db.password, '***');
  assert.equal(out.config.db.host, 'localhost', 'benign siblings survive');
});

await test('4.3 matching is case-insensitive and substring-based', () => {
  const out = redactDeep({ apiKey: 'k', PRIVATE_KEY: 'p', accessToken: 't', Passwd: 'w' }) as any;
  for (const k of ['apiKey', 'PRIVATE_KEY', 'accessToken', 'Passwd']) {
    assert.equal(out[k], '***', `${k} should be redacted`);
  }
});

await test('4.4 credentials inside arrays are redacted', () => {
  const out = redactDeep({ users: [{ name: 'a', password: 'p' }] }) as any;
  assert.equal(out.users[0].password, '***');
  assert.equal(out.users[0].name, 'a');
});

await test('4.5 non-credential values pass through untouched', () => {
  const input = { tenant_id: 'pg.citya', limit: 10, active: true, tags: ['x'] };
  assert.deepEqual(redactDeep(input), input);
});

await test('4.6 pathological nesting terminates', () => {
  let deep: Record<string, unknown> = { password: 'p' };
  for (let i = 0; i < 50; i++) deep = { nested: deep };
  const out = JSON.stringify(redactDeep(deep));
  assert.ok(!out.includes('"p"'), 'a deep credential must not survive the depth limit');
});

await test('4.7 isSensitiveKey covers the documented names', () => {
  for (const k of ['password', 'secret', 'token', 'credential', 'auth', 'apikey']) {
    assert.ok(isSensitiveKey(k), `${k} should be sensitive`);
  }
  for (const k of ['tenant_id', 'name', 'limit']) {
    assert.ok(!isSensitiveKey(k), `${k} should not be sensitive`);
  }
});

// =====================================================================
// 5. Artifact path confinement
// =====================================================================

console.log('\n\x1b[1m5. Artifact paths\x1b[0m');

import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

// realpathSync'd because resolveArtifactPath returns real paths, and the
// system tmpdir is itself a symlink on macOS (/var -> /private/var).
const artifactRoot = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-artifacts-')));
const outsideRoot = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-outside-')));
const inArtifactDir = (fn: () => void) => withEnv({ MCP_ARTIFACT_DIR: artifactRoot }, fn);

await test('5.1 a bare filename resolves inside the artifact directory', () => {
  inArtifactDir(() => {
    assert.ok(resolveArtifactPath('snap.json').startsWith(artifactRoot + sep));
  });
});

await test('5.2 a nested relative path is allowed', () => {
  inArtifactDir(() => {
    assert.ok(resolveArtifactPath('runs/today/snap.json').startsWith(artifactRoot + sep));
  });
});

await test('5.3 traversal out of the directory is rejected', () => {
  inArtifactDir(() => {
    for (const p of ['../escape.json', '../../etc/passwd', 'a/../../escape.json']) {
      assert.throws(() => resolveArtifactPath(p), /outside the permitted artifact directory/, p);
    }
  });
});

await test('5.4 an unrelated absolute path is rejected', () => {
  inArtifactDir(() => {
    assert.throws(() => resolveArtifactPath('/etc/passwd'), /outside the permitted/);
    assert.throws(() => resolveArtifactPath(join(outsideRoot, 'x.json')), /outside the permitted/);
  });
});

await test('5.5 a sibling directory sharing the prefix is rejected', () => {
  // `/data/artifacts-evil` must not pass a naive startsWith on `/data/artifacts`.
  inArtifactDir(() => {
    assert.throws(() => resolveArtifactPath(artifactRoot + '-evil/x.json'), /outside the permitted/);
  });
});

await test('5.6 an absolute path inside the directory is allowed', () => {
  inArtifactDir(() => {
    assert.ok(resolveArtifactPath(join(artifactRoot, 'ok.json')).startsWith(artifactRoot + sep));
  });
});

await test('5.7 a live symlink pointing out of the directory is rejected', () => {
  inArtifactDir(() => {
    const link = join(artifactRoot, 'escape-link');
    symlinkSync(outsideRoot, link, 'dir');
    assert.throws(() => resolveArtifactPath('escape-link/x.json'), /outside the permitted/);
  });
});

await test('5.8 a DANGLING symlink is rejected', () => {
  // realpathSync throws on a dangling link, so resolving alone treats it as a
  // leaf that doesn't exist yet and returns a path inside the base — which the
  // caller's writeFileSync then follows straight out of the directory.
  // Creating a new file elsewhere is the case that matters.
  inArtifactDir(() => {
    symlinkSync(join(outsideRoot, 'not-created-yet.json'), join(artifactRoot, 'dangle.json'));
    assert.throws(() => resolveArtifactPath('dangle.json'), /symbolic link/);
  });
});

await test('5.9 a rejected path creates no directories', () => {
  // The check must come before the mkdir. Creating the caller's directories and
  // then throwing is arbitrary directory creation wherever the process can write.
  inArtifactDir(() => {
    const victim = join(outsideRoot, 'should-not-exist');
    assert.throws(() => resolveArtifactPath(join(victim, 'deep', 'x.json')), /outside the permitted/);
    assert.ok(!existsSync(victim), 'a denied path still authored directories on disk');
  });
});

// =====================================================================
// 6. base_url allow-list
// =====================================================================

console.log('\n\x1b[1m6. base_url allow-list\x1b[0m');

await test('6.1 ambient mode without an explicit allow-list does not enforce', () => {
  withEnv({ MCP_TRANSPORT: undefined, MCP_AUTH_MODE: 'ambient', MCP_ALLOWED_BASE_URLS: undefined }, () => {
    assert.equal(checkBaseUrlAllowed('http://anything.example'), null);
  });
});

await test('6.2 ambient mode WITH an explicit allow-list enforces it', () => {
  withEnv({ MCP_AUTH_MODE: 'ambient', MCP_ALLOWED_BASE_URLS: 'digit.example' }, () => {
    assert.equal(checkBaseUrlAllowed('https://digit.example'), null);
    assert.ok(checkBaseUrlAllowed('https://evil.example'));
  });
});

await test('6.3 token mode enforces the allow-list', () => {
  withEnv({ MCP_TRANSPORT: 'http', MCP_AUTH_MODE: 'token', MCP_ALLOWED_BASE_URLS: 'digit.example' }, () => {
    assert.equal(checkBaseUrlAllowed('https://digit.example/api'), null);
    const denial = checkBaseUrlAllowed('https://attacker.example');
    assert.ok(denial);
    assert.match(denial!, /not allowed/);
  });
});

await test('6.4 non-http schemes are rejected', () => {
  withEnv({ MCP_AUTH_MODE: 'token', MCP_ALLOWED_BASE_URLS: 'digit.example' }, () => {
    assert.match(checkBaseUrlAllowed('file:///etc/passwd')!, /must use http or https/);
    assert.match(checkBaseUrlAllowed('gopher://digit.example')!, /must use http or https/);
  });
});

await test('6.5 a malformed URL is rejected', () => {
  withEnv({ MCP_AUTH_MODE: 'token', MCP_ALLOWED_BASE_URLS: 'digit.example' }, () => {
    assert.match(checkBaseUrlAllowed('not a url')!, /not a valid URL/);
  });
});

await test('6.6 the port is part of the host comparison', () => {
  withEnv({ MCP_AUTH_MODE: 'token', MCP_ALLOWED_BASE_URLS: 'digit.example:8080' }, () => {
    assert.equal(checkBaseUrlAllowed('http://digit.example:8080'), null);
    assert.ok(checkBaseUrlAllowed('http://digit.example:9090'), 'a different port is a different target');
  });
});

await test('6.7 the default allow-list is startup config, not mutable client state', () => {
  withEnv({ MCP_AUTH_MODE: 'token', MCP_ALLOWED_BASE_URLS: undefined }, () => {
    const atStartup = allowedBaseUrlHosts();
    assert.equal(atStartup.length, 1, 'defaults to exactly the configured DIGIT host');

    // This is the regression that matters: `configure` writes the client's
    // environment, so deriving the allow-list from the live client would let
    // one accepted call widen the guard that vets the next one.
    const snap = digitApi.snapshotAuth();
    try {
      digitApi.setAdHocEnvironment('http://attacker.example');
      assert.deepEqual(allowedBaseUrlHosts(), atStartup, 'allow-list must not follow the client');
      assert.ok(
        checkBaseUrlAllowed('http://attacker.example'),
        'a host must not authorise itself by having been configured once',
      );
    } finally {
      digitApi.restoreAuth(snap);
    }
  });
});

// =====================================================================
// 7. X-Forwarded-For trust
// =====================================================================

console.log('\n\x1b[1m7. Forwarded-for trust\x1b[0m');

await test('7.1 with no trusted proxies the header is ignored', () => {
  withEnv({ MCP_TRUSTED_PROXIES: undefined }, () => {
    const r = resolveClientIp('10.0.0.5', '1.2.3.4');
    assert.equal(r.ip, '10.0.0.5');
    assert.equal(r.claimed, '1.2.3.4', 'the claim is kept for forensics');
    assert.equal(r.trusted, false);
  });
});

await test('7.2 a trusted peer\'s header is honoured', () => {
  withEnv({ MCP_TRUSTED_PROXIES: '10.0.0.5' }, () => {
    const r = resolveClientIp('10.0.0.5', '1.2.3.4');
    assert.equal(r.ip, '1.2.3.4');
    assert.equal(r.trusted, true);
  });
});

await test('7.3 only the first hop of the chain is taken', () => {
  withEnv({ MCP_TRUSTED_PROXIES: '*' }, () => {
    assert.equal(resolveClientIp('10.0.0.5', '1.2.3.4, 5.6.7.8').ip, '1.2.3.4');
  });
});

await test('7.4 an IPv4 CIDR matches', () => {
  withEnv({ MCP_TRUSTED_PROXIES: '10.0.0.0/8' }, () => {
    assert.equal(resolveClientIp('10.4.5.6', '1.2.3.4').trusted, true);
    assert.equal(resolveClientIp('192.168.1.1', '1.2.3.4').trusted, false);
  });
});

await test('7.5 IPv4-mapped IPv6 peers are normalised before matching', () => {
  withEnv({ MCP_TRUSTED_PROXIES: '10.0.0.5' }, () => {
    assert.equal(resolveClientIp('::ffff:10.0.0.5', '1.2.3.4').ip, '1.2.3.4');
  });
});

await test('7.6 an IPv6 literal proxy matches regardless of formatting', () => {
  withEnv({ MCP_TRUSTED_PROXIES: '2001:db8::1' }, () => {
    assert.equal(resolveClientIp('2001:0db8:0000:0000:0000:0000:0000:0001', '1.2.3.4').trusted, true);
    assert.equal(resolveClientIp('2001:db8::2', '1.2.3.4').trusted, false);
  });
});

await test('7.7 an IPv6 CIDR matches — a dual-stack cluster must not fail open or blind', () => {
  withEnv({ MCP_TRUSTED_PROXIES: '2001:db8::/32' }, () => {
    assert.equal(resolveClientIp('2001:db8:abcd::9', '1.2.3.4').trusted, true);
    assert.equal(resolveClientIp('2001:dead::9', '1.2.3.4').trusted, false);
  });
});

await test('7.7b an IPv6 CIDR with a partial prefix masks within the group', () => {
  // /32 only ever compares whole 16-bit groups, so it never exercises the
  // groupBits/mask arithmetic — the only non-trivial line in the function.
  withEnv({ MCP_TRUSTED_PROXIES: '2001:db8:8000::/33' }, () => {
    assert.equal(resolveClientIp('2001:db8:8000::1', '1.2.3.4').trusted, true);
    assert.equal(resolveClientIp('2001:db8:0::1', '1.2.3.4').trusted, false);
  });
});

await test('7.8 a zone index is stripped rather than parsed into the address', () => {
  withEnv({ MCP_TRUSTED_PROXIES: 'fe80::1' }, () => {
    assert.equal(resolveClientIp('fe80::1%eth0', '1.2.3.4').trusted, true);
  });
  // The load-bearing half: a zone must not leak into the group parse. Asserting
  // only the match above passes even if the zone is never stripped, because
  // parseInt('1%eth0', 16) is 1.
  withEnv({ MCP_TRUSTED_PROXIES: 'fe80::2' }, () => {
    assert.equal(resolveClientIp('fe80::1%2', '1.2.3.4').trusted, false,
      'a zone id must not be read as part of the address');
  });
});

await test('7.9 no claim means the socket address stands', () => {
  withEnv({ MCP_TRUSTED_PROXIES: undefined }, () => {
    const r = resolveClientIp('10.0.0.5', undefined);
    assert.equal(r.ip, '10.0.0.5');
    assert.equal(r.trusted, true);
    assert.equal(r.claimed, undefined);
  });
});

// =====================================================================
// 8. Request isolation
// =====================================================================

console.log('\n\x1b[1m8. Request isolation\x1b[0m');

const tick = () => new Promise((r) => setImmediate(r));

await test('8.1 concurrent isolated clients do not observe each other', async () => {
  const seen: string[] = [];
  const caller = (name: string, delays: number) => runWithIsolatedClient(async () => {
    digitApi.applyToken(`token-${name}`, user(name, ['SUPERUSER']), 'pg');
    for (let i = 0; i < delays; i++) await tick();
    seen.push(`${name}:${digitApi.getAuthInfo().user?.userName}`);
  });

  // Interleave deliberately: A yields more times than B, so if the client were
  // process-wide, A would come back holding B's identity.
  await Promise.all([caller('alice', 5), caller('bob', 1), caller('carol', 3)]);

  assert.deepEqual(seen.sort(), ['alice:alice', 'bob:bob', 'carol:carol']);
});

await test('8.2 an isolated client does not leak into the shared default', async () => {
  // Restore the shared client afterwards: the suite runs sequentially at the
  // top level, so leaving it authenticated hands every later test an admin.
  const snap = digitApi.snapshotAuth();
  try {
    digitApi.applyToken('outer-token', ADMIN, 'pg');
    await runWithIsolatedClient(async () => {
      digitApi.applyToken('inner-token', CITIZEN, 'pg');
      assert.equal(digitApi.getAuthInfo().user?.userName, 'citizen-1');
    });
    assert.equal(digitApi.getAuthInfo().user?.userName, 'admin-1', 'the outer scope must be untouched');
  } finally {
    digitApi.restoreAuth(snap);
  }
});

await test('8.4 the isolated client also isolates `environment`', async () => {
  // configure()'s base_url writes `environment`. Omitting it from the snapshot
  // let one call repoint the whole process at a caller-chosen host.
  const snap = digitApi.snapshotAuth();
  try {
    const before = digitApi.getEnvironmentInfo().url;
    await runWithIsolatedClient(async () => {
      digitApi.setAdHocEnvironment('http://elsewhere.example');
      assert.equal(digitApi.getEnvironmentInfo().url, 'http://elsewhere.example');
    });
    assert.equal(digitApi.getEnvironmentInfo().url, before, 'environment escaped the request scope');
  } finally {
    digitApi.restoreAuth(snap);
  }
});

await test('8.5 a cached identity is copied, not shared, between callers', async () => {
  // The introspection cache holds one UserInfo per token. Handing the same
  // reference to concurrent request-scoped clients would put mutable state back
  // across the boundary the isolation exists to draw.
  const cached: UserInfo = user('shared', ['SUPERUSER']);
  const a = { ...cached, roles: cached.roles!.map((r) => ({ ...r })) };
  const b = { ...cached, roles: cached.roles!.map((r) => ({ ...r })) };
  a.roles![0].code = 'MUTATED';
  assert.equal(b.roles![0].code, 'SUPERUSER', 'per-caller copies must not alias');
  assert.equal(cached.roles![0].code, 'SUPERUSER', 'the cache entry must not be mutable through a copy');
});

await test('8.3 request context is per-request under interleaving', async () => {
  const seen: string[] = [];
  const caller = (ip: string, delays: number) =>
    runWithRequestContext({ ip, userAgent: `ua-${ip}` }, async () => {
      for (let i = 0; i < delays; i++) await tick();
      seen.push(`${ip}:${getRequestContext()?.ip}`);
    });

  await Promise.all([caller('1.1.1.1', 4), caller('2.2.2.2', 1), caller('3.3.3.3', 2)]);
  assert.deepEqual(seen.sort(), ['1.1.1.1:1.1.1.1', '2.2.2.2:2.2.2.2', '3.3.3.3:3.3.3.3']);
});

await test('8.6 outside a request scope the context is empty', () => {
  assert.equal(getRequestContext(), undefined, 'stdio must not inherit a stale HTTP context');
});

// =====================================================================
// Summary
// =====================================================================

rmSync(artifactRoot, { recursive: true, force: true });
rmSync(outsideRoot, { recursive: true, force: true });

console.log('\n' + '='.repeat(60));
console.log(`  Results: ${passed.length} passed, ${failed.length} failed`);
if (failed.length > 0) {
  console.log(`  Failed: ${failed.join(', ')}`);
}
console.log('='.repeat(60) + '\n');

process.exit(failed.length > 0 ? 1 : 0);
