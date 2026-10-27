# CMS v2.20 Deployment Changelog (v2.12 → v2.20)

**Covers:** v2.12 → v2.20, up to `master` at `5dc402e09` (23 Oct 2026). **Who this is for:** operators upgrading or deploying CMS.

What an operator must change to move a CMS deployment from v2.12 to v2.20. It lists only what affects a deployment; feature details are in the [Release notes](release-notes-v2.20.md). For the identity and Keycloak cut-over in detail, see the [Migration guide](migration-guide-v2.12-to-v2.20-beta.md).

**The five things that matter most**

1. **Sign-in is now Keycloak only.** Remove `enable_keycloak` and the old auth keys, and add an SMTP server.
2. **Several services are replaced.** The deploy removes them for you; check nothing else calls them.
3. **Notifications need a one-time migration per tenant**, or tenants with complaints stop getting notifications.
4. **Automatic escalation is off after the upgrade** until you switch it on per tenant.
5. **Back up every database first.** There is no tested rollback.

## 1. Settings to change

All in `local-setup/ansible/inventory/host_vars/<tenant>.yml`. Compare with `_example.yml`.

**Remove** (the deploy stops if the first three are still set)

| Setting | Why |
| --- | --- |
| `enable_keycloak` | Keycloak is always on now |
| `auth_provider`, `citizen_auth_provider`, `employee_auth_provider` | Replaced by the new sign-in service |
| `enable_digit_ui_v2` | The old `/citizen/` app is retired |
| `keycloak_client_id`, `login_tenant_allowlist`, `token_exchange_system_username`, `token_exchange_system_user_type` | No longer used |
| `pgr_notification_config_driven`, `novu_bridge_channel` | Notifications are configured per tenant in the Configurator |
| `build_otp_publisher`, `otp_publisher_image`, `enable_overpass` | Services removed |

**Rename**

| Old | New |
| --- | --- |
| `token_exchange_system_password` | `identity_digit_admin_password` (in `bootstrap_secrets` or OpenBao) |

**Add** (required)

| Setting | What to put |
| --- | --- |
| `identity_smtp_host`, `identity_smtp_port`, `identity_smtp_from`, `identity_smtp_user` (+ password secret) | Mail server for sign-in and password-reset emails |
| `identity_citizen_signin_methods` | How citizens sign in; empty means citizens cannot sign in |
| `digit_ui_default_tenant_slug` | Tenant that old `/digit-ui/` links redirect to; empty means old links return 404 |
| `notification_stack_tag` (or `image_tag`) | One image tag for pgr-services, novu-bridge and user-preferences |

**Add** (only if you use them)

| Setting | When |
| --- | --- |
| `configurator_posthog_key`, `configurator_posthog_host`, `configurator_sentry_dsn` | You track Configurator usage or errors |
| `identity_configurator_roles` | Roles other than the admin defaults need the Configurator |
| `kong_cors_origins` | Browsers call the APIs from a domain other than your own |

## 2. Defaults that now behave differently

Nothing to set unless you relied on the old behaviour.

| What | v2.12 | v2.20 | To get the old behaviour |
| --- | --- | --- | --- |
| Automatic escalation | On | Off | Switch on per tenant after the escalation migration (section 4) |
| Fixed test OTP 123456 | On | Off | `identity_dev_fixed_otp: true` (test servers only) |
| Old login pages and endpoints | Open | Closed | `identity_legacy_user_endpoints: true` (temporary rollback only) |
| App links without a tenant (`/digit-ui/...`) | Work | 404 | Set `digit_ui_default_tenant_slug` |
| Container ports | Open on all interfaces | Localhost only, behind a host firewall | `manage_host_firewall: false` if you run your own firewall |
| Browser CORS | Any origin | Your domain only | Add origins in `kong_cors_origins` |
| `/status/` board | Off | On, with a password | `nginx_features.status: false` |
| Fast-path database seed | Ran freely | Stops unless `db_fast_path_ack_data_wipe: true` | Set it only on an empty server |
| Employee password reset | SMS | Email only | None; add staff email addresses |

## 3. Services added and removed

| Change | Service | What you need to do |
| --- | --- | --- |
| Added, always on | Keycloak + Identity BFF (sign-in) | Plan resources for three more containers (Keycloak, its database, the BFF) and Redis; set the SMTP settings |
| Added, always on | Host firewall, status board, container metrics | Nothing, unless you manage your own firewall |
| Removed | token-exchange-svc, otp-publisher, novu-bridge-endpoint, egov-notification-sms | Nothing on Ansible. With plain Docker Compose, remove them yourself, or every login OTP is sent twice |
| Rewritten | user-preferences (Go → Java) | Do not reuse the v2.12 image tag; see section 4 |
| Optional | WhatsApp chatbot, alerting (Sherlog), AI diagnosis (OpenSRE), read-only MCP | Off by default; see section 6 |

All CMS images are pinned to `master-b4adf0d`. Confirm the final 2.20 tag before deploying (section 7).

## 4. Manual data steps

Database migrations run automatically when the new images start. These four steps do not.

| Step | When | How |
| --- | --- | --- |
| Escalation migration | Server is on v2.12 (not v2.12.1) | Step 6a of the [v2.12 → v2.12.1 migration guide](../2.12/migration-guide-v2.12-to-v2.12.1.md), then `docs/operations/data-migration/pgr-escalation-self-loop.md` per state tenant |
| Notification migration | Every tenant that already has complaints | `migrate-notifications.py plan`, then `apply --adopt-defaults` ([notifications migration](notifications/migration.md)). Without it, those tenants send no complaint notifications |
| user-preferences data | Single-server (Compose) install whose `user_preference` table has rows | The deploy stops here. No automated path yet; get guidance before upgrading |
| Staff email addresses | Employees without an email | Add them before upgrading; password reset is email only |

On Kubernetes, also apply `V20261022000000__workspace_route_grants.sql` to the MDMS database by hand.

## 5. Upgrade steps

1. Back up every Postgres database.
2. If the server is on v2.12, upgrade to v2.12.1 first (including the escalation migration).
3. Update host_vars as in section 1.
4. Move any hand-edited `.env` values into host_vars; the notification services read host_vars only.
5. Deploy with one tag: `./deploy.sh <tenant> --image-tag=<tag>`.
6. Run the notification migration for each tenant (section 4).
7. Switch automatic escalation back on per tenant if you used it.

**Kubernetes / Helm differences**

- Set `identity.enabled: true` and deploy `identity-helmfile.yaml` (`docs/setup/deployment/helm-identity.md`).
- Set `ingress.defaultTenantSlug` and `global.notificationStackTag`.
- Set `NOVU_BRIDGE_PREFERENCE_ENABLED="false"` unless you collect citizen consent, or most messages are skipped.

**Check after upgrading**

- Health checks and the `/status/` board are green.
- An admin, an employee and a citizen can each sign in at `/<tenant>/digit-ui/...`.
- A complaint can be filed, assigned, escalated, resolved and reopened, with a notification at each step.
- `tests/integration-tests`: `npm run test:lifecycle`.

**Rollback.** Not tested. Restore the backup and redeploy v2.12.1 images.

## 6. Optional new features

All off by default. Turn on only what you need.

| Feature | Turn on with |
| --- | --- |
| 30-day trial for self-serve workspaces | `identity_workspace_trial_days: 30` (needs Novu email for reminders) |
| WhatsApp complaints | `enable_chatbot: true` + Twilio settings |
| Alerting with automatic investigation | `enable_sherlog: true` + a model API key in OpenBao |
| AI incident diagnosis | `enable_opensre: true` + an Anthropic API key in OpenBao |
| Public read-only automation server | `enable_mcp_readonly: true` and `nginx_features.mcp_readonly: true` |
| Magic-link sign-in | `identity_magic_link_enabled: true` |
| Choose several boundaries at once in Geography | `configurator_geography_multiple_selections: true` |
| Home-page banners | `citizen_banner_enabled`, `configurator_banner_enabled` |

## 7. Known deployment issues

| Issue | Impact | Status |
| --- | --- | --- |
| Images are pinned to `master-b4adf0d`, which misses the last fixes (including two pgr-services fixes) | Deploying it ships known bugs | Re-pin to `master-5dc402e` or a 2.20 tag before release |
| Prometheus does not scrape Keycloak metrics | No sign-in metrics in monitoring | Open |
| No automated upgrade for user-preferences data on Compose | Deploy stops on servers with consent data | Open |
| No tested rollback; migrations cannot be undone | Restore from backup only | Open |
| The [migration guide](migration-guide-v2.12-to-v2.20-beta.md) file name still says "beta" | Readers may think it is not final | Rename for 2.20 |
| `_example.yml` comments still say images default to `nightly-develop` | Misleading | Docs fix pending |

Source: changes between tag `v2.12` and `master` at `5dc402e09`, checked on 26 October 2026.
