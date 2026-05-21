#!/usr/bin/env node
import { createServer } from './server.js';
import { mcpLogger } from './logger.js';
import { sessionStore } from './services/session-store.js';
import { db } from './services/db.js';
import { digitDb } from './services/digit-db.js';
import { handlePgrDashboard } from './api/pgr-dashboard.js';
import { ToolRegistry } from './tools/registry.js';
import { registerAllTools } from './tools/index.js';
import { ALL_GROUPS } from './types/index.js';
import { digitApi } from './services/digit-api.js';
import { setProgressEmitter, type ProgressEvent } from './services/progress.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const transportMode = process.env.MCP_TRANSPORT === 'http' ? 'http' : 'stdio';

if (transportMode === 'stdio') {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const enableAll = process.env.MCP_ENABLE_ALL_GROUPS === '1' || process.env.MCP_ENABLE_ALL_GROUPS === 'true';
  const server = createServer(enableAll ? { enableAllGroups: true } : undefined);
  const transport = new StdioServerTransport();
  await sessionStore.ensureSession('stdio');
  server.connect(transport).catch(console.error);
} else {
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const http = await import('node:http');

  const port = parseInt(process.env.MCP_PORT || '3000', 10);

  // --- Static file serving setup ---
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  const UI_DIR = resolve(join(__dirname, '..', 'ui'));

  const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };

  function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  function parseQuery(url: string): Record<string, string> {
    const idx = url.indexOf('?');
    if (idx === -1) return {};
    const params: Record<string, string> = {};
    for (const part of url.slice(idx + 1).split('&')) {
      const [k, v] = part.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
    return params;
  }

  async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
    let filePath = urlPath === '/' ? '/index.html' : urlPath;
    const resolved = resolve(join(UI_DIR, filePath));

    // Path traversal protection
    if (!resolved.startsWith(UI_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    try {
      const info = await stat(resolved);
      if (!info.isFile()) throw new Error('Not a file');

      const ext = extname(resolved);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = await readFile(resolved);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  }

  // Initialize DBs for API endpoints (best-effort, graceful degradation)
  await db.initialize();
  await digitDb.initialize();

  // --- REST shim registry ---
  // A long-lived ToolRegistry shared by every /v1/* call. The MCP /mcp
  // handler builds a fresh server per request for horizontal scaling,
  // but the REST shim is stateless against the registry — we register
  // once at startup and dispatch directly to the tool handler.
  const restRegistry = new ToolRegistry();
  registerAllTools(restRegistry);
  restRegistry.enableGroups(ALL_GROUPS);

  // The DigitApiClient is a process-level singleton, so REST calls must
  // be serialized while we swap its auth state. For an admin-only
  // bootstrap endpoint this is fine; high-concurrency callers should
  // talk to the regular DIGIT APIs directly.
  let restMutex: Promise<void> = Promise.resolve();
  async function withRestLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = restMutex;
    let release!: () => void;
    restMutex = new Promise<void>((res) => { release = res; });
    await prev;
    try { return await fn(); } finally { release(); }
  }

  /**
   * Authenticate the caller. Accepted forms:
   *   1. Authorization: Bearer <token>            — token already minted upstream
   *   2. body.auth = { username, password, tenant_id }  — OAuth login first
   * Returns null when no auth was supplied (caller should 401), or an
   * error message string when the supplied creds were rejected.
   */
  async function authenticateRest(
    req: IncomingMessage,
    body: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; status: number; error: string } | null> {
    const authHeader = (req.headers['authorization'] || req.headers['Authorization']) as string | undefined;

    // Form 1: Authorization: Bearer <token>
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!token) return { ok: false, status: 401, error: 'Empty bearer token' };
      // We don't have userInfo from the token alone; the caller can pass
      // the state tenant via X-State-Tenant header so MDMS calls resolve.
      const stateTenant = (req.headers['x-state-tenant'] as string | undefined) || null;
      digitApi.applyToken(token, null, stateTenant);
      return { ok: true };
    }

    // Form 2: body.auth = { username, password, tenant_id }
    const auth = body.auth as Record<string, string> | undefined;
    if (auth && auth.username && auth.password && auth.tenant_id) {
      try {
        await digitApi.login(auth.username, auth.password, auth.tenant_id);
        return { ok: true };
      } catch (err) {
        return { ok: false, status: 401, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // Form 3: fall back to CRS_USERNAME / CRS_PASSWORD env vars if present.
    // This mirrors the JSON-RPC path's ensureAuthenticated() so REST callers
    // running on the same MCP container don't have to repeat the creds in
    // every body. Skipped if the env isn't configured — caller still gets 401.
    const envUser = process.env.CRS_USERNAME;
    const envPass = process.env.CRS_PASSWORD;
    if (envUser && envPass) {
      const envTenant = process.env.CRS_TENANT_ID || digitApi.getEnvironmentInfo().stateTenantId;
      try {
        if (!digitApi.isAuthenticated()) {
          await digitApi.login(envUser, envPass, envTenant);
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, status: 401, error: `env auth failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    return null; // caller will translate to 401
  }

  // Map known low-level Spring / DIGIT errors to human-friendly explanations
  // before forwarding to the caller. The wire still includes the raw message
  // under `error.raw` so client logs aren't lossy.
  const ERROR_HINTS: Array<{ test: RegExp; rewrite: (raw: string) => string; code?: string }> = [
    {
      test: /Pattern\.createUserRequest\.user\.tenantId.*\^?\[a-zA-Z\. \]/,
      rewrite: () => 'Tenant id must contain only letters, dots and spaces (no digits or other characters). egov-user rejects timestamp-suffixed tenant names.',
      code: 'INVALID_TENANT_ID',
    },
    {
      test: /SCHEMA_DEFINITION_NOT_FOUND_ERR|Schema definition against which data is being created is not found/,
      rewrite: () => 'MDMS schema definition is not yet available on the target tenant (Kafka persistence lag). The server retried automatically; if you still see this, run tenant_bootstrap to ensure the schema is copied first.',
      code: 'SCHEMA_NOT_READY',
    },
    {
      test: /INVALID_ROLE|Unable to validate role from MDMS/,
      rewrite: () => 'Role code is not registered in ACCESSCONTROL-ROLES.roles for this tenant. Run tenant_bootstrap so role definitions are copied, or add the role via mdms_create.',
      code: 'ROLE_NOT_REGISTERED',
    },
    {
      test: /DuplicateUserName|Duplicate record|DUPLICATE/i,
      rewrite: (raw) => `A record with this identifier already exists on the tenant. Original: ${raw.slice(0, 120)}`,
      code: 'DUPLICATE',
    },
  ];

  function normalizeError(raw: string): { error: string; raw: string; code?: string } {
    for (const h of ERROR_HINTS) {
      if (h.test.test(raw)) {
        return { error: h.rewrite(raw), raw, code: h.code };
      }
    }
    return { error: raw, raw };
  }

  async function dispatchTool(
    toolName: string,
    args: Record<string, unknown>,
    req: IncomingMessage,
    progressCb?: (event: ProgressEvent) => void,
  ): Promise<{ status: number; body: unknown }> {
    const tool = restRegistry.getTool(toolName);
    if (!tool) {
      return { status: 404, body: { success: false, error: `Unknown tool: ${toolName}` } };
    }

    return withRestLock(async () => {
      const snap = digitApi.snapshotAuth();
      if (progressCb) setProgressEmitter(progressCb);
      try {
        const authResult = await authenticateRest(req, args);
        if (authResult === null) {
          return {
            status: 401,
            body: {
              success: false,
              error: 'Authentication required. Send Authorization: Bearer <token>, or body.auth = { username, password, tenant_id }.',
            },
          };
        }
        if (!authResult.ok) {
          return { status: authResult.status, body: { success: false, error: authResult.error } };
        }

        // Strip the auth envelope before forwarding the args to the tool,
        // so the tool's input schema validation doesn't trip on it.
        const { auth: _ignored, ...toolArgs } = args;
        void _ignored;

        const result = await tool.handler(toolArgs as Record<string, unknown>);
        let parsed: unknown;
        try { parsed = JSON.parse(result); } catch { parsed = { raw: result }; }
        return { status: 200, body: parsed };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const norm = normalizeError(msg);
        return { status: 500, body: { success: false, ...norm } };
      } finally {
        if (progressCb) setProgressEmitter(null);
        digitApi.restoreAuth(snap);
      }
    });
  }

  /**
   * Streaming dispatch (Server-Sent Events). Emits one SSE event per
   * progress emission from the underlying tool, then a final `done`
   * event with the structured tool result (or `error` event on failure).
   *
   * The HTTP status is 200 for the stream itself; consumers should
   * inspect the `done` event payload's `success` field.
   */
  async function runStreamed(
    toolName: string,
    args: Record<string, unknown>,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const tool = restRegistry.getTool(toolName);
    if (!tool) {
      jsonResponse(res, 404, { success: false, error: `Unknown tool: ${toolName}` });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const writeEvent = (name: string, payload: unknown) => {
      res.write(`event: ${name}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    // Heartbeat every 15s so proxies don't time the connection out.
    const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
    try {
      await withRestLock(async () => {
        const snap = digitApi.snapshotAuth();
        setProgressEmitter((e) => writeEvent('progress', e));
        try {
          const authResult = await authenticateRest(req, args);
          if (authResult === null) {
            writeEvent('error', { success: false, error: 'Authentication required.' });
            return;
          }
          if (!authResult.ok) {
            writeEvent('error', { success: false, error: authResult.error });
            return;
          }
          const { auth: _ignored, ...toolArgs } = args;
          void _ignored;
          const raw = await tool.handler(toolArgs as Record<string, unknown>);
          let parsed: unknown;
          try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
          writeEvent('done', parsed);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          writeEvent('error', { success: false, ...normalizeError(msg) });
        } finally {
          setProgressEmitter(null);
          digitApi.restoreAuth(snap);
        }
      });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }

  /**
   * Bulk dispatch — runs the same tool over an array of arg objects.
   * Authenticates once, then runs items with bounded concurrency under
   * the same REST mutex (so individual tool handlers still get a clean
   * digitApi singleton — they just share the auth context).
   */
  async function runBulk(
    toolName: string,
    items: Record<string, unknown>[],
    concurrency: number,
    auth: Record<string, string> | undefined,
    req: IncomingMessage,
  ): Promise<{ status: number; body: unknown }> {
    const tool = restRegistry.getTool(toolName);
    if (!tool) {
      return { status: 404, body: { success: false, error: `Unknown tool: ${toolName}` } };
    }
    const boundTool = tool;
    return withRestLock(async () => {
      const snap = digitApi.snapshotAuth();
      try {
        // Auth applies once for the whole batch — caller can put `auth` at
        // the top level instead of repeating it in every item.
        const authResult = await authenticateRest(req, auth ? { auth } : {});
        if (authResult === null) {
          return { status: 401, body: { success: false, error: 'Authentication required.' } };
        }
        if (!authResult.ok) {
          return { status: authResult.status, body: { success: false, error: authResult.error } };
        }

        type ItemResult = { ok: boolean; status: number; body: unknown };
        const results: ItemResult[] = new Array(items.length);
        let nextIdx = 0;

        async function worker(): Promise<void> {
          while (true) {
            const i = nextIdx++;
            if (i >= items.length) return;
            try {
              const raw = await boundTool.handler(items[i]);
              let parsed: unknown;
              try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
              const ok = !!(parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).success !== false);
              results[i] = { ok, status: 200, body: parsed };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              results[i] = { ok: false, status: 500, body: { success: false, ...normalizeError(msg) } };
            }
          }
        }

        const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
        await Promise.all(workers);

        const ok = results.filter((r) => r.ok).length;
        const failed = results.length - ok;
        return {
          status: 200,
          body: {
            success: failed === 0,
            tool: toolName,
            summary: { total: results.length, ok, failed, concurrency },
            results,
          },
        };
      } finally {
        digitApi.restoreAuth(snap);
      }
    });
  }

  /**
   * Tenant export — dumps a portable JSON bundle covering MDMS schema
   * definitions, MDMS data records, tenant.tenants + tenant.citymodule,
   * and workflow business services. Callers can pass an explicit schema
   * allow-list; default is "everything the schema search returns".
   *
   * The output is the same shape that tenant_bootstrap consumes
   * conceptually, so a future /v1/tenant/import endpoint can replay
   * one of these bundles into a sibling deployment.
   */
  async function exportTenant(
    target: string,
    schemas: string[] | undefined,
    limit: number | undefined,
  ): Promise<Record<string, unknown>> {
    const pageLimit = Math.min(Math.max(limit ?? 500, 1), 2000);
    const schemaDefs = await digitApi.mdmsSchemaSearch(target);
    const codes = schemas && schemas.length ? schemas : schemaDefs.map((s) => s.code as string);
    const data: Record<string, unknown[]> = {};
    for (const code of codes) {
      try {
        const rows = await digitApi.mdmsV2SearchRaw(target, code, { limit: pageLimit });
        if (rows.length > 0) data[code] = rows;
      } catch {
        // skip schemas that error (e.g. missing on target) — keeps the bundle
        // representative of what's actually queryable.
      }
    }
    // Workflow business services for this tenant
    let workflow: unknown = null;
    try {
      workflow = await digitApi.workflowBusinessServiceSearch(target, ['PGR']);
    } catch { /* skip if workflow API unreachable */ }

    return {
      exportedAt: new Date().toISOString(),
      sourceTenant: target,
      schemaCount: schemaDefs.length,
      dataRowCount: Object.values(data).reduce((a, b) => a + b.length, 0),
      schemas: schemaDefs.map((s) => ({ code: s.code, description: s.description, definition: s.definition })),
      data,
      workflow,
    };
  }

  // CORS: read MCP_CORS_ORIGINS env (comma-separated). Supports literal
  // origins ("https://configurator.digit.org") and wildcards ("*.digit.org",
  // "*"). Empty/unset → CORS disabled (callers must use same-origin).
  const corsPatterns = (process.env.MCP_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  function corsAllow(origin: string | undefined): string | null {
    if (!origin) return null;
    for (const p of corsPatterns) {
      if (p === '*') return origin;
      if (p === origin) return origin;
      if (p.startsWith('*.')) {
        const suffix = p.slice(1); // ".digit.org"
        if (origin.endsWith(suffix)) return origin;
      }
    }
    return null;
  }
  function applyCors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin as string | undefined;
    const allowed = corsAllow(origin);
    if (!allowed) return;
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-State-Tenant, Accept');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  // --- HTTP server ---

  const httpServer = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '';
    const pathname = url.split('?')[0];

    // Apply CORS on every response that goes through this server. Preflight
    // OPTIONS requests are short-circuited here with a 204 so the configurator
    // can call /v1/* from a different origin without extra ops setup
    // (assuming MCP_CORS_ORIGINS is configured).
    applyCors(req, res);
    if (req.method === 'OPTIONS' && pathname.startsWith('/v1/')) {
      res.writeHead(204).end();
      return;
    }

    // Health check endpoint (used by K8s probes) — don't log
    if (req.method === 'GET' && (pathname === '/healthz' || pathname === '/v1/healthz')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', transport: 'http', timestamp: new Date().toISOString() }));
      return;
    }

    // --- REST shim: friendly endpoints over the existing MCP tools ---
    // Frontends can hit these directly instead of speaking JSON-RPC at /mcp.
    // Tool input schemas + structured results live in src/tools/mdms-tenant.ts.

    // GET /v1/version — server identity + build metadata. Lets the frontend
    // verify the deployed MCP has a known fix.
    if (req.method === 'GET' && pathname === '/v1/version') {
      jsonResponse(res, 200, {
        service: 'digit-mcp',
        version: process.env.MCP_VERSION || '1.0.0',
        gitSha: process.env.MCP_GIT_SHA || null,
        buildTime: process.env.MCP_BUILD_TIME || null,
        nodeVersion: process.version,
        startedAt: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
        uptimeSec: Math.floor(process.uptime()),
        features: ['v1/tenant/bootstrap', 'v1/tenant/city', 'v1/tenant/cleanup', 'v1/tenant/:id/export', 'v1/tools/:name', 'v1/tools/:name/bulk', 'sse-progress', 'cors'],
      });
      return;
    }

    // POST /v1/tenant/bootstrap — copy all schemas + essential data + workflow
    // + ADMIN user from `source_tenant` (default "pg") to `target_tenant`.
    // Body: { "target_tenant": "ke", "source_tenant"?: "pg",
    //         "auth"?: { "username", "password", "tenant_id" } }
    // OR Authorization: Bearer <token>
    //
    // Set Accept: text/event-stream (or ?stream=1) to receive per-phase
    // Server-Sent Events as the bootstrap runs. The final event is named
    // "done" and carries the full structured result; on error the final
    // event is named "error".
    if (req.method === 'POST' && pathname === '/v1/tenant/bootstrap') {
      try {
        const body = JSON.parse(await readBody(req));
        if (!body.target_tenant) {
          jsonResponse(res, 400, { success: false, error: 'target_tenant is required' });
          return;
        }
        const accept = String(req.headers.accept || '');
        const wantsStream = /text\/event-stream/.test(accept) || /[?&]stream=1\b/.test(url);
        if (wantsStream) {
          await runStreamed('tenant_bootstrap', body, req, res);
          return;
        }
        const result = await dispatchTool('tenant_bootstrap', body, req);
        jsonResponse(res, result.status, result.body);
      } catch (err) {
        jsonResponse(res, 400, { success: false, error: String(err) });
      }
      return;
    }

    // POST /v1/tenant/city — create a city tenant under an already-bootstrapped root.
    // Body: { "tenant_id": "ke.nairobi", "display_name"?: "Nairobi" }
    if (req.method === 'POST' && pathname === '/v1/tenant/city') {
      try {
        const body = JSON.parse(await readBody(req));
        if (!body.tenant_id) {
          jsonResponse(res, 400, { success: false, error: 'tenant_id is required' });
          return;
        }
        const accept = String(req.headers.accept || '');
        const wantsStream = /text\/event-stream/.test(accept) || /[?&]stream=1\b/.test(url);
        if (wantsStream) {
          await runStreamed('city_setup', body, req, res);
          return;
        }
        const result = await dispatchTool('city_setup', body, req);
        jsonResponse(res, result.status, result.body);
      } catch (err) {
        jsonResponse(res, 400, { success: false, error: String(err) });
      }
      return;
    }

    // POST /v1/tenant/cleanup — first-class recovery endpoint that wraps the
    // tenant_cleanup tool. Use this to roll back a half-bootstrapped tenant
    // before retrying. Body: { "target_tenant": "…", optional cleanup flags }
    //
    // We accept either `target_tenant` (symmetric with /v1/tenant/bootstrap)
    // or the tool's native `tenant_id` field and forward the right one.
    //
    // Accept: text/event-stream (or ?stream=1) streams per-phase progress
    // (mdms search paging, deactivate batches, user pass) as SSE; final
    // event is `done` or `error`. Useful because full-tenant cleanups can
    // run minutes when there are thousands of MDMS records.
    if (req.method === 'POST' && pathname === '/v1/tenant/cleanup') {
      try {
        const body = JSON.parse(await readBody(req));
        const tenantId = body.tenant_id || body.target_tenant;
        if (!tenantId) {
          jsonResponse(res, 400, { success: false, error: 'tenant_id (or target_tenant) is required' });
          return;
        }
        const { target_tenant: _t, ...rest } = body;
        void _t;
        const toolArgs = { ...rest, tenant_id: tenantId };
        const accept = String(req.headers.accept || '');
        const wantsStream = /text\/event-stream/.test(accept) || /[?&]stream=1\b/.test(url);
        if (wantsStream) {
          await runStreamed('tenant_cleanup', toolArgs, req, res);
          return;
        }
        const result = await dispatchTool('tenant_cleanup', toolArgs, req);
        jsonResponse(res, result.status, result.body);
      } catch (err) {
        jsonResponse(res, 400, { success: false, error: String(err) });
      }
      return;
    }

    // POST /v1/tenant/:id/export — dump a tenant's MDMS data + workflow as a
    // portable JSON bundle. Useful for backup-before-migration or cloning to a
    // sibling deployment. Body: { "auth": …, "schemas"?: ["…"], "limit"?: 500 }
    const exportMatch = pathname.match(/^\/v1\/tenant\/([a-zA-Z][a-zA-Z0-9._-]*)\/export$/);
    if (req.method === 'POST' && exportMatch) {
      try {
        const targetTenant = exportMatch[1];
        const body = JSON.parse(await readBody(req) || '{}');
        await withRestLock(async () => {
          const snap = digitApi.snapshotAuth();
          try {
            const authResult = await authenticateRest(req, body);
            if (authResult === null) {
              jsonResponse(res, 401, { success: false, error: 'Authentication required.' });
              return;
            }
            if (!authResult.ok) {
              jsonResponse(res, authResult.status, { success: false, error: authResult.error });
              return;
            }
            const bundle = await exportTenant(targetTenant, body.schemas as string[] | undefined, body.limit as number | undefined);
            jsonResponse(res, 200, bundle);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            jsonResponse(res, 500, { success: false, ...normalizeError(msg) });
          } finally {
            digitApi.restoreAuth(snap);
          }
        });
      } catch (err) {
        jsonResponse(res, 400, { success: false, error: String(err) });
      }
      return;
    }

    // GET /v1/tools — list every REST-callable tool with its inputSchema,
    // so the frontend can render forms / build clients dynamically. Each
    // entry includes a `responseShape` hint when known.
    if (req.method === 'GET' && pathname === '/v1/tools') {
      jsonResponse(res, 200, {
        tools: restRegistry.getAllTools().map((t) => ({
          name: t.name,
          group: t.group,
          category: t.category,
          risk: t.risk,
          description: t.description,
          inputSchema: t.inputSchema,
          // Hint at the JSON envelope every handler returns. Tools can later
          // declare a tighter outputSchema; until then, every response is
          // `{ success: boolean, data?, error?, ... }`.
          responseShape: { type: 'object', properties: { success: { type: 'boolean' } } },
        })),
      });
      return;
    }

    // POST /v1/tools/:name/bulk — invoke a tool against a batch of arg objects.
    // Body: { "items": [ { …args… }, … ], "auth"?: {…}, "concurrency"?: 4 }
    // Auth applies to the whole batch (single login). Items run with bounded
    // parallelism. Response is an array of { ok, status, body, error }
    // entries in input order, plus a top-level summary.
    const bulkMatch = pathname.match(/^\/v1\/tools\/([a-z_][a-z0-9_]*)\/bulk$/i);
    if (req.method === 'POST' && bulkMatch) {
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const items = body.items;
        if (!Array.isArray(items) || items.length === 0) {
          jsonResponse(res, 400, { success: false, error: 'items must be a non-empty array' });
          return;
        }
        if (items.length > 1000) {
          jsonResponse(res, 400, { success: false, error: 'bulk size limited to 1000 items per call' });
          return;
        }
        const concurrency = Math.min(Math.max(parseInt(String(body.concurrency || 4), 10) || 4, 1), 16);
        const result = await runBulk(bulkMatch[1], items, concurrency, body.auth, req);
        jsonResponse(res, result.status, result.body);
      } catch (err) {
        jsonResponse(res, 400, { success: false, error: String(err) });
      }
      return;
    }

    // POST /v1/tools/:name — generic dispatcher for any registered tool.
    // Body is forwarded verbatim as the tool's args object.
    const toolMatch = pathname.match(/^\/v1\/tools\/([a-z_][a-z0-9_]*)$/i);
    if (req.method === 'POST' && toolMatch) {
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const result = await dispatchTool(toolMatch[1], body, req);
        jsonResponse(res, result.status, result.body);
      } catch (err) {
        jsonResponse(res, 400, { success: false, error: String(err) });
      }
      return;
    }

    // PGR Dashboard API
    if (req.method === 'GET' && pathname === '/api/pgr/dashboard') {
      await handlePgrDashboard(res, parseQuery(url));
      return;
    }

    // MCP endpoint — stateless mode for horizontal scaling
    if (pathname === '/mcp') {
      await sessionStore.ensureSession('http');
      const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress || '';
      const userAgent = req.headers['user-agent'] || '';
      const normalizedIp = String(clientIp).split(',')[0].trim();
      mcpLogger.setRequestContext(normalizedIp, userAgent);
      sessionStore.setHttpContext(String(userAgent), normalizedIp);

      const server = createServer({ enableAllGroups: true });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    // --- API endpoints ---

    if (req.method === 'GET' && pathname === '/api/stats') {
      if (!db.isHealthy()) {
        jsonResponse(res, 200, { error: 'Database not available', total_sessions: 0, total_tools: 0, total_errors: 0, total_checkpoints: 0 });
        return;
      }
      try {
        const rows = await db.query(
          `SELECT count(*) as total_sessions, coalesce(sum(tool_count),0) as total_tools,
                  coalesce(sum(error_count),0) as total_errors, coalesce(sum(checkpoint_count),0) as total_checkpoints
           FROM sessions`
        );
        const row = rows[0] || {};
        jsonResponse(res, 200, {
          total_sessions: parseInt(String(row.total_sessions || '0'), 10),
          total_tools: parseInt(String(row.total_tools || '0'), 10),
          total_errors: parseInt(String(row.total_errors || '0'), 10),
          total_checkpoints: parseInt(String(row.total_checkpoints || '0'), 10),
        });
      } catch (err) {
        jsonResponse(res, 200, { error: String(err), total_sessions: 0, total_tools: 0, total_errors: 0, total_checkpoints: 0 });
      }
      return;
    }

    // Events endpoint (must be before /api/sessions to avoid prefix match)
    const eventsMatch = pathname.match(/^\/api\/sessions\/([0-9a-f-]{36})\/events$/);
    if (req.method === 'GET' && eventsMatch) {
      const sessionId = eventsMatch[1];
      if (!db.isHealthy()) {
        jsonResponse(res, 200, { error: 'Database not available', session_id: sessionId, events: [] });
        return;
      }
      try {
        // Fetch session metadata
        const sessionRows = await db.query(
          `SELECT id, started_at, environment, transport, tool_count, checkpoint_count, error_count,
                  last_checkpoint_summary, updated_at, user_name, user_purpose,
                  client_name, user_agent, client_ip
           FROM sessions WHERE id = $1`,
          [sessionId]
        );
        const session = sessionRows[0] || null;

        const events = await db.query(
          `SELECT seq, ts, type, tool, args, duration_ms, is_error, result_summary,
                  error_message, summary, recent_tools
           FROM events WHERE session_id = $1
           ORDER BY seq ASC, CASE type WHEN 'tool_call' THEN 0 WHEN 'tool_result' THEN 1 WHEN 'checkpoint' THEN 2 END`,
          [sessionId]
        );

        const messages = await db.query(
          `SELECT turn, role, content, ts FROM messages WHERE session_id = $1 ORDER BY turn ASC`,
          [sessionId]
        );

        jsonResponse(res, 200, { session_id: sessionId, session, events, messages });
      } catch (err) {
        jsonResponse(res, 200, { error: String(err), session_id: sessionId, events: [] });
      }
      return;
    }

    // POST messages endpoint
    const messagesMatch = pathname.match(/^\/api\/sessions\/([0-9a-f-]{36})\/messages$/);
    if (req.method === 'POST' && messagesMatch) {
      const sessionId = messagesMatch[1];
      if (!db.isHealthy()) {
        jsonResponse(res, 503, { error: 'Database not available' });
        return;
      }
      try {
        const body = JSON.parse(await readBody(req));
        const messages = body.messages;
        if (!Array.isArray(messages)) {
          jsonResponse(res, 400, { error: 'messages must be an array' });
          return;
        }
        // Count tools and errors from message content blocks
        let toolCount = 0;
        let errorCount = 0;
        const toolSequence: string[] = [];
        for (const msg of messages) {
          const blocks = Array.isArray(msg.content) ? msg.content : [];
          for (const block of blocks) {
            if (block.type === 'tool_use') {
              toolCount++;
              const name = (block.name || '').replace(/^mcp__\w+__/, '');
              if (name) toolSequence.push(name);
            }
            if (block.type === 'tool_result' && block.is_error) {
              errorCount++;
            }
          }
        }

        // Auto-create session if it doesn't exist, otherwise update counters
        db.execute(
          `INSERT INTO sessions (id, started_at, environment, transport, tool_count, error_count, tool_sequence, updated_at)
           VALUES ($1, NOW(), $2, 'http', $3, $4, $5, NOW())
           ON CONFLICT (id) DO UPDATE SET
             tool_count = sessions.tool_count + $3,
             error_count = sessions.error_count + $4,
             tool_sequence = array_cat(sessions.tool_sequence, $5),
             updated_at = NOW()`,
          [sessionId, body.environment || 'agent-test', toolCount, errorCount, toolSequence]
        );

        for (const msg of messages) {
          db.execute(
            `INSERT INTO messages (session_id, turn, role, content, ts)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (session_id, turn) DO UPDATE SET role=EXCLUDED.role, content=EXCLUDED.content, ts=EXCLUDED.ts`,
            [sessionId, msg.turn, msg.role, JSON.stringify(msg.content)]
          );
        }
        jsonResponse(res, 200, { session_id: sessionId, inserted: messages.length, tools: toolCount });
      } catch (err) {
        jsonResponse(res, 400, { error: String(err) });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/sessions') {
      if (!db.isHealthy()) {
        jsonResponse(res, 200, { error: 'Database not available', sessions: [], total: 0, limit: 50, offset: 0 });
        return;
      }
      try {
        const q = parseQuery(url);
        const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 200);
        const offset = parseInt(q.offset || '0', 10) || 0;

        const countRows = await db.query('SELECT count(*) as total FROM sessions');
        const total = parseInt(String(countRows[0]?.total || '0'), 10);

        const sessions = await db.query(
          `SELECT id, started_at, environment, transport, tool_count, checkpoint_count,
                  error_count, last_checkpoint_summary, updated_at, user_name, user_purpose,
                  client_name, user_agent, client_ip
           FROM sessions ORDER BY started_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset]
        );
        jsonResponse(res, 200, { sessions, total, limit, offset });
      } catch (err) {
        jsonResponse(res, 200, { error: String(err), sessions: [], total: 0, limit: 50, offset: 0 });
      }
      return;
    }

    // --- Static file serving (fallback for non-API GETs) ---
    if (req.method === 'GET') {
      await serveStatic(res, pathname);
      return;
    }

    // --- 404 ---
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(port, '0.0.0.0', () => {
    mcpLogger.log({ event: 'startup', port, logPath: mcpLogger.logPath });
    console.error(`DIGIT MCP server listening on http://0.0.0.0:${port}/mcp`);
    console.error(`Session viewer: http://0.0.0.0:${port}/`);
    console.error(`Health check: http://0.0.0.0:${port}/healthz`);
    console.error(`Logging to: ${mcpLogger.logPath}`);
  });
}
