/**
 * Integration tests for the MCP security boundary — the ENFORCEMENT side.
 *
 * `test-security.ts` covers the policy functions (does checkToolAccess decide
 * correctly?). This suite covers the question that one structurally cannot:
 * **is the check actually called, on every route?**
 *
 * That gap was found by mutation testing — deleting the `checkToolAccess` call
 * from server.ts, or `authorizeRest` from a REST dispatch path, or the whole
 * `/api/*` gate, left the unit suite at 57/57 green. Those are the regressions
 * a refactor is most likely to introduce, so they are tested here against a
 * real server over a real socket.
 *
 * A stub DIGIT stands in for egov-user: it mints tokens whose roles are
 * determined by the token string, so identity is controllable without a live
 * platform. Nothing here needs network access.
 *
 * Run: npm run test:security:http
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- Test runner ---------------------------------------------------------

const passed: string[] = [];
const failed: string[] = [];

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed.push(name);
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } catch (err) {
    failed.push(name);
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- Stub DIGIT ----------------------------------------------------------

/**
 * Token -> identity. The MCP server introspects against `/user/_details`, so
 * this is the whole of "who is the caller" as far as it is concerned.
 */
const IDENTITIES: Record<string, { userName: string; tenantId: string; roles: string[] }> = {
  'tok-admin':   { userName: 'admin-1',   tenantId: 'pg',       roles: ['SUPERUSER'] },
  'tok-emp':     { userName: 'gro-1',     tenantId: 'pg.citya', roles: ['GRO', 'PGR_LME'] },
  'tok-citizen': { userName: 'citizen-1', tenantId: 'pg',       roles: ['CITIZEN'] },
  // A self-registered citizen carries type EMPLOYEE (pgr_create provisions
  // them that way) but only the CITIZEN role — the case that makes keying on
  // user.type instead of roles a privilege bug.
  'tok-provisioned': { userName: 'prov-1', tenantId: 'pg', roles: ['CITIZEN'] },
};

/** Flipped by the outage test to make the stub fail like a downed egov-user. */
let stubOutage = false;

function startStubDigit(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://stub');
      if (url.pathname === '/user/_details') {
        if (stubOutage) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end('{"error":"upstream unavailable"}');
          return;
        }
        const token = url.searchParams.get('access_token') || '';
        const id = IDENTITIES[token];
        if (!id) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ Errors: [{ code: 'InvalidAccessTokenException' }] }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          UserRequest: {
            userName: id.userName,
            name: id.userName,
            tenantId: id.tenantId,
            type: token === 'tok-provisioned' ? 'EMPLOYEE' : undefined,
            roles: id.roles.map((code) => ({ code, name: code, tenantId: id.tenantId })),
          },
        }));
        return;
      }
      if (url.pathname === '/user/oauth/token') {
        // body.auth -> digitApi.login(). Any username maps to the admin
        // identity; the point under test is that the path still works and is
        // still authorized, not the credential check itself.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: 'tok-admin',
          UserRequest: {
            userName: 'admin-1', name: 'admin-1', tenantId: 'pg',
            roles: [{ code: 'SUPERUSER', name: 'SUPERUSER', tenantId: 'pg' }],
          },
        }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

/** Reserve an ephemeral port, then free it for the server under test. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

// --- Harness -------------------------------------------------------------

const dataDir = mkdtempSync(join(tmpdir(), 'mcp-http-test-'));
const logFile = join(dataDir, 'access.log');
const stub = await startStubDigit();
const port = await freePort();
const base = `http://127.0.0.1:${port}`;

const child: ChildProcess = spawn('node', ['dist/index.js'], {
  env: {
    ...process.env,
    MCP_TRANSPORT: 'http',
    MCP_PORT: String(port),
    MCP_AUTH_MODE: '',              // exercise the transport-derived default
    CRS_API_URL: `http://127.0.0.1:${stub.port}`,
    CRS_ENVIRONMENT: 'self-hosted',
    // Present on purpose: this is the configuration in which an anonymous
    // caller used to be elevated to the container's stored ADMIN.
    CRS_USERNAME: 'ADMIN',
    CRS_PASSWORD: 'secret',
    SESSION_DATA_DIR: dataDir,
    MCP_LOG_FILE: logFile,
    MCP_ARTIFACT_DIR: join(dataDir, 'artifacts'),
    MCP_CORS_ORIGINS: '*',
    TELEMETRY: 'false',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});

let serverStderr = '';
child.stderr?.on('data', (c: Buffer) => { serverStderr += c.toString(); });

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start.\n${serverStderr}`);
}

function cleanup(): void {
  child.kill('SIGKILL');
  stub.server.close();
  rmSync(dataDir, { recursive: true, force: true });
}

process.on('exit', cleanup);

await waitForServer();

// --- Helpers -------------------------------------------------------------

interface Res { status: number; body: string; json: Record<string, unknown> }

async function call(path: string, opts: { token?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  const res = await fetch(`${base}${path}`, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(body); } catch { /* non-JSON */ }
  return { status: res.status, body, json };
}

/** Invoke an MCP tool over JSON-RPC and return the decoded tool payload. */
async function mcpTool(tool: string, token?: string, args: Record<string, unknown> = {}): Promise<Res> {
  const res = await call('/mcp', {
    token,
    headers: { Accept: 'application/json, text/event-stream' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } },
  });
  if (res.status !== 200) return res;
  // Stateless transport replies as SSE; pull the JSON-RPC frame out of it.
  const frame = res.body.includes('data: ') ? res.body.split('data: ').pop()!.trim() : res.body;
  try {
    const rpc = JSON.parse(frame);
    const text = rpc?.result?.content?.[0]?.text;
    return { status: 200, body: text ?? frame, json: text ? JSON.parse(text) : rpc };
  } catch {
    return res;
  }
}

// =========================================================================
console.log('\n\x1b[1mA. Anonymous reachability\x1b[0m');
// =========================================================================
// CRS_USERNAME/CRS_PASSWORD are set in this server's env. Before the fix, that
// is exactly what made an unauthenticated caller act as ADMIN.

await test('A.1 /healthz is open (orchestrator liveness, gatus)', async () => {
  assert.equal((await call('/healthz')).status, 200);
});

await test('A.2 anonymous /mcp is refused', async () => {
  const r = await call('/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  assert.equal(r.status, 401);
});

await test('A.3 anonymous /v1/* is refused (no env-credential fallback)', async () => {
  for (const [path, body] of [
    ['/v1/tools', undefined],
    ['/v1/tools/discover_tools', {}],
    ['/v1/tools/discover_tools/bulk', { items: [{}] }],
    ['/v1/tenant/bootstrap', { target_tenant: 'x' }],
    ['/v1/tenant/cleanup', { tenant_id: 'pg.x' }],
    ['/v1/tenant/x/export', {}],
  ] as const) {
    const r = await call(path, body ? { body } : {});
    assert.equal(r.status, 401, `${path} returned ${r.status}, expected 401`);
  }
});

await test('A.4 anonymous /api/* is refused', async () => {
  for (const path of ['/api/stats', '/api/sessions', '/api/pgr/dashboard']) {
    assert.equal((await call(path)).status, 401, path);
  }
});

await test('A.5 an unrecognised bearer token is refused everywhere', async () => {
  for (const path of ['/api/stats', '/v1/tools']) {
    const r = await call(path, { token: 'not-a-real-token' });
    assert.equal(r.status, 401, path);
  }
  const rpc = await call('/mcp', { token: 'not-a-real-token', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  assert.equal(rpc.status, 401);
});

await test('A.6 CORS preflight is answered without credentials', async () => {
  // A preflight never carries Authorization. Gating it 401s the preflight and
  // the real request is never sent, silently breaking cross-origin clients.
  for (const path of ['/api/stats', '/v1/tools', '/mcp']) {
    const r = await call(path, {
      method: 'OPTIONS',
      headers: { Origin: 'http://dash.test', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(r.status, 204, `${path} preflight returned ${r.status}`);
  }
});

// =========================================================================
console.log('\n\x1b[1mB. Tier enforcement on the MCP path\x1b[0m');
// =========================================================================

await test('B.1 a citizen is refused an employee-tier tool', async () => {
  const r = await mcpTool('user_search', 'tok-citizen', { tenant_id: 'pg' });
  assert.equal(r.json.code, 403, `expected 403, got ${JSON.stringify(r.json).slice(0, 120)}`);
  assert.equal(r.json.category, 'auth');
});

await test('B.2 an employee is refused an admin-tier tool', async () => {
  const r = await mcpTool('tenant_cleanup', 'tok-emp', { tenant_id: 'pg.x' });
  assert.equal(r.json.code, 403);
  assert.match(String(r.json.error), /SUPERUSER/);
});

await test('B.3 an admin passes the admin tier (reaches the handler)', async () => {
  const r = await mcpTool('get_environment_info', 'tok-admin');
  assert.notEqual(r.json.code, 403);
  assert.equal(r.json.success, true);
});

await test('B.4 a public tool is reachable by a citizen', async () => {
  const r = await mcpTool('discover_tools', 'tok-citizen');
  assert.notEqual(r.json.code, 403, 'public tier must not require a role');
});

await test('B.5 type=EMPLOYEE with only the CITIZEN role is still a citizen', async () => {
  // Regression guard for keying on user.type instead of roles.
  const r = await mcpTool('user_search', 'tok-provisioned', { tenant_id: 'pg' });
  assert.equal(r.json.code, 403, 'a provisioned citizen must not reach staff tooling');
});

// =========================================================================
console.log('\n\x1b[1mC. Tier enforcement on the REST paths\x1b[0m');
// =========================================================================

await test('C.1 single dispatch authorizes', async () => {
  const r = await call('/v1/tools/tenant_cleanup', { token: 'tok-emp', body: { tenant_id: 'pg.x' } });
  assert.equal(r.status, 403);
});

await test('C.2 bulk dispatch authorizes', async () => {
  const r = await call('/v1/tools/tenant_cleanup/bulk', {
    token: 'tok-emp',
    body: { items: [{ tenant_id: 'pg.x' }] },
  });
  assert.equal(r.status, 403, `bulk returned ${r.status}`);
});

await test('C.3 streamed dispatch authorizes BEFORE committing 200', async () => {
  // A denial must be a real 403, not a 200 stream carrying `event: error` —
  // any client keying on the status code reads the latter as success.
  const res = await fetch(`${base}/v1/tenant/bootstrap?stream=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: 'Bearer tok-emp' },
    body: JSON.stringify({ target_tenant: 'x' }),
  });
  assert.equal(res.status, 403, `SSE denial returned ${res.status}`);
  assert.match(await res.text(), /requires one of these roles/);
});

await test('C.7 an unknown tool is not distinguishable before authenticating', async () => {
  // 404-for-unknown vs 401-for-known let an anonymous caller enumerate the
  // whole tool surface by diffing status codes.
  const known = await call('/v1/tools/tenant_cleanup', { body: {} });
  const unknown = await call('/v1/tools/no_such_tool_xyz', { body: {} });
  assert.equal(known.status, 401);
  assert.equal(unknown.status, 401, 'an unknown tool leaked a distinguishable 404');
});

await test('C.8 /v1/version withholds build detail from anonymous callers', async () => {
  const anon = await call('/v1/version');
  assert.equal(anon.status, 200, 'must stay usable as a liveness probe');
  assert.equal(anon.json.gitSha, undefined, 'build metadata leaked');
  assert.equal(anon.json.nodeVersion, undefined, 'runtime version leaked');
  const authed = await call('/v1/version', { token: 'tok-admin' });
  assert.ok('nodeVersion' in authed.json, 'an authenticated caller should still see it');
});

await test('C.4 tenant export authorizes (not a registered tool)', async () => {
  const r = await call('/v1/tenant/pg/export', { token: 'tok-emp', body: {} });
  assert.equal(r.status, 403);
});

await test('C.5 a citizen is refused an employee-tier tool over REST', async () => {
  const r = await call('/v1/tools/user_search', { token: 'tok-citizen', body: { tenant_id: 'pg' } });
  assert.equal(r.status, 403);
});

await test('C.6 body.auth (Form 2) still authenticates and is authorized', async () => {
  // The Ansible playbook drives /v1/tenant/bootstrap with an `auth` envelope
  // rather than a header (local-setup/ansible/playbook-deploy.yml). Token mode
  // must not break that path — it supplies real credentials, so it stays.
  const r = await call('/v1/tools/get_environment_info', {
    body: { auth: { username: 'ADMIN', password: 'eGov@123', tenant_id: 'pg' } },
  });
  assert.equal(r.status, 200, `Form 2 returned ${r.status}: ${r.body.slice(0, 120)}`);
});

// =========================================================================
console.log('\n\x1b[1mD. The /api/* gate\x1b[0m');
// =========================================================================

await test('D.1 a citizen is refused (admin tier)', async () => {
  const r = await call('/api/sessions', { token: 'tok-citizen' });
  assert.equal(r.status, 403);
});

await test('D.2 an employee is refused (admin tier)', async () => {
  assert.equal((await call('/api/stats', { token: 'tok-emp' })).status, 403);
});

await test('D.3 an admin is admitted', async () => {
  const r = await call('/api/stats', { token: 'tok-admin' });
  assert.equal(r.status, 200);
});

await test('D.4 the gate covers the whole namespace, not listed routes', async () => {
  // A route added later must be authenticated by default.
  for (const path of ['/api/sessions', '/api/sessions/00000000-0000-0000-0000-000000000000/events', '/api/pgr/dashboard']) {
    assert.equal((await call(path, { token: 'tok-citizen' })).status, 403, path);
  }
});

// =========================================================================
console.log('\n\x1b[1mE. Error mapping and audit\x1b[0m');
// =========================================================================

await test('E.1 a tier denial is logged as tool_denied', async () => {
  await mcpTool('tenant_cleanup', 'tok-emp', { tenant_id: 'pg.x' });
  assert.match(readFileSync(logFile, 'utf-8'), /"event":"tool_denied"/);
});

await test('E.2 an /api/* denial is logged as api_denied', async () => {
  await call('/api/stats', { token: 'tok-emp' });
  assert.match(readFileSync(logFile, 'utf-8'), /"event":"api_denied"/);
});

await test('E.3 REST tool calls are audited, not just denials', async () => {
  // server.ts wraps the MCP path in mcpLogger/sessionStore; the REST paths
  // called tool.handler() directly, so every successful /v1/* invocation —
  // tenant_destroy included — left no trace at all.
  await call('/v1/tools/discover_tools', { token: 'tok-admin', body: {} });
  const log = readFileSync(logFile, 'utf-8');
  assert.match(log, /"event":"tool_call".*"tool":"discover_tools"/, 'no tool_call recorded for the REST invocation');
  assert.match(log, /"event":"tool_result".*"tool":"discover_tools"/, 'no tool_result recorded');
});

await test('E.4 credentials are redacted in the audit log', async () => {
  await call('/v1/tools/discover_tools', {
    token: 'tok-admin',
    body: { auth: { username: 'u', password: 'sup3rs3cret' }, nested: { apiKey: 'k3y' } },
  });
  const log = readFileSync(logFile, 'utf-8');
  assert.ok(!log.includes('sup3rs3cret'), 'password reached the access log');
  assert.ok(!log.includes('k3y'), 'apiKey reached the access log');
});

await test('E.5 the audit line carries the resolved caller, not a spoofed IP', async () => {
  await call('/v1/tools/discover_tools', {
    token: 'tok-admin',
    body: {},
    headers: { 'X-Forwarded-For': '9.9.9.9' },
  });
  const log = readFileSync(logFile, 'utf-8');
  assert.match(log, /"event":"untrusted_forwarded_for"|"user":"admin-1"/,
    'expected the caller identity or an untrusted-XFF note');
  const toolLines = log.split('\n').filter((l) => l.includes('"event":"tool_call"'));
  assert.ok(!toolLines.some((l) => l.includes('9.9.9.9')), 'a spoofed X-Forwarded-For reached the audit trail');
});

await test('E.6 an identity-service outage is 503, not "invalid token"', async () => {
  // A 5xx or an unreachable egov-user reported as 401 sends the operator after
  // credentials while the platform is down — and makes the viewer discard a
  // perfectly good token, forcing a re-login across the fleet.
  stubOutage = true;
  try {
    // A token the cache has not seen, so it must go to the wire.
    const r = await call('/api/stats', { token: 'tok-never-seen-before' });
    assert.equal(r.status, 503, `expected 503, got ${r.status}: ${r.body.slice(0, 120)}`);
    assert.match(String(r.json.error), /not a problem with your credentials/);
  } finally {
    stubOutage = false;
  }
});

// =========================================================================
console.log('\n\x1b[1mF. Ambient mode is a deliberate opt-out\x1b[0m');
// =========================================================================

await test('F.1 the transport-derived default is token mode', async () => {
  // MCP_AUTH_MODE was passed empty, so this asserts the derivation itself —
  // an HTTP deployment is closed without any extra configuration.
  assert.equal((await call('/api/stats')).status, 401);
  assert.ok(!serverStderr.includes('MCP_AUTH_MODE=ambient'), 'ambient warning should not fire in token mode');
});

// --- Summary -------------------------------------------------------------

cleanup();

console.log('\n' + '='.repeat(60));
console.log(`  Results: ${passed.length} passed, ${failed.length} failed`);
if (failed.length > 0) console.log(`  Failed: ${failed.join(', ')}`);
console.log('='.repeat(60) + '\n');

process.exit(failed.length > 0 ? 1 : 0);
