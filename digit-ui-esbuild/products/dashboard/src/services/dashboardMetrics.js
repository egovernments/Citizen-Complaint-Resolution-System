import { DASHBOARD_ROLES } from "../../roles";

/**
 * dashboardMetrics — client-side render-lag instrumentation (issue #1110, PR1).
 *
 * Dependency-free (no npm deps; only the pure DASHBOARD_ROLES constant), hand-rolled
 * OTLP/HTTP JSON emitter. Statically imported (the bundle is a single IIFE —
 * splitting:false — so dynamic import() would save nothing); the cheap core
 * (`beginLoad`, marks, `getTraceHeaders`) runs synchronously, while the
 * PerformanceObserver subscription and the flush machinery defer to
 * requestIdleCallback (setTimeout fallback for Safari).
 *
 * Metrics (OTLP -> collector `deltatocumulative` -> prometheus exporter):
 *   dashboard.ttfb.ms                 histogram  hard navigations only
 *   dashboard.first_widget_visible.ms histogram  first non-skeleton tile paint
 *   dashboard.all_widgets_ready.ms    histogram  batch settle + paint
 *   dashboard.filter_apply.ms         histogram  interaction window (see below)
 *   dashboard.persona_switch.ms       histogram  interaction window (see below)
 *   dashboard.slow_api_calls.count    sum        load-window calls > 2000ms
 *   dashboard.transfer.bytes          sum        Σ resource transferSize in the load window
 *                                                (network transfer incl. headers; 0 on cache hits)
 *   dashboard.error_widgets.count     sum        errored tiles at load settle (base kpiIds)
 * All histograms/sums use DELTA temporality (browsers are ephemeral emitters).
 * Variable tags (tenant/persona/layout_id/record_count_tier/ua_family/nav_type)
 * are DATAPOINT attributes; the resource carries only service.name=dashboard-web
 * (resource_to_telemetry_conversion is on — per-session resource attrs would
 * explode Prometheus label cardinality).
 *
 * Per-load correlation: one `dashboard.load` OTLP log record (-> Loki) carries the
 * trace id + all metric values + tags; `getTraceHeaders()` puts the same trace id
 * on the dashboard's API calls as W3C `traceparent` (+ `x-trace-id`), which Kong's
 * otel plugin and the pgr javaagent continue into Tempo.
 *
 * Interaction-window state machine (R6):
 *   markInteraction(kind) sets a PENDING intent (timestamped; repeat intents reset
 *   the timestamp — measure from the last user action). The window OPENS only when
 *   the batch effect actually issues a new reqId while an unexpired (<5s) intent is
 *   pending (markBatchStart). It CLOSES on markAllWidgetsReady for the SAME reqId
 *   (post-paint), emitting filter_apply/persona_switch. Superseded batches discard
 *   the window; a 30s absolute expiry discards dangling windows.
 *
 * Flush cadence (R5): quiesce flush after the load settles; 5s-debounced flush
 * after each closed interaction window; 60s periodic flush while dirty; pagehide
 * sendBeacon backstop. Two SEPARATE OTLP payloads per flush: resourceMetrics ->
 * /otel/v1/metrics, resourceLogs -> /otel/v1/logs (never a combined body).
 *
 * Failure policy (R7): console.warn on every failed POST (config errors must stay
 * visible even when invisible in metrics); 4xx (route missing / auth) mutes the
 * session after ONE failure; network/5xx backs off 1s/10s/60s and mutes after 3
 * consecutive failures, attempting a best-effort `dashboard.metrics.selfmute`
 * log record first.
 */

/* ------------------------------------------------------------------------- */
/* Config / gate                                                             */
/* ------------------------------------------------------------------------- */

const OTEL_BASE = (process.env.REACT_APP_OTEL_BASE || "/otel").replace(/\/$/, "");
const METRICS_URL = `${OTEL_BASE}/v1/metrics`;
const LOGS_URL = `${OTEL_BASE}/v1/logs`;

const HISTOGRAM_BOUNDS = [250, 500, 1000, 2000, 3000, 5000, 8000, 13000, 21000];
const SLOW_CALL_MS = 2000;
const INTENT_TTL_MS = 5000;
const WINDOW_TTL_MS = 30000;
const QUIESCE_FLUSH_DELAY_MS = 2000;
const INTERACTION_FLUSH_DEBOUNCE_MS = 5000;
const DIRTY_FLUSH_INTERVAL_MS = 60000;
const BACKOFF_MS = [1000, 10000, 60000];
const MAX_CONSECUTIVE_FAILURES = 3;

export function isEnabled() {
  // esbuild define wins when explicitly set ("true"/"false"); otherwise the
  // runtime globalConfigs gate, default ON (disabled only when explicitly false).
  const env = process.env.REACT_APP_DASHBOARD_METRICS;
  if (env === "false") return false;
  if (env === "true") return true;
  try {
    const v = window.globalConfigs?.getConfig?.("DASHBOARD_METRICS_ENABLED");
    return v !== false && v !== "false";
  } catch (e) {
    return true;
  }
}

function on() {
  return isEnabled() && !state.muted;
}

/* ------------------------------------------------------------------------- */
/* Time / id helpers                                                         */
/* ------------------------------------------------------------------------- */

function nowMs() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

/** Epoch nanoseconds (as a decimal string) for an offset on the performance.now() timeline. */
function epochNano(perfMs) {
  const origin =
    (typeof performance !== "undefined" && performance.timeOrigin) || Date.now() - nowMs();
  return String(Math.round((origin + perfMs) * 1e6));
}

function randHex(chars) {
  const bytes = new Uint8Array(chars / 2);
  const cryptoObj = typeof crypto !== "undefined" ? crypto : null;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  // An all-zero trace/span id is invalid per W3C — force a non-zero low byte.
  return /^0+$/.test(out) ? out.slice(0, -2) + "01" : out;
}

/** Browser family from the UA string: Edge/Chrome/Firefox/Safari/Other, `+mobile` suffix. */
export function uaFamily(ua) {
  const s = String(ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : "") ?? "");
  let family = "Other";
  if (/Edg(e|A|iOS)?\//.test(s)) family = "Edge";
  else if (/(Chrome|CriOS)\//.test(s)) family = "Chrome";
  else if (/(Firefox|FxiOS)\//.test(s)) family = "Firefox";
  else if (/Safari\//.test(s) && /Version\//.test(s)) family = "Safari";
  if (/Mobi|Android|iPhone|iPad/.test(s)) family += "+mobile";
  return family;
}

/** record_count_tier buckets — identical to #1109. */
export function recordCountTier(count) {
  if (count == null || count === "") return "unknown"; // absent until PR2
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0) return "unknown";
  if (n < 10000) return "lt10k";
  if (n < 50000) return "10k-50k";
  if (n < 100000) return "50k-100k";
  return "gt100k";
}

/* ------------------------------------------------------------------------- */
/* Module state                                                              */
/* ------------------------------------------------------------------------- */

const state = {
  load: null, // current load ctx
  hasBegunOnce: false,
  packMeta: null, // { packId, recordCount, persona } — defensive, absent until PR2
  pendingIntent: null, // { kind, ts }
  interactionWindow: null, // { kind, reqId, startTs, openedAt }
  // flush-pending telemetry (cleared on successful send; re-merged on failure)
  pending: { hist: {}, sums: {}, logs: [] },
  inFlight: false,
  muted: false,
  consecutiveFailures: 0,
  backoffUntil: 0,
  deferredInitDone: false,
  interactionFlushTimer: null,
  dirtyFlushTimer: null,
  bufferedMarks: [], // marks that arrived before beginLoad — reconciled on begin
};

function newLoadCtx(navType, t0, ttfbMs) {
  return {
    traceId: randHex(32),
    navType, // "hard" | "soft"
    t0, // performance.now()-timeline origin of the load
    beginNow: nowMs(),
    ttfbMs, // null for soft navs
    firstWidgetMs: null,
    firstWidgetPending: false,
    allReadyMs: null,
    allReadyPending: false,
    errorWidgets: 0,
    slowApiCalls: 0,
    transferBytes: 0,
    quiesced: false, // load window closed (accumulators frozen)
  };
}

/* ------------------------------------------------------------------------- */
/* Load lifecycle                                                            */
/* ------------------------------------------------------------------------- */

function getNavigationEntry() {
  try {
    return performance.getEntriesByType?.("navigation")?.[0] || null;
  } catch (e) {
    return null;
  }
}

/**
 * Begin a dashboard load. Called SYNCHRONOUSLY at AdminDashboardInner mount,
 * before useCatalog/useFilterOptions fire their fetches, so getTraceHeaders()
 * is available to every dashboard request of this load.
 *
 * nav_type: "hard" when this is the first mount of this page load AND the
 * browser navigation landed directly on the dashboard route (t0 = navigation
 * start, ttfb from the navigation entry); "soft" otherwise (in-app route
 * change; t0 = mount — this EXCLUDES the pre-mount Module.js localization-gate
 * wait, see docs).
 */
export function beginLoad() {
  if (!isEnabled()) return;
  // Double-mount guard (e.g. StrictMode double-invoke): ignore a re-begin
  // within 100ms of an active load.
  if (state.load && !state.load.quiesced && nowMs() - state.load.beginNow < 100) return;

  const navEntry = getNavigationEntry();
  const isHard =
    !state.hasBegunOnce &&
    !!navEntry &&
    /\/employee\/dashboard(\/|\?|#|$)/.test(String(navEntry.name || ""));
  state.hasBegunOnce = true;

  const navType = isHard ? "hard" : "soft";
  const t0 = isHard ? 0 : nowMs();
  const ttfbMs =
    isHard && Number.isFinite(navEntry.responseStart) && navEntry.responseStart > 0
      ? navEntry.responseStart
      : null;

  state.load = newLoadCtx(navType, t0, ttfbMs);
  if (ttfbMs != null) recordHist("dashboard.ttfb.ms", ttfbMs);

  // Reconcile any marks that raced ahead of beginLoad (mark-before-begin buffers).
  const buffered = state.bufferedMarks.splice(0);
  for (const mark of buffered) {
    const rel = Math.max(0, mark.ts - t0);
    if (mark.type === "firstWidget" && state.load.firstWidgetMs == null) {
      state.load.firstWidgetMs = rel;
      recordHist("dashboard.first_widget_visible.ms", rel);
    }
  }

  ensureDeferredInit();
}

/** One-shot per load: first tile painting real content (incl. error / "No data"). */
export function markFirstWidgetVisible() {
  if (!on()) return;
  const load = state.load;
  if (!load) {
    if (!state.bufferedMarks.some((m) => m.type === "firstWidget")) {
      state.bufferedMarks.push({ type: "firstWidget", ts: nowMs() });
    }
    return;
  }
  if (load.firstWidgetMs != null || load.firstWidgetPending) return;
  load.firstWidgetPending = true;
  postPaint((ts) => {
    if (state.load !== load || load.firstWidgetMs != null) return;
    load.firstWidgetMs = Math.max(0, ts - load.t0);
    recordHist("dashboard.first_widget_visible.ms", load.firstWidgetMs);
  });
}

/**
 * Batch settle. Callers invoke this AFTER the reqId staleness guard, with the
 * error count already collapsed to base kpiIds. Serves double duty:
 *  - one-shot load mark (all_widgets_ready + error_widgets + quiesce flush)
 *  - interaction-window close for the SAME reqId (filter_apply/persona_switch)
 */
export function markAllWidgetsReady(errorCount = 0, reqId) {
  if (!on()) return;
  const load = state.load;
  const needLoadMark = !!load && load.allReadyMs == null && !load.allReadyPending;
  if (needLoadMark) load.allReadyPending = true;
  const mayCloseWindow = windowMatches(reqId);
  if (!needLoadMark && !mayCloseWindow) return;

  postPaint((ts) => {
    if (needLoadMark && state.load === load && load.allReadyMs == null) {
      load.allReadyMs = Math.max(0, ts - load.t0);
      load.errorWidgets = Math.max(0, Number(errorCount) || 0);
      recordHist("dashboard.all_widgets_ready.ms", load.allReadyMs);
      if (load.errorWidgets > 0) recordSum("dashboard.error_widgets.count", load.errorWidgets);
      // Close the load window shortly after settle so buffered resource entries
      // (the batch call itself, late boundary/geojson) land in the accumulators,
      // then flush the load + its dashboard.load log record.
      setTimer(() => {
        if (state.load === load && !load.quiesced) {
          load.quiesced = true;
          recordSum("dashboard.slow_api_calls.count", load.slowApiCalls);
          recordSum("dashboard.transfer.bytes", load.transferBytes);
          state.pending.logs.push(buildLoadLogRecord(load));
          flush("quiesce");
        }
      }, QUIESCE_FLUSH_DELAY_MS);
    }

    // Interaction window: re-check inside the paint callback — a superseding
    // batch may have discarded/replaced the window between call and paint.
    const win = state.interactionWindow;
    if (win && reqId != null && win.reqId === reqId) {
      state.interactionWindow = null;
      if (ts - win.openedAt <= WINDOW_TTL_MS) {
        const durMs = Math.max(0, ts - win.startTs);
        const metric =
          win.kind === "persona" ? "dashboard.persona_switch.ms" : "dashboard.filter_apply.ms";
        recordHist(metric, durMs);
        state.pending.logs.push(buildInteractionLogRecord(win.kind, durMs));
        scheduleInteractionFlush();
      }
    }
  });
}

/**
 * User interaction intent (`filter` | `persona`). Does NOT open a window —
 * only markBatchStart (a real new reqId) does. A repeat intent before the
 * window opens resets the timestamp (measure from the last user action).
 */
export function markInteraction(kind) {
  if (!on()) return;
  if (kind !== "filter" && kind !== "persona") return;
  state.pendingIntent = { kind, ts: nowMs() };
}

/**
 * Hook at the batch effect body: a NEW reqId was issued. Opens the interaction
 * window when an unexpired intent is pending; discards a superseded window.
 */
export function markBatchStart(reqId) {
  if (!on() || reqId == null) return;
  const ts = nowMs();
  const win = state.interactionWindow;
  if (win && (win.reqId !== reqId || ts - win.openedAt > WINDOW_TTL_MS)) {
    state.interactionWindow = null; // superseded or expired — discard
  }
  const intent = state.pendingIntent;
  if (intent) {
    state.pendingIntent = null;
    if (ts - intent.ts <= INTENT_TTL_MS) {
      state.interactionWindow = { kind: intent.kind, reqId, startTs: intent.ts, openedAt: ts };
    }
    // expired intent (e.g. a filter change that never changed refsKey): drop silently
  }
}

function windowMatches(reqId) {
  const win = state.interactionWindow;
  return !!win && reqId != null && win.reqId === reqId;
}

/**
 * Explicit API-call hook (from analyticsService, for non-2xx responses the
 * resource observer can't classify). Failure info only — bytes/slow counting is
 * owned by the PerformanceObserver so the same request is never double-counted.
 */
export function recordApiCall(url, durMs, bytes, ok) {
  if (!on()) return;
  const load = state.load;
  if (!load || load.quiesced) return;
  if (ok === false) load.failedApiCalls = (load.failedApiCalls || 0) + 1;
}

/** Pack metadata from /packs (defensive; fields absent until PR2 lands). */
export function setPackMeta(meta) {
  if (!meta || typeof meta !== "object") return;
  state.packMeta = {
    packId: meta.packId != null ? String(meta.packId) : null,
    recordCount: Number.isFinite(Number(meta.recordCount)) ? Number(meta.recordCount) : null,
    persona: meta.persona != null ? String(meta.persona) : null,
  };
}

/* ------------------------------------------------------------------------- */
/* Trace headers                                                             */
/* ------------------------------------------------------------------------- */

/** W3C traceparent (fresh span id per call) + x-trace-id for the current load. */
export function getTraceHeaders() {
  if (!on() || !state.load) return {};
  const traceId = state.load.traceId;
  return {
    traceparent: `00-${traceId}-${randHex(16)}-01`,
    "x-trace-id": traceId,
  };
}

/** Shared header-injection helper for the dashboard's fetch call sites (R3). */
export function withTraceHeaders(headers) {
  return { ...(headers || {}), ...getTraceHeaders() };
}

/* ------------------------------------------------------------------------- */
/* Tags (datapoint attributes only — D6)                                     */
/* ------------------------------------------------------------------------- */

function readLocalStorage(key) {
  try {
    const raw = window.localStorage?.getItem(key);
    if (!raw || raw === "undefined") return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return raw;
    }
  } catch (e) {
    return null;
  }
}

function getTenantTag() {
  try {
    return (
      window.globalConfigs?.getConfig?.("STATE_LEVEL_TENANT_ID") ||
      process.env.REACT_APP_STATE_LEVEL_TENANT_ID ||
      "unknown"
    );
  } catch (e) {
    return "unknown";
  }
}

/**
 * persona tag: prefer the server's actual pack-match decision (packMeta.persona,
 * PR2); fall back to the first caller role present in DASHBOARD_ROLES, in the
 * DASHBOARD_ROLES array order (deterministic — mirrors the BE first-match), else
 * "other". Bounded cardinality either way.
 */
function getPersonaTag() {
  if (state.packMeta?.persona) return state.packMeta.persona;
  const info = readLocalStorage("Employee.user-info");
  const roleCodes = new Set(
    (Array.isArray(info?.roles) ? info.roles : []).map((r) => String(r?.code ?? "")).filter(Boolean)
  );
  for (const role of DASHBOARD_ROLES) {
    if (roleCodes.has(role)) return role;
  }
  return "other";
}

/**
 * layout_id = pack id (PR2), suffixed "+custom" when the persisted local layout
 * override exists. Coarse on purpose: the storage key is global (not
 * per-pack/tenant/user) — documented in docs/observability/dashboard-metrics.md.
 */
function getLayoutIdTag() {
  const packId = state.packMeta?.packId || "unknown";
  let custom = false;
  try {
    custom = window.localStorage?.getItem("ccrs.dashboard.catalog-layout.v1") != null;
  } catch (e) {
    /* storage unavailable */
  }
  return custom ? `${packId}+custom` : packId;
}

function currentTags() {
  return {
    tenant: String(getTenantTag()),
    persona: getPersonaTag(),
    layout_id: getLayoutIdTag(),
    record_count_tier: recordCountTier(state.packMeta?.recordCount),
    ua_family: uaFamily(),
    nav_type: state.load?.navType || "unknown",
  };
}

/* ------------------------------------------------------------------------- */
/* Recording                                                                 */
/* ------------------------------------------------------------------------- */

function recordHist(name, value) {
  if (!Number.isFinite(value)) return;
  (state.pending.hist[name] = state.pending.hist[name] || []).push(value);
}

function recordSum(name, delta) {
  if (!Number.isFinite(delta) || delta <= 0) return;
  state.pending.sums[name] = (state.pending.sums[name] || 0) + delta;
}

function hasPendingMetrics() {
  return (
    Object.keys(state.pending.hist).length > 0 || Object.keys(state.pending.sums).length > 0
  );
}

function isDirty() {
  return hasPendingMetrics() || state.pending.logs.length > 0;
}

/* ------------------------------------------------------------------------- */
/* Deferred periphery: PerformanceObserver + lifecycle listeners + 60s timer */
/* ------------------------------------------------------------------------- */

function requestIdle(fn) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 1000 });
  else setTimer(fn, 200); // Safari fallback
}

function setTimer(fn, ms) {
  return setTimeout(fn, ms);
}

/** Double-rAF so the timestamp is post-paint; setTimeout fallback outside browsers. */
function postPaint(fn) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(() => fn(nowMs())));
  } else {
    setTimer(() => fn(nowMs()), 0);
  }
}

function getAnalyticsBasePath() {
  if (process.env.REACT_APP_ANALYTICS_BASE) {
    return process.env.REACT_APP_ANALYTICS_BASE.replace(/\/$/, "");
  }
  return process.env.NODE_ENV === "development" ? "/pgr-analytics" : "/api/analytics";
}

function isDashboardResource(url) {
  const s = String(url || "");
  if (s.includes(getAnalyticsBasePath())) return true;
  if (s.includes("/boundary-service/")) return true;
  if (s.includes("/egov-mdms-service/") || s.includes("/mdms-v2/")) return true;
  return false;
}

function onResourceEntries(entries) {
  const load = state.load;
  if (!load || load.quiesced) return; // slow/transfer are load-window metrics
  for (const entry of entries) {
    if (entry.initiatorType !== "fetch" && entry.initiatorType !== "xmlhttprequest") continue;
    if (!isDashboardResource(entry.name)) continue;
    if (entry.startTime < load.t0) continue; // pre-load leftovers (buffered:true)
    if (entry.duration > SLOW_CALL_MS) load.slowApiCalls += 1;
    load.transferBytes += Number(entry.transferSize) || 0;
  }
}

function ensureDeferredInit() {
  if (state.deferredInitDone) return;
  state.deferredInitDone = true;
  requestIdle(() => {
    try {
      if (typeof PerformanceObserver === "function") {
        const observer = new PerformanceObserver((list) => onResourceEntries(list.getEntries()));
        observer.observe({ type: "resource", buffered: true });
      }
    } catch (e) {
      /* resource timing unavailable — slow/transfer stay 0 */
    }
    try {
      const beacon = () => flushWithBeacon("pagehide");
      window.addEventListener("pagehide", beacon);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") beacon();
      });
    } catch (e) {
      /* non-browser environment */
    }
    // 60s periodic flush while dirty (long-lived tabs).
    if (!state.dirtyFlushTimer) {
      state.dirtyFlushTimer = setInterval(() => {
        if (isDirty()) flush("periodic");
      }, DIRTY_FLUSH_INTERVAL_MS);
    }
  });
}

function scheduleInteractionFlush() {
  if (state.interactionFlushTimer) clearTimeout(state.interactionFlushTimer);
  state.interactionFlushTimer = setTimer(() => {
    state.interactionFlushTimer = null;
    flush("interaction");
  }, INTERACTION_FLUSH_DEBOUNCE_MS);
}

/* ------------------------------------------------------------------------- */
/* OTLP JSON envelopes                                                       */
/* ------------------------------------------------------------------------- */

const AGGREGATION_TEMPORALITY_DELTA = 1;

function attrValue(v) {
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  return { stringValue: String(v) };
}

function toAttributes(obj) {
  return Object.entries(obj).map(([key, v]) => ({ key, value: attrValue(v) }));
}

function histogramDataPoint(values, attributes, startNano, endNano) {
  const bucketCounts = new Array(HISTOGRAM_BOUNDS.length + 1).fill(0);
  let sum = 0;
  for (const v of values) {
    sum += v;
    let i = 0;
    while (i < HISTOGRAM_BOUNDS.length && v > HISTOGRAM_BOUNDS[i]) i++;
    bucketCounts[i] += 1;
  }
  return {
    startTimeUnixNano: startNano,
    timeUnixNano: endNano,
    count: String(values.length),
    sum,
    bucketCounts: bucketCounts.map(String),
    explicitBounds: HISTOGRAM_BOUNDS,
    attributes,
  };
}

// NOTE: no OTLP `unit` field on purpose. The metric NAMES already carry their
// unit (`.ms` / `.bytes` / `.count`, exactly as the #1110 ticket table), and the
// collector's prometheus exporter appends a unit-derived suffix when `unit` is
// set — validated live: unit:"ms" surfaced as dashboard_..._ms_milliseconds_*.
// Omitting the unit keeps the scraped names exactly dashboard_ttfb_ms_bucket etc.

/** OTLP/HTTP JSON ExportMetricsServiceRequest (resourceMetrics only — R4). */
function buildMetricsPayload(hist, sums) {
  const nowPerf = nowMs();
  const endNano = epochNano(nowPerf);
  const startNano = epochNano(state.load ? state.load.t0 : nowPerf);
  const attributes = toAttributes(currentTags());
  const metrics = [];
  for (const [name, values] of Object.entries(hist)) {
    if (!values.length) continue;
    metrics.push({
      name,
      histogram: {
        aggregationTemporality: AGGREGATION_TEMPORALITY_DELTA,
        dataPoints: [histogramDataPoint(values, attributes, startNano, endNano)],
      },
    });
  }
  for (const [name, delta] of Object.entries(sums)) {
    metrics.push({
      name,
      sum: {
        aggregationTemporality: AGGREGATION_TEMPORALITY_DELTA,
        isMonotonic: true,
        dataPoints: [
          {
            startTimeUnixNano: startNano,
            timeUnixNano: endNano,
            asInt: String(Math.round(delta)),
            attributes,
          },
        ],
      },
    });
  }
  if (!metrics.length) return null;
  return {
    resourceMetrics: [
      {
        resource: { attributes: toAttributes({ "service.name": "dashboard-web" }) },
        scopeMetrics: [{ scope: { name: "ccrs.dashboard" }, metrics }],
      },
    ],
  };
}

/** OTLP/HTTP JSON ExportLogsServiceRequest (resourceLogs only — R4). */
function buildLogsPayload(logRecords) {
  if (!logRecords.length) return null;
  return {
    resourceLogs: [
      {
        resource: { attributes: toAttributes({ "service.name": "dashboard-web" }) },
        scopeLogs: [{ scope: { name: "ccrs.dashboard" }, logRecords }],
      },
    ],
  };
}

function baseLogRecord(body, attributes) {
  const record = {
    timeUnixNano: epochNano(nowMs()),
    severityNumber: 9,
    severityText: "INFO",
    body: { stringValue: body },
    attributes: toAttributes(attributes),
  };
  if (state.load) {
    record.traceId = state.load.traceId;
    record.spanId = randHex(16);
  }
  return record;
}

/** D11: one per-load correlation record — trace id + all metric values + tags. */
function buildLoadLogRecord(load) {
  return baseLogRecord("dashboard.load", {
    ...currentTags(),
    trace_id: load.traceId,
    ttfb_ms: load.ttfbMs != null ? Math.round(load.ttfbMs) : -1,
    first_widget_visible_ms: load.firstWidgetMs != null ? Math.round(load.firstWidgetMs) : -1,
    all_widgets_ready_ms: load.allReadyMs != null ? Math.round(load.allReadyMs) : -1,
    slow_api_calls: load.slowApiCalls,
    transfer_bytes: load.transferBytes,
    error_widgets: load.errorWidgets,
    failed_api_calls: load.failedApiCalls || 0,
  });
}

function buildInteractionLogRecord(kind, durMs) {
  return baseLogRecord("dashboard.interaction", {
    ...currentTags(),
    trace_id: state.load?.traceId || "",
    kind,
    duration_ms: Math.round(durMs),
  });
}

/* ------------------------------------------------------------------------- */
/* Delivery                                                                  */
/* ------------------------------------------------------------------------- */

function takePending() {
  const taken = state.pending;
  state.pending = { hist: {}, sums: {}, logs: [] };
  return taken;
}

function restorePending(taken) {
  for (const [name, values] of Object.entries(taken.hist)) {
    state.pending.hist[name] = [...values, ...(state.pending.hist[name] || [])];
  }
  for (const [name, delta] of Object.entries(taken.sums)) {
    state.pending.sums[name] = (state.pending.sums[name] || 0) + delta;
  }
  state.pending.logs = [...taken.logs, ...state.pending.logs];
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    keepalive: true,
    body: JSON.stringify(payload),
  });
  return response;
}

function noteSuccess() {
  state.consecutiveFailures = 0;
  state.backoffUntil = 0;
}

function noteFailure(status) {
  // Config errors must be visible in the console even when invisible in metrics.
  // eslint-disable-next-line no-console
  console.warn(
    `[dashboardMetrics] telemetry POST failed${status ? ` (HTTP ${status})` : " (network)"}` +
      ` — check the /otel Kong route / DASHBOARD_METRICS_ENABLED gate`
  );
  if (status >= 400 && status < 500 && status !== 429) {
    // Route missing / auth misconfig: mute after ONE failure, but loudly.
    // 429 is EXEMPT: our own Kong route rate-limits at 60/min-per-IP, so a
    // shared-IP burst must take the backoff path below, not a session mute.
    state.muted = true;
    // eslint-disable-next-line no-console
    console.warn("[dashboardMetrics] muting dashboard telemetry for this session (4xx)");
    return;
  }
  state.consecutiveFailures += 1;
  state.backoffUntil =
    nowMs() + BACKOFF_MS[Math.min(state.consecutiveFailures, BACKOFF_MS.length) - 1];
  if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    trySelfMuteRecord();
    state.muted = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[dashboardMetrics] muting dashboard telemetry for this session (${MAX_CONSECUTIVE_FAILURES} consecutive failures)`
    );
  }
}

function trySelfMuteRecord() {
  try {
    const payload = buildLogsPayload([
      baseLogRecord("dashboard.metrics.selfmute", {
        ...currentTags(),
        consecutive_failures: state.consecutiveFailures,
      }),
    ]);
    if (payload) postJson(LOGS_URL, payload).catch(() => {});
  } catch (e) {
    /* best effort */
  }
}

/**
 * Flush pending telemetry: TWO separate OTLP payloads (metrics -> /v1/metrics,
 * logs -> /v1/logs). Pending data is snapshotted and re-merged on failure so a
 * transient error never loses records.
 */
export function flush(reason) {
  if (!on() || state.inFlight || !isDirty()) return;
  if (nowMs() < state.backoffUntil) return; // retried by the 60s dirty timer
  const taken = takePending();
  const metricsPayload = buildMetricsPayload(taken.hist, taken.sums);
  const logsPayload = buildLogsPayload(taken.logs);
  const posts = [];
  if (metricsPayload) posts.push(postJson(METRICS_URL, metricsPayload));
  if (logsPayload) posts.push(postJson(LOGS_URL, logsPayload));
  if (!posts.length) return;

  state.inFlight = true;
  Promise.all(posts)
    .then((responses) => {
      state.inFlight = false;
      const failed = responses.find((r) => !r.ok);
      if (failed) {
        restorePending(taken);
        noteFailure(failed.status);
      } else {
        noteSuccess();
      }
    })
    .catch(() => {
      state.inFlight = false;
      restorePending(taken);
      noteFailure(0);
    });
}

function sendBeaconJson(url, payload) {
  try {
    if (typeof navigator === "undefined" || !navigator.sendBeacon) return false;
    return !!navigator.sendBeacon(
      url,
      new Blob([JSON.stringify(payload)], { type: "application/json" })
    );
  } catch (e) {
    return false;
  }
}

/**
 * pagehide backstop: sendBeacon with an explicit JSON Blob (R4).
 * The two signals succeed or fail independently, so restore per payload —
 * restoring both when only the logs beacon failed would double-count the
 * already-delivered metrics on the next flush. Exported for the smoke test.
 */
export function flushWithBeacon(reason) {
  if (!on() || !isDirty()) return;
  const taken = takePending();
  const metricsPayload = buildMetricsPayload(taken.hist, taken.sums);
  const logsPayload = buildLogsPayload(taken.logs);
  const metricsOk = !metricsPayload || sendBeaconJson(METRICS_URL, metricsPayload);
  const logsOk = !logsPayload || sendBeaconJson(LOGS_URL, logsPayload);
  if (metricsOk && logsOk) return;
  // page may survive (bfcache/visibility) — keep only what actually failed
  restorePending({
    hist: metricsOk ? {} : taken.hist,
    sums: metricsOk ? {} : taken.sums,
    logs: logsOk ? [] : taken.logs,
  });
}

/* ------------------------------------------------------------------------- */
/* Test/debug hook                                                            */
/* ------------------------------------------------------------------------- */

/** Internal-state inspection for the state-machine smoke test. Not public API. */
export function _inspect() {
  return {
    load: state.load,
    pendingIntent: state.pendingIntent,
    interactionWindow: state.interactionWindow,
    pending: state.pending,
    muted: state.muted,
    consecutiveFailures: state.consecutiveFailures,
  };
}
