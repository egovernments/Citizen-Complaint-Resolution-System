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
| `seed.sh`                      | **Upsert** seeder. Authenticates, registers schemas, creates-or-updates records via config-service |

## Wiring at deploy time

The Ansible playbook calls `seed.sh` once per tenant after
`tenant_bootstrap` succeeds and the operator has populated their
Twilio creds (`twilio_account_sid`, `twilio_auth_token`, `twilio_from`
in `host_vars/<tenant>.yml`).

`seed.sh` is a true **upsert**, not create-only. On a re-run,
config-service rejects a second `_create` for the same x-unique tuple
with `DUPLICATE_RECORD`; the script then `_search`es for the existing
record and `_update`s it. This is what lets a redeploy actually apply
**corrections** to an already-live tenant — a stale row (wrong
`channel`, missing `contentSid`, placeholder Twilio token) is
overwritten, not silently kept. The existing row is matched on its
x-unique **data** tuple (`eventName,channel,locale` for
TemplateBinding; `providerName,channel` for ProviderDetail), *not* on
the `uniqueIdentifier` string — a legacy row may carry a stale id
(e.g. `…​.sms.…`) whose data was later flipped to `whatsapp`.

Per-record output is explicit: `created` / `updated` / `SKIPPED` /
`FAILED` (no more misleading "already exists — fine").

**Routing caveat (important):** Kong typically routes config-service
`_create` and `_resolve` but **not** `_search` / `_update`. The upsert
needs both, so it only works against config-service **directly**
(`$CONFIG_SERVICE_URL`, default `http://digit-config-service:8080`,
reachable in-cluster). `seed.sh` probes for a base that can `_search`,
preferring the direct URL; if only Kong is reachable it runs
**create-only** and prints a loud `WARNING` that corrections were
skipped (re-run in-cluster to apply them). The Ansible deploy-time
invocation runs in-cluster, so the full upsert applies there. To run
inside the docker network manually:

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

The **five complaint-lifecycle rows ship with real, Meta-approved
WhatsApp Content SIDs** already registered on the eGov Twilio account
(EN, `*_message_new` family). No operator action is needed for
lifecycle WhatsApp — `seed.sh` wires them on deploy.

`paramOrder` maps `ComplaintsDomainEvent.data` keys onto each
template's positional `{{1}},{{2}},…` slots. The mapping was verified
against the live Twilio Content API per SID (not inferred from names):
the bridge builds `{ "1": data[paramOrder[0]], … }`, so the order must
stay aligned with the template body if a SID is ever swapped.

To swap a SID (new template / different locale): register it in
Twilio Console → Messaging → Content Templates, wait for Meta approval,
re-confirm its `{{n}}` order via `GET content.twilio.com/v1/Content/<SID>`,
update both `contentSid` and `paramOrder` in
`data/template-bindings.json`, and re-run `seed.sh` (upserted via the
`(tenantId, eventName, channel, locale)` unique key).

**Hindi:** approved `*_hindi_message_new` SIDs also exist on the
account. They are NOT wired yet — the producer emits only the default
locale, and the HI templates' `{{n}}` order must be re-verified via the
Content API before adding `hi_IN` rows. Tracked as a follow-up.

For **SMS** (Twilio numbers configured as SMS-capable), `contentSid`
stays absent — the bridge renders the body from
`backend/novu-bridge-endpoint/workflows.js`.

For **WhatsApp sandbox** testing: the recipient must first send
`join <code>` to the Twilio sandbox number (opens a 24h window).
After that any freeform message including the workflow body lands.

> **Known content nuance:** `data.serviceName` is the PGR
> `serviceCode`, not its localized display label, so it lands in slot
> `{{1}}` as a code. Resolving it to a display name needs a
> localization lookup in the producer — tracked separately, not a
> wiring bug.

## OTP.SEND row — intentionally NOT wired

The `OTP.SEND` row is kept on the **hardcoded OTP path** for now: no
`contentSid`, `channel: sms`, not routed to Twilio. Reasons:

- No `twilio/authentication` (or any OTP) Content template exists on
  the account — verified via the Content API. WhatsApp out-of-window
  OTP is therefore impossible until one is created + Meta-approved.
- SMS-OTP needs the novu-bridge channel-aware fix (CCRS #43) **and**
  an SMS-capable sender (the account's owned `+1` number, not the
  WhatsApp-only sender) before it can be turned on.

Revisit once #43 lands and an SMS sender / authentication template is
available. The `otp-publisher` service
(`local-setup/scripts/otp-publisher/`) and the `otp-send` workflow
remain in place for that future cut-over.
