# Post-Deploy Add-ons & Opt-in Features

The base deploy gives you a working PGR stack. Everything else is an **add-on**
you opt into, and they come in two kinds:

- **Deploy-time features** — flags in `host_vars/<tenant>.yml`; enable by
  flipping the flag and re-running `./deploy.sh <tenant>` (idempotent).
- **Post-deploy installers** — scripts in `local-setup/scripts/` that flip a
  feature on against a *running* stack. Both are **resumable and idempotent**
  (`--list`, `--from stepN`, `--to stepN`, `--only stepN`) and verify their own
  work; neither redeploys anything.

---

## Installer 1 — PGR notifications (SMS / Email / WhatsApp)

`local-setup/scripts/enable-notifications.sh` — switches PGR onto the
config-driven notification path and stands up the delivery pipeline
(Novu + novu-bridge + provider).

What it does (9 resumable steps):

1. `PGR_NOTIFICATION_CONFIG_DRIVEN=true` on pgr-services
2. Pin the bridge image + bring up the Novu stack
3. Mint the self-hosted Novu API key, wire it into the bridge
4. Open the channel gate (`SMS,EMAIL,WHATSAPP`) + config-admin proxy roles
5. Ingress for the Novu dashboard (showcase + validate)
6. Seed the **4 notification MDMS masters** at the state root
7. Provider credentials — **the one manual input**: `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (secrets never printed)
8. Bootstrap Novu: Twilio integration + per-channel workflows
   (`complaints-sms` / `-email` / `-whatsapp`)
9. Drive-and-verify from `nb_dispatch_log` (`SENT` = trigger accepted;
   confirm actual delivery against the provider — see the runbook §5.4)

```bash
TWILIO_ACCOUNT_SID=AC… TWILIO_AUTH_TOKEN=… \
  TWILIO_WHATSAPP_FROM=whatsapp:+14155238886 \
  ./local-setup/scripts/enable-notifications.sh
```

WhatsApp specifics — Content templates must be authored and approved at the
provider **first**, then synced to Content-SIDs (configurator UI or headless
CLI): the full path is
[`../../docs/notification-onboarding/RUNBOOK.md`](../../docs/notification-onboarding/RUNBOOK.md)
(§5 covers templates → SIDs → test-send → drive a real complaint), with
[`TUTORIAL.md`](../../docs/notification-onboarding/TUTORIAL.md),
[`install-fresh.md`](../../docs/notification-onboarding/install-fresh.md),
[`install-upgrade.md`](../../docs/notification-onboarding/install-upgrade.md) and
the provider-onboarding runbook alongside.

---

## Installer 2 — Supervisor dashboard (KPI catalog + packs)

`local-setup/scripts/enable-dashboard.sh` — seeds everything the employee
supervisor dashboard needs, **from the repo's own files** (never by copying
another tenant, which is how empty catalogs propagate).

What it does (7 resumable steps):

1. Register the three `dss.*` schemas (`KpiDefinition`, `DashboardPack`,
   `DashboardConfig`)
2. Seed the KPI catalog — 39 definitions + 1 pack — with RBAC roles remapped
   via `ROLE_MAP` when your deployment uses its own taxonomy
3. Seed `dss.DashboardConfig` (nav/route `allowedRoles`, number format)
4. Grant the sidebar action to each gate-passing role
5. Seed localization — the 315-message `rainmaker-dashboard` pack per locale
6. Flush the oauth token store (**mandatory after any role grant**)
7. Verify end-to-end (`catalog/_search`, `/packs`, `/_query`, every
   `titleKey` resolves in every served locale)

```bash
# canonical roles (PGR_*/GRO/DGRO/SUPERVISOR/SUPERUSER):
./local-setup/scripts/enable-dashboard.sh
# custom taxonomy:
ROLE_MAP="PGR_SUPERVISOR=CMS_SUPERVISOR,PGR_LME=CMS_CASE_MANAGER" \
  ./local-setup/scripts/enable-dashboard.sh
```

Its preflight is **read-only and refuses to write** when it finds what seeding
cannot fix — schema-as-data rows shadowing the real records, KPI role ceilings
nobody holds — and tells you when `--repair` applies. The dashboard nav is
gated by `dss.DashboardConfig.allowedRoles`, so at least one employee must hold
one of those roles. New state roots bootstrapped by `tenant_bootstrap` get the
catalog seeded from the repo automatically (and a warning when a `dss.*` master
would land empty); anything older needs this script once.

Reference: [`../../docs/dashboard-configuration/README.md`](../../docs/dashboard-configuration/README.md)
— KPI catalog, packs & RBAC, view access, filters, SLA/hierarchies, operations,
localization.

---

## Deploy-time opt-in features (host_vars flags)

Enable by setting the flag(s) in `host_vars/<tenant>.yml` and re-running
`./deploy.sh <tenant>`. Where a `nginx_features.*` twin exists, **both** flags
are needed — the service flag runs it, the nginx flag makes it reachable.

| Add-on | Flag(s) | What you get | Notes |
|---|---|---|---|
| **Configurator (DIGIT Studio)** | `nginx_features.configurator` + `build_configurator` | Browser onboarding wizard at `/configurator/` | See [TENANT-ONBOARDING.md §A](TENANT-ONBOARDING.md#a-configurator-wizard-browser) |
| **MCP server + REST shim** | `enable_mcp` (+ `nginx_features.mcp` for `/mcp` + `/v1/*`) | Automation/REST onboarding API, headless `city_setup_from_xlsx` | `build_mcp: true` to build from in-tree source; default is a pinned public image |
| **Search stack (employee inbox)** | `enable_search_stack` | Elasticsearch + egov-indexer + inbox-v2 | Heavy (~3 GB RAM extra); without it the employee inbox 503s |
| **Novu notification stack** | `enable_novu` (+ `build_novu_bridge`, `build_novu_dashboard`) | Notification infra only (no config) | The installer above is the full turn-key path; `enable_novu` alone just runs the services |
| **Keycloak SSO** | `enable_keycloak` + `nginx_features.keycloak` | Keycloak at `/auth/` + token exchange; optional Google IdP via `keycloak_google_client_*` | SPA switch to OIDC is a separate `auth_provider` step |
| **Citizen UI v2** | `enable_digit_ui_v2` + `nginx_features.digit_ui_v2` | Vite + React 19 citizen SPA at `/citizen/` | Both flags or the bundle sits on disk unreachable |
| **Turbopass (OSM autocomplete)** | `enable_turbopass` | Self-hosted location search from a prepared OSM extract | Operator prepares the data dir on the controller first |
| **Overpass (OSM queries)** | `enable_overpass` | Self-hosted Overpass API | Prepare the country extract first — see `overpass/README.md` |
| **Real OTP (production SMS)** | `enable_otp_services` | Real OTP delivery instead of the console mock | ALSO remove the Kong mock plugin + set a real `SMS_PROVIDER_CLASS` — see `kong/kong.yml` notes |
| **Integration-test dashboards** | `enable_integration_tests` + `nginx_features.integration_tests` (+ `_runner` pair for in-dashboard runs) | Published Playwright dashboards at `/tests/` | Runner is CPU/RAM heavy — shares the box with the live stack |
| **Brand assets** | `nginx_features.brand_assets` | Local logo/banner mirror at `/brand/` | |
| **CI test suites on deploy** | `run_ci_tests` | Newman + regression suites run at the end of every deploy | Adds ~5–10 min per deploy |
| **DB fast path** | `db_fast_path` + `db_fast_path_ack_data_wipe` | Prebuilt DB dump load on first deploy | Required on fresh installs; the ack is a preflight gate |

Full inline documentation for every flag lives in
[`../ansible/inventory/host_vars/_example.yml`](../ansible/inventory/host_vars/_example.yml) —
each key carries its own comment block, defaults, and pairing requirements.
