# CMS v2.20 Deployment Changelog (v2.12 → v2.20)

**Covers:** v2.12 → v2.20, as of `master` at `63472b4a1` (#2716) and `develop` at `42e914005` (27 Oct 2026). **Who this is for:** operators upgrading or deploying CMS.

What an operator must change to move a CMS deployment from v2.12 to v2.20. It lists only what affects a deployment; feature details are in the [Release notes](release-notes-v2.20.md), and escalation known issues in [Known issues](known_issues_2.20.md). The [Migration guide](migration-guide-v2.12-to-v2.20-beta.md) has the full identity and Keycloak cut-over; section numbers below (guide §n) point into it.

**The six things that matter most**

1. **Sign-in is now Keycloak only.** Set the identity secrets and an SMTP server before deploying (section 1).
2. **Existing staff must be linked before they can sign in.** Staff on city tenants cannot be linked (section 4).
3. **Run a full deploy, not `--tags`.** Keycloak 24 → 26.7.3 is a one-way migration.
4. **Notifications need a one-time migration per tenant**, or tenants with complaints stop getting notifications.
5. **Automatic escalation is off after the upgrade.** Turning it back on is one switch for the whole deployment (`PGR_ESCALATION_ENABLED`, section 2).
6. **Back up every database first.** There is no tested rollback.

## 1. Settings to change

All in `local-setup/ansible/inventory/host_vars/<tenant>.yml`. Compare with `_example.yml`.

**What stops the deploy**

The deploy stops only if `enable_keycloak` is `false`, or if `auth_provider`, `citizen_auth_provider` or `employee_auth_provider` is set to `keycloak`. The other retired keys below are ignored or only print a warning.

**Keep or remove**

| Setting | Action | Why |
| --- | --- | --- |
| `enable_keycloak` | Remove | Keycloak is always on. Setting it to `false` stops the deploy. On master, removing it also stops Prometheus scraping Keycloak (section 7) |
| `auth_provider`, `citizen_auth_provider`, `employee_auth_provider` | Remove | Replaced by the Identity BFF; the value `keycloak` stops the deploy |
| `enable_digit_ui_v2`, `nginx_features.digit_ui_v2`, `digit_ui_v2_repo`, `digit_ui_v2_branch` | Remove | The old `/citizen/` app is retired (#2290); these only print a warning |
| `keycloak_client_id`, `login_tenant_allowlist`, `token_exchange_system_username`, `token_exchange_system_user_type` | Remove | No longer used |
| `pgr_notification_config_driven`, `novu_bridge_channel` | Remove | Notifications are configured per tenant in the Configurator |
| `build_otp_publisher`, `otp_publisher_image`, `enable_overpass`, `build_default_data_handler` | Remove | Services removed |
| `pgr_services_image`, `configurator_image` and every other per-image pin | Remove | A pin wins over `--image-tag`, so a 2.12 pin keeps the old build running against the 2.20 migrations and notification stack. The deploy only warns about mismatched pins |
| `token_exchange_system_password` | Keep until `identity_digit_admin_password` is in OpenBao | The deploy falls back to it for the BFF admin password |

**Secrets** (OpenBao)

`bootstrap_secrets` is read only on a tenant's first deploy. On an existing box, add these with `bao kv patch`. Passwords must not contain `$`.

| Secret | Required | Notes |
| --- | --- | --- |
| `identity_digit_admin_password` | Yes | DIGIT admin the BFF uses |
| `keycloak_admin_password` | Yes | If Keycloak 24 already runs, it must match its current admin password, or realm setup fails after the one-way migration |
| `keycloak_db_password` | Only if Keycloak never ran on this box | |
| `identity_smtp_password` | Yes, unless `identity_smtp_auth: false` | |
| `keycloak_google_client_secret` | Only with Google sign-in | A `keycloak_google_client_id` without this secret fails the deploy |

**Add** (needed for sign-in to work)

| Setting | Default | What to put |
| --- | --- | --- |
| `identity_smtp_host`, `identity_smtp_from`, `identity_smtp_user` | none | Mail server for sign-in and password-reset emails. The deploy checks these only after Keycloak has migrated (#2618) |
| `identity_smtp_port`, `identity_smtp_from_display_name`, `identity_smtp_auth`, `identity_smtp_ssl`, `identity_smtp_starttls` | `587`, `DIGIT Identity`, `true`, `false`, `true` | Change only if your server differs |
| `identity_citizen_signin_methods` | `[]` (citizens cannot sign in) | Usually `[phone_otp]`. That needs an OTP channel: `identity_citizen_otp_sender: http` **and** `IDENTITY_OTP_SENDER_URL`, which host_vars does not set yet, so add it with a compose overlay (guide, citizen OTP). With `http` set but no URL, phone sign-in is hidden and the deploy does not warn. On test boxes only, `identity_dev_fixed_otp: true` works instead. `enable_otp_services` is not a channel for these codes |

**Review** (these have defaults and do not stop the deploy)

| Setting | Default | What to check |
| --- | --- | --- |
| `identity_signup_methods` | `[magic_link, google, github]` | Who can create a new workspace. An empty list falls back to the default. See section 2 |
| `digit_ui_default_tenant_slug` | empty | Tenant that old `/digit-ui/` links redirect to; empty means they return 404 |
| `notification_stack_tag` (or `image_tag`) | unset: falls back to the compose default `nightly-develop`, with a warning | One release tag for pgr-services, novu-bridge and user-preferences |

**Add** (only if you use them)

| Setting | When |
| --- | --- |
| `keycloak_google_client_id` (+ secret above), `google` in `identity_signin_methods` / `identity_signup_methods` | Google sign-in or sign-up. Set the Google OAuth redirect URI to `https://<domain>/auth/realms/digit/broker/google/endpoint` (the realm is now `digit`) |
| `configurator_posthog_key`, `configurator_posthog_host`, `configurator_sentry_dsn` | You track Configurator usage or errors |
| `identity_configurator_roles` | Roles other than the admin defaults need the Configurator |
| `kong_cors_origins` | Browsers call the APIs from a domain other than your own. The list replaces the default, so include `https://<domain>` too |

**develop only (#2725):** the HRMS env var `EGOV_HRMS_DEFAULT_PASSWORD` is renamed `EGOV_HRMS_EMPLOYEE_DEFAULT_PASSWORD` in the Ansible `.env` and compose files (Helm already used the new name). On `hrms_dev_mode: true` boxes the OpenBao value `egov_hrms_default_password` now reaches HRMS; replace the `CHANGE_ME` placeholder, or employee creates without a password fail.

## 2. Defaults that now behave differently

| What | v2.12 | v2.20 | To get the old behaviour |
| --- | --- | --- | --- |
| Self-serve workspace sign-up | n/a | Magic link, Google and GitHub are listed by default, but none works until `identity_magic_link_enabled: true` or the Google / GitHub client IDs are set. A 2.12 host that still has a Google client ID and secret lets any Google account create a workspace | To turn self-sign-up off, set `identity_signup_methods: [magic_link]` and keep `identity_magic_link_enabled: false`. An empty list turns all three methods back on |
| Citizen Google sign-in | Available | Removed; citizens use phone and code | None |
| Automatic escalation | On | Off for the whole deployment: `PGR_ESCALATION_ENABLED` is hard-coded to `'false'` in `docker-compose.egov-digit.yaml`. There is no per-tenant switch | After the escalation migration (section 4), set `PGR_ESCALATION_ENABLED: 'true'` for pgr-services in a `docker-compose.<tenant>.yml` overlay |
| Fixed test OTP 123456 | On | Off | `identity_dev_fixed_otp: true` (test servers only) |
| Old login pages and endpoints | Open | Closed | `identity_legacy_user_endpoints: true` (temporary rollback only) |
| App links without a tenant (`/digit-ui/...`) | Work | 404 | Set `digit_ui_default_tenant_slug` |
| `/citizen` | Old citizen app | 404; the app is at `/<tenant>/digit-ui/citizen` | None |
| Container ports | Open on all interfaces | Localhost only, behind a host firewall | `manage_host_firewall: false` if you run your own firewall |
| Browser CORS | Any origin | Your domain only | List every allowed origin, including `https://<domain>`, in `kong_cors_origins`; the list replaces the default |
| `/status/` board | On (in `_example.yml`), no password | On, always behind HTTP basic auth; the password is generated into OpenBao (`bao kv get -field=status_basic_auth_password <secrets_path>`, for example `kv/digit/<tenant>`) | None; `nginx_features.status: false` turns the board off |
| Fast-path database seed | Refused without `db_fast_path_ack_data_wipe: true`, and `_example.yml` shipped the ack as `true` | `_example.yml` ships the ack as `false`, and a Postgres storage guard checks the box first (#2101) | A host_vars copied from 2.12 still has `true` and gets no new protection: set it to `false` on any box with data |
| Employee password reset | SMS | Email only | None; add staff email addresses |
| HRMS dev-mode password (develop only, #2725) | `eGov@123` | OpenBao `egov_hrms_default_password` | Set that secret |

## 3. Services added and removed

| Change | Service | What you need to do |
| --- | --- | --- |
| Added, always on | Keycloak 26.7.3 + Identity BFF (sign-in) | Plan resources for Keycloak, its database, the BFF and Redis; set the secrets and SMTP settings |
| Added, always on | Host firewall, status board, container metrics | Nothing, unless you manage your own firewall |
| Removed, **not** cleaned up | token-exchange-svc | Keeps running as an orphan. Remove it by hand after the cut-over (guide §3, §6) |
| Removed, cleaned up only sometimes | otp-publisher, novu-bridge-endpoint, egov-notification-sms | The deploy removes them only when `enable_novu` is on and novu-bridge has taken over the OTP topic, and never on macOS. Remove them by hand only after the deploy reports that novu-bridge has taken over. With `enable_novu` off nothing is sent twice; removing them during a deferred handoff loses OTPs |
| Removed | digit-ui-v2 (`/citizen`) | The deploy deletes `/opt/digit-ui-v2` and `/var/www/citizen` (not on macOS, or with `nginx_preserve_vhost`). Helm: `helm uninstall digit-ui-v2 -n egov` |
| Rewritten | user-preferences (Go → Java) | Do not reuse the v2.12 image tag. Existing data is adopted automatically (#2703) |
| Optional | WhatsApp chatbot, alerting (Sherlog, master only), AI diagnosis (OpenSRE), read-only MCP | Off by default; see section 6 |

## 4. Manual steps

pgr-services, novu-bridge, user-preferences and chatbot migrations run automatically when the new images start. These steps do not.

| Step | When | How |
| --- | --- | --- |
| Rebuild db-migrations | Every existing Compose box | The deploy reuses the old db-migrations image, so the 2.20 MDMS migrations (including the workspace route grants) never run and admins get `AccessDeniedException` after picking a workspace. Rebuild and run it after the deploy (guide §4). Kubernetes: apply `V20261022000000__workspace_route_grants.sql` by hand |
| Link existing staff | Every existing box | A staff member can sign in only with a Keycloak user for their email, membership in the root's Organization and a binding to their DIGIT account. Link the first admin through the BFF internal API (guide §5.1), then the rest from Configurator › People › Employees. Staff whose home tenant is a city tenant cannot be linked; re-create them at the root |
| Staff email addresses | Employees without an email | Add them before upgrading; sign-in and password reset need email |
| Escalation migration | Server is on v2.12 (not v2.12.1) | Step 6a of the [v2.12 → v2.12.1 migration guide](../2.12/migration-guide-v2.12-to-v2.12.1.md), then `docs/operations/data-migration/pgr-escalation-self-loop.md` per state tenant |
| Notification migration | Every tenant that already has complaints | `migrate-notifications.py plan`, then `apply --adopt-defaults` ([notifications migration](notifications/migration.md)). Without it, those tenants send no complaint notifications |
| Remove token-exchange-svc | After staff sign-in works | `docker rm -f token-exchange-svc` |

## 5. Upgrade steps

1. Back up every Postgres database.
2. If the server is on v2.12, upgrade to v2.12.1 first (including the escalation migration).
3. Update host_vars and OpenBao secrets as in section 1.
4. Move any hand-edited `.env` values into host_vars; the notification services read host_vars only.
5. Run a **full** deploy with one tag: `./deploy.sh <tenant> --image-tag=<tag>`. Never use `--tags` for this upgrade: `configure-identity-keycloak.sh` runs only in a full deploy and sets the clients, redirect URIs, social-provider visibility and SMTP. Use `identity-keycloak` and `identity-bff` images that include the latest fixes.
6. Rebuild and run db-migrations (section 4).
7. Link the first admin, then the other staff (section 4).
8. Run the notification migration for each tenant.
9. Remove token-exchange-svc.
10. If you used automatic escalation, turn it back on: `PGR_ESCALATION_ENABLED: 'true'` in a compose overlay (applies to every tenant).

**Kubernetes / Helm differences**

- Set `identity.enabled: true` and deploy `identity-helmfile.yaml` (`docs/setup/deployment/helm-identity.md`).
- Set the SMTP host and from address (marked REQUIRED in `env.yaml`), create the `identity-secrets` Secret and the Keycloak database.
- Set `IDENTITY_OTP_SENDER` and `IDENTITY_OTP_SENDER_URL` for citizen phone sign-in.
- Set `ingress.defaultTenantSlug` and `global.notificationStackTag`.
- Set `NOVU_BRIDGE_PREFERENCE_ENABLED="false"` unless you collect citizen consent, or most messages are skipped.
- Run `helm uninstall digit-ui-v2 -n egov`.

**Check after upgrading**

- Health checks and the `/status/` board are green. Unhealthy observability containers (Tempo, Loki, Prometheus and others) now only warn (#2703); any other unhealthy container still fails the gate and skips the Keycloak realm setup.
- An admin, an employee and a citizen can each sign in at `/<tenant>/digit-ui/...`.
- A complaint can be filed, assigned, escalated, resolved and reopened, with a notification at each step.
- `tests/integration-tests`: `npm run test:lifecycle`.

**Rollback.** Not tested, and the Keycloak migration is one-way. Restore the backup and redeploy v2.12.1 images.

## 6. Optional new features

All off by default. Turn on only what you need.

| Feature | Turn on with |
| --- | --- |
| 30-day trial for self-serve workspaces | `identity_workspace_trial_days: 30` (needs Novu email for reminders) |
| Self-serve sign-up by email link | `identity_magic_link_enabled: true` (`magic_link` is already in the default `identity_signup_methods`). Rate limit: `identity_magic_link_request_limit` (3) per `identity_magic_link_request_window_seconds` (1800) |
| Google sign-in or sign-up | See section 1 |
| Staff phone join (an employee's phone signs in to the same person) | `identity_staff_phone_join: true`. Off until #2631 is done |
| WhatsApp complaints | `enable_chatbot: true` + Twilio settings |
| Alerting with automatic investigation (master only) | `enable_sherlog: true` + a model API key in OpenBao |
| AI incident diagnosis | `enable_opensre: true` + an Anthropic API key in OpenBao |
| Public read-only automation server | `enable_mcp_readonly: true` and `nginx_features.mcp_readonly: true` |
| Choose several boundaries at once in Geography | `configurator_geography_multiple_selections: true` |
| Home-page banners | `citizen_banner_enabled`, `configurator_banner_enabled` |

Self-serve workspaces are upgraded to the latest platform seed in the background (`pgr_onboarding_baseline_upgrade_enabled: true`, the default): v12 at the beta, v14 on master, v16 on develop. Deploy-seeded roots such as `ke` are not upgraded this way.

## 7. Known deployment issues

| Issue | Impact | Status |
| --- | --- | --- |
| master pins images to `master-b4adf0d`; develop still uses `nightly-develop` | Neither is a release tag | Pin a 2.20 tag before release |
| Prometheus does not scrape Keycloak on develop, or on master when `enable_keycloak` is removed | No sign-in metrics in monitoring | Open |
| The migration guide (§2.1, §2.2) still says to keep `enable_keycloak: true`; this changelog and the deploy's own message say to delete it | Conflicting advice | Guide to be updated |
| The identity SMTP check runs only after Keycloak has migrated | A bad SMTP setting is found late | Open (#2618) |
| Setup can show a boundary "usually temporary" error, then fail on Try again, although setup succeeded | Confusing onboarding | Open (#2709) |
| No tested rollback; the Keycloak and database migrations cannot be undone | Restore from backup only | Open |
| The [migration guide](migration-guide-v2.12-to-v2.20-beta.md) file name still says "beta" | Readers may think it is not final | Rename for 2.20 |
| `_example.yml` comments still say images default to `nightly-develop` | Misleading on master | Docs fix pending |

Source: changes between tag `v2.12`, `master` at `63472b4a1` and `develop` at `42e914005`, checked on 27 October 2026.
