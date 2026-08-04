// Tests for digit-ui-esbuild/public/analytics.js — the analytics adapter registry shim.
//
// Run from digit-ui-esbuild/:   node --test tests/analytics.shim.test.js
//
// public/analytics.js is a plain ES5 IIFE that is never bundled, so there is
// nothing to import: we execute it inside a vm context with a stubbed DOM and
// then assert against window.DigitAnalytics._internal. Same spirit as
// products/dashboard/src/services/dashboardMetrics.test.js, minus the esbuild
// step (this file has no imports to resolve).
//
// The most valuable assertions here are the NEGATIVE ones: a default
// environment must issue zero requests, and every malformed or hostile record
// must be refused with a named reason.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SHIM = fs.readFileSync(path.resolve(__dirname, "../public/analytics.js"), "utf8");

/**
 * Boot the shim in a stubbed browser.
 * @param {object} opts
 *   config   – globalConfigs key/value map
 *   local    – localStorage seed
 *   session  – sessionStorage seed
 *   pathname – window.location.pathname
 *   dnt      – navigator.doNotTrack
 *   respond  – (tenantId) => rows[]   (null = never respond)
 */
function loadShim(opts) {
  opts = opts || {};
  const config = Object.assign(
    { STATE_LEVEL_TENANT_ID: "mz", CONTEXT_PATH: "digit-ui", MDMS_V2_CONTEXT_PATH: "mdms-v2" },
    opts.config || {}
  );
  const local = Object.assign({}, opts.local || {});
  const session = Object.assign({}, opts.session || {});
  const xhrCalls = [];
  const scripts = [];
  const timers = [];

  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = { debug() {}, warn() {}, error() {}, log() {} };
  sandbox.navigator = { doNotTrack: opts.dnt || null };
  sandbox.location = {
    pathname: opts.pathname || "/digit-ui/employee/pgr/inbox",
    search: opts.search || "",
    href: "http://localhost" + (opts.pathname || "/digit-ui/employee/pgr/inbox"),
  };
  sandbox.globalConfigs = { getConfig: (k) => config[k] };
  sandbox.localStorage = {
    getItem: (k) => (k in local ? local[k] : null),
    setItem: (k, v) => { local[k] = String(v); },
  };
  sandbox.sessionStorage = {
    getItem: (k) => (k in session ? session[k] : null),
    setItem: (k, v) => { session[k] = String(v); },
  };

  const makeEl = () => ({
    async: false, src: "", textContent: "", crossOrigin: "", referrerPolicy: "",
    onload: null, onerror: null,
    getAttribute: () => null, parentNode: null,
  });
  sandbox.document = {
    readyState: "complete",
    head: { appendChild(el) { scripts.push(el); if (el.onload) el.onload(); } },
    documentElement: { appendChild(el) { scripts.push(el); } },
    createElement: makeEl,
    addEventListener() {},
    referrer: "",
  };
  // The real bundle captures the history OBJECT, so the shim's later patch still
  // intercepts. Mutating pathname here mirrors what a real navigation does.
  sandbox.history = {
    pushState(state, title, url) { if (url) sandbox.location.pathname = url; },
    replaceState(state, title, url) { if (url) sandbox.location.pathname = url; },
  };
  sandbox.addEventListener = () => {};
  sandbox.setTimeout = (fn, ms) => { timers.push(fn); return timers.length; };
  sandbox.clearTimeout = () => {};

  sandbox.XMLHttpRequest = function () {
    this.readyState = 0;
    this.status = 0;
    this.responseText = "";
    this.timeout = 0;
    this.withCredentials = true;
    this.headers = {};
    this.open = (method, url) => { this._url = url; this._method = method; };
    this.setRequestHeader = (k, v) => { this.headers[k] = v; };
    this.send = (body) => {
      const parsed = JSON.parse(body);
      const tenantId = parsed.MdmsCriteria.tenantId;
      xhrCalls.push({ url: this._url, method: this._method, headers: this.headers, criteria: parsed.MdmsCriteria, withCredentials: this.withCredentials });
      if (!opts.respond) return;
      const rows = opts.respond(tenantId);
      if (rows === null) return;
      this.readyState = 4;
      this.status = 200;
      this.responseText = JSON.stringify({ mdms: rows });
      if (this.onreadystatechange) this.onreadystatechange();
    };
  };

  vm.runInNewContext(SHIM, sandbox, { filename: "analytics.js" });
  return {
    api: sandbox.DigitAnalytics,
    internal: sandbox.DigitAnalytics && sandbox.DigitAnalytics._internal,
    xhrCalls, scripts, sandbox, session, local,
    flush: () => { while (timers.length) timers.shift()(); },
  };
}

/** A well-formed MDMS envelope row. */
function row(tenantId, data, isActive) {
  return { tenantId, schemaCode: "common-masters.AnalyticsProvider", uniqueIdentifier: data.code, isActive: isActive !== false, data };
}

const MATOMO_OK = {
  code: "matomo-state", type: "MATOMO", enabled: true, siteId: "7",
  scriptUrl: "https://matomo.mz.gov.mz/matomo.js",
  endpointUrl: "https://matomo.mz.gov.mz/matomo.php",
};

/* ─────────────────────────── boot guards ─────────────────────────── */

test("default environment (no records) issues the two reads and initialises nothing", () => {
  const t = loadShim({ session: {}, respond: () => [] });
  assert.equal(t.xhrCalls.length, 1, "one read: no city tenant is known");
  assert.equal(t.internal.providers(), 0);
  assert.equal(t.scripts.length, 0, "no vendor script may be injected");
});

test("no STATE_LEVEL_TENANT_ID means zero requests", () => {
  const t = loadShim({ config: { STATE_LEVEL_TENANT_ID: "" }, respond: () => [] });
  assert.equal(t.xhrCalls.length, 0);
});

test("the uitest placeholder tenant means zero requests", () => {
  const t = loadShim({ config: { STATE_LEVEL_TENANT_ID: "uitest" }, respond: () => [] });
  assert.equal(t.xhrCalls.length, 0);
});

test("kill switch disables only on an explicit true", () => {
  assert.equal(loadShim({ config: { ANALYTICS_KILL_SWITCH: true }, respond: () => [] }).xhrCalls.length, 0);
  // Anything else — including the string "true", undefined and null — is NOT a
  // kill, because getConfig returns undefined on environments whose
  // globalConfigs.js predates the key and those must keep working.
  assert.equal(loadShim({ config: { ANALYTICS_KILL_SWITCH: "true" }, respond: () => [] }).xhrCalls.length, 1);
  assert.equal(loadShim({ config: {}, respond: () => [] }).xhrCalls.length, 1);
});

test("per-browser opt-out disables everything", () => {
  const t = loadShim({ local: { "digit.analytics.off": "1" }, respond: () => [] });
  assert.equal(t.xhrCalls.length, 0);
});

test("TESTING_MODE disables everything", () => {
  const t = loadShim({ config: { TESTING_MODE: true }, respond: () => [] });
  assert.equal(t.xhrCalls.length, 0);
});

test("a non-canonical entrance disables everything", () => {
  // Kong prefix-matches /digit-ui with strip_path:false, so /digit-ui-test/ and
  // /digit-ui-zzz/ serve this same bundle. That traffic must never be tracked.
  for (const p of ["/digit-ui-test/employee/pgr/inbox", "/digit-ui-zzz/citizen/pgr"]) {
    const t = loadShim({ pathname: p, respond: () => [] });
    assert.equal(t.xhrCalls.length, 0, p);
  }
});

test("Do Not Track disables everything and cannot be overridden by data", () => {
  const t = loadShim({ dnt: "1", respond: () => [row("mz", MATOMO_OK)] });
  assert.equal(t.xhrCalls.length, 0);
});

test("the registry read is anonymous, single-header, bounded and boolean-free", () => {
  const t = loadShim({ respond: () => [] });
  const call = t.xhrCalls[0];
  assert.equal(call.url, "/mdms-v2/v2/_search");
  assert.deepEqual(Object.keys(call.headers), ["Content-Type"], "extra headers break the live CORS allowlist");
  assert.equal(call.withCredentials, false);
  assert.equal(call.criteria.limit, 200, "MDMS silently pages at 10 without an explicit limit");
  assert.ok(!call.criteria.filters, "a boolean in filters silently returns 0 rows");
});

test("MDMS_V2_CONTEXT_PATH is honoured rather than hardcoded", () => {
  const t = loadShim({ config: { MDMS_V2_CONTEXT_PATH: "mdms-v2-custom" }, respond: () => [] });
  assert.equal(t.xhrCalls[0].url, "/mdms-v2-custom/v2/_search");
});

test("a city tenant adds a second read, and the same tenant does not", () => {
  const withCity = loadShim({
    session: { "Digit.Employee.tenantId": JSON.stringify({ value: "mz.ige", expiry: Date.now() + 60000 }) },
    respond: () => [],
  });
  assert.equal(withCity.xhrCalls.length, 2);
  assert.deepEqual(withCity.xhrCalls.map((c) => c.criteria.tenantId), ["mz", "mz.ige"]);

  const sameTenant = loadShim({
    session: { "Digit.Employee.tenantId": JSON.stringify({ value: "mz", expiry: Date.now() + 60000 }) },
    respond: () => [],
  });
  assert.equal(sameTenant.xhrCalls.length, 1);
});

test("an expired city envelope reads as unknown, never as the state tenant", () => {
  const t = loadShim({
    session: { "Digit.Employee.tenantId": JSON.stringify({ value: "mz.ige", expiry: Date.now() - 1000 }) },
    respond: () => [],
  });
  assert.equal(t.xhrCalls.length, 1, "expired storage must not be treated as a live city");
});

test("a transport failure yields no providers rather than failing open", () => {
  const t = loadShim({ respond: () => null }); // never responds
  assert.equal(t.internal.providers(), 0);
  assert.equal(t.scripts.length, 0);
});

/* ─────────────────────── merge (city wins) ─────────────────────── */

test("collect drops foreign-tenant rows, which is what stops the fallback double-count", () => {
  const { internal } = loadShim({ respond: () => [] });
  // A data _search at a city returns the STATE rows while the city owns none.
  const rows = [row("mz", MATOMO_OK)];
  assert.equal(internal.collect(rows, "mz").length, 1);
  assert.equal(internal.collect(rows, "mz.ige").length, 0);
});

test("collect drops envelope-inactive rows", () => {
  const { internal } = loadShim({ respond: () => [] });
  assert.equal(internal.collect([row("mz", MATOMO_OK, false)], "mz").length, 0);
});

test("a city row replaces the state row of the same code, wholesale", () => {
  const { internal } = loadShim({ respond: () => [] });
  const state = [{ code: "m", type: "MATOMO", enabled: true, siteId: "1" }];
  const city = [{ code: "m", type: "MATOMO", enabled: true, siteId: "7" }];
  const merged = internal.mergeByCode(state, city);
  assert.equal(merged.length, 1, "no duplicate");
  assert.equal(merged[0].siteId, "7", "city wins");
});

test("a city row with enabled:false overrides an enabled state row (per-city opt-out)", () => {
  const { internal } = loadShim({ respond: () => [] });
  const merged = internal.mergeByCode(
    [{ code: "m", type: "MATOMO", enabled: true, siteId: "1" }],
    [{ code: "m", type: "MATOMO", enabled: false, siteId: "1" }]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].enabled, false, "a pilot city must be able to opt out");
});

test("city-only codes are additive", () => {
  const { internal } = loadShim({ respond: () => [] });
  const merged = internal.mergeByCode(
    [{ code: "a", type: "MATOMO", enabled: true, siteId: "1" }],
    [{ code: "b", type: "MATOMO", enabled: true, siteId: "2" }]
  );
  assert.deepEqual(merged.map((r) => r.code), ["a", "b"]);
});

test("surfaces gates by citizen/employee and empty means both", () => {
  const { internal } = loadShim({ respond: () => [] });
  assert.equal(internal.surfaceAllowed({ surfaces: "" }, "citizen"), true);
  assert.equal(internal.surfaceAllowed({ surfaces: "citizen" }, "citizen"), true);
  assert.equal(internal.surfaceAllowed({ surfaces: "citizen" }, "employee"), false);
  assert.equal(internal.surfaceAllowed({ surfaces: "citizen, employee" }, "employee"), true);
});

/* ───────────────────────────── validate ───────────────────────────── */

test("validate enforces per-type required fields with stable reason codes", () => {
  const { internal: i } = loadShim({ respond: () => [] });
  const R = i.REASONS;
  const cases = [
    [{}, R.MISSING_CODE],
    [{ code: "x" }, R.MISSING_TYPE],
    [{ code: "x", type: "MATOMO" }, R.DISABLED],
    [{ code: "x", type: "NOPE", enabled: true }, R.UNKNOWN_TYPE],
    [{ code: "x", type: "MATOMO", enabled: true }, R.MISSING_SITE_ID],
    [{ code: "x", type: "MATOMO", enabled: true, siteId: "1" }, R.MISSING_SCRIPT_URL],
    [{ code: "x", type: "MATOMO", enabled: true, siteId: "1", scriptUrl: "http://matomo.mz.gov.mz/matomo.js" }, R.SCRIPT_URL_NOT_HTTPS],
    [{ code: "x", type: "MATOMO", enabled: true, siteId: "1", scriptUrl: "https://evil.example.com/m.js" }, R.SCRIPT_URL_HOST_NOT_ALLOWED],
    [{ code: "x", type: "GA4", enabled: true }, R.MISSING_MEASUREMENT_ID],
    [{ code: "x", type: "POSTHOG", enabled: true }, R.MISSING_API_KEY],
    [{ code: "x", type: "SENTRY", enabled: true }, R.MISSING_DSN],
    [{ code: "x", type: "SENTRY", enabled: true, dsn: "not-a-dsn" }, R.MISSING_DSN],
    [{ code: "x", type: "MATOMO", enabled: true, siteId: "1", scriptUrl: "https://matomo.mz.gov.mz/matomo.js", sampleRate: 2 }, R.BAD_SAMPLE_RATE],
  ];
  for (const [rec, reason] of cases) {
    const v = i.validate(rec);
    assert.equal(v.ok, false, JSON.stringify(rec));
    assert.equal(v.reason, reason, JSON.stringify(rec));
  }
  assert.equal(i.validate(MATOMO_OK).ok, true);
  assert.equal(i.validate({ code: "g", type: "GA4", enabled: true, measurementId: "G-ABC123" }).ok, true);
  assert.equal(i.validate({ code: "s", type: "SENTRY", enabled: true, dsn: "https://abc123@o1.ingest.us.sentry.io/456" }).ok, true);
});

test("CUSTOM is refused unless ops opted in, even when otherwise valid", () => {
  const custom = {
    code: "c", type: "CUSTOM", enabled: true,
    adapter: {
      scriptUrl: "https://matomo.mz.gov.mz/x.js", globalName: "_xq",
      callTemplates: { pageView: [["trackPage", "{{page}}"]] },
    },
  };
  const off = loadShim({ respond: () => [] }).internal;
  assert.equal(off.validate(custom).reason, off.REASONS.CUSTOM_DISABLED_BY_OPS);
  const on = loadShim({ config: { ANALYTICS_CUSTOM_ENABLED: true }, respond: () => [] }).internal;
  assert.equal(on.validate(custom).ok, true);
});

test("CUSTOM records cannot claim a dangerous global or smuggle a placeholder", () => {
  const { internal: i } = loadShim({ config: { ANALYTICS_CUSTOM_ENABLED: true }, respond: () => [] });
  const base = (adapter) => ({ code: "c", type: "CUSTOM", enabled: true, adapter });
  const ok = { scriptUrl: "https://matomo.mz.gov.mz/x.js", globalName: "_xq", callTemplates: { pageView: [["p", "{{page}}"]] } };

  assert.equal(i.validate(base(Object.assign({}, ok, { globalName: "Digit" }))).reason, i.REASONS.BAD_GLOBAL_NAME);
  assert.equal(i.validate(base(Object.assign({}, ok, { globalName: "noUnderscore" }))).reason, i.REASONS.BAD_GLOBAL_NAME);
  assert.equal(i.validate(base(Object.assign({}, ok, { globalName: "_dataLayer!" }))).reason, i.REASONS.BAD_GLOBAL_NAME);
  assert.equal(
    i.validate(base({ scriptUrl: ok.scriptUrl, globalName: "_xq", callTemplates: { pageView: [["p", "{{token}}"]] } })).reason,
    i.REASONS.BAD_PLACEHOLDER
  );
  assert.equal(
    i.validate(base({ scriptUrl: ok.scriptUrl, globalName: "_xq", callTemplates: { pageView: [["p", "{{sur{{page}}face}}"]] } })).reason,
    i.REASONS.BAD_PLACEHOLDER
  );
  assert.equal(
    i.validate(base({ scriptUrl: ok.scriptUrl, globalName: "_xq", __proto__: {}, callTemplates: { pageView: [["p", "x"]] }, "constructor": 1 })).reason,
    i.REASONS.FORBIDDEN_KEY
  );
  const huge = { scriptUrl: ok.scriptUrl, globalName: "_xq", callTemplates: { pageView: [["p", new Array(400).join("ab")]] } };
  assert.equal(i.validate(base(huge)).reason, i.REASONS.TEMPLATE_TOO_LARGE);
});

test("the script host allowlist accepts vendor patterns and rejects everything else", () => {
  const { internal: i } = loadShim({ respond: () => [] });
  for (const h of ["www.googletagmanager.com", "js.sentry-cdn.com", "o1.ingest.us.sentry.io", "eu.posthog.com", "matomo.mz.gov.mz"]) {
    assert.equal(i.hostAllowed(h), true, h);
  }
  for (const h of ["evil.example.com", "posthog.com.evil.net", "notmatomo.com", ""]) {
    assert.equal(i.hostAllowed(h), false, h);
  }
});

test("ops can widen the allowlist but MDMS cannot", () => {
  const t = loadShim({ config: { ANALYTICS_SCRIPT_HOSTS: ["stats.mz.gov.mz"] }, respond: () => [] });
  assert.equal(t.internal.hostAllowed("stats.mz.gov.mz"), true);
  assert.equal(t.internal.hostAllowed("other.mz.gov.mz"), false);
});

/* ───────────────────────────── scrubbing ───────────────────────────── */

test("every live complaint-id format is parameterised, including one-letter prefixes", () => {
  const { internal: i } = loadShim({ respond: () => [] });
  const ids = ["PRD-2026-000023", "P-2026-000037", "E-2026-000022", "TST-2026-000020", "PG-PGR-2026-08-04-000123"];
  for (const id of ids) {
    assert.equal(i.scrub("/employee/pgr/complaint-details/" + id), "/employee/pgr/complaint-details/:id", id);
  }
});

test("uuids, mobile numbers, emails and numeric segments never survive", () => {
  const { internal: i } = loadShim({ respond: () => [] });
  assert.equal(i.scrub("/employee/hrms/details/9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f"), "/employee/hrms/details/:uuid");
  assert.equal(i.scrub("/citizen/pgr/841234567"), "/citizen/pgr/:num");
  assert.equal(i.scrub("contact hari@example.gov.mz now"), "contact :email now");
  assert.equal(i.scrub("/employee/pgr/42"), "/employee/pgr/:n");
});

test("the query string is default-deny", () => {
  const { internal: i } = loadShim({ respond: () => [] });
  assert.equal(i.scrubQuery("?tenantId=mz.ige&module=pgr"), "?tenantId=mz.ige&module=pgr");
  assert.equal(i.scrubQuery("?mobileNumber=841234567"), "");
  assert.equal(i.scrubQuery("?authToken=abc&ts=1783412541615"), "");
  assert.equal(i.scrubQuery("?tenantId=mz&id=PRD-2026-000023"), "?tenantId=mz");
});

/* ──────────────────────── CUSTOM interpolation ──────────────────────── */

test("interpolation resolves only allowlisted placeholders and scrubs the result", () => {
  const { internal: i } = loadShim({ respond: () => [] });
  const map = i.placeholderMap({
    surface: "citizen", entrance: "digit-ui", stateTenant: "mz", cityTenant: "mz.ige",
    page: "/citizen/pgr", locale: "pt_PT", module: "pgr", contextPath: "digit-ui",
    referrerHost: "localhost", now: 1, event: { name: "e", category: "c", action: "a", label: "PRD-2026-000023" }, error: null,
  });
  assert.equal(i.interpolate("{{page}}", map), "/citizen/pgr");
  assert.equal(i.interpolate("{{token}}", map), "", "unknown placeholders render empty, never literal");
  assert.equal(i.interpolate("{{eventLabel}}", map), ":id", "interpolated values are scrubbed");
  assert.equal(i.interpolate("{{sur{{page}}face}}", map), "", "no second pass: nothing can be smuggled");
  assert.equal(i.interpolate(new Array(400).join("z"), map).length, 200, "arguments are truncated");
});

/* ──────────────────────── activation behaviour ──────────────────────── */

test("an enabled Matomo record initialises exactly one allowlisted script", () => {
  const t = loadShim({ respond: (tenant) => (tenant === "mz" ? [row("mz", MATOMO_OK)] : []) });
  assert.equal(t.internal.providers(), 1);
  assert.equal(t.scripts.length, 1);
  assert.equal(t.scripts[0].src, "https://matomo.mz.gov.mz/matomo.js");
  assert.equal(t.scripts[0].crossOrigin, "anonymous");
  assert.equal(t.scripts[0].referrerPolicy, "no-referrer");
  const paq = t.sandbox._paq.map((c) => c[0]);
  assert.ok(paq.indexOf("setSiteId") !== -1 && paq.indexOf("trackPageView") !== -1);
});

test("a record whose script host is not allowlisted loads nothing", () => {
  const bad = Object.assign({}, MATOMO_OK, { code: "evil", scriptUrl: "https://evil.example.com/m.js" });
  const t = loadShim({ respond: (tenant) => (tenant === "mz" ? [row("mz", bad)] : []) });
  assert.equal(t.internal.providers(), 0);
  assert.equal(t.scripts.length, 0);
});

test("a disabled record is inert, and one bad record does not stop a good sibling", () => {
  const t = loadShim({
    respond: (tenant) => (tenant === "mz"
      ? [row("mz", { code: "off", type: "MATOMO", enabled: false, siteId: "1", scriptUrl: MATOMO_OK.scriptUrl }),
         row("mz", { code: "broken", type: "MATOMO", enabled: true }),
         row("mz", MATOMO_OK)]
      : []),
  });
  assert.equal(t.internal.providers(), 1);
  assert.equal(t.scripts.length, 1);
});

test("the registry response is cached, including the negative result", () => {
  const t = loadShim({ respond: () => [] });
  assert.ok(t.session["digit.analytics.registry"], "an env with no providers must not re-probe every navigation");
  const cached = JSON.parse(t.session["digit.analytics.registry"]);
  assert.equal(cached.key, "mz|-");
  assert.deepEqual(cached.rows, []);

  // A warm cache short-circuits the network entirely.
  const warm = loadShim({ session: t.session, respond: () => { throw new Error("must not fetch"); } });
  assert.equal(warm.xhrCalls.length, 0);
});

test("a provider waits for the surface to be decidable, then activates on the route change", () => {
  // Regression: the app boots at /digit-ui/, which is neither the citizen nor
  // the employee surface. A record scoped to both must NOT be discarded there —
  // it has to wait for the SPA's first route and activate then. Found in a real
  // browser: the record was silently dropped at init and never tracked.
  const t = loadShim({
    pathname: "/digit-ui/",
    respond: (tenant) => (tenant === "mz" ? [row("mz", Object.assign({}, MATOMO_OK, { surfaces: "citizen,employee" }))] : []),
  });
  assert.equal(t.internal.providers(), 0, "not yet: the surface is undecidable on the landing path");
  assert.equal(t.scripts.length, 0, "and nothing may load before we know the surface");

  t.sandbox.history.pushState({}, "", "/digit-ui/citizen/pgr/complaints");
  t.flush();

  assert.equal(t.internal.providers(), 1, "activates once the surface is known");
  assert.equal(t.scripts.length, 1);
});

test("a record scoped to the other surface stays inert", () => {
  const t = loadShim({
    pathname: "/digit-ui/employee/pgr/inbox",
    respond: (tenant) => (tenant === "mz" ? [row("mz", Object.assign({}, MATOMO_OK, { surfaces: "citizen" }))] : []),
  });
  assert.equal(t.internal.providers(), 0);
  assert.equal(t.scripts.length, 0);
});

test("trackEvent is a no-op when nothing is configured", () => {
  const t = loadShim({ respond: () => [] });
  assert.doesNotThrow(() => t.api.trackEvent("save_clicked", { category: "pgr" }));
});
