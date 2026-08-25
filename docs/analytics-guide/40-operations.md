# 4. Operations

Switching it off, working out why something is or is not sending, and what was
actually verified.

## Switching it off — fastest first

| Tier | Scope | How | Caveat |
|---|---|---|---|
| 0 | one browser | `localStorage.setItem('digit.analytics.off','1')` | Takes effect **from the next page load** — the check runs at boot, so an already-open tab keeps sending until reloaded. Also silences the Configurator's own telemetry. |
| 1 | whole environment, no deploy | edit the rendered `/opt/digit/nginx/globalConfigs.js` on the box, inside `getConfig`, after the `TOKEN_EXCHANGE_URL` arm: `else if (key === "ANALYTICS_KILL_SWITCH") { return true; }` | Served `no-cache`, so it lands on the next page load. **The next ansible run re-renders this file and silently reverts it** — the render task has no tag, so it runs on every `./deploy.sh`. Pair with tier 2. |
| 2 | durable | `analytics_kill_switch: true` in the env's `host_vars`, then `./deploy.sh <host>` | The proper fix. |
| 3 | data level | set every row `enabled: false` in the Configurator | The only tier that works on a bundle whose `globalConfigs.js` has no kill-switch key. Never soft-delete. |

**Deleting `analytics.js` from the webroot does not roll back.** Container-mode
hosts receive the bundle via an additive `tar -x` and `build/` is never cleaned,
so an old copy keeps serving. Use the switches.

## Propagation and caching

| Layer | Behaviour |
|---|---|
| MDMS row → portal | the shim caches the registry in `sessionStorage` for **90 s**, empty results included, so a toggle appears within 90 s or on a new tab |
| the shim file itself | unhashed filename served `no-cache` by both nginx layers → revalidated (cheap 304) on every load, picked up as soon as it is on disk |
| the app's own MDMS cache | 24 h IndexedDB — deliberately **not** used by the shim, which does its own fetch |
| container webroot | a bare `docker restart digit-ui` reverts the webroot to the image, which may predate the deploy |

## Troubleshooting

| Symptom | Cause / what to do |
|---|---|
| Row enabled, nothing sends | Check the seven boot guards in order (local opt-out, kill switch, `TESTING_MODE`, non-canonical entrance, unrendered `stateTenantId` = `uitest`, DNT, testing tenant). The shim logs exactly one `console.debug` line naming the guard that fired. |
| `[analytics] skipping <code>: <reason>` | The row fails validation. The reason is a machine code (`missing_site_id`, `script_url_host_not_allowed`, `custom_disabled_by_ops`, …); the Configurator shows the same message inline. |
| Vendor script never loads | Host not allowlisted. Add it to `analytics_script_hosts` (ops) — the compile-time list is vendor CDNs only and there is **no** prefix wildcard. `https` is required. |
| Configurator warns "this host is not one of the vendor hosts" | Informational: the Configurator cannot read the portal's `globalConfigs`, so it cannot confirm ops declared the host. It does not block the save; the portal is the enforcer. |
| Save blocked, "Invalid JSON" | The `settings`/`adapter` textarea does not parse. Deliberate: silently keeping the last valid value would persist the pre-edit object under a success toast. |
| "already exists (possibly inactive)" on create | MDMS's duplicate response. That code was used before and codes are permanent — edit the existing row (it may be switched off) rather than creating a second one. |
| Enabled at a city, but state employees also send | Expected if the row lives at the state root. Scope it with a city-owned row, or restrict `surfaces`. |
| A city cannot stop an inherited destination | It can: create a row with the **same code** and `enabled: false` at that city. The city row replaces the state row wholesale. |
| One destination stopped mid-session | An adapter that throws 3 consecutive times self-mutes for that page (a success resets the counter). Other destinations keep running. Look for `muting provider <code>` in the console. |
| PostHog shows no events, but Matomo works | Almost certainly **bot filtering, not a fault**. posthog-js runs `_is_bot()` and silently drops every `capture()` from an automated browser — `capture()` returns `undefined` and no request is made. `navigator.webdriver`, a headless UA and missing browser features all trip it, and masking one is not enough. Consequence: **Playwright/Selenium/QA traffic never reaches PostHog**, so verify PostHog in a real browser. Matomo and GA4 have no equivalent filter, which is why they show automated traffic. |
| PostHog events missing only on the FIRST page of a visit | Fixed: the shim now queues captures made before `array.js` finishes loading and replays them on init. On a hard page load the pageview is always emitted before the SDK object exists, so previously that one event was dropped. Bounded at 20 queued calls. |
| Dashboard `transfer.bytes` / `slow_api_calls` stepped | The supervisor dashboard's own OTLP instrumentation counts `/mdms-v2/` fetches inside its load window, and the two registry reads land there on a hard navigation to `/employee/dashboard`. Bounded and harmless. |
| Configurator screen absent | Separate artifact and separate ansible gate (`build_configurator`, `nginx_features.configurator`) from the portal bundle. |

## The Configurator's own telemetry

Separate from everything above. The Configurator ships hardcoded PostHog and
Sentry credentials and starts sending at module scope, before login, with session
replay and `sendDefaultPii: true`. This work did not change that default — it
added a switch, because every environment running it today is already sending and
flipping the default would silently change behaviour on machines nobody has looked
at.

Three ways to switch it off, all gating **all three** vendor call sites
(`main.tsx`, `PageViewTracker`, and every export of `lib/telemetry.ts`):

1. `localStorage['digit.analytics.off'] = '1'` — same key as the portal.
2. `window.__CFG_TELEMETRY__ = { kill: true }` in
   `/var/www/configurator/telemetry-config.js` on the box. Reverted by the next
   deploy, which rsyncs `dist` over it.
3. `VITE_CFG_TELEMETRY_KILL=true` at build time — durable.

Absent flag, absent file, unreadable storage and any thrown error all mean **not
killed**. Routing this app's telemetry through the MDMS registry (so it obeys the
same switch it operates) is deliberately a separate piece of work.

## Verification record

**Local stack (develop-based), 2026-08-04/05.** Full checklist, browser-driven:

| Case | Result |
|---|---|
| No enabled rows | shim loads, 1 registry read, 0 vendor requests, 0 console errors |
| Row enabled, host declared by ops, **real** Matomo tracker + stub collector | 4 route changes → **4 collector hits**, all pageview-shaped |
| Same enabled row, ops declaration **removed** | **0 hits** — the host allowlist is the gate |
| `?mobileNumber=841234567` + `PRD-2026-000023` in the URL | collector saw `/citizen/pgr/complaint-details/:id?tenantId=mz`; neither value on the wire |
| `localStorage digit.analytics.off=1` | shim not even fetched |
| Configurator: nav gate, residency ack blocking save, MDMS round-trip, telemetry kill switch | as specified |
| Suites | shim 36 tests, configurator 124 tests (13 files), `tsc` clean, `vite build` clean |

**Pilot with a production Matomo: deferred.** Pilot testing is closed by current
environment policy, so steps 1–7 of [10-setup.md](10-setup.md) have not been run
against a real hosted Matomo. Do that before relying on pilot data.

**Not verified:** behaviour on cms-pilot and mctd specifically (their `host_vars`
are gitignored, so whether they build digit-ui from this monorepo is unconfirmed —
see the provenance warning in [10-setup.md](10-setup.md)).
