# 3. Customization

Two ways to reach a destination the built-in catalog does not cover:

- **[A data-described `CUSTOM` record](#a-custom-records-no-code)** — no code, no
  deploy, configured like any other row. Covers vendors that follow the
  "push arrays onto a global queue" pattern: Plausible, Umami, Piwik PRO, a bare
  pixel, an in-house collector.
- **[A code adapter](#b-a-code-adapter)** — a small change to the shim when a
  vendor needs real logic. This is how MATOMO/GA4/POSTHOG/SENTRY are built.

## A. CUSTOM records (no code)

A `CUSTOM` row describes a vendor as **data**: a script to load, a global array to
push onto, and call templates for each hook. Nothing from MDMS is ever executed —
there is no `eval`, no `new Function`, no `innerHTML`.

```jsonc
{
  "code": "plausible-mz",
  "type": "CUSTOM",
  "enabled": false,
  "adapter": {
    "scriptUrl": "https://stats.mz.gov.mz/script.js",   // https + declared host
    "globalName": "_pq",                                 // /^_[A-Za-z0-9_]{1,40}$/
    "callTemplates": {
      "init":     [["setEndpoint", "https://stats.mz.gov.mz/api/event"]],
      "pageView": [["trackPage", "{{page}}", "{{cityTenant}}"]],
      "event":    [["trackEvent", "{{eventCategory}}", "{{eventAction}}", "{{eventLabel}}"]]
    }
  }
}
```

At runtime each template row becomes `window._pq.push([...])` with placeholders
substituted. The vendor script, loaded `async` with `crossOrigin="anonymous"` and
`referrerPolicy="no-referrer"`, consumes the queue exactly as it would if you had
pasted the vendor's own snippet — minus the ability to run arbitrary logic.

### The placeholder allowlist (16, exact, case-sensitive)

```
{{surface}}   {{entrance}}   {{stateTenant}}  {{cityTenant}}
{{page}}      {{locale}}     {{module}}       {{contextPath}}
{{referrerHost}}  {{now}}
{{eventName}} {{eventCategory}} {{eventAction}} {{eventLabel}} {{eventValue}}
{{errorName}}
```

Deliberately absent: `{{errorMessage}}`, `{{href}}`, anything user-shaped, and any
way to reach storage. Substitution is a **single pass** over string leaves only —
never over keys, never recursive, and never a second pass over the result.

### Rules the record must satisfy

| Rule | Failure reason |
|---|---|
| `scriptUrl` is `https:` and its host is allowlisted (vendor list + ops `analytics_script_hosts`) | `script_url_not_https`, `script_url_host_not_allowed` |
| `globalName` matches `/^_[A-Za-z0-9_]{1,40}$/`, is not an app global (`Digit`, `globalConfigs`, `posthog`, `dataLayer`, `Sentry`, …), and does not already exist as a non-array | `bad_global_name` |
| every `{{placeholder}}` is on the list, and no stray `{`/`}` survives after well-formed tokens are removed — this is what kills `{{sur{{page}}face}}` | `bad_placeholder` |
| no `__proto__`, `constructor` or `prototype` anywhere in `adapter` | `forbidden_key` |
| `JSON.stringify(adapter)` ≤ 8192 bytes, ≤ 3 hooks, ≤ 8 args per call, ≤ 200 chars per arg | `template_too_large` |
| ops has set `analytics_custom_enabled: true` on this environment | `custom_disabled_by_ops` |

Every interpolated value is `String()`-cast, passed through the PII scrubber and
truncated to 200 characters before it reaches the queue.

### Why `CUSTOM` needs an extra ops opt-in

It is the one type where an MDMS row names the script that gets loaded. On an
environment with Kong in audit mode, MDMS write access is script-injection access
— so `CUSTOM` stays off unless ops explicitly enables it, *and* the host must be
declared, *and* the row still needs the residency acknowledgement. Three locks,
because avoiding `eval` alone does not help: `script.src = fromMdms` is the same
trust transfer.

## B. A code adapter

Use this when the vendor needs logic templates cannot express — an SDK that must
be configured with an object, a consent callback, a payload transform. Roughly
half a day, four files.

### 1. The adapter — `digit-ui-esbuild/public/analytics.js`

Add an entry to `ADAPTERS`. Five synchronous, total functions; the shared layer
wraps every call and self-mutes the adapter after 3 consecutive throws.

```js
PLAUSIBLE: {
  init: function (rec, ctx) {
    // Queue-then-load, or load-then-configure via loadScript's callback.
    loadScript(rec.scriptUrl, function () { /* configure the SDK */ });
  },
  pageView: function (rec, ctx) { /* ctx.page is ALREADY scrubbed */ },
  event: function (rec, ctx) { /* ctx.event = {name, category, action, label, value} */ },
  captureError: function (rec, ctx) { /* ctx.error = {name, message, stack}, pre-scrubbed */ }
}
```

House rules for this file, all load-bearing:

- **ES5 only.** `public/` is copied verbatim and never transpiled: `var`,
  `function`, no arrow functions, no `let`/`const`, no template literals, no
  optional chaining, no `Object.assign`, no `Array.includes`, no `Promise`.
  Check with `node --check public/analytics.js`.
- **Never read `location`, storage or `document.title` from an adapter.** Take
  everything from `ctx` — that is what makes the PII guarantee structural.
- **Use `loadScript()`**; it re-checks the host allowlist, so a bypassed
  `validate()` still cannot load a foreign script.
- **Fail closed.** Anything uncertain means "no provider".

### 2. Per-type validation — the same file, plus the mirror

Add the required-field branch in the shim's `validate()`, and the identical branch
in `configurator/src/admin/analytics/analyticsProviderRules.ts`. New failure
reasons go in both `REASONS` maps, with operator-facing text in `REASON_TEXT`.

The two implementations exist because the shim is untranspiled ES5 served to a
different app and cannot be imported by the Configurator. They are kept honest by
`analyticsProviderRules.test.ts`, which **executes the real shim source** against
stubbed globals and asserts both reach the same verdict *and the same machine
reason* for every fixture. Add your fixtures there; drift fails the test instead
of producing destinations the Configurator saves and the portal silently ignores.

If your type sends data off-cluster, add it to `CLOUD_TYPES` so it inherits the
residency acknowledgement.

### 3. The form — which fields to show

Add the type to `PROVIDER_TYPES` and give it a field list in `fieldsForType()`.
If it needs a field the schema does not have, put it under `settings` — the schema
cannot be amended (`schema/v1/_update` → 501), and `settings` is the open bucket
that exists for exactly this. Label and document it in
`configurator/src/admin/schemaDescriptors/analytics-provider.ts`, which is the
single source of truth for labels and help text.

### 4. Docs and the allowlist

If the vendor loads from a fixed CDN, add that host to `HOST_ALLOWLIST` in **both**
files. If it is self-hosted, do not — leave it to ops via
`analytics_script_hosts`, and say so in
[20-configuration.md](20-configuration.md#host-matching-rules).

### Checklist

```bash
# shim
cd digit-ui-esbuild && node --check public/analytics.js && npm test
# mirror + editor (parity test lives here)
cd configurator && npm test && npx tsc -p tsconfig.app.json --noEmit
# then verify in a browser: enable the row, watch the network tab,
# and confirm a PII-bearing URL is parameterised on the wire
```

## Adding a tracked interaction

Click tracking is opt-in by attribute — arbitrary `textContent` is never
serialised, because labels are localised and complaint screens interpolate ids
into them.

```jsx
<button data-analytics-event="complaint_submitted" data-analytics-label="pgr">
```

For anything else, call the tiny public API from product code:

```js
window.DigitAnalytics && window.DigitAnalytics.trackEvent('export_clicked', {
  category: 'dashboard', label: 'csv',
});
```

It is a no-op when nothing is configured, so it is always safe to call.
