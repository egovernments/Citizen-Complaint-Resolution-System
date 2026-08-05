# 1. Setup

Getting the analytics registry onto an environment, and creating the first
destination end to end. Nothing here changes what an environment sends until the
last step.

## What has to be true

| Piece | Reaches an environment via | Check |
|---|---|---|
| The MDMS schema | `seed-analytics-schema.sh` (running env) or default-data-handler (freshly created tenants only) | `schema/v1/_search` returns `common-masters.AnalyticsProvider` |
| The portal shim | a digit-ui build + deploy — `public/analytics.js` is copied verbatim into `build/`, no build-script change | `curl -sI <host>/digit-ui/analytics.js` returns a **javascript** content type |
| The Configurator screen | a configurator build + deploy (`build_configurator`, `nginx_features.configurator`) | the **Analytics Providers** entry appears in the sidebar for SUPERUSER/MDMS_ADMIN |
| The ops knobs | ansible re-render of `globalConfigs.js`, **optional** — absent keys read as `undefined`, which the shim treats as "not killed" | `curl -s <host>/digit-ui/globalConfigs.js \| grep ANALYTICS_` |

All four are independent. The screen works with no shim deployed (it warns), and
the shim works with no screen deployed (rows can be written over the API). Design
for all four combinations; every one of them is inert by default.

> **Provenance warning.** `group_vars/digit.yml` defaults
> `digit_ui_esbuild_repo` to an **external** GitHub repo, and
> `digit_ui_bundle_image` pulls a prebuilt image. On an environment configured
> either way, a change in this monorepo never arrives. Confirm the target's
> `host_vars` sets `build_digit_ui: true` before promising anyone the feature is
> live there.

## The 0 → 1 path: one command

On a moz-family environment the unified migration runner covers every
prerequisite, and is safe to re-run:

```bash
node docs/migration/ccrs-migrate.cjs \
  --host https://<env> --user <admin> --pass <pw> --tenant <stateRoot>
```

Two phases do the analytics work:

| Phase | What it ensures |
|---|---|
| `schemas` | registers `common-masters.AnalyticsProvider` at the state root |
| `analytics` | ACCESSCONTROL action rows (30/31) + grants for `SUPERUSER`/`MDMS_ADMIN`, and the Configurator's localisation keys in all four locales — then busts the localisation cache, without which the UI keeps serving the raw key |

`verify` then reports readiness, and the expected result on a fresh environment is
**schema present, zero destinations** — plumbing in place, feature dark:

```
AnalyticsProvider=schema ok, 0 destination(s) — feature dark, as expected
```

Add-if-missing throughout: a re-run creates nothing twice and never overwrites a
label an operator has renamed. Verified on a real stack — first run
`2 actions / 4 grants / 8 keys created`, second run `0 created, 8 already present`.

Use `--dry-run` first to print the plan without writing. Note that `auth` must be
in the phase list for any write phase to run:
`--phases auth,analytics,verify --dry-run`.

Everything else on this page is the manual equivalent, for develop/master
environments where `ccrs-migrate.cjs` does not exist.

## Step 1 — register the schema

```bash
TENANT=mz ./local-setup/scripts/seed-analytics-schema.sh
# optional: MDMS_URL=http://localhost:18094 (default; talks to mdms-v2 directly)
```

Idempotent — a second run reports `already present`. It creates **no records**:
absent records *is* the default-off state.

The script refuses a dotted tenant on purpose. A schema registered under a city
tenant becomes permanently invisible to the search API and cannot be repaired
(`schema/v1/_update` returns HTTP 501 and there is no delete). Schemas live at
the state root; **data** rows may live at any tenant beneath it — verified: a
city can hold rows against a state-root-only schema.

It also refuses to run if the schema description in the source file contains
non-ASCII, rather than stripping it. Old mdms-v2 images silently drop such
creates, and the obvious `jq` sanitiser for this is broken on jq 1.6 (its
Oniguruma build does not parse `\uXXXX` inside a character class and deletes
ordinary ASCII instead) — a mangled description would be permanent.

## Step 2 — deploy the portal bundle

Standard digit-ui build and deploy. Two things worth knowing:

- `public/analytics.js` needs **no** build-script change: the build copies every
  top-level `public/` entry except `index.html`, verbatim. Verified: the built
  copy is byte-identical.
- The bootstrapper tag lands **above** the injected bundle script, because
  `generateHTML()` replaces `</body>` with `scriptTags + "</body>"`.

Under `npm run dev`, the dev server serves `public/analytics.js` from a handler
placed **ahead** of the `build/` static branch — `build/` is never cleaned, so a
stale copy there would otherwise shadow your edits.

## Step 3 — check the bundle supports it

Open the Configurator screen. If this environment's portal bundle predates the
shim, a red banner says so and tells you to redeploy digit-ui. The screen probes
`HEAD /digit-ui/analytics.js` and inspects the **content type**, because a
missing file is served as the SPA shell with `200 text/html`, not a 404.

(The probe is skipped under `vite` dev, where there is no `/digit-ui` proxy and
it would always cry wolf.)

## Step 4 — create a destination, switched off

Configurator → **Analytics Providers** → **Add destination**.

1. **Code** — permanent identity, also the MDMS `uniqueIdentifier`. Immutable
   after create, and MDMS has no delete, so a code is spent forever. Pick
   something durable: `matomo-state`, not `matomo-test-2`.
2. **Provider** — `MATOMO`, `GA4`, `POSTHOG`, `SENTRY` or `CUSTOM`. Only that
   type's fields are shown.
3. Fill them in and **Save** with Enabled unticked. An incomplete draft may be
   saved while it is off; enabling it later requires it to be complete.

For a self-hosted Matomo you also need step 5 — the shim will refuse an
undeclared host.

## Step 5 — declare a self-hosted host (Matomo and CUSTOM only)

The compile-time allowlist carries vendor CDNs only
(`www.googletagmanager.com`, `js.sentry-cdn.com`, `browser.sentry-cdn.com`,
`*.sentry.io`, `*.posthog.com`). There is deliberately **no prefix wildcard**: a
pattern like `matomo.*` would have accepted
`matomo.<anything-an-attacker-registers>.com`. A self-hosted collector's host is
environment-specific, so ops declares it:

```yaml
# host_vars/<env>.yml
analytics_script_hosts:
  - matomo.mz.gov.mz
```

then `./deploy.sh <host>` to re-render `globalConfigs.js`. MDMS **cannot** widen
this list; the Configurator warns when it cannot verify a host, and the portal is
the enforcer. Verified on local: with the host declared, four route changes
produced four collector hits; with the declaration removed and the identical
enabled record in place, **zero**.

## Step 6 — enable it

Tick **Enabled** and save. A cloud destination (`GA4`, `POSTHOG`, `SENTRY`,
`CUSTOM`) additionally demands the data-residency acknowledgement — see
[20-configuration.md](20-configuration.md#the-residency-acknowledgement).

## Step 7 — verify in a browser

DevTools → Network on the portal:

1. Navigate three or four routes. Expect one collector request per route change.
2. Open a complaint with `?mobileNumber=…` in the URL. The tracked URL must read
   `:id` / `:num`, never the values.
3. Console: `[analytics]` debug lines name any row that was skipped and why.

Changes appear on the next page load, worst case ~90 s later (the shim's own
`sessionStorage` cache; deliberately not the app's 24 h IndexedDB MDMS cache).

## Step 8 — keep the streams separate

Do not point a new destination at an existing stream:

- `unified-demo.digit.org/matomo` **site 5** is consumed by three server-side ops
  emitters (digit-mcp, the telemetry sidecar, the jupyter dataloader).
- The PostHog project `phc_NsoE…` and the Sentry DSN hardcoded in the
  configurator and digit-ui-v2 bundles are their own pre-existing streams.

Give the portal its own site/project so the data stays attributable.
