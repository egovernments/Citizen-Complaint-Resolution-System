# Notification MDMS seed

Seed records that wire the **PGR complaint lifecycle events** and
**OTP send** to the Novu workflows defined in
`backend/novu-bridge-endpoint/workflows.js`.

The Java `novu-bridge` service consumes Kafka events from
`complaints.domain.events` and resolves two records via
**`digit-config-service`** before triggering Novu:

1. **`TemplateBinding`** — keyed by `(tenantId, eventName, channel, locale)`
   → maps the inbound event to a Novu workflow id (`templateId`).
2. **`ProviderDetail`** — keyed by `(tenantId, providerName, channel)`
   → the per-tenant Twilio credentials + sender number that the bridge
   injects as Novu trigger overrides.

> **Architectural note:** `digit-config-service` has its OWN postgres
> table (`eg_config_data`); it is NOT a thin pass-through over MDMS-v2.
> Data records therefore go through
> `POST /config-service/config/v1/_create/<schema>` (this script does
> this). Earlier iterations seeded via mdms-v2 `_create` — the records
> landed in MDMS but the bridge couldn't find them. config-service
> validates each create against the MDMS schema registered at root,
> hence the script still does the MDMS-v2 schema-create up front.

## Files

| File | Purpose |
|---|---|
| `schemas/TemplateBinding.json` | MDMS-v2 schema, registered at root tenant |
| `schemas/ProviderDetail.json`  | MDMS-v2 schema, registered at root tenant |
| `data/template-bindings.json`  | 6 records: 5 complaint-lifecycle events + OTP.SEND |
| `data/provider-details.json`   | 1 record per provider — Twilio sender + credentials |
| `seed.sh`                      | Idempotent seeder. Authenticates, registers schemas, creates records via config-service |

## Wiring at deploy time

The Ansible playbook calls `seed.sh` once per tenant after
`tenant_bootstrap` succeeds and the operator has populated their
Twilio creds (`twilio_account_sid`, `twilio_auth_token`, `twilio_from`
in `host_vars/<tenant>.yml`). The seed is idempotent — re-runs report
`successful (already exists)` for any record already present.

`seed.sh` auto-detects whether `$DIGIT_URL` (Kong) routes
`/config-service` and falls back to `$CONFIG_SERVICE_URL` direct
(default `http://digit-config-service:8080`) when not. To run inside
the docker network manually:

```bash
docker exec -e TENANT=ke.bomet \
            -e TWILIO_ACCOUNT_SID=… -e TWILIO_AUTH_TOKEN=… -e TWILIO_FROM=+1… \
            -e DIGIT_URL=http://kong-gateway:8000 \
            -e CONFIG_SERVICE_URL=http://digit-config-service:8080 \
            <some-container-on-egov-network> bash /opt/digit/db/notif-mdms-seed/seed.sh
```

## Content templates (production WhatsApp)

Twilio rejects out-of-24h-window WhatsApp messages with error 63016
unless the message is sent via a pre-approved **Content Template** (a
`HX…` SID assigned by Twilio after Meta approval).

For production WhatsApp delivery, the operator must:

1. Register a Content Template via Twilio Console → Messaging →
   Content Templates (category: `authentication` for OTP).
2. Wait for Meta approval (minutes for the `authentication` category,
   hours-to-days for `marketing`/`utility`).
3. Copy the `HX…` SID.
4. Update the matching row in `data/template-bindings.json`:
   ```json
   "contentSid": "HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   ```
5. Re-run `seed.sh` — the row is upserted via the
   `(tenantId, eventName, channel, locale)` unique key.

For **SMS** (Twilio numbers configured as SMS-capable), `contentSid`
stays absent — the bridge renders the body from
`backend/novu-bridge-endpoint/workflows.js`.

For **WhatsApp sandbox** testing: the recipient must first send
`join <code>` to the Twilio sandbox number (opens a 24h window).
After that any freeform message including the workflow body lands.

## OTP.SEND row

The `OTP.SEND` event is published by the new `otp-publisher` service
(see `local-setup/scripts/otp-publisher/`) when the SPA citizen-login
flow calls `/user-otp/v1/_send`. The TemplateBinding row routes it to
the `otp-send` workflow registered in `novu-bridge-endpoint`. See
that service's README for the publisher chain.
