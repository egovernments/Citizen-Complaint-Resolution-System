#!/usr/bin/env node
/**
 * test-runner daemon — the only write path behind the "Run tests" button.
 *
 * The dashboards are static files served by nginx; nothing in the browser can
 * start Playwright or write into the webroot. This tiny HTTP service does, and
 * NOTHING ELSE. It is deliberately dependency-free (Node core only) and bound
 * to loopback — nginx proxies `/tests/api/` to it WITH the existing
 * basic-auth (digit-tests / .htpasswd-tests), so auth is enforced by nginx, not
 * re-implemented here. The loopback bind + remote-addr guard below make sure the
 * daemon can't be reached around nginx.
 *
 * Endpoints (all relative to the proxied /tests/api/):
 *   POST /run            → 202 {run_id} | 409 {running, run_id}   (single-flight)
 *   GET  /run/current    → {state, run_id, started_at, phase, exit_code}
 *   GET  /run/:id/log    → text/plain, current contents of that run's run.log
 *   GET  /health         → {ok:true}
 *
 * A run is ~1h, so POST returns immediately and the dashboard polls /run/current.
 * The actual run/catalog/publish lives in run-cycle.sh (a thin lift of the
 * Makefile + publish.sh, local-copy instead of ssh). flock there is the
 * cross-process single-flight; the in-memory `current` below is the fast path.
 *
 * Config (env):
 *   RUNNER_PORT        listen port on 127.0.0.1            (default 8181)
 *   RUNNER_REPO_DIR    vendored tests/integration-tests    (default: parent of this file)
 *   RUNNER_WEBROOT     served dir holding catalog.json/runs (default /var/www/integration-tests)
 *   RUNNER_TENANT_ENV  env file sourced by the job (BASE_URL, DIGIT_TENANT, …)  (optional)
 *   RUNNER_RUN_LIMIT   keep at most this many runs          (default 5)
 *   RUNNER_BRANCH      branch the job reports in the catalog (default "deployed")
 */
import { createServer } from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, createReadStream, existsSync, readFileSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.RUNNER_PORT || '8181', 10);
const REPO_DIR = process.env.RUNNER_REPO_DIR || join(HERE, '..');
const WEBROOT = process.env.RUNNER_WEBROOT || '/var/www/integration-tests';
const TENANT_ENV = process.env.RUNNER_TENANT_ENV || '';
const RUN_LIMIT = process.env.RUNNER_RUN_LIMIT || '5';
const BRANCH = process.env.RUNNER_BRANCH || 'deployed';
const JOB = process.env.RUNNER_JOB || join(HERE, 'run-cycle.sh'); // overridable for tests/custom cycles

/** In-memory single-flight state. Resets to idle on daemon restart (an orphaned
 *  job keeps the flock, so a POST after restart still 409s correctly). */
let current = null; // { run_id, started_at, child }
let lastExit = null; // { run_id, exit_code, finished_at }

function shortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO_DIR }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function mintRunId() {
  // 2026-06-04_1430_a1b2c3d — matches the Makefile/publish.sh convention.
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp =
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `_${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  return `${stamp}_${shortSha()}`;
}

function phaseOf(runId) {
  const f = join(WEBROOT, 'runs', runId, 'phase');
  try {
    return existsSync(f) ? readFileSync(f, 'utf8').trim() : null;
  } catch {
    return null;
  }
}

function startRun() {
  const runId = mintRunId();
  const runDir = join(WEBROOT, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const logPath = join(runDir, 'run.log');
  const out = openSync(logPath, 'a'); // append: daemon owns run.log, the job copies artifacts in around it

  const child = spawn('bash', [JOB], {
    cwd: REPO_DIR,
    env: {
      ...process.env,
      RUN_ID: runId,
      REPO_DIR,
      WEBROOT,
      TENANT_ENV,
      RUN_LIMIT,
      BRANCH,
    },
    stdio: ['ignore', out, out],
    detached: false,
  });
  const started_at = new Date().toISOString();
  current = { run_id: runId, started_at, child };
  child.on('exit', (code) => {
    lastExit = { run_id: runId, exit_code: code, finished_at: new Date().toISOString() };
    current = null;
  });
  return { run_id: runId, started_at };
}

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(s);
}

const server = createServer((req, res) => {
  // Defense in depth: only ever answer loopback. nginx proxies from 127.0.0.1.
  const ra = req.socket.remoteAddress || '';
  if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1')) {
    return json(res, 403, { error: 'loopback only' });
  }

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && path === '/health') {
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && path === '/run') {
    if (current) {
      return json(res, 409, { running: true, run_id: current.run_id, started_at: current.started_at });
    }
    try {
      const { run_id, started_at } = startRun();
      return json(res, 202, { run_id, started_at });
    } catch (e) {
      return json(res, 500, { error: String(e && e.message ? e.message : e) });
    }
  }

  if (req.method === 'GET' && path === '/run/current') {
    if (current) {
      return json(res, 200, {
        state: 'running',
        run_id: current.run_id,
        started_at: current.started_at,
        phase: phaseOf(current.run_id),
      });
    }
    return json(res, 200, { state: 'idle', ...(lastExit || {}) });
  }

  const m = path.match(/^\/run\/([^/]+)\/log$/);
  if (req.method === 'GET' && m) {
    const runId = decodeURIComponent(m[1]);
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) return json(res, 400, { error: 'bad run id' });
    const logPath = join(WEBROOT, 'runs', runId, 'run.log');
    if (!existsSync(logPath)) return json(res, 404, { error: 'no log' });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return createReadStream(logPath).pipe(res);
  }

  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[test-runner] listening on 127.0.0.1:${PORT} repo=${REPO_DIR} webroot=${WEBROOT}`);
});
