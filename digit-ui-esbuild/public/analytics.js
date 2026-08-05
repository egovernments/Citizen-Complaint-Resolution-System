/*
 * analytics.js — provider-agnostic analytics shim for the DIGIT esbuild UI.
 *
 * WHAT THIS IS
 *   Destinations are DATA: one MDMS row per destination in
 *   common-masters.AnalyticsProvider, edited by admins in the Configurator.
 *   This file reads those rows and initialises the ones that are enabled. With
 *   no rows (the state of every environment until an admin acts) it issues at
 *   most two anonymous reads and then does nothing at all.
 *
 * LANGUAGE LEVEL: ES5. This file lives in public/ and is NOT processed by
 *   esbuild — it is copied byte-for-byte into build/. No arrow functions, no
 *   let/const, no template literals, no optional chaining, no Object.assign,
 *   no Array.includes, no Promise. Verify with `node --check`.
 *
 * DEFAULT-OFF, AND EVERY FAILURE PATH MEANS "NO PROVIDERS"
 *   Note the deliberate inversion versus products/dashboard/src/services/
 *   dashboardMetrics.js, which is default-ON and fails OPEN (catch -> true).
 *   Reviewers will pattern-match on that file; this one is the opposite on
 *   purpose. A thrown exception, a network error, a malformed row or an unknown
 *   provider type must never result in tracking, and must never break the page.
 *
 * NOT RELATED TO THE DASHBOARD'S TELEMETRY
 *   products/dashboard/.../dashboardMetrics.js emits OTLP render-lag metrics to
 *   the in-cluster /otel collector, and REACT_APP_ANALYTICS_BASE is the
 *   dashboard's *backend* API. Neither is touched here. This shim does not
 *   measure performance, does not inject traceparent, and never posts to /otel.
 *
 * PII
 *   ctx (the only thing adapters can see) structurally cannot carry identity:
 *   no token, no uuid, no user name, no mobile number, no email, no full href,
 *   no document.title. Everything string-shaped is passed through scrub()
 *   first. Operator-supplied patterns are APPENDED to the built-ins, never
 *   replace them.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Constants                                                           *
   * ------------------------------------------------------------------ */

  var SCHEMA_CODE = "common-masters.AnalyticsProvider";
  var CACHE_KEY = "digit.analytics.registry";
  var CACHE_TTL_MS = 90000; /* 90s: an admin toggle shows up on the next load */
  var FETCH_TIMEOUT_MS = 4000;
  var PAGE_LIMIT = 200; /* MDMS pages at 10 with no explicit limit */
  var MAX_ADAPTER_BYTES = 8192;
  var MAX_TEMPLATE_HOOKS = 3;
  var MAX_TEMPLATE_ARGS = 8;
  var MAX_ARG_CHARS = 200;
  var MAX_THROWS = 3; /* self-mute an adapter after this many throws */

  /* Compile-time script-host allowlist. MDMS CANNOT widen this; only the
   * ops-controlled ANALYTICS_SCRIPT_HOSTS globalConfigs key can. This is the
   * only control standing between "an employee can write an MDMS row" and
   * "script execution on every citizen page" — there is no CSP on any env.
   *
   * Only two shapes are allowed: an exact host, or "*.suffix" which matches on a
   * DOT BOUNDARY. There is deliberately no prefix wildcard: a pattern like
   * "matomo.*" would accept matomo.<anything-an-attacker-registers>.com, which
   * is not a control at all. A self-hosted Matomo (or any first-party
   * collector) is environment-specific, so its host belongs in the ops-only
   * ANALYTICS_SCRIPT_HOSTS key rather than baked in here. */
  var HOST_ALLOWLIST = [
    "www.googletagmanager.com",
    "js.sentry-cdn.com",
    "browser.sentry-cdn.com",
    "*.sentry.io",
    "*.posthog.com"
  ];

  /* Globals a CUSTOM record may never claim. */
  var GLOBAL_DENYLIST = [
    "Digit", "eGov", "globalConfigs", "contextPath", "globalPath", "i18next",
    "__applyTheme", "__DIGIT_USER_VALIDATION", "XLSX", "Keycloak", "process",
    "dataLayer", "posthog", "Sentry"
  ];

  /* The complete set of placeholders a CUSTOM template may use. Deliberately
   * no errorMessage, no href, no user, no token, no storage access. */
  var PLACEHOLDERS = [
    "surface", "entrance", "stateTenant", "cityTenant", "page", "locale",
    "module", "contextPath", "referrerHost", "now", "eventName",
    "eventCategory", "eventAction", "eventLabel", "eventValue", "errorName"
  ];

  /* ------------------------------------------------------------------ *
   * Tiny helpers (no library, and no console noise on the quiet path)   *
   * ------------------------------------------------------------------ */

  function gc(key) {
    try {
      if (window.globalConfigs && typeof window.globalConfigs.getConfig === "function") {
        return window.globalConfigs.getConfig(key);
      }
    } catch (e) {}
    return undefined;
  }

  /* console.debug only. local-setup/tests/e2e asserts ZERO console errors
   * across the employee flow, and "no providers configured" is the normal
   * state of most environments — it must be silent at warn level and above. */
  function dbg(msg) {
    try {
      if (window.console && typeof window.console.debug === "function") {
        window.console.debug("[analytics] " + msg);
      }
    } catch (e) {}
  }

  function indexOf(arr, v) {
    if (!arr) return -1;
    for (var i = 0; i < arr.length; i++) { if (arr[i] === v) return i; }
    return -1;
  }

  function isStr(v) { return typeof v === "string"; }
  function trim(s) { return isStr(s) ? s.replace(/^\s+|\s+$/g, "") : ""; }

  /* Realm-safe array test. `x instanceof Array` is FALSE for an array created in
   * another realm — an iframe, or the vm context the unit tests run the shim in.
   * Array.isArray is ES5.1 and has no such hole. */
  function isArray(v) {
    return Array.isArray ? Array.isArray(v) : Object.prototype.toString.call(v) === "[object Array]";
  }

  function splitList(s) {
    var out = [];
    if (!isStr(s)) return out;
    var parts = s.split(",");
    for (var i = 0; i < parts.length; i++) {
      var p = trim(parts[i]);
      if (p) out.push(p);
    }
    return out;
  }

  function lsGet(key) {
    try {
      var v = window.localStorage ? window.localStorage.getItem(key) : null;
      if (!v || v === "undefined" || v === "null") return null;
      return v;
    } catch (e) { return null; }
  }

  function ssGet(key) {
    try {
      var v = window.sessionStorage ? window.sessionStorage.getItem(key) : null;
      if (!v || v === "undefined" || v === "null") return null;
      return v;
    } catch (e) { return null; }
  }

  function parseMaybeJSON(v) {
    if (!v) return null;
    try { return JSON.parse(v); } catch (e) { return v; }
  }

  /* Digit's Storage helper keys everything as `Digit.<key>` and wraps values as
   * {value, ttl, expiry}, deleting them past expiry. A long-lived tab can hold
   * an EXPIRED city — which must read as "unknown", never as the state tenant,
   * because misattributed data is worse than missing data. */
  function digitEnvelope(key) {
    var raw = ssGet("Digit." + key);
    if (!raw) return null;
    var parsed = parseMaybeJSON(raw);
    if (!parsed || typeof parsed !== "object") return parsed;
    if (parsed.expiry && typeof parsed.expiry === "number" && parsed.expiry < new Date().getTime()) {
      return null;
    }
    return typeof parsed.value !== "undefined" ? parsed.value : parsed;
  }

  function hostMatches(host, pattern) {
    if (!isStr(host) || !isStr(pattern) || !host || !pattern) return false;
    host = host.toLowerCase();
    pattern = pattern.toLowerCase();
    if (pattern === host) return true;
    if (pattern.indexOf("*.") === 0) {
      /* Dot-boundary suffix match: "*.posthog.com" accepts eu.posthog.com but
       * NOT posthog.com.evil.net, and never the bare suffix itself. */
      var suffix = pattern.substring(1); /* ".posthog.com" */
      return host.length > suffix.length && host.substring(host.length - suffix.length) === suffix;
    }
    return false;
  }

  function hostAllowed(host) {
    var extra = gc("ANALYTICS_SCRIPT_HOSTS");
    var list = HOST_ALLOWLIST.slice(0);
    if (extra && extra.length) {
      /* array or comma-separated string, both tolerated */
      var add = isStr(extra) ? splitList(extra) : extra;
      for (var i = 0; i < add.length; i++) { list.push(add[i]); }
    }
    for (var j = 0; j < list.length; j++) {
      if (hostMatches(host, list[j])) return true;
    }
    return false;
  }

  /* Host of an https URL, or "" if the URL is anything we are not certain about.
   * The authority must NOT contain userinfo: in "https://matomo.io@evil.com/x.js"
   * the real host is evil.com, but a naive parse reports "matomo.io@evil.com" and
   * would sail past a host check. Anything with "@", or an empty/odd authority,
   * returns "" and therefore fails the allowlist. */
  function urlHost(url) {
    if (!isStr(url)) return "";
    var m = /^https:\/\/([^\/?#]+)/i.exec(url);
    if (!m) return "";
    var authority = m[1];
    if (authority.indexOf("@") !== -1) return "";
    var host = authority.split(":")[0]; /* drop an explicit port */
    if (!host || host.indexOf("..") !== -1) return "";
    return host;
  }

  /* A SAME-ORIGIN path: "/matomo/matomo.js". Strictly safer than any absolute
   * URL — it cannot reach a third party, it inherits the page's scheme (so it
   * works on the http-only environments where mctd and the local box live), and
   * no host allowlist applies because the host IS the portal's own.
   *
   * Everything that only LOOKS same-origin must be refused:
   *   "//evil.com/x.js"     protocol-relative — a foreign origin
   *   "/\evil.com/x.js"     backslash; some parsers treat it as a separator
   *   "/x?://y"             anything carrying a scheme separator
   *   "javascript:..."      not a path at all
   *   whitespace/control chars, which browsers strip before parsing
   * The test is deliberately whitelist-shaped: one leading slash, then only
   * characters we are willing to name. */
  var RE_SAME_ORIGIN_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]*$/;
  var RE_SAME_ORIGIN_QUERY = /^[A-Za-z0-9._~!$&'()*+,;=:@%\/?-]*$/;

  function isSameOriginPath(url) {
    if (!isStr(url) || url.length < 2) return false;
    if (url.charAt(0) !== "/" || url.charAt(1) === "/") return false; /* "//host" */
    if (url.indexOf("\\") !== -1) return false;
    if (url.indexOf("://") !== -1) return false;
    if (url.indexOf("#") !== -1) return false; /* a fragment is meaningless here */
    if (/[\s\u0000-\u001f\u007f]/.test(url)) return false;

    /* Split an optional query: a cache-busted "/matomo/matomo.js?v=5" is
     * legitimate, so validate the two halves separately. */
    var q = url.indexOf("?");
    var path = q === -1 ? url : url.substring(0, q);
    var query = q === -1 ? "" : url.substring(q + 1);
    if (!RE_SAME_ORIGIN_PATH.test(path)) return false;
    if (query && !RE_SAME_ORIGIN_QUERY.test(query)) return false;

    /* THE IMPORTANT ONE. A path under the SPA's own entrance prefix is served by
     * `try_files ... /index.html`, so it answers 200 with the HTML shell — and
     * injecting that as a script throws an uncaught SyntaxError on every page
     * load. Same trap the index.html bootstrapper guards against for the shim's
     * own file; a same-origin scriptUrl reopens it, so refuse those paths.
     * Covers the canonical entrance, the testing entrance and Kong's
     * prefix-match typo paths, all of which begin with the context path. */
    var cp = contextPath();
    var seg = path.split("/")[1] || "";
    if (cp && seg.indexOf(cp) === 0) return false;

    return true;
  }

  /* One script loader for every adapter. async, no credentials leakage, and
   * the host allowlist is re-checked here so a bypassed validate() still
   * cannot load a foreign script. */
  var loaded = {};
  function loadScript(url, onload) {
    var sameOrigin = isSameOriginPath(url);
    if (!sameOrigin) {
      if (!isStr(url) || url.indexOf("https://") !== 0) return false;
      if (!hostAllowed(urlHost(url))) { dbg("script host not allowed: " + urlHost(url)); return false; }
    }
    if (loaded[url]) { if (onload) { try { onload(); } catch (e) {} } return true; }
    loaded[url] = true;
    try {
      var s = document.createElement("script");
      s.async = true;
      s.src = url;
      /* crossOrigin only makes sense for a cross-origin fetch; setting it on a
       * same-origin script needlessly demands CORS headers from our own nginx. */
      if (!sameOrigin) s.crossOrigin = "anonymous";
      s.referrerPolicy = "no-referrer";
      if (onload) { s.onload = function () { try { onload(); } catch (e) {} }; }
      s.onerror = function () { dbg("script failed to load: " + url); };
      (document.head || document.documentElement).appendChild(s);
      return true;
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ *
   * PII scrubber                                                        *
   * ------------------------------------------------------------------ */

  /* Complaint / service-request ids. The live IdFormat rows differ PER TENANT
   * and some cities use a ONE-letter prefix, so the leading class must accept a
   * single letter:  PRD-2026-000023 (mz), P-2026-000037 (mz.ige),
   * E-2026-000022 (mz.igsae), TST-2026-000020, PG-PGR-2026-08-04-000123. */
  var RE_ID = /\b[A-Z][A-Z-]{0,12}-\d{4}(?:-\d{2}){0,2}-\d{3,}\b/g;
  var RE_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  var RE_LONGNUM = /\b\d{8,15}\b/g; /* MZ mobiles are 9 digits, IN 10 */
  var RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
  var RE_NUMSEG = /\/\d+(?=\/|$)/g;

  /* Query params that may survive. DEFAULT-DENY: everything else is dropped,
   * including `ts` (a cache-buster with unbounded cardinality) and every id. */
  var QUERY_ALLOW = [
    "tenantId", "module", "moduleName", "masterName", "key", "locale",
    "preview", "builderPreview"
  ];

  var extraScrubbers = []; /* compiled from operator scrubPatterns, appended */

  function scrub(s) {
    if (!isStr(s) || !s) return "";
    var out = s;
    out = out.replace(RE_ID, ":id");
    out = out.replace(RE_UUID, ":uuid");
    out = out.replace(RE_LONGNUM, ":num");
    out = out.replace(RE_EMAIL, ":email");
    out = out.replace(RE_NUMSEG, "/:n");
    for (var i = 0; i < extraScrubbers.length; i++) {
      try { out = out.replace(extraScrubbers[i], ":x"); } catch (e) {}
    }
    return out;
  }

  function scrubQuery(search) {
    if (!isStr(search) || search.length < 2) return "";
    var kept = [];
    var pairs = search.replace(/^\?/, "").split("&");
    for (var i = 0; i < pairs.length; i++) {
      if (!pairs[i]) continue;
      var eq = pairs[i].indexOf("=");
      var k = eq === -1 ? pairs[i] : pairs[i].substring(0, eq);
      var v = eq === -1 ? "" : pairs[i].substring(eq + 1);
      if (indexOf(QUERY_ALLOW, k) !== -1) {
        kept.push(k + "=" + scrub(decodeURIComponentSafe(v)));
      }
    }
    return kept.length ? "?" + kept.join("&") : "";
  }

  function decodeURIComponentSafe(v) {
    try { return decodeURIComponent(v); } catch (e) { return v; }
  }

  function contextPath() { return gc("CONTEXT_PATH") || "digit-ui"; }

  function firstSegment() {
    try {
      var m = /^\/([^\/?#]+)/.exec(window.location.pathname || "");
      return m ? m[1] : "";
    } catch (e) { return ""; }
  }

  /* Strip the context prefix by CONFIG, never by the literal "/digit-ui" —
   * the testing entrance and the container surface serve other prefixes. */
  function currentPage() {
    var path = "";
    try { path = window.location.pathname || ""; } catch (e) { return ""; }
    var cp = contextPath();
    if (cp && path.indexOf("/" + cp) === 0) path = path.substring(cp.length + 1);
    if (!path) path = "/";
    var q = "";
    try { q = scrubQuery(window.location.search || ""); } catch (e) {}
    return scrub(path) + q;
  }

  function currentSurface() {
    var p = "";
    try { p = window.location.pathname || ""; } catch (e) {}
    if (p.indexOf("/citizen") !== -1) return "citizen";
    if (p.indexOf("/employee") !== -1) return "employee";
    return "unknown";
  }

  function currentModule() {
    var page = currentPage();
    var m = /^\/(?:citizen|employee)\/([a-z0-9-]+)/i.exec(page);
    return m ? m[1] : "";
  }

  /* ------------------------------------------------------------------ *
   * Page titles — DERIVED, never localised                              *
   *                                                                      *
   * Built from the already-scrubbed, already-parameterised page path, so a
   * title can never contain a complaint id or a mobile number by
   * construction rather than by remembering to exclude one.
   *
   * Derivation means a NEW route gets a sensible title automatically. The
   * alternative — a hand-maintained route->title map — falls through to a
   * placeholder the moment someone adds a screen and forgets the map, and on
   * this codebase routes are assembled from constants rather than literals, so
   * that drift is close to certain.
   *
   * DELIBERATELY NOT LOCALISED. This tenant already runs two locales, so a
   * localised title would split one page into one report row PER LANGUAGE:
   * totals fragment, trends break when a translation is edited, and
   * cross-tenant comparison stops working. `locale` is already sent as its own
   * dimension, which gives the language insight without corrupting page
   * identity. Operators wanting translated labels should relabel at the
   * reporting layer, where it is reversible.
   *
   * This function also never touches document.title: an analytics script must
   * not mutate the host application's UI. */

  /* The only part that cannot be derived: a module CODE carries no clue to its
   * name. Small and slow-changing (a new module is a deliberate, rare event,
   * unlike a new route). A code that is missing here still yields a usable
   * title — "Pgr · Inbox · Employee" — which makes the gap visible in reports
   * instead of hiding it behind a placeholder. */
  var MODULE_TITLES = {
    pgr: "Complaints",
    dss: "Dashboard",
    hrms: "HRMS",
    user: "Account",
    workbench: "Workbench",
    "sandbox-ui": "Sandbox",
    engagement: "Engagement",
    obps: "Building Permit",
    ws: "Water & Sewerage",
    pt: "Property Tax",
    tl: "Trade License",
    mcollect: "mCollect",
    fsm: "FSM"
  };

  var SURFACE_TITLES = { citizen: "Citizen", employee: "Employee" };

  /* "complaint-details" -> "Complaint Details"; ":id"/":uuid"/":num"/":n"/":email"
   * placeholders are dropped, since they carry no meaning in a title. */
  function deslugify(seg) {
    if (!isStr(seg) || !seg || seg.charAt(0) === ":") return "";
    var words = seg.split("-");
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w) continue;
      out.push(w.charAt(0).toUpperCase() + w.substring(1));
    }
    return out.join(" ");
  }

  /* titleMap / modules overrides come from the record's `settings` bucket, which
   * is an open object precisely so additions never need a schema change. */
  function pageTitle(page, settings) {
    if (!isStr(page)) return "";
    var pathOnly = page.split("?")[0];

    var overrides = settings && typeof settings === "object" ? settings.titleMap : null;
    if (overrides && typeof overrides === "object") {
      /* exact match on the parameterised path wins outright */
      if (isStr(overrides[pathOnly])) return overrides[pathOnly];
    }

    var segs = pathOnly.split("/");
    var clean = [];
    for (var i = 0; i < segs.length; i++) { if (segs[i]) clean.push(segs[i]); }
    if (!clean.length) return "Home";

    var surface = "";
    if (SURFACE_TITLES[clean[0]]) { surface = SURFACE_TITLES[clean[0]]; clean.shift(); }

    var moduleName = "";
    if (clean.length) {
      var code = clean[0];
      var moduleMap = MODULE_TITLES;
      var extra = settings && typeof settings === "object" ? settings.modules : null;
      if (extra && typeof extra === "object" && isStr(extra[code])) moduleName = extra[code];
      else if (isStr(moduleMap[code])) moduleName = moduleMap[code];
      else moduleName = deslugify(code); /* unknown module: honest, not hidden */
      clean.shift();
    }

    var parts = [];
    if (moduleName) parts.push(moduleName);
    for (var j = 0; j < clean.length; j++) {
      var d = deslugify(clean[j]);
      if (d) parts.push(d);
    }
    if (surface) parts.push(surface);
    return parts.length ? parts.join(" \u00b7 ") : (surface || "Home");
  }

  function referrerHost() {
    try {
      var m = /^https?:\/\/([^\/:?#]+)/i.exec(document.referrer || "");
      return m ? m[1] : "";
    } catch (e) { return ""; }
  }

  /* ------------------------------------------------------------------ *
   * Tenant + locale resolution                                          *
   * ------------------------------------------------------------------ */

  function stateTenant() {
    var t = gc("STATE_LEVEL_TENANT_ID");
    if (!isStr(t) || !t) return "";
    if (t === "uitest") return ""; /* the un-rendered template placeholder */
    return t;
  }

  /* Ordered chain. Values may be bare or JSON-quoted; both login writers
   * early-return on multi-root envs, so never depend on one key. */
  function cityTenant() {
    var v = digitEnvelope("Employee.tenantId");
    if (isStr(v) && v) return v;

    var home = digitEnvelope("CITIZEN.COMMON.HOME.CITY");
    if (home && typeof home === "object" && isStr(home.code) && home.code) return home.code;

    var candidates = ["Employee.tenant-id", "Citizen.tenant-id", "tenant-id"];
    for (var i = 0; i < candidates.length; i++) {
      var raw = parseMaybeJSON(lsGet(candidates[i]));
      if (isStr(raw) && raw) return raw;
    }

    var infoKeys = ["Employee.user-info", "Citizen.user-info"];
    for (var j = 0; j < infoKeys.length; j++) {
      var info = parseMaybeJSON(lsGet(infoKeys[j]));
      if (info && typeof info === "object") {
        var t = info.tenantId || info.tenantid;
        if (isStr(t) && t) return t;
      }
    }
    return "";
  }

  /* NEVER localStorage locale/selectedLanguage/i18nextLng — src/index.js
   * normalises all three to a hardcoded "en_IN" on every boot, on both
   * branches, even where the branch default is pt. */
  function currentLocale() {
    var init = digitEnvelope("initData");
    if (init && typeof init === "object" && isStr(init.selectedLanguage) && init.selectedLanguage) {
      return init.selectedLanguage;
    }
    var l = digitEnvelope("locale");
    return isStr(l) ? l : "";
  }

  /* Optional: honour a tenant marked as a testing tenant, where that flag
   * exists (moz family). Absent on develop, so this is a no-op there rather
   * than a dependency. The portable per-tenant opt-out is a city row with
   * enabled:false, which the merge rule treats as authoritative. */
  function activeTenantIsTesting(city) {
    if (!city) return false;
    var init = digitEnvelope("initData");
    var tenants = init && typeof init === "object" ? init.tenants : null;
    if (!tenants || !tenants.length) return false;
    for (var i = 0; i < tenants.length; i++) {
      var t = tenants[i];
      if (t && t.code === city && t.isTestingTenant === true) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * ctx — the only surface adapters can see                             *
   * ------------------------------------------------------------------ */

  function buildCtx(extra) {
    var city = cityTenant();
    var ctx = {
      surface: currentSurface(),
      entrance: firstSegment(),
      stateTenant: stateTenant(),
      cityTenant: city,
      tenantKnown: !!city,
      page: currentPage(),
      title: "",            /* filled per-record below: overrides are per-record */
      locale: currentLocale(),
      module: currentModule(),
      contextPath: contextPath(),
      referrerHost: referrerHost(),
      now: new Date().getTime(),
      dnt: dntOn(),
      event: null,
      error: null,
      scrub: scrub,
      getConfig: gc
    };
    if (extra) {
      if (extra.event) ctx.event = extra.event;
      if (extra.error) ctx.error = extra.error;
    }
    if (Object.freeze) { try { Object.freeze(ctx); } catch (e) {} }
    return ctx;
  }

  /* ctx is frozen, so per-record additions need a shallow copy. */
  function extendCtx(ctx, extra) {
    var out = {};
    for (var k in ctx) { if (ctx.hasOwnProperty(k)) out[k] = ctx[k]; }
    for (var j in extra) { if (extra.hasOwnProperty(j)) out[j] = extra[j]; }
    if (Object.freeze) { try { Object.freeze(out); } catch (e) {} }
    return out;
  }

  /* DNT is hardcoded, deliberately NOT a schema field: no MDMS row may switch
   * off respect for Do Not Track. */
  function dntOn() {
    try {
      if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return true;
    } catch (e) {}
    return false;
  }

  /* ------------------------------------------------------------------ *
   * validate() — the single source of truth for per-type requirements   *
   * The JSON Schema cannot express these (draft-04 validator, no        *
   * if/then/else), so they live here and are mirrored by the            *
   * Configurator's save-time check against a shared fixture table.      *
   * ------------------------------------------------------------------ */

  var REASONS = {
    OK: "ok",
    MISSING_CODE: "missing_code",
    MISSING_TYPE: "missing_type",
    UNKNOWN_TYPE: "unknown_type",
    DISABLED: "disabled",
    MISSING_SITE_ID: "missing_site_id",
    MISSING_MEASUREMENT_ID: "missing_measurement_id",
    MISSING_API_KEY: "missing_api_key",
    MISSING_DSN: "missing_dsn",
    MISSING_SCRIPT_URL: "missing_script_url",
    SCRIPT_URL_NOT_HTTPS: "script_url_not_https",
    SCRIPT_URL_HOST_NOT_ALLOWED: "script_url_host_not_allowed",
    BAD_GLOBAL_NAME: "bad_global_name",
    BAD_SAMPLE_RATE: "bad_sample_rate",
    TEMPLATE_TOO_LARGE: "template_too_large",
    BAD_PLACEHOLDER: "bad_placeholder",
    FORBIDDEN_KEY: "forbidden_key",
    CUSTOM_DISABLED_BY_OPS: "custom_disabled_by_ops"
  };

  function fail(reason) { return { ok: false, reason: reason }; }
  var OK = { ok: true, reason: REASONS.OK };

  function validateScriptUrl(url) {
    if (!isStr(url) || !url) return fail(REASONS.MISSING_SCRIPT_URL);
    /* Same-origin path: no scheme to check, no host to allowlist. */
    if (isSameOriginPath(url)) return OK;
    if (url.indexOf("https://") !== 0) return fail(REASONS.SCRIPT_URL_NOT_HTTPS);
    if (!hostAllowed(urlHost(url))) return fail(REASONS.SCRIPT_URL_HOST_NOT_ALLOWED);
    return OK;
  }

  function validateSampleRate(r) {
    if (typeof r === "undefined" || r === null) return OK;
    if (typeof r !== "number" || r < 0 || r > 1) return fail(REASONS.BAD_SAMPLE_RATE);
    return OK;
  }

  var RE_GLOBAL_NAME = /^_[A-Za-z0-9_]{1,40}$/;
  var FORBIDDEN_KEYS = ["__proto__", "constructor", "prototype"];

  function validateCustomAdapter(rec) {
    var a = rec.adapter;
    if (!a || typeof a !== "object") return fail(REASONS.MISSING_SCRIPT_URL);

    var urlCheck = validateScriptUrl(a.scriptUrl || rec.scriptUrl);
    if (!urlCheck.ok) return urlCheck;

    var name = a.globalName || rec.globalName;
    if (!isStr(name) || !RE_GLOBAL_NAME.test(name) || indexOf(GLOBAL_DENYLIST, name) !== -1) {
      return fail(REASONS.BAD_GLOBAL_NAME);
    }
    /* Never overwrite an existing non-array global. */
    try {
      if (typeof window[name] !== "undefined" && !isArray(window[name])) {
        return fail(REASONS.BAD_GLOBAL_NAME);
      }
    } catch (e) { return fail(REASONS.BAD_GLOBAL_NAME); }

    var serialised;
    try { serialised = JSON.stringify(a); } catch (e) { return fail(REASONS.TEMPLATE_TOO_LARGE); }
    if (!serialised || serialised.length > MAX_ADAPTER_BYTES) return fail(REASONS.TEMPLATE_TOO_LARGE);
    for (var f = 0; f < FORBIDDEN_KEYS.length; f++) {
      if (serialised.indexOf("\"" + FORBIDDEN_KEYS[f] + "\"") !== -1) return fail(REASONS.FORBIDDEN_KEY);
    }

    var t = a.callTemplates;
    if (!t || typeof t !== "object") return fail(REASONS.BAD_PLACEHOLDER);
    var hooks = ["init", "pageView", "event"];
    var hookCount = 0;
    for (var h = 0; h < hooks.length; h++) {
      var calls = t[hooks[h]];
      if (typeof calls === "undefined" || calls === null) continue;
      if (!isArray(calls)) return fail(REASONS.BAD_PLACEHOLDER);
      hookCount++;
      for (var c = 0; c < calls.length; c++) {
        var args = calls[c];
        if (!isArray(args)) return fail(REASONS.BAD_PLACEHOLDER);
        if (args.length > MAX_TEMPLATE_ARGS) return fail(REASONS.TEMPLATE_TOO_LARGE);
        for (var i = 0; i < args.length; i++) {
          var v = args[i];
          if (v === null) continue;
          var ty = typeof v;
          if (ty === "number" || ty === "boolean") continue;
          if (ty !== "string") return fail(REASONS.BAD_PLACEHOLDER);
          if (v.length > MAX_ARG_CHARS) return fail(REASONS.TEMPLATE_TOO_LARGE);
          if (badTemplateString(v)) return fail(REASONS.BAD_PLACEHOLDER);
        }
      }
    }
    if (hookCount > MAX_TEMPLATE_HOOKS) return fail(REASONS.TEMPLATE_TOO_LARGE);
    return OK;
  }

  /* A template string is bad if it names a placeholder we do not publish, OR if
   * any brace survives after every well-formed token is removed. The second half
   * is what kills nesting: "{{sur{{page}}face}}" leaves "{{surface}}" behind,
   * which would otherwise be pushed to the vendor as a half-substituted literal. */
  function badTemplateString(s) {
    if (!isStr(s)) return true;
    var re = /\{\{([a-zA-Z]+)\}\}/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      if (indexOf(PLACEHOLDERS, m[1]) === -1) return true;
    }
    var residue = s.replace(/\{\{[a-zA-Z]+\}\}/g, "");
    return residue.indexOf("{") !== -1 || residue.indexOf("}") !== -1;
  }

  function validate(rec) {
    if (!rec || typeof rec !== "object") return fail(REASONS.MISSING_CODE);
    if (!isStr(rec.code) || !trim(rec.code)) return fail(REASONS.MISSING_CODE);
    if (!isStr(rec.type) || !trim(rec.type)) return fail(REASONS.MISSING_TYPE);
    if (rec.enabled !== true) return fail(REASONS.DISABLED);

    var rate = validateSampleRate(rec.sampleRate);
    if (!rate.ok) return rate;

    var type = trim(rec.type).toUpperCase();
    if (type === "MATOMO") {
      if (!isStr(rec.siteId) || !trim(rec.siteId)) return fail(REASONS.MISSING_SITE_ID);
      return validateScriptUrl(rec.scriptUrl);
    }
    if (type === "GA4") {
      if (!isStr(rec.measurementId) || !trim(rec.measurementId)) return fail(REASONS.MISSING_MEASUREMENT_ID);
      return OK; /* script host is fixed and already allowlisted */
    }
    if (type === "POSTHOG") {
      if (!isStr(rec.apiKey) || !trim(rec.apiKey)) return fail(REASONS.MISSING_API_KEY);
      return validateScriptUrl(posthogScriptUrl(rec));
    }
    if (type === "SENTRY") {
      if (!isStr(rec.dsn) || !parseDsn(rec.dsn)) return fail(REASONS.MISSING_DSN);
      return validateScriptUrl(sentryScriptUrl(rec));
    }
    if (type === "CUSTOM") {
      /* CUSTOM is the one type that can load an operator-named script, so it
       * needs an ops opt-in on top of everything else. Off by default even on
       * an environment where MATOMO or GA4 are running. */
      if (gc("ANALYTICS_CUSTOM_ENABLED") !== true) return fail(REASONS.CUSTOM_DISABLED_BY_OPS);
      return validateCustomAdapter(rec);
    }
    return fail(REASONS.UNKNOWN_TYPE);
  }

  /* ------------------------------------------------------------------ *
   * Adapters                                                            *
   * Each is { init, pageView, event, captureError }. All synchronous and *
   * total; the caller wraps every call and self-mutes after MAX_THROWS.  *
   * ------------------------------------------------------------------ */

  function pushTo(name, args) {
    try {
      if (!isArray(window[name])) window[name] = [];
      window[name].push(args);
    } catch (e) {}
  }

  /* The collector. A same-origin endpoint is fine and is what a self-hosted
   * Matomo behind our own nginx looks like; Matomo's own tracker resolves a
   * relative setTrackerUrl against the page origin. */
  function matomoEndpoint(rec) {
    if (isStr(rec.endpointUrl) && rec.endpointUrl) return rec.endpointUrl;
    if (isStr(rec.scriptUrl) && rec.scriptUrl) return rec.scriptUrl.replace(/matomo\.js(\?.*)?$/, "matomo.php");
    return "";
  }

  function posthogScriptUrl(rec) {
    var host = isStr(rec.endpointUrl) && rec.endpointUrl ? rec.endpointUrl : "https://us.i.posthog.com";
    host = host.replace(/\/+$/, "");
    return host + "/static/array.js";
  }

  function parseDsn(dsn) {
    var m = /^https:\/\/([0-9a-f]+)@([^\/]+)\/(\d+)$/i.exec(trim(dsn));
    if (!m) return null;
    return { key: m[1], host: m[2], project: m[3] };
  }

  function sentryScriptUrl(rec) {
    var d = parseDsn(rec.dsn);
    return d ? "https://js.sentry-cdn.com/" + d.key + ".min.js" : "";
  }

  var ADAPTERS = {

    MATOMO: {
      init: function (rec, ctx) {
        var endpoint = matomoEndpoint(rec);
        if (!endpoint) return;
        pushTo("_paq", ["setTrackerUrl", endpoint]);
        pushTo("_paq", ["setSiteId", String(rec.siteId)]);
        pushTo("_paq", ["setCustomUrl", ctx.page]);
        pushTo("_paq", ["setDocumentTitle", ctx.title || ctx.module || ctx.surface]);
        /* Matomo's own param exclusion, belt to the scrubber's braces. */
        pushTo("_paq", ["setExcludedQueryParams", ["mobileNumber", "mobileNo", "otp", "token", "authToken", "access_token", "uuid", "id", "individualId"]]);
        pushTo("_paq", ["enableLinkTracking", false]);
        loadScript(rec.scriptUrl);
      },
      pageView: function (rec, ctx) {
        pushTo("_paq", ["setCustomUrl", ctx.page]);
        if (ctx.title) pushTo("_paq", ["setDocumentTitle", ctx.title]);
        pushTo("_paq", ["trackPageView"]);
      },
      event: function (rec, ctx) {
        var e = ctx.event || {};
        pushTo("_paq", ["trackEvent", e.category || "ui", e.action || e.name || "event", e.label || "", typeof e.value === "number" ? e.value : undefined]);
      },
      captureError: function (rec, ctx) {
        var er = ctx.error || {};
        pushTo("_paq", ["trackEvent", "error", er.name || "Error", er.message || ""]);
      }
    },

    GA4: {
      init: function (rec, ctx) {
        pushTo("dataLayer", { "gtm.start": ctx.now, event: "gtm.js" });
        gtag("js", new Date());
        gtag("config", rec.measurementId, {
          send_page_view: false,     /* the shim owns pageviews */
          anonymize_ip: true,
          allow_google_signals: false,
          allow_ad_personalization_signals: false
        });
        loadScript("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(rec.measurementId));
      },
      pageView: function (rec, ctx) {
        gtag("event", "page_view", { page_path: ctx.page, page_location: undefined, page_title: ctx.title || ctx.module || ctx.surface });
      },
      event: function (rec, ctx) {
        var e = ctx.event || {};
        gtag("event", e.name || e.action || "event", {
          event_category: e.category || "ui",
          event_label: e.label || "",
          value: typeof e.value === "number" ? e.value : undefined
        });
      },
      captureError: function (rec, ctx) {
        var er = ctx.error || {};
        gtag("event", "exception", { description: er.name || "Error", fatal: false });
      }
    },

    POSTHOG: {
      init: function (rec, ctx) {
        var host = isStr(rec.endpointUrl) && rec.endpointUrl ? rec.endpointUrl.replace(/\/+$/, "") : "https://us.i.posthog.com";
        loadScript(posthogScriptUrl(rec), function () {
          try {
            if (!window.posthog || typeof window.posthog.init !== "function") return;
            window.posthog.init(rec.apiKey, {
              api_host: host,
              /* Every one of these is mandatory restraint, not a preference:
               * the vendor default is opt-OUT capture and we invert it. */
              autocapture: false,
              capture_pageview: false,
              capture_pageleave: false,
              disable_session_recording: true,
              session_recording: { maskAllInputs: true },
              mask_all_text: true,
              mask_all_element_attributes: true,
              enable_recording_console_log: false,
              person_profiles: "identified_only",
              respect_dnt: true,
              sanitize_properties: function (props) {
                var out = {};
                for (var k in props) {
                  if (!props.hasOwnProperty(k)) continue;
                  var v = props[k];
                  out[k] = isStr(v) ? scrub(v) : v;
                }
                /* Vendor-injected URL properties are not covered by our page
                 * derivation, so scrub them explicitly. */
                if (out.$current_url) out.$current_url = scrub(String(out.$current_url));
                if (out.$referrer) out.$referrer = ctx.referrerHost;
                delete out.$initial_referrer;
                delete out.$initial_current_url;
                return out;
              }
            });
            /* Replay anything emitted while array.js was still in flight. */
            phFlush();
          } catch (e) { dbg("posthog init failed"); }
        });
      },
      pageView: function (rec, ctx) {
        phCall("capture", ["$pageview", { $current_url: ctx.page, page_title: ctx.title, tenant: ctx.cityTenant || ctx.stateTenant, state_tenant: ctx.stateTenant, entrance: ctx.entrance, surface: ctx.surface, locale: ctx.locale }]);
      },
      event: function (rec, ctx) {
        var e = ctx.event || {};
        phCall("capture", [e.name || e.action || "event", { category: e.category || "ui", label: e.label || "", value: e.value, $current_url: ctx.page, tenant: ctx.cityTenant || ctx.stateTenant, entrance: ctx.entrance }]);
      },
      captureError: function (rec, ctx) {
        var er = ctx.error || {};
        phCall("capture", ["error", { error_name: er.name || "Error", error_message: er.message || "", $current_url: ctx.page }]);
      }
    },

    SENTRY: {
      init: function (rec, ctx) {
        var url = sentryScriptUrl(rec);
        if (!url) return;
        loadScript(url, function () {
          try {
            if (!window.Sentry || typeof window.Sentry.onLoad !== "function") return;
            window.Sentry.onLoad(function () {
              try {
                window.Sentry.init({
                  dsn: rec.dsn,
                  /* The opposite of the configurator's current config, on
                   * purpose: no PII, no replay, no performance traces. */
                  sendDefaultPii: false,
                  autoSessionTracking: false,
                  tracesSampleRate: 0,
                  replaysSessionSampleRate: 0,
                  replaysOnErrorSampleRate: 0,
                  environment: ctx.stateTenant || "unknown",
                  initialScope: { tags: { tenant: ctx.cityTenant || ctx.stateTenant, entrance: ctx.entrance, surface: ctx.surface } },
                  beforeSend: function (ev) {
                    try {
                      if (ev.request) { delete ev.request.cookies; delete ev.request.headers; if (ev.request.url) ev.request.url = scrub(String(ev.request.url)); }
                      if (ev.message) ev.message = scrub(String(ev.message));
                      delete ev.user;
                    } catch (e) {}
                    return ev;
                  }
                });
              } catch (e) { dbg("sentry init failed"); }
            });
          } catch (e) {}
        });
      },
      /* Sentry is an error sink; the SDK installs its own global handlers, so
       * the shared layer must not forward errors to it a second time. */
      pageView: function () {},
      event: function () {},
      captureError: function () {}
    },

    CUSTOM: {
      init: function (rec, ctx) {
        var a = rec.adapter || {};
        var name = a.globalName || rec.globalName;
        runTemplates(name, a.callTemplates && a.callTemplates.init, ctx);
        loadScript(a.scriptUrl || rec.scriptUrl);
      },
      pageView: function (rec, ctx) {
        var a = rec.adapter || {};
        runTemplates(a.globalName || rec.globalName, a.callTemplates && a.callTemplates.pageView, ctx);
      },
      event: function (rec, ctx) {
        var a = rec.adapter || {};
        runTemplates(a.globalName || rec.globalName, a.callTemplates && a.callTemplates.event, ctx);
      },
      captureError: function () {}
    }
  };

  function gtag() {
    try {
      if (!isArray(window.dataLayer)) window.dataLayer = [];
      window.dataLayer.push(arguments);
    } catch (e) {}
  }

  /* PostHog is the one adapter whose API is a real object rather than a vendor
   * queue array, so calls made before its script finishes loading have nowhere
   * to go. That is not a rare edge: on a HARD page load the shim emits the
   * pageview as soon as the registry resolves, which is always before
   * array.js has arrived — so dropping early calls means dropping exactly the
   * one pageview most navigations produce. Queue them instead and replay on
   * ready. (Matomo's _paq, GA4's dataLayer and CUSTOM's named global are all
   * arrays, which is why they never had this problem.) */
  var phReady = false;
  var phPending = [];
  var PH_MAX_PENDING = 20; /* bounded: if the script never loads, do not grow */

  function phCall(fn, args) {
    try {
      if (!phReady || !window.posthog || typeof window.posthog[fn] !== "function") {
        if (phPending.length < PH_MAX_PENDING) phPending.push([fn, args]);
        return;
      }
      window.posthog[fn].apply(window.posthog, args);
    } catch (e) {}
  }

  /* Called once, immediately after posthog.init() succeeds. */
  function phFlush() {
    phReady = true;
    var queued = phPending;
    phPending = [];
    for (var i = 0; i < queued.length; i++) {
      try {
        if (window.posthog && typeof window.posthog[queued[i][0]] === "function") {
          window.posthog[queued[i][0]].apply(window.posthog, queued[i][1]);
        }
      } catch (e) {}
    }
  }

  /* ------------------------------------------------------------------ *
   * CUSTOM interpolation                                                *
   * DATA ONLY. One pass, never recursive, never a second pass over the  *
   * result (which would let {{sur{{x}}face}} smuggle a placeholder),     *
   * no path syntax at all, and never eval/new Function/innerHTML.        *
   * ------------------------------------------------------------------ */

  function placeholderMap(ctx) {
    var e = ctx.event || {};
    var er = ctx.error || {};
    var m = Object.create ? Object.create(null) : {};
    m.surface = ctx.surface;
    m.entrance = ctx.entrance;
    m.stateTenant = ctx.stateTenant;
    m.cityTenant = ctx.cityTenant;
    m.page = ctx.page;
    m.locale = ctx.locale;
    m.module = ctx.module;
    m.contextPath = ctx.contextPath;
    m.referrerHost = ctx.referrerHost;
    m.now = ctx.now;
    m.eventName = e.name || "";
    m.eventCategory = e.category || "";
    m.eventAction = e.action || "";
    m.eventLabel = e.label || "";
    m.eventValue = typeof e.value === "number" ? e.value : "";
    m.errorName = er.name || "";
    return m;
  }

  function interpolate(value, map) {
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (!isStr(value)) return null;
    /* Reject the whole argument rather than emit a half-substituted literal:
     * an unknown placeholder and a nested one both render as "". */
    if (badTemplateString(value)) return "";
    var out = value.replace(/\{\{([a-zA-Z]+)\}\}/g, function (whole, key) {
      if (indexOf(PLACEHOLDERS, key) === -1) return "";
      var v = map[key];
      if (typeof v === "undefined" || v === null) return "";
      return String(v);
    });
    out = scrub(out);
    if (out.length > MAX_ARG_CHARS) out = out.substring(0, MAX_ARG_CHARS);
    return out;
  }

  function runTemplates(globalName, calls, ctx) {
    if (!isStr(globalName) || !RE_GLOBAL_NAME.test(globalName)) return;
    if (!isArray(calls)) return;
    var map = placeholderMap(ctx);
    var hooks = calls.length > MAX_TEMPLATE_ARGS * MAX_TEMPLATE_HOOKS ? MAX_TEMPLATE_ARGS * MAX_TEMPLATE_HOOKS : calls.length;
    for (var i = 0; i < hooks; i++) {
      var args = calls[i];
      if (!isArray(args)) continue;
      var rendered = [];
      for (var j = 0; j < args.length && j < MAX_TEMPLATE_ARGS; j++) {
        var v = interpolate(args[j], map);
        if (v === null) { rendered = null; break; }
        rendered.push(v);
      }
      if (rendered) pushTo(globalName, rendered);
    }
  }

  /* ------------------------------------------------------------------ *
   * Registry fetch                                                      *
   * ------------------------------------------------------------------ */

  function mdmsPath() {
    var prefix = gc("MDMS_V2_CONTEXT_PATH") || "mdms-v2";
    return "/" + String(prefix).replace(/^\/+|\/+$/g, "") + "/v2/_search";
  }

  /* XHR, not fetch: a native timeout and no Promise (this file is ES5). */
  function searchTenant(tenantId, done) {
    var body;
    try {
      body = JSON.stringify({
        MdmsCriteria: {
          tenantId: tenantId,
          schemaCode: SCHEMA_CODE,
          isActive: true,
          /* `limit` is mandatory: MDMS silently pages at 10 without it.
           * NEVER put a boolean in `filters` — it silently returns 0 rows. */
          limit: PAGE_LIMIT,
          offset: 0
        }
      });
    } catch (e) { done([]); return; }

    var xhr;
    try { xhr = new XMLHttpRequest(); } catch (e) { done([]); return; }
    var settled = false;
    function finish(rows) { if (!settled) { settled = true; done(rows || []); } }

    try {
      xhr.open("POST", mdmsPath(), true);
      xhr.timeout = FETCH_TIMEOUT_MS;
      /* ONE header only. The live gateway's CORS allow-list is narrower than
       * the repo's kong.yml declares; stay inside the intersection. */
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.withCredentials = false;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status < 200 || xhr.status >= 300) { finish([]); return; }
        var parsed;
        try { parsed = JSON.parse(xhr.responseText); } catch (e) { finish([]); return; }
        var rows = parsed && parsed.mdms;
        if (!isArray(rows)) { finish([]); return; }
        if (rows.length === PAGE_LIMIT) dbg("registry page hit the limit; some providers may be ignored");
        finish(rows);
      };
      xhr.ontimeout = function () { finish([]); };
      xhr.onerror = function () { finish([]); };
      xhr.send(body);
    } catch (e) { finish([]); }
  }

  function cacheRead(key) {
    var raw = ssGet(CACHE_KEY);
    if (!raw) return null;
    var parsed = parseMaybeJSON(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.key !== key) return null;
    if (!parsed.at || (new Date().getTime() - parsed.at) > CACHE_TTL_MS) return null;
    return isArray(parsed.rows) ? parsed.rows : null;
  }

  function cacheWrite(key, rows) {
    try {
      if (!window.sessionStorage) return;
      /* A negative result is cached too, so an environment with no providers
       * stops re-probing on every navigation. */
      window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ key: key, at: new Date().getTime(), rows: rows || [] }));
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ *
   * Merge: city wins wholesale, never a union                           *
   * A data _search at a city returns the STATE rows while the city owns  *
   * none for that schemaCode (measured). A literal union would therefore *
   * double-count state rows and make per-city opt-out impossible, since  *
   * an enabled:false city row could not override an enabled:true state   *
   * row. So: drop foreign-tenant rows, then let the city row replace the *
   * state row of the same code, enabled:false included.                  *
   * ------------------------------------------------------------------ */

  function collect(rows, wantTenant) {
    var out = [];
    if (!isArray(rows)) return out;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || typeof row !== "object") continue;
      if (row.tenantId !== wantTenant) continue;   /* kills the fallback double-count */
      if (row.isActive === false) continue;
      if (!row.data || typeof row.data !== "object") continue;
      out.push(row.data);
    }
    return out;
  }

  function mergeByCode(stateRecords, cityRecords) {
    var byCode = {};
    var order = [];
    var i, rec;
    for (i = 0; i < stateRecords.length; i++) {
      rec = stateRecords[i];
      if (!rec || !isStr(rec.code)) continue;
      if (!byCode[rec.code]) order.push(rec.code);
      byCode[rec.code] = rec;
    }
    for (i = 0; i < cityRecords.length; i++) {
      rec = cityRecords[i];
      if (!rec || !isStr(rec.code)) continue;
      if (!byCode[rec.code]) order.push(rec.code);
      byCode[rec.code] = rec; /* wholesale replace, including enabled:false */
    }
    var merged = [];
    for (i = 0; i < order.length; i++) { merged.push(byCode[order[i]]); }
    return merged;
  }

  function surfaceAllowed(rec, surface) {
    var list = splitList(rec.surfaces);
    if (!list.length) return true;
    for (var i = 0; i < list.length; i++) {
      if (list[i].toLowerCase() === surface) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Live provider set + shared layer                                    *
   * ------------------------------------------------------------------ */

  var live = [];          /* [{ record, adapter, throws }] */
  var installed = false;
  var initialisedCodes = {};

  function callAdapter(entry, fn, ctx) {
    if (entry.throws >= MAX_THROWS) return;
    var impl = entry.adapter[fn];
    if (typeof impl !== "function") return;
    try {
      /* The title depends on the RECORD (settings.titleMap / settings.modules),
       * so it is resolved per adapter rather than once for the whole tick. */
      if (ctx && !ctx.title) {
        try { ctx = extendCtx(ctx, { title: pageTitle(ctx.page, entry.record.settings) }); } catch (e) {}
      }
      impl(entry.record, ctx);
      entry.throws = 0;
    } catch (e) {
      entry.throws++;
      if (entry.throws >= MAX_THROWS) dbg("muting provider " + entry.record.code + " after " + MAX_THROWS + " errors");
    }
  }

  function sampledOut(rec) {
    if (typeof rec.sampleRate !== "number" || rec.sampleRate >= 1) return false;
    if (rec.sampleRate <= 0) return true;
    return Math.random() >= rec.sampleRate;
  }

  function emitPageView() {
    var ctx = buildCtx(null);
    if (ctx.dnt) return;
    for (var i = 0; i < live.length; i++) {
      if (live[i].record.disablePageViews === true) continue;
      if (sampledOut(live[i].record)) continue;
      callAdapter(live[i], "pageView", ctx);
    }
  }

  function emitEvent(ev) {
    var ctx = buildCtx({ event: ev });
    if (ctx.dnt) return;
    for (var i = 0; i < live.length; i++) {
      if (sampledOut(live[i].record)) continue;
      callAdapter(live[i], "event", ctx);
    }
  }

  function emitError(err) {
    var ctx = buildCtx({ error: err });
    if (ctx.dnt) return;
    for (var i = 0; i < live.length; i++) {
      if (live[i].record.trackErrors !== true) continue;
      callAdapter(live[i], "captureError", ctx);
    }
  }

  /* SPA route hooks. Safe to install late: the bundle captures the history
   * OBJECT (not the method), so a later monkey-patch is still intercepted. */
  function installRouteHooks() {
    var wrap = function (name) {
      var original = window.history[name];
      if (typeof original !== "function") return;
      window.history[name] = function () {
        var r = original.apply(window.history, arguments);
        try { schedule(onRouteChange); } catch (e) {}
        return r;
      };
    };
    try { wrap("pushState"); wrap("replaceState"); } catch (e) {}
    try {
      window.addEventListener("popstate", function () { schedule(onRouteChange); });
    } catch (e) {}
  }

  /* A route change can also be the moment a provider becomes eligible: the app
   * lands on /digit-ui/ (surface not yet decidable) and only then routes to
   * /citizen or /employee. So re-attempt activation before emitting. */
  function onRouteChange() {
    tryActivate();
    if (live.length) emitPageView();
  }

  /* Coalesce bursts (a route change often fires replaceState then pushState)
   * without adding a 4th timer — index.html already runs three intervals. */
  var pending = null;
  var lastPage = null;
  function schedule(fn) {
    if (pending) return;
    pending = window.setTimeout(function () {
      pending = null;
      var p = currentPage();
      if (p === lastPage) return;
      lastPage = p;
      fn();
    }, 50);
  }

  var clickInstalled = false;
  function installClickTracking() {
    if (clickInstalled) return;
    var wanted = false;
    for (var i = 0; i < live.length; i++) { if (live[i].record.trackClicks === true) wanted = true; }
    if (!wanted) return;
    clickInstalled = true;
    try {
      document.addEventListener("click", function (ev) {
        try {
          var el = ev.target;
          /* Opt-in only. Never serialise arbitrary textContent: labels are
           * localised and complaint pages interpolate ids into them. */
          for (var hops = 0; el && hops < 5; hops++) {
            if (el.getAttribute && el.getAttribute("data-analytics-event")) {
              emitEvent({
                name: scrub(String(el.getAttribute("data-analytics-event"))).substring(0, 60),
                category: "click",
                action: "click",
                label: scrub(String(el.getAttribute("data-analytics-label") || "")).substring(0, 60)
              });
              return;
            }
            el = el.parentNode;
          }
        } catch (e) {}
      }, true);
    } catch (e) {}
  }

  var errorInstalled = false;
  function installErrorTracking() {
    if (errorInstalled) return;
    var wanted = false;
    for (var i = 0; i < live.length; i++) { if (live[i].record.trackErrors === true) wanted = true; }
    if (!wanted) return;
    errorInstalled = true;
    try {
      window.addEventListener("error", function (ev) {
        var e = ev && ev.error;
        emitError({
          name: (e && e.name) || "Error",
          message: scrub(String((e && e.message) || (ev && ev.message) || "")).substring(0, 300),
          stack: ""
        });
      });
      window.addEventListener("unhandledrejection", function (ev) {
        var r = ev && ev.reason;
        emitError({
          name: (r && r.name) || "UnhandledRejection",
          message: scrub(String((r && r.message) || r || "")).substring(0, 300),
          stack: ""
        });
      });
    } catch (e) {}
  }

  /* Records that passed the merge but are not initialised yet. A record stays
   * here — rather than being discarded — while the current surface is not yet
   * decidable, which is the normal state on the first paint: the app boots at
   * /digit-ui/ and only then routes to /citizen/... or /employee/.... Records
   * that fail validate() are dropped permanently; data cannot change without a
   * reload, so re-checking them every route change would be pure noise. */
  var pendingRecords = [];
  var deferLogged = {};

  function activate(records) {
    for (var i = 0; i < records.length; i++) { pendingRecords.push(records[i]); }
    if (!pendingRecords.length) { dbg("no providers configured"); return; }

    /* Route hooks go in even when nothing is live yet: the surface becoming
     * known IS a route change, and that is what makes a provider eligible. */
    if (!installed) {
      installed = true;
      installRouteHooks();
    }

    tryActivate();
    if (live.length) {
      lastPage = currentPage();
      emitPageView();
    }
  }

  function tryActivate() {
    var ctx = buildCtx(null);
    var keep = [];
    var newly = 0;

    for (var i = 0; i < pendingRecords.length; i++) {
      var rec = pendingRecords[i];
      if (initialisedCodes[rec.code]) continue;

      var verdict = validate(rec);
      if (!verdict.ok) {
        if (verdict.reason !== REASONS.DISABLED) dbg("skipping " + (rec && rec.code) + ": " + verdict.reason);
        continue; /* permanent */
      }

      if (ctx.surface === "unknown") { keep.push(rec); continue; }
      if (!surfaceAllowed(rec, ctx.surface)) {
        keep.push(rec); /* a different surface may come later in this tab */
        if (!deferLogged[rec.code]) {
          deferLogged[rec.code] = true;
          dbg("deferring " + rec.code + ": not configured for the " + ctx.surface + " surface");
        }
        continue;
      }

      var type = trim(rec.type).toUpperCase();
      var adapter = ADAPTERS[type];
      if (!adapter) continue;

      /* Operator regexes are APPENDED to the built-in scrubbers. */
      var extra = splitList(rec.scrubPatterns);
      for (var p = 0; p < extra.length; p++) {
        try { extraScrubbers.push(new RegExp(extra[p], "g")); } catch (e) { dbg("bad scrubPattern ignored"); }
      }

      var entry = { record: rec, adapter: adapter, throws: 0 };
      initialisedCodes[rec.code] = true;
      live.push(entry);
      newly++;
      callAdapter(entry, "init", ctx);
    }

    pendingRecords = keep;

    /* These read the live set, so they can only be decided once something is
     * live. Both are idempotent. */
    if (newly) {
      installClickTracking();
      installErrorTracking();
    }
    return newly;
  }

  /* ------------------------------------------------------------------ *
   * Boot                                                                *
   * Guards run in order; the first one that fires means ZERO network     *
   * requests and zero side effects.                                     *
   * ------------------------------------------------------------------ */

  function boot() {
    /* 1. per-browser opt-out — the instant, no-deploy rollback for one user */
    if (lsGet("digit.analytics.off") === "1") { dbg("off: local opt-out"); return; }

    /* 2. ops kill switch. Opt-in kill: ONLY an explicit true disables, because
     *    getConfig has no terminal else and returns undefined for keys that a
     *    not-yet-re-rendered environment does not have. */
    if (gc("ANALYTICS_KILL_SWITCH") === true) { dbg("off: kill switch"); return; }

    /* 3. the testing entrance sets TESTING_MODE in its own globalConfigs */
    if (gc("TESTING_MODE")) { dbg("off: testing mode"); return; }

    /* 4. only the canonical entrance is tracked. Kong prefix-matches /digit-ui
     *    with strip_path:false, so /digit-ui-test/ and any /digit-ui<typo>/
     *    serve the same bundle; none of that traffic belongs in the dataset. */
    var seg = firstSegment();
    if (seg && seg !== contextPath()) { dbg("off: entrance " + seg + " is not " + contextPath()); return; }

    /* 5. an unrendered globalConfigs (stateTenantId === "uitest") means we
     *    cannot attribute anything; missing data beats wrong data. */
    var state = stateTenant();
    if (!state) { dbg("off: STATE_LEVEL_TENANT_ID missing or placeholder"); return; }

    /* 6. Do Not Track, hardcoded — no MDMS row can switch this off. */
    if (dntOn()) { dbg("off: DNT"); return; }

    var city = cityTenant();

    /* 7. a tenant explicitly marked as a testing tenant, where that flag
     *    exists at all (no-op where it does not). */
    if (activeTenantIsTesting(city)) { dbg("off: testing tenant"); return; }

    var cacheKey = state + "|" + (city || "-");
    var cached = cacheRead(cacheKey);
    if (cached) { activate(cached); return; }

    var stateRows = null;
    var cityRows = city && city !== state ? null : [];

    function maybeDone() {
      if (stateRows === null || cityRows === null) return;
      var merged = mergeByCode(collect(stateRows, state), collect(cityRows, city));
      cacheWrite(cacheKey, merged);
      activate(merged);
    }

    searchTenant(state, function (rows) { stateRows = rows; maybeDone(); });
    if (city && city !== state) {
      searchTenant(city, function (rows) { cityRows = rows; maybeDone(); });
    }
  }

  /* Expose a tiny, deliberately minimal API. trackEvent is the only thing
   * product code should ever call; everything else is internal. */
  window.DigitAnalytics = {
    trackEvent: function (name, props) {
      try {
        if (!live.length) return;
        props = props || {};
        emitEvent({
          name: String(name || "event").substring(0, 60),
          category: String(props.category || "ui").substring(0, 40),
          action: String(props.action || name || "event").substring(0, 40),
          label: scrub(String(props.label || "")).substring(0, 200),
          value: typeof props.value === "number" ? props.value : undefined
        });
      } catch (e) {}
    },
    /* For tests and for the Configurator's "what will actually run" preview. */
    _internal: {
      validate: validate,
      scrub: scrub,
      scrubQuery: scrubQuery,
      mergeByCode: mergeByCode,
      collect: collect,
      surfaceAllowed: surfaceAllowed,
      hostAllowed: hostAllowed,
      interpolate: interpolate,
      placeholderMap: placeholderMap,
      pageTitle: pageTitle,
      REASONS: REASONS,
      PLACEHOLDERS: PLACEHOLDERS,
      providers: function () { return live.length; }
    }
  };

  try { boot(); } catch (e) { dbg("boot failed, no providers"); }
})();
