# Analytics adapter registry

Where the citizen/employee portal may send usage analytics and error reports —
and, by default, that it sends them **nowhere**. Destinations are MDMS rows
edited in the Configurator, not deploy-time config, so enabling, disabling or
re-pointing analytics never needs a rebuild or an ansible run.

| | |
|---|---|
| **Schema** | `common-masters.AnalyticsProvider` — `utilities/default-data-handler/src/main/resources/schema/common-masters.json` |
| **Portal runtime** | `digit-ui-esbuild/public/analytics.js` (untranspiled ES5, loaded by an inline bootstrapper in `public/index.html`) |
| **Editor** | Configurator → **Analytics Providers** (`/manage/analytics-providers`) |
| **Seeder** | `local-setup/scripts/seed-analytics-schema.sh` (schema only, never a record) |
| **Ops knobs** | `analytics_kill_switch`, `analytics_script_hosts`, `analytics_custom_enabled` |

## Guides

1. **[10-setup.md](10-setup.md)** — getting the feature onto an environment, and
   the first destination end to end.
2. **[20-configuration.md](20-configuration.md)** — every field, state-vs-city
   precedence, the residency acknowledgement, the ops-only knobs, and exactly
   what is and is not sent.
3. **[30-customization.md](30-customization.md)** — adding a destination the
   catalog does not cover: data-described `CUSTOM` records, and how to add a
   proper code adapter.
4. **[40-operations.md](40-operations.md)** — switching it off, troubleshooting,
   propagation timing, verification record.
5. **[50-self-hosted-matomo.md](50-self-hosted-matomo.md)** — a complete
   install → deploy → configure walkthrough for self-hosted Matomo, in the order
   it was actually executed, with the five traps we hit called out inline.

## The runtime flow

```
index.html (inline bootstrapper, before the app bundle)
  ├─ localStorage['digit.analytics.off'] === '1'  → stop, load nothing
  ├─ globalConfigs ANALYTICS_KILL_SWITCH === true → stop
  └─ fetch /digit-ui/analytics.js
       └─ content-type not javascript → stop silently
          (a missing file is served as the SPA shell with 200 text/html on every
           nginx layer here, so the content-type check is what keeps an
           environment on an older bundle inert instead of throwing)

analytics.js — seven guards, in order. The first that fires ⇒ ZERO requests
  1 local opt-out   2 kill switch   3 TESTING_MODE
  4 entrance ≠ contextPath   (kills /digit-ui-test/ and Kong prefix typos)
  5 STATE_LEVEL_TENANT_ID missing or the "uitest" placeholder
  6 navigator.doNotTrack === '1'
  7 the active tenant is flagged a testing tenant (where that flag exists)

registry read — two anonymous POSTs (state tenant, then city tenant when known
  and different), one header, no credentials, explicit limit 200; result cached
  in sessionStorage for 90 s, empty results included

merge — drop rows whose tenantId ≠ the tenant we asked for, then a city row
  REPLACES the state row of the same code, `enabled: false` included

per row — validate() → surfaces gate → adapter.init()
  MATOMO · GA4 · POSTHOG · SENTRY · CUSTOM

shared layer, written once for every adapter
  history pushState/replaceState + popstate → pageView
  delegated click, only [data-analytics-event] → event
  window error / unhandledrejection        → captureError
  ── every outgoing string passes the PII scrubber ──
```

## The admin flow

```
Configurator → Analytics Providers
  list   rows labelled "owned by mz.ige" / "inherited from mz",
         plus "what the portal will actually run" (enabled AND valid),
         plus a warning if this environment's bundle predates the shim
  edit   only the fields the chosen type needs
  save   owns the row?  → update it
         inherited?     → create a copy at this tenant, parent untouched
  cloud destination?    → data-residency acknowledgement required
  delete                → does not exist; enabled:false is the off switch
       ↓
  MDMS row changes → portal picks it up on the next page load (≤ 90 s)
```

## Two things to know before reading further

**There is no localhost guard.** A local stack with a real
`STATE_LEVEL_TENANT_ID` and an enabled row *will* send. Local boxes are quiet
because rows default to `enabled: false` (and the esbuild dev server's
`globalConfigs` carries the `uitest` placeholder, which trips guard 5). To
guarantee a dark machine, set `localStorage['digit.analytics.off'] = '1'`.

**The role gate is a UI guard, not a server-side control.** On environments
running Kong in audit mode (`ENFORCE_RBAC = false`) with plain `EMPLOYEE`
accepted at the Configurator login, any employee token can write MDMS rows.
That is why the controls that decide whether third-party script may run at all
live in `globalConfigs`, where only ops can reach them —
see [20-configuration.md](20-configuration.md#ops-only-knobs).
