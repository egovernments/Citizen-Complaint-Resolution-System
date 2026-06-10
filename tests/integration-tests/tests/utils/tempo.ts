/**
 * Tempo helper — fetch traces from the VPC-only Tempo instance backing the
 * Bomet/Nairobi DIGIT deployments and shell-out to grep trace_ids out of the
 * pgr-services container logs.
 *
 * Tempo is reachable only over the Hetzner VPC at `http://10.0.0.2:13200`;
 * tests that depend on this helper must run from a host on that VPC (egov
 * dev box or one of the digit servers). Outside the VPC the fetch will fail
 * with ECONNREFUSED / ETIMEDOUT — the helpers throw clearly so the spec
 * surfaces "Tempo unreachable from this host" rather than a misleading
 * assertion failure.
 *
 * Trace IDs in pgr-services logs are emitted by the OTEL javaagent as the
 * MDC field `trace_id=<32-hex>` (OTLP standard). We grep the container's
 * stdout via `ssh egov-bomet docker logs` because the API server doesn't
 * expose pgr-services logs directly.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const TEMPO_URL = process.env.TEMPO_URL || 'http://10.0.0.2:13200';
export const BOMET_SSH_HOST = process.env.BOMET_SSH_HOST || 'egov-bomet';
export const PGR_CONTAINER = process.env.PGR_CONTAINER || 'digit-pgr-services-1';

/**
 * Tail pgr-services container logs on Bomet via SSH and extract the first
 * 32-hex OTEL trace_id from a line matching `substring`. Returns `null` if
 * no match is found.
 *
 * @param substring  case-sensitive grep token (e.g. a serviceRequestId + class name)
 * @param sinceISO   optional `--since` lower bound (ISO-8601 timestamp); defaults to last 10 minutes
 */
export async function extractTraceIdFromBometLogs(
  substring: string,
  sinceISO?: string,
): Promise<string | null> {
  const since = sinceISO || new Date(Date.now() - 10 * 60_000).toISOString();
  // Compose a single shell pipeline that runs on the remote host. We use
  // grep -aoE to ignore embedded NULs in container logs and PCRE-style
  // alternation. `head -1` short-circuits after the first match. `|| true`
  // suppresses the non-zero exit if no line matched — we want a quiet empty
  // string in that case, not a thrown error.
  const remoteCmd = [
    `docker logs --since='${since}' ${PGR_CONTAINER} 2>&1`,
    `grep -F ${shellQuote(substring)}`,
    `grep -aoE 'trace_id=[a-f0-9]{32}'`,
    `head -1`,
    `sed 's/trace_id=//'`,
    `|| true`,
  ].join(' | ');

  try {
    const { stdout } = await execFileAsync(
      'ssh',
      [BOMET_SSH_HOST, 'bash', '-lc', remoteCmd],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const tid = stdout.trim();
    return tid && /^[a-f0-9]{32}$/.test(tid) ? tid : null;
  } catch (err: any) {
    // Distinguish SSH-failure (we want a clear test message) from grep-miss
    // (we want null + downstream "no trace yet, retry" path).
    if (err.code === 'ETIMEDOUT' || /ssh:|Permission denied|Could not resolve/i.test(err.message || '')) {
      throw new Error(
        `SSH to ${BOMET_SSH_HOST} failed while looking up trace_id (${err.message}). ` +
        `Ensure ~/.ssh/config has an alias for egov-bomet and you're on the egov VPC.`,
      );
    }
    return null;
  }
}

/**
 * Fetch a Tempo trace by id. Polls with retries because trace ingestion is
 * asynchronous — the OTEL javaagent batches spans, the collector forwards
 * to Tempo, and Tempo's ingester needs a beat to flush before search hits.
 *
 * Returns the raw Tempo trace JSON ({ batches: [...] }) or throws after
 * `retries` exhausted attempts.
 */
export async function getTempoTrace(
  traceId: string,
  retries = 5,
  delayMs = 2000,
): Promise<TempoTrace> {
  if (!/^[a-f0-9]{32}$/.test(traceId)) {
    throw new Error(`Invalid trace id "${traceId}" — must be 32 lowercase hex chars`);
  }

  let lastErr: string = '';
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(`${TEMPO_URL}/api/traces/${traceId}`, {
        // 10s per attempt — Tempo's normal response is sub-second; longer means trouble
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        const body = (await resp.json()) as TempoTrace;
        if (body && Array.isArray(body.batches) && body.batches.length > 0) {
          return body;
        }
        lastErr = `Tempo returned 200 with empty batches`;
      } else {
        lastErr = `HTTP ${resp.status}`;
      }
    } catch (err: any) {
      lastErr = err?.message || String(err);
      if (/fetch failed|ECONNREFUSED|ETIMEDOUT/.test(lastErr) && attempt === 0) {
        throw new Error(
          `Tempo unreachable at ${TEMPO_URL} (${lastErr}). ` +
          `This helper requires VPC access — run from the egov dev server.`,
        );
      }
    }
    if (attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`Tempo trace ${traceId} not found after ${retries} attempts (last: ${lastErr})`);
}

/**
 * Walk every span in a Tempo trace and return those that carry the given
 * attribute key (regardless of value).
 */
export function findSpansByAttribute(trace: TempoTrace, attrKey: string): TempoSpan[] {
  const out: TempoSpan[] = [];
  for (const batch of trace.batches ?? []) {
    for (const ils of batch.instrumentationLibrarySpans ?? batch.scopeSpans ?? []) {
      for (const span of ils.spans ?? []) {
        if ((span.attributes ?? []).some((a) => a.key === attrKey)) {
          out.push(span);
        }
      }
    }
  }
  return out;
}

/**
 * Read a single attribute value off a Tempo span. Tempo encodes values as
 * `{ stringValue }`, `{ intValue }`, `{ doubleValue }`, `{ boolValue }`,
 * etc. — this normalises them to a plain JS value (string | number | boolean
 * | undefined).
 */
export function getAttr(span: TempoSpan, key: string): string | number | boolean | undefined {
  const a = (span.attributes ?? []).find((x) => x.key === key);
  if (!a) return undefined;
  const v = a.value || {};
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) {
    // Tempo proto JSON serializes 64-bit ints as strings sometimes.
    const n = typeof v.intValue === 'string' ? Number(v.intValue) : v.intValue;
    return Number.isFinite(n) ? n : undefined;
  }
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  return undefined;
}

// ---------------------------------------------------------------------------
// Tempo response types (subset — Tempo uses the OTLP protobuf JSON shape)
// ---------------------------------------------------------------------------

export interface TempoTrace {
  batches?: TempoBatch[];
}

export interface TempoBatch {
  resource?: { attributes?: TempoAttr[] };
  // OTLP v0.7+ uses `scopeSpans`; older Tempo builds still emit
  // `instrumentationLibrarySpans`. Accept either.
  scopeSpans?: TempoScopeSpans[];
  instrumentationLibrarySpans?: TempoScopeSpans[];
}

export interface TempoScopeSpans {
  scope?: { name?: string; version?: string };
  spans?: TempoSpan[];
}

export interface TempoSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: TempoAttr[];
}

export interface TempoAttr {
  key: string;
  value: {
    stringValue?: string;
    intValue?: number | string;
    doubleValue?: number;
    boolValue?: boolean;
    arrayValue?: { values: any[] };
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Single-quote a string for safe interpolation into a remote bash -lc. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
