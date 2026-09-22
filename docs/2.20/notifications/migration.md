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
| Channel on/off | `novu_bridge_channels_enabled` | Configurator → Notifications → Channels; the env list is a fallback for tenants with no rows |

## Before you upgrade

- [ ] Note which channels each tenant uses today and which provider sends them.
- [ ] Remove the flags and properties listed under [Removed settings](#removed-settings) from
      your host_vars, Compose overlays and Helm values.
- [ ] If you use real OTP login, confirm `enable_novu: true` (the deploy refuses
      `enable_otp_services: true` without it).
- [ ] Kubernetes: confirm `pgr-services` deploys with `deploymentStrategy.type: Recreate`
      ([step 2](#2-never-run-old-and-new-pgr-services-together)).

## 1. Copy each tenant's configuration

A stock `./deploy.sh <tenant>` runs the notification seed step. To run only that step:

```bash
cd local-setup/ansible
./deploy.sh mycity --tags notifications
```

It is idempotent and additive. It:

1. creates the five `NOTIFICATIONS.*` schemas, and upgrades an existing schema in place when
   the committed definition has gained a property;
2. **copies the tenant's own rows** — read live over `/mdms-v2/v2/_search`, not the repository
   defaults — from `RAINMAKER-PGR.Notification*` into `NOTIFICATIONS.*`;
3. seeds the generated event catalogue (no legacy counterpart);
4. adds the access-control actions and role-actions for the new screens and provider
   endpoints, and restarts `egov-accesscontrol` when it created any (it caches role-actions).

**Legacy rows are never modified or deleted.** In the Configurator they become read-only
("Legacy (PGR) …" under **Advanced**). Rolling back to 2.12 images leaves them as the live
configuration.

Until the copy runs for a tenant, novu-bridge serves that tenant's legacy rows through a read
adapter — per tenant, all or nothing, decided by whether the tenant has any
`NOTIFICATIONS.Routing` rows. Delivery keeps working; the Configure and Channels screens are
read-only with the banner *"This tenant has not been migrated yet — shown read-only"*.

If the copy could not finish, the deploy prints
`notif-seed — WARNING: the NOTIFICATIONS.* copy did not complete`. Legacy rows are untouched;
re-run the step once MDMS is healthy. Without the step at all the Channels screen saves nothing
and provider edit/delete return 403.

### Where is a tenant?

There is no setting that chooses old or new — the data does. Check with any of:

- **Configurator → Notifications → Configure**: no banner = on `NOTIFICATIONS.*`.
- `GET /novu-bridge/novu-adapter/v1/config/source?tenantId=mycity` (employee token): one entry
  per master with the schema read, row count, `legacy` and `stale` flags.
- The `source_path` column on `nb_dispatch_log` (and the **Produced by** column / `sourcePath`
  filter on Logs): `PRERENDERED` = a finished envelope from a producer, `RESOLVED` = a thin event
  resolved by the bridge. After the cutover, complaint rows should read `RESOLVED`.

## 2. Never run old and new pgr-services together

novu-bridge accepts both pre-rendered envelopes and thin events, and does **not** suppress
replays: an event arriving twice with the same idempotency key is dispatched twice. A 2.12
replica (pre-rendered) and a 2.20 replica (thin) running at the same moment each notify the
citizen, and because the transaction ids are identical on both paths, both sends upsert the
**same** `nb_dispatch_log` row — the duplicate leaves no trace.

- **Docker Compose**: `docker compose up` stops the old container before starting the new one.
  Nothing to do.
- **Kubernetes**: `devops/deploy-as-code/charts/urban/pgr-services/values.yaml` sets
  `deploymentStrategy.type: Recreate`. Keep it for this upgrade and do not add a
  `rollingUpdate` block (the API rejects it with `Recreate`).

Rollback = redeploy the previous pgr-services image; the bridge still accepts its envelopes.

## 3. OTP moves to novu-bridge

- `egov-notification-sms` and `otp-publisher` are gone from Compose; on Helm
  `egov-notification-sms` is `installed: false` in
  `devops/deploy-as-code/charts/core-services/coreservices-helmfile.yaml` (kept for a
  one-release rollback).
- `egov-otp` + `user-otp` still generate and validate OTPs and publish the SMS to
  `egov.core.notification.sms`; novu-bridge translates it (`eventType CORE_SMS`, ledger event
  `CORE.SMS.OTP`) and delivers it through the tenant's SMS channel.
- The tenant an OTP is checked against is `NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT` when the
  message carries none: Compose rewrites it to `state_root`, Helm reads `state-level-tenant-id`
  from the `egov-config` ConfigMap. **SMS must be switched on, with a provider, at that tenant**
  or every OTP is `SKIPPED / NB_NO_PROVIDER` and phone login stops.

## Removed settings

Delete these wherever you set them; nothing reads them in 2.20.

| Where | Removed |
|---|---|
| host_vars | `pgr_notification_config_driven`, `build_otp_publisher`, `otp_publisher_image` |
| pgr-services env / properties | `PGR_NOTIFICATION_CONFIG_DRIVEN` (`pgr.notification.config.driven`), `pgr.notification.default.locale`, `pgr.notification.rolepool.page.size`, `pgr.notification.rolepool.max.pages`, `complaints.domain.events.enabled`, `complaints.domain.events.default.locale`, `notification.sms.enabled`, `egov.user.event.notification.enabled`, `kafka.topics.notification.sms`, `egov.usr.events.*`, `egov.pgr.events.*`, `egov.ui.app.host.map` |
| novu-bridge env / properties | `NOVU_BRIDGE_KAFKA_INPUT_TOPIC` (now `NOVU_BRIDGE_KAFKA_INPUT_TOPICS`, comma-separated), `NOVU_BRIDGE_KAFKA_RETRY_TOPIC` (no retry topic), `NOVU_BRIDGE_CHANNEL`, `MDMS_HOST` / `MDMS_SEARCH_PATH` (now `NOVU_BRIDGE_MDMS_HOST` / `_SEARCH_PATH`) |

Changed defaults worth checking: `NOVU_BRIDGE_CHANNEL_POLICY_SCHEMA` is `NOTIFICATIONS.Channel`
(legacy fallback automatic — leave it unset); `NOVU_BRIDGE_KAFKA_INPUT_TOPICS` adds
`notifications.events`; `NOVU_BRIDGE_PROXY_ALLOWED_ROLES` adds `MDMS_ADMIN`; the new
`NOVU_BRIDGE_PROXY_ADMIN_ROLES` gates provider create/rotate/delete.

## After the upgrade

- [ ] `./deploy.sh <tenant>` (or `--tags notifications`) ran for **every** tenant with
      `failed=0` and no `notif-seed — WARNING` task.
- [ ] `/config/source` shows no `legacy: true` for any tenant you expect to edit.
- [ ] Each channel you use is on with a provider selected (**Notifications → Channels**).
- [ ] **Validate** on Configure reports zero errors.
- [ ] One real complaint transition produced `RESOLVED` rows on Logs and arrived on a handset.
- [ ] With OTP login: a phone login works and left a `CORE.SMS.OTP` row.
