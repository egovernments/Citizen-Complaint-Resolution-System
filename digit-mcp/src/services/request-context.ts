import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request identity for the audit trail.
 *
 * The logger and the session store both record who made a call. They used to
 * keep that as instance fields set once per HTTP request, which is correct for
 * stdio (one owner, one request at a time) but not for the HTTP transport:
 * with two `/mcp` requests in flight, whichever arrived last owned the fields,
 * so request A's tool calls could be logged under request B's IP.
 *
 * This is the same fix as `runWithIsolatedClient` in digit-api.ts, applied to
 * the other piece of per-request state — and it matters for the same reason
 * N3 (untrusted X-Forwarded-For) does: an audit trail that attributes calls to
 * the wrong caller under load is not an audit trail.
 *
 * Outside a request scope (stdio, CLI, tests) the store is empty and callers
 * fall back to their own defaults.
 */
export interface RequestContext {
  ip: string;
  userAgent: string;
  /** userName of the validated caller, when the route authenticated one. */
  userName?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `context` visible to everything it awaits. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

/** The active request's context, or undefined outside any request scope. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Attach the validated caller to the active context, if there is one.
 * No-op under stdio, where there is no per-request scope to attach to.
 */
export function setContextUser(userName: string | undefined): void {
  const ctx = storage.getStore();
  if (ctx && userName) ctx.userName = userName;
}
