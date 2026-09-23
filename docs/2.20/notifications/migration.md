# Migrating notifications from 2.12 to 2.20

Read this before deploying 2.20 over a 2.12 deployment. First-time setup is
[setup-guide.md](./setup-guide.md).

## What changes

| Area | 2.12 | 2.20 |
|---|---|---|
| Configuration masters | `RAINMAKER-PGR.NotificationRouting` / `.NotificationTemplate` / `.NotificationProviderTemplate` / `.NotificationChannel`, keyed `(businessService, action, toState)`, bare audiences | `NOTIFICATIONS.EventCatalogue` / `.Routing` / `.Template` / `.ProviderTemplate` / `.Channel` at the state tenant, keyed on `eventName`, audiences `ACTOR:` / `ROLE:` / `EVENT_RECIPIENTS` / `A\|B` |
| What pgr-services publishes | Pre-rendered envelopes, one per recipient × channel, behind `pgr.notification.config.driven` | One thin event per workflow transition on `complaints.domain.events`; novu-bridge routes, resolves and renders. No flag |
| Login OTP SMS | `egov-notification-sms` (or `otp-publisher`) | novu-bridge consumes `egov.core.notification.sms`; same channel policy, provider and log as other SMS |
| Providers | Novu dashboard / deploy-time env | Configurator → Notifications → Providers (credentials stored in Novu) |
| Channel on/off | `novu_bridge_channels_enabled` | Channel rows (Configurator → Notifications → Channels). The env list is a fallback for a tenant with no rows; the upgrade turns it into rows ([step 3](#channel-rows-what-happens-to-an-existing-tenant)) |
| Images | pgr-services and novu-bridge pinned separately | pgr-services, pgr-services-db, novu-bridge and novu-bridge-db share one tag ([step 1](#1-take-all-four-images-from-one-build)) |

## Before you upgrade

- [ ] Choose **one build** for pgr-services, pgr-services-db, novu-bridge and novu-bridge-db
      ([step 1](#1-take-all-four-images-from-one-build)).
- [ ] Note which channels each tenant uses today (`NOVU_BRIDGE_CHANNELS_ENABLED` on the running
      `novu-bridge` container) and which provider sends them. After the upgrade they must still
      be on.
- [ ] Remove the flags and properties listed under [Removed settings](#removed-settings) from
      your host_vars, Compose overlays and Helm values. Move any bridge setting you added to
      `/opt/digit/.env` by hand into host_vars ([step 5](#5-bridge-settings-now-come-from-host_vars)).
- [ ] If you use real OTP login, confirm `enable_novu: true` (the deploy refuses
      `enable_otp_services: true` without it).
- [ ] Kubernetes: keep `deploymentStrategy.type: Recreate` on `pgr-services` and upgrade
      novu-bridge first ([step 2](#2-new-novu-bridge-before-new-pgr-services)).
- [ ] Book a quiet period per tenant for moving its notification configuration
      ([step 3](#3-copy-each-tenants-configuration)): the deploy does not move it.

## 1. Take all four images from one build

pgr-services publishes thin events that only a novu-bridge from the same build can resolve, and
each application needs the Flyway migrations its `-db` image carries: 2.20's bridge writes
columns that `novu-bridge-db` adds (`V20260916120000__dispatch_log_delivery_receipts.sql`,
`V20260921130000__add_source_path.sql`). A new bridge on the old schema fails every dispatch-log
write. `build/build-config.yml` builds all four from the same commit in every run, so pin them
with **one** tag:

| Tier | Setting | Default |
|---|---|---|
| Compose (Ansible) | `notification_stack_tag` in host_vars → `NOTIFICATION_STACK_TAG` in `/opt/digit/.env` | `nightly-develop` |
| Helm | `global.notificationStackTag` in `devops/deploy-as-code/charts/environments/env.yaml` | `nightly-develop` |
| `enable-notifications.sh` | `NOTIFICATION_STACK_TAG` | `nightly-develop` |

`nightly-develop` is the rolling tag the develop nightly publishes for all four
(`egovio/<image>:nightly-develop`, plus an immutable `develop-<sha8>`; see
`build/NIGHTLY-BUILDS.md`). It moves **per image**: when one image's build fails, or two runs
overlap, it points at different commits for different images. **On a live deployment pin an
immutable tag that exists for all four** — a release tag, or a `develop-<sha8>` you have checked
on Docker Hub for `pgr-services`, `pgr-services-db`, `novu-bridge` and `novu-bridge-db`.

A per-image override (`pgr_services_image`, `pgr_services_db_image`, `novu_bridge_image`,
`novu_bridge_db_image`; Helm `<chart>.image.tag` / `<chart>.initContainers.dbMigration.image.tag`)
wins over the shared tag for that one image, so pin all four to the same build or none. The
deploy warns when host_vars pin only some of them.

## 2. New novu-bridge before new pgr-services

A 2.12 bridge cannot read a thin event: it dead-letters it to `novu-bridge.dlq`, and nothing
replays the DLQ, so every transition published in that window is a notification lost. The new
bridge accepts both the old pre-rendered envelopes and thin events, so upgrading it first is
safe.

- **Docker Compose**: the deploy recreates `novu-bridge` (and runs its migrator) on its own
  before the full `up -d`, whenever a bridge is already running. Doing it by hand:
  `docker compose <files> up -d novu-bridge` first, then `up -d pgr-services`.
- **Kubernetes**: `digit-helmfile.yaml` applies `common-services` (novu-bridge, released with
  `wait: true`) before `urban` (pgr-services), so a plain `helmfile -e env sync` waits for the new
  bridge to be Ready before touching pgr-services; a bridge that never becomes Ready stops the
  sync with the old pair still running. Syncing charts one at a time, do it in this order:
  ```bash
  cd devops/deploy-as-code
  helmfile -f charts/common-services/common-services-helmfile.yaml -e env -l name=novu-bridge sync
  kubectl -n egov rollout status deploy/novu-bridge
  helmfile -f charts/urban/urban-helmfile.yaml -e env -l name=pgr-services sync
  ```

**Never run an old and a new pgr-services together.** A 2.12 replica (pre-rendered envelopes)
and a 2.20 replica (thin events) each notify the citizen, under two different transaction ids,
so the bridge's refusal to re-send an id it has already `SENT` or `DELIVERED` does not catch it.
Compose stops the old container before starting the new one. On Kubernetes
`devops/deploy-as-code/charts/urban/pgr-services/values.yaml` sets
`deploymentStrategy.type: Recreate`; keep it and do not add a `rollingUpdate` block (the API
rejects it with `Recreate`).

## 3. Copy each tenant's configuration

**The deploy upgrades software only.** `./deploy.sh <tenant>` (or `--tags notifications`)
creates the notification schemas and access-control rows, gives a tenant with **no** channel
rows rows that say what `NOVU_BRIDGE_CHANNELS_ENABLED` says
([below](#channel-rows-what-happens-to-an-existing-tenant)), and — only for a tenant with no
notification configuration at all — writes the shipped defaults straight into
`NOTIFICATIONS.*`. It never copies a tenant's 2.12 rows and never adds a default row to a
configured tenant. A 2.12 tenant keeps being served from its legacy masters, unchanged; the
deploy says so (`notif-seed — ACTION: this tenant's notification configuration is not migrated`).
Until it is migrated, the Configure and Channels screens show it read-only (*"This tenant has not
been migrated yet — shown read-only"*) and refuse a raw first `NOTIFICATIONS.Routing` /
`NOTIFICATIONS.Channel` row (`namespace-switch`): that row alone would switch the tenant over.

Moving a tenant is a separate step, per tenant, with
`local-setup/scripts/migrate-notifications.py` (the deploy stages it as
`/opt/digit/notification-seed/migrate-notifications.py`). **It is one-way.** novu-bridge serves
a tenant from `NOTIFICATIONS.*` from its first `NOTIFICATIONS.Routing` row on (active or not —
MDMS has no delete), and no command or setting moves it back. The legacy rows are never modified.

```bash
cd /opt/digit/notification-seed                 # or local-setup/scripts in a checkout
export DIGIT_URL=http://127.0.0.1:18000         # Kong; DIGIT_USERNAME / DIGIT_PASSWORD default ADMIN / eGov@123
python3 migrate-notifications.py plan  --all --report plan.json
python3 migrate-notifications.py apply --all --only defaults --yes --report apply.json
python3 migrate-notifications.py apply --tenant mycity --yes --report apply-mycity.json
```

### Plan (read-only)

`--all` takes every state tenant listed in `tenant.tenants` at the root(s): `--roots a,b`, else
`STATE_ROOT`, else the running bridge's `NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT` (the deploy sets it
to `state_root`). City codes are skipped (configuration lives at the state tenant), and so is test
junk (`--exclude`, default `(?i)^(PW_|pwt)`). `--tenant X` (repeatable) names tenants instead.

| Category | Meaning | `apply` does |
|---|---|---|
| `none` | no configuration in either namespace | nothing, unless `--adopt-defaults` (then the shipped defaults) |
| `defaults` | legacy rows equal the shipped defaults, after conversion | copies the tenant's rows |
| `customised` | legacy rows differ; the plan lists rows only in the tenant, rows only in the defaults (**not** added) and every changed field | copies the tenant's rows, exactly |
| `migrated` | already served from `NOTIFICATIONS.*` | adds missing catalogue rows, channel rows that are still only in the legacy master, and provider pins; nothing else |
| `partial` | `NOTIFICATIONS.*` rows but no Routing, a copy that did not finish, no event catalogue, or an interrupted default seed | finishes the copy with the tenant's own rows (`--adopt-defaults` for an interrupted default seed) |

For each tenant the plan also shows the rows `apply` would create, after conversion
(`--show-rows full` prints them whole); the event catalogue, generated from the tenant's
**live** PGR workflow in egov-workflow-v2 (the repository template, with a warning, when that
cannot answer); channel policy now and after; the provider decision per channel; and warnings:
routing for events the live workflow cannot produce, routed audiences with no template or none
in the default locale, WhatsApp routes without an approved provider template, and rows the
conversion drops (`AUTO_ESCALATE` / `SYSTEM` — the bridge drops them today too).

### Review

Read every `customised` and `partial` tenant. The copy is the tenant's own rows through the
conversion the bridge already applies to them (`notifications_convert.py` mirrors
`LegacyMasterAdapter`), so what it sends today is what it sends after. Inactive rows stay
inactive. Default rows it never had are not added.

### Apply

- `apply` needs `--yes`; without it, it prints the plan and exits `4`.
- With `--all` it needs `--only <categories>`. `customised` and `partial` tenants are applied only
  when listed there or named with `--tenant`: do `--only defaults` first, then the customised
  tenants one at a time.
- Write order: event catalogue, templates, provider templates, channel rows, **routing last**.
  Routing is held back when any catalogue, template or provider-template write fails; the tenant
  then stays on its legacy masters. Re-run to finish.
- **Apply in a quiet period.** The bridge rejects an event whose name is missing from a
  non-empty event catalogue — whichever namespace serves the tenant — dead-letters it, and caches
  the catalogue for 60 s. MDMS creates one row per call, so a tenant's first catalogue appears
  row by row (well under a second), and an event arriving in that window can be rejected
  (`NB_EVENT_NOT_IN_CATALOGUE`) for up to 60 s. `apply` prints the window; check Logs for
  `REJECTED` rows in it. A catalogue left incomplete fails the tenant
  (`EVENT CATALOGUE INCOMPLETE`): re-run at once. The catalogue lists PGR's workflow transitions;
  a thin event with any other name is rejected for a tenant that has one.
- Before and after writing, `apply` resolves one synthetic thin event per catalogued event and
  locale through `POST /novu-bridge/novu-adapter/v1/dispatch/_resolve` (nothing is sent, no
  ledger row is written), with made-up citizen and assignee contacts and the tenant's real role
  pools, and compares recipient, channel, locale and text. Any difference is listed and makes the
  tenant `WARN`. When the bridge cannot answer, the preview is skipped and the output says so.
- It then re-reads every master and reports counts and any row that is missing or reads back
  different.
- Re-running skips rows already there and reports them as present. A failed tenant does not
  stop the others.

Exit codes: `0` ok · `1` warnings · `2` a tenant failed · `3` a write was refused with 403
(restart `egov-accesscontrol`; a tenant that never had the deploy's notification step also lacks
its access-control rows — run `NOTIF_TENANT=<tenant> NOTIF_SEED_PHASE=access python3
seed-notifications.py` first) · `4` refused to start.

### Providers

Novu integrations belong to the whole deployment; `NOTIFICATIONS.Channel.provider` pins one per
channel per tenant. A pin outranks the channel's `gateway` and `NOVU_BRIDGE_SMS_PROVIDER`. For
each channel that is on:

| Situation | `apply` |
|---|---|
| exactly one active integration of that channel (Novu's in-app inbox ignored) | pins it |
| several | lists them and leaves the channel unpinned (Novu keeps using its primary); choose with `--provider SMS=<identifier>` |
| none | operator action — the channel cannot deliver; the tenant ends `WARN` |
| SMS on the direct SMSCountry route (`gateway: smscountry`, or `NOVU_BRIDGE_SMS_PROVIDER=smscountry`) | kept as it is: a pin would move SMS onto a Novu integration. Move it on purpose with `--create-smscountry-provider` or `--provider SMS=…` |
| on through `NOVU_BRIDGE_CHANNELS_ENABLED`, no channel row | no pin (nowhere to store one) |

`--create-smscountry-provider` (or `--create-provider <type>`, for `twilio-sms`,
`twilio-whatsapp`, `smtp`, `ozeki`, `smscountry`) creates a catalog provider through
`POST /novu-bridge/novu-adapter/v1/providers` and pins it for the tenants in the run.
Credentials are read only from `--credentials-file`, a JSON object keyed by type:

```json
{"smscountry": {"name": "SMSCountry", "credentials": {"user": "…", "password": "…", "senderId": "…"}}}
```

The file must be mode `0600` or stricter, or it is refused. Values are never printed or written
to the report. The identifier is derived from the name, so a re-run finds the provider rather
than creating a second one. Integrations created before the catalog are listed as working but
not rotatable from the Configurator; re-create them from the catalog when convenient.

### The report

`--report <file>` writes JSON: `mode`, `roots`, `excluded`, `bridgeEnv`, `providers`
(`integrations` as the bridge lists them, `preCatalog`, `created` — credential key names only),
and per tenant `category`, `reasons`, `counts`, `defaultsDiff` (`onlyInTenant`, `onlyInDefaults`,
`changed` with the default and tenant values), `planned` (full rows per master), `catalogue`,
`channels` (`now`, `after`), `providers` (the decision per channel), `warnings`,
`operatorActions`, `notes`. After `apply`: `apply.write` (created / present / failed per master),
`apply.catalogue` (the write window, `COMPLETE` or `PARTIAL`), `apply.verify`,
`apply.mismatches`, `apply.preview` (`differences`, and both previews) and `result` — `OK`,
`WARN`, `FAILED` or `SKIPPED`.

### Verify

Run `plan --all` again: every tenant you applied is `migrated` with nothing to create, and
`/config/source` ([below](#where-is-a-tenant)) reports `NOTIFICATIONS.Routing` for it. Then send
one real complaint transition per migrated tenant and check Logs.

### Channel rows: what happens to an existing tenant

Channel rows switch delivery on and off the moment they exist: a tenant with **any** active
channel row (in `NOTIFICATIONS.Channel`, else `RAINMAKER-PGR.NotificationChannel`) is decided by
those rows alone — a channel without a row is off — and only a tenant with none follows
`NOVU_BRIDGE_CHANNELS_ENABLED`. So the seed does not write the committed all-off rows; it reads
the allowlist the **running** `novu-bridge` container has and decides per tenant:

| The tenant today | The seed writes | Effect |
|---|---|---|
| No channel rows; allowlist e.g. `SMS` | One row per channel, `enabled` = listed (SMS on, EMAIL/WHATSAPP off), no `gateway` — in the legacy master for a 2.12 tenant, else in `NOTIFICATIONS.Channel` | None: the rows say what the env said. `NOVU_BRIDGE_SMS_PROVIDER` still picks the SMS transport |
| No channel rows; empty allowlist (a new deployment) | All three rows, off | None: nothing was enabled. The out-of-box default |
| Has channel rows | Nothing | None. A channel on the allowlist without a row is reported: it has been off since the tenant got rows |
| Only inactive rows, one of them for an allowlisted channel | Nothing (`mode=conflict`) | None; decide that channel on the Channels screen |
| Seed run by hand without `NOTIF_CHANNELS_ALLOWLIST` | Nothing (`mode=unknown`) | None; the tenant stays on the env allowlist |

The seed prints its decision — `CHANNEL-POLICY: tenant=… mode=… allowlist=… target=…` and one
line per channel — and the deploy shows it under `notif-seed — result`. A run that dies half way
is finished by the next one with the same rule. The migration copies a 2.12 tenant's channel rows
into `NOTIFICATIONS.Channel` as they are (plus provider pins). The bridge caches channel policy
for 60 s, so a change takes up to a minute to apply.

A tenant created by `default-data-handler` (a new tenant, or a Helm bootstrap) starts with the
committed all-off rows whatever the allowlist says; the Helm tier runs no seed and sets no
`NOVU_BRIDGE_CHANNELS_ENABLED`, so switch channels on in the Configurator there.

### Where is a tenant?

There is no setting that chooses old or new — the data does. Check with any of:

- `migrate-notifications.py plan --tenant mycity`: the category.
- **Configurator → Notifications → Configure**: no banner = on `NOTIFICATIONS.*`.
- `GET /novu-bridge/novu-adapter/v1/config/source?tenantId=mycity` (employee token): one entry
  per master with the schema read, row count, `legacy` and `stale` flags.
- The `source_path` column on `nb_dispatch_log` (and the **Produced by** column / `sourcePath`
  filter on Logs): `PRERENDERED` = a finished envelope from a producer, `RESOLVED` = a thin event
  resolved by the bridge. After the cutover, complaint rows should read `RESOLVED`.

## 4. OTP moves to novu-bridge

- `egov-notification-sms`, `otp-publisher` and `novu-bridge-endpoint` are gone from Compose.
  `up -d` does not stop containers of services it no longer knows, and a leftover
  `egov-notification-sms` still consumes `egov.core.notification.sms` next to novu-bridge — every
  OTP sent twice, through two providers. The deploy removes the three containers when
  `enable_novu` is on (only a container this deployment's compose created). By hand:
  `docker rm -f egov-notification-sms otp-publisher novu-bridge-endpoint`, or
  `docker compose <files> up -d --remove-orphans` (which also removes any other orphan of the
  project). On Helm `egov-notification-sms` is `installed: false` in
  `devops/deploy-as-code/charts/core-services/coreservices-helmfile.yaml` (kept for a
  one-release rollback).
- `egov-otp` + `user-otp` still generate and validate OTPs and publish the SMS to
  `egov.core.notification.sms`; novu-bridge translates it (`eventType CORE_SMS`, ledger event
  `CORE.SMS.OTP`) and delivers it through the tenant's SMS channel.
- The bridge's first subscription to `egov.core.notification.sms` starts at the **latest**
  offset, not the beginning: OTPs queued before the upgrade are not sent. An OTP whose
  `expiryTime` has passed is dropped with an INFO log (no phone, no text) — no ledger row, no
  DLQ message.
- The tenant an OTP is checked against is `NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT` when the
  message carries none: Compose rewrites it to `state_root`, Helm reads `state-level-tenant-id`
  from the `egov-config` ConfigMap. **SMS must be switched on, with a provider, at that tenant**
  or every OTP is `SKIPPED / NB_NO_PROVIDER` and phone login stops.

## 5. Bridge settings now come from host_vars

`./deploy.sh` regenerates `/opt/digit/.env` from `templates/digit.env.j2` on every run. These are
now rendered from host_vars, so a value you added to `.env` by hand must move there or it is lost
on the next deploy:

| host_vars | Env |
|---|---|
| `novu_bridge_receipts_secret` | `NOVU_BRIDGE_RECEIPTS_SECRET` |
| `novu_bridge_preference_enabled` / `novu_bridge_preference_fail_open` | `NOVU_BRIDGE_PREFERENCE_ENABLED` / `_FAIL_OPEN` |
| `novu_bridge_core_sms_country_code` | `NOVU_BRIDGE_CORE_SMS_COUNTRY_CODE` |
| `novu_bridge_smscountry_allowed_hosts` | `NOVU_BRIDGE_SMSCOUNTRY_ALLOWED_HOSTS` |
| `notification_stack_tag`, `pgr_services_db_image`, `novu_bridge_db_image` | `NOTIFICATION_STACK_TAG`, `PGR_SERVICES_DB_IMAGE`, `NOVU_BRIDGE_DB_IMAGE` |

## Rollback

- **Redeploy the 2.12 checkout, not just the 2.12 image tags.** The 2.12 pgr-services needs
  `PGR_NOTIFICATION_CONFIG_DRIVEN=true` (and the `MDMS_HOST` / legacy topic settings) to send
  anything, and 2.20's compose files no longer set them; with 2.20's files a 2.12 pgr-services
  sends nothing. Roll pgr-services and novu-bridge back together, and the retired containers
  come back with the 2.12 compose files.
- The database needs no down-migration: 2.20's bridge migrations only add columns with defaults,
  which the 2.12 bridge ignores.
- **Configurator edits made after a tenant's migration are lost.** They were written to
  `NOTIFICATIONS.*` only; 2.12 reads `RAINMAKER-PGR.*`, which still holds the configuration as
  it was when the tenant was migrated. (Under 2.20 there is no way back: migration is one-way
  per tenant.)
- The 2.12 bridge ignores channel rows and goes back to `NOVU_BRIDGE_CHANNELS_ENABLED`.
- Thin events dead-lettered while the versions were mixed cannot be replayed by a 2.12 bridge.

## Removed settings

Delete these wherever you set them; nothing reads them in 2.20.

| Where | Removed |
|---|---|
| host_vars | `pgr_notification_config_driven`, `build_otp_publisher`, `otp_publisher_image` |
| pgr-services env / properties | `PGR_NOTIFICATION_CONFIG_DRIVEN` (`pgr.notification.config.driven`), `pgr.notification.default.locale`, `pgr.notification.rolepool.page.size`, `pgr.notification.rolepool.max.pages`, `complaints.domain.events.enabled`, `complaints.domain.events.default.locale`, `notification.sms.enabled`, `egov.user.event.notification.enabled`, `kafka.topics.notification.sms`, `egov.usr.events.*`, `egov.pgr.events.*`, `egov.ui.app.host.map` |
| novu-bridge env / properties | `NOVU_BRIDGE_KAFKA_INPUT_TOPIC` (now `NOVU_BRIDGE_KAFKA_INPUT_TOPICS`, comma-separated), `NOVU_BRIDGE_KAFKA_RETRY_TOPIC` (no retry topic), `NOVU_BRIDGE_CHANNEL`, `MDMS_HOST` / `MDMS_SEARCH_PATH` (now `NOVU_BRIDGE_MDMS_HOST` / `_SEARCH_PATH`), `NOVU_BRIDGE_CONFIG_HOST` / `_CONFIG_RESOLVE_PATH` / `_CONFIG_SEARCH_PATH` (Helm; env.yaml `novu-bridge.config-resolve-path` / `config-search-path`) |
| build | `novu-bridge-endpoint` and `otp-publisher` images (no longer built) |

Changed defaults worth checking: `NOVU_BRIDGE_CHANNEL_POLICY_SCHEMA` is `NOTIFICATIONS.Channel`
(legacy fallback automatic — leave it unset); `NOVU_BRIDGE_KAFKA_INPUT_TOPICS` adds
`notifications.events`; `NOVU_BRIDGE_PROXY_ALLOWED_ROLES` adds `MDMS_ADMIN`; the new
`NOVU_BRIDGE_PROXY_ADMIN_ROLES` gates provider create/rotate/delete.

## After the upgrade

- [ ] `docker ps` (or `kubectl get pods -o wide`) shows pgr-services and novu-bridge on the tag
      you chose, and the `novu-bridge-migration` / `pgr-services-migration` containers (init
      containers on Helm) exited 0 from the same tag.
- [ ] No `egov-notification-sms`, `otp-publisher` or `novu-bridge-endpoint` container is running.
- [ ] `./deploy.sh <tenant>` (or `--tags notifications`) ran with `failed=0` and no
      `notif-seed — WARNING` task.
- [ ] `migrate-notifications.py plan --all` leaves no tenant `defaults`, `customised` or
      `partial` that you meant to migrate, and every `apply` ended `OK` (or its `WARN` lines are
      understood).
- [ ] The `CHANNEL-POLICY` lines show every channel you use today as `ON` or as an existing
      enabled row.
- [ ] `/config/source` shows no `legacy: true` for any tenant you expect to edit.
- [ ] Each channel you use is on with a provider selected (**Notifications → Channels**).
- [ ] **Validate** on Configure reports zero errors.
- [ ] One real complaint transition produced `RESOLVED` rows on Logs and arrived on a handset.
- [ ] With OTP login: a phone login works and left a `CORE.SMS.OTP` row.
- [ ] `novu-bridge.dlq` has no new messages
      (`rpk topic consume novu-bridge.dlq -o start`; see [kafka-events.md](./kafka-events.md#verify-delivery)).
