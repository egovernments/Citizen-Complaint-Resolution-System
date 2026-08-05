# 2. Configuration

Every field of `common-masters.AnalyticsProvider`, how state and city rows
interact, and the split between what admins control and what only ops control.

## The record

One row per destination. Only the fields the chosen `type` needs are read; the
Configurator shows exactly those and hides the rest.

```jsonc
{
  "code": "matomo-state",          // permanent identity = MDMS uniqueIdentifier
  "type": "MATOMO",                // MATOMO | GA4 | POSTHOG | SENTRY | CUSTOM
  "enabled": false,                // THE switch

  // MATOMO — the only type needing no residency acknowledgement (self-hosted)
  "siteId": "7",                   // string, so leading zeros survive
  "scriptUrl": "https://matomo.example.gov.mz/matomo.js",
  "endpointUrl": "https://matomo.example.gov.mz/matomo.php",

  "measurementId": "G-XXXXXXX",    // GA4
  "apiKey": "phc_…",               // POSTHOG (endpointUrl overrides the default host)
  "dsn": "https://<key>@<host>/<projectId>",  // SENTRY

  "surfaces": "citizen,employee",  // comma string; empty/absent = both
  "sampleRate": 1,                 // 0..1; empty or 1 sends everything
  "disablePageViews": false,       // negative polarity — see below
  "trackClicks": false,            // only [data-analytics-event] elements
  "trackErrors": false,
  "scrubPatterns": "",             // extra regexes, ADDED to the built-ins
  "order": 10,                     // display order only

  "settings": { "residencyAck": true },  // open bucket
  "adapter": { }                          // CUSTOM only — see 30-customization
}
```

### Field notes that matter

**`type` is a plain string, not an enum.** The JSON Schema deliberately does not
constrain it: `schema/v1/_update` returns HTTP 501, so an enum could never be
extended without recreating the schema — which is impossible. MDMS will happily
accept a typo; the Configurator's dropdown and the shim (which ignores unknown
types with `unknown_type`) are what enforce the catalog.

**Negative polarity on `disablePageViews`.** MDMS never applies JSON-Schema
defaults, so a flag whose safe value is `true` has to be phrased so `false` is
safe. Same reason the master switch is `enabled` and not `active`: the generic
MDMS create form writes `false` for every boolean *except* one named exactly
`active`, which it writes `true`.

**Booleans the form never touched are omitted**, not written `false`. The shim
treats absent and `false` identically. Only `enabled` is always written
explicitly, because that flag is the whole contract.

**`settings` and `adapter` are open buckets** (`additionalProperties: true`)
inside an otherwise strict schema. They exist so new options never need a schema
change — which, again, is impossible after create.

**The payload is built from an explicit key list.** The schema is
`additionalProperties: false`, so a stray `id`, `_uniqueIdentifier` or
`auditDetails` key makes the write fail outright.

## State and city: who wins

The shim reads the **state root** and the **active city tenant**. A city row
**replaces** the state row with the same `code`, wholesale — `enabled: false`
included.

| Situation | Result |
|---|---|
| `matomo-state` enabled at `mz` | runs for every city under `mz` |
| city adds `matomo-state` with `enabled: false` | that city sends nothing — the per-city opt-out |
| city adds `matomo-state` with its own `siteId` | that city reports to its own site |
| city adds a code the state does not have | additive; runs for that city only |

It is **never a union**. mdms-v2 answers a city search with the state rows while
the city owns none, so a union would double-count every state row and make
opt-out impossible — an `enabled: false` city row could never override an
`enabled: true` state row. Both the shim and the editor therefore drop rows whose
`tenantId` is not the tenant they asked for.

**Rows are never deleted.** MDMS has no delete API, and a soft-deleted row's code
can never be reused. `enabled: false` is the off switch. The editor enforces this:
it labels rows *owned* vs *inherited*, writes only owned rows (an inherited row is
shadowed by a copy at your tenant, leaving the parent untouched), and offers no
delete.

## The residency acknowledgement

`GA4`, `POSTHOG`, `SENTRY` and `CUSTOM` send data outside the cluster. The
Configurator refuses to **enable** one until the acknowledgement box is ticked,
and records the tick at `settings.residencyAck: true` so it is auditable.
Self-hosted `MATOMO` does not require it.

This is a human sign-off about where citizen data may go. Get the programme's
approval before ticking it. Note that the shim does not re-check the flag at
runtime — it is a save-time control, so a row written directly over the MDMS API
bypasses it. That is one more reason the ops knobs below exist.

## Ops-only knobs

Three keys, in `group_vars/digit.yml` → `templates/globalConfigs.js.j2` →
the rendered `globalConfigs.js`, plus `digit-ui-esbuild/public/globalConfigs.js`
for local builds. They are **config, not MDMS**, precisely because MDMS is
writable from the Configurator and these three decide whether third-party script
may run at all.

| Key | Default | Effect |
|---|---|---|
| `analytics_kill_switch` | `false` | `true` hard-disables the shim, whatever MDMS says |
| `analytics_script_hosts` | `[]` | extra **exact** hostnames a `scriptUrl` may use, on top of the compile-time vendor list |
| `analytics_custom_enabled` | `false` | `true` allows `type: "CUSTOM"` rows to initialise at all |

The kill switch disables **only on an explicit `true`**. `getConfig` has no
terminal `else`, so on any box whose rendered `globalConfigs.js` predates these
keys the read is `undefined` and the shim keeps working normally — no inventory
edit is needed to adopt the feature, and none of the `| default(...)` filters can
break an existing render.

This is the **opposite** polarity to `dashboard_metrics_enabled` next door, which
is on-by-default and fails open. The inversion is deliberate and commented at
both sites: reviewers pattern-match on that file.

### Host matching rules

Only two shapes are supported:

- an **exact** host — `matomo.mz.gov.mz`
- a **dot-boundary suffix** — `*.posthog.com` accepts `eu.posthog.com` but not
  `posthog.com.evil.net`, and not the bare suffix

There is no prefix wildcard. A URL whose authority contains `@` yields no host at
all and is refused outright: in `https://matomo.mz.gov.mz@evil.com/x.js` the real
host is `evil.com`, and a naive parse would report the whole string and sail past
a host check.

## What is sent, and what never is

Every adapter receives the same `ctx`: parameterised page path, surface
(`citizen`/`employee`), entrance, state tenant, city tenant, locale, module,
referrer **host** only, and a timestamp. What each vendor actually transmits
varies with its own API — Matomo carries the scrubbed page plus
category/action/label/value; GA4 carries `page_path` and event params; PostHog
carries the scrubbed `$current_url` plus tenant properties; Sentry carries
exceptions only.

**Never sent:** names, e-mail addresses, mobile numbers, auth tokens, user
UUIDs, full URLs, or `document.title`. `ctx` structurally has no field for any of
them — that absence is the primary defence, not a filter.

The scrubber runs on every outgoing string, identically for every adapter:

| Pattern | Becomes |
|---|---|
| complaint ids — `PRD-2026-000023`, `P-2026-000037`, `E-2026-000022`, `TST-2026-000020`, `PG-PGR-2026-08-04-000123` | `:id` |
| UUIDs | `:uuid` |
| digit runs of 8–15 (MZ mobiles are 9) | `:num` |
| e-mail addresses | `:email` |
| bare numeric path segments | `/:n` |
| query string | **default-deny** — only `tenantId`, `module`, `moduleName`, `masterName`, `key`, `locale`, `preview`, `builderPreview` survive |

Operator `scrubPatterns` are **appended**; they can tighten, never loosen.
Do Not Track is honoured unconditionally and is not a field — no row can switch
it off.

## Who can change what

| Surface | Who |
|---|---|
| The **Analytics Providers** sidebar entry | shown to `SUPERUSER` / `MDMS_ADMIN` only |
| The `/manage/analytics-providers` **route** | reachable by any logged-in Configurator user; renders read-only, with `apiKey` and `dsn` masked |
| Writing a row | gated on `SUPERUSER` / `MDMS_ADMIN` in the UI |
| The three ops knobs | ansible / the box — not reachable from any UI |

With Kong in audit mode (`ENFORCE_RBAC = false`) and plain `EMPLOYEE` accepted at
the Configurator login, the UI gate is courtesy, not security: **MDMS write access
is effectively script-injection access** for `CUSTOM` rows. ACCESSCONTROL rows for
the two write endpoints (actions 30/31 → `SUPERUSER`/`MDMS_ADMIN`) ship with the
seed data so a later RBAC flip does not break analytics writes, but they only
reach **freshly seeded** tenants — `MdmsBulkLoader` skips a file whose tenant
already has rows, and default-data-handler is no longer in the compose stack on
develop/master. Until that flip, the ops knobs are the real control.
