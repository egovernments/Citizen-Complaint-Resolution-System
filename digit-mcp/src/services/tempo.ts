// Tempo HTTP API client for distributed trace queries
// All calls use fetch() — no shell commands, no auth needed.

const TEMPO_URL = process.env.TEMPO_URL || 'http://localhost:13200';
const COLLECTOR_URL = process.env.OTEL_COLLECTOR_URL || 'http://localhost:13133';
const GRAFANA_URL = process.env.GRAFANA_URL || 'http://localhost:13000';
const FETCH_TIMEOUT_MS = 10_000;

// ── Helpers ──

function withTimeout(ms = FETCH_TIMEOUT_MS): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function tempoFetch(path: string): Promise<Response> {
  const { signal, clear } = withTimeout();
  try {
    const res = await fetch(`${TEMPO_URL}${path}`, { signal });
    return res;
  } finally {
    clear();
  }
}

// ── Health checks ──

export async function tempoReady(): Promise<boolean> {
  try {
    const res = await tempoFetch('/ready');
    return res.ok;
  } catch {
    return false;
  }
}

export async function collectorHealthy(): Promise<boolean> {
  const { signal, clear } = withTimeout();
  try {
    const res = await fetch(`${COLLECTOR_URL}`, { signal });
    clear();
    return res.ok;
  } catch {
    clear();
    return false;
  }
}

export async function grafanaHealthy(): Promise<boolean> {
  const { signal, clear } = withTimeout();
  try {
    const res = await fetch(`${GRAFANA_URL}/grafana/api/health`, { signal });
    clear();
    return res.ok;
  } catch {
    clear();
    return false;
  }
}

// ── Trace search ──

export interface TraceSearchResult {
  traceID: string;
  rootServiceName: string;
  rootTraceName: string;
  durationMs: number;
  startTimeUnixNano: string;
}

export interface SearchParams {
  serviceName?: string;
  operation?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  secondsAgo?: number;
  limit?: number;
}

export async function searchTraces(params: SearchParams): Promise<TraceSearchResult[]> {
  const qs = new URLSearchParams();
  const limit = params.limit ?? 20;
  qs.set('limit', String(limit));

  // Time window
  const now = Math.floor(Date.now() / 1000);
  const secondsAgo = params.secondsAgo ?? 300;
  qs.set('start', String(now - secondsAgo));
  qs.set('end', String(now));

  // Tag-based filters
  const tags: string[] = [];
  if (params.serviceName) {
    tags.push(`service.name="${params.serviceName}"`);
  }
  if (params.operation) {
    tags.push(`name="${params.operation}"`);
  }
  if (tags.length > 0) {
    qs.set('tags', tags.join(' '));
  }

  if (params.minDurationMs) {
    qs.set('minDuration', `${params.minDurationMs}ms`);
  }
  if (params.maxDurationMs) {
    qs.set('maxDuration', `${params.maxDurationMs}ms`);
  }

  const res = await tempoFetch(`/api/search?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(`Tempo search failed: HTTP ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { traces?: TraceSearchItem[]; metrics?: Record<string, unknown> };
  const traces = data.traces || [];

  return traces.map((t) => ({
    traceID: t.traceID,
    rootServiceName: t.rootServiceName || 'unknown',
    rootTraceName: t.rootTraceName || 'unknown',
    durationMs: t.durationMs ?? Math.round((Number(t.startTimeUnixNano) ? 0 : 0)),
    startTimeUnixNano: t.startTimeUnixNano || '0',
  }));
}

// Raw Tempo search item shape
interface TraceSearchItem {
  traceID: string;
  rootServiceName?: string;
  rootTraceName?: string;
  durationMs?: number;
  startTimeUnixNano?: string;
}

// ── Get inspected traces count (metric from search endpoint) ──

export async function getInspectedTraceCount(): Promise<number | null> {
  try {
    const res = await tempoFetch('/api/search?limit=1');
    if (!res.ok) return null;
    const data = (await res.json()) as { metrics?: { inspectedTraces?: number } };
    return data.metrics?.inspectedTraces ?? null;
  } catch {
    return null;
  }
}

// ── Get full trace by ID ──

export interface SpanDetail {
  spanId: string;
  parentSpanId: string;
  name: string;
  serviceName: string;
  durationMs: number;
  status: string;
  attributes: Record<string, string | number | boolean>;
}

export interface TraceDetail {
  traceId: string;
  services: Record<string, SpanDetail[]>;
  errors: SpanDetail[];
  spanCount: number;
  durationMs: number;
  grafanaUrl: string;
}

// Attribute key names we extract for debugging
const INTERESTING_ATTRS = new Set([
  'http.method', 'http.status_code', 'http.url', 'http.target', 'http.route',
  'db.statement', 'db.system', 'db.name',
  'messaging.destination', 'messaging.system',
  'rpc.method', 'rpc.service',
  'net.peer.name', 'net.peer.port',
  'exception.type', 'exception.message',
]);

export async function getTrace(traceId: string): Promise<TraceDetail> {
  // Pad trace ID to 32 hex chars (TASK-016 gotcha)
  const paddedId = traceId.padStart(32, '0');

  const res = await tempoFetch(`/api/traces/${paddedId}`);
  if (!res.ok) {
    throw new Error(`Tempo get trace failed: HTTP ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as OtlpTraceResponse;
  return parseOtlpTrace(paddedId, data);
}

// ── OTLP JSON parsing ──

interface OtlpTraceResponse {
  batches?: OtlpBatch[];
  // Tempo may also return resourceSpans directly
  resourceSpans?: OtlpBatch[];
}

interface OtlpBatch {
  resource?: { attributes?: OtlpAttribute[] };
  scopeSpans?: OtlpScopeSpan[];
  // Legacy field name
  instrumentationLibrarySpans?: OtlpScopeSpan[];
}

interface OtlpScopeSpan {
  scope?: { name?: string };
  spans?: OtlpSpan[];
}

interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  status?: { code?: number; message?: string };
  attributes?: OtlpAttribute[];
}

interface OtlpAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string | number; boolValue?: boolean; doubleValue?: number };
}

function attrValue(attr: OtlpAttribute): string | number | boolean {
  const v = attr.value;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.doubleValue !== undefined) return v.doubleValue;
  return '';
}

function findServiceName(attrs?: OtlpAttribute[]): string {
  if (!attrs) return 'unknown';
  const sn = attrs.find((a) => a.key === 'service.name');
  return sn ? String(attrValue(sn)) : 'unknown';
}

function parseOtlpTrace(traceId: string, data: OtlpTraceResponse): TraceDetail {
  const batches = data.batches || data.resourceSpans || [];
  const services: Record<string, SpanDetail[]> = {};
  const errors: SpanDetail[] = [];
  let spanCount = 0;
  let minStart = Infinity;
  let maxEnd = 0;

  for (const batch of batches) {
    const serviceName = findServiceName(batch.resource?.attributes);
    const scopeSpans = batch.scopeSpans || batch.instrumentationLibrarySpans || [];

    for (const ss of scopeSpans) {
      for (const span of ss.spans || []) {
        spanCount++;

        const startNano = Number(span.startTimeUnixNano || 0);
        const endNano = Number(span.endTimeUnixNano || 0);
        const durationMs = endNano > startNano ? (endNano - startNano) / 1_000_000 : 0;

        if (startNano < minStart) minStart = startNano;
        if (endNano > maxEnd) maxEnd = endNano;

        // Extract interesting attributes
        const attributes: Record<string, string | number | boolean> = {};
        for (const attr of span.attributes || []) {
          if (INTERESTING_ATTRS.has(attr.key)) {
            attributes[attr.key] = attrValue(attr);
          }
        }

        // Status: 0=UNSET, 1=OK, 2=ERROR
        const statusCode = span.status?.code ?? 0;
        const status = statusCode === 2 ? 'ERROR' : statusCode === 1 ? 'OK' : 'UNSET';

        const detail: SpanDetail = {
          spanId: span.spanId || '',
          parentSpanId: span.parentSpanId || '',
          name: span.name || 'unknown',
          serviceName,
          durationMs: Math.round(durationMs * 100) / 100,
          status,
          attributes,
        };

        if (!services[serviceName]) services[serviceName] = [];
        services[serviceName].push(detail);

        if (status === 'ERROR') {
          errors.push(detail);
        }
      }
    }
  }

  const totalDurationMs = maxEnd > minStart ? (maxEnd - minStart) / 1_000_000 : 0;

  return {
    traceId,
    services,
    errors,
    spanCount,
    durationMs: Math.round(totalDurationMs * 100) / 100,
    grafanaUrl: `${GRAFANA_URL}/grafana/explore?orgId=1&left=%7B%22datasource%22:%22tempo%22,%22queries%22:%5B%7B%22queryType%22:%22traceql%22,%22query%22:%22${traceId}%22%7D%5D%7D`,
  };
}
