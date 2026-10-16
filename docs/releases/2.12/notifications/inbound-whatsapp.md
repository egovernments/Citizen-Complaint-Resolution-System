# Enable Inbound WhatsApp

Citizens file and track complaints by messaging your WhatsApp number. Twilio calls the
`xstate-chatbot` service directly; Novu is **not** involved (it handles outbound only — see
[README.md](README.md)).

## Before you start

- An **active** Twilio account with a WhatsApp sender — the Twilio Sandbox for testing, or an
  approved sender for production.
- **One sender = one webhook.** A Twilio number delivers incoming messages to a single URL.
  Pointing it at this deployment takes it away from any other environment using it.
- The tenant has `ComplaintHierarchy` and boundaries. The bot offers the state's city tenants
  (`tenant.tenants`); to offer only some, add a `tenant.citymodule` row with
  `module: PGR.WHATSAPP` listing them.

## 1. Get the Account SID and Auth Token

1. Log in to the [Twilio Console](https://console.twilio.com).
2. On **Account Dashboard → Account Info**, copy the **Account SID** (starts with `AC`) and
   click **Show** to copy the **Auth Token**.

Treat both as secrets: keep them only in the deploy config below — never in git, chat or tickets.

## 2. Configure

In `local-setup/ansible/inventory/host_vars/<tenant>.yml` (gitignored):

```yaml
enable_chatbot: true

twilio_account_sid: "AC..."                      # step 1
twilio_auth_token: "..."                         # step 1
twilio_whatsapp_from: "whatsapp:+14155238886"    # your sender; this is the Sandbox number

chatbot_root_tenant: "ke"                        # state tenant complaints are filed under
chatbot_whatsapp_business_number: "14155238886"  # same sender, digits only
chatbot_boundary_hierarchy_type: "ADMIN"         # your boundary hierarchy name

# Required: the chatbot refuses to start without them. Defaults match the pg demo
# tenant (India) and the bootstrap admin; set your own, e.g. for Mozambique:
chatbot_default_country_code: "+258"             # fallback when MDMS has no number rule
chatbot_default_mobile_regex: "^8[0-9]{8}$"      # fallback valid-number rule
chatbot_mobile_number_length: 9                  # digit count shown in the invalid-number reply
chatbot_service_account_username: "CHATBOT"      # employee the bot files as; default bootstrap_user
chatbot_service_account_password: "..."          # default bootstrap_password
```

The bot creates citizens and files complaints as `chatbot_service_account_username`, so
citizens never need a password. Its default, the bootstrap admin, has full admin roles: in
production use a dedicated account limited to creating citizens and filing complaints.

## 3. Deploy

```bash
cd local-setup/ansible
./deploy.sh <tenant>
```

This starts `xstate-chatbot` and its migration, and exposes `https://<domain>/xstate-chatbot/`
through Kong.

<details>
<summary>Existing Compose stack, without Ansible</summary>

Add to the stack's `.env`, then start the service:

```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
CHATBOT_ROOT_TENANT=ke
CHATBOT_WHATSAPP_BUSINESS_NUMBER=14155238886
CHATBOT_WEBHOOK_BASE_URL=https://<domain>
CHATBOT_EXTERNAL_HOST=https://<domain>/
CHATBOT_DEFAULT_COUNTRY_CODE=+258
CHATBOT_DEFAULT_MOBILE_REGEX=^8[0-9]{8}$
CHATBOT_MOBILE_NUMBER_LENGTH=9
CHATBOT_SERVICE_ACCOUNT_USERNAME=CHATBOT
CHATBOT_SERVICE_ACCOUNT_PASSWORD=...
```

```bash
docker compose -f docker-compose.egov-digit.yaml --profile chatbot up -d xstate-chatbot-db xstate-chatbot
```

If the stack's `kong/kong.yml` is older than this feature, copy the `xstate-chatbot` service
and the `/xstate-chatbot/message` + `/xstate-chatbot/status` `AUTH_OPTIONAL` entries from
`local-setup/kong/kong.yml`, then `docker exec kong-gateway kong reload`.
</details>

## 4. Point Twilio at the deployment

Webhook URL: `https://<domain>/xstate-chatbot/message`, method **POST**. It must match
`https://<domain>` exactly, or Twilio's signature check rejects every message.

**Sandbox** — Messaging → Try it out → Send a WhatsApp message → **Sandbox settings**:
set **When a message comes in**, click **Save**. Each tester first sends `join <code>` (shown
on the **Sandbox** tab) to the Sandbox number.

**Approved sender** — Messaging → Senders → WhatsApp senders → **Edit Sender**: set
**Webhook URL for incoming messages**, click **Update WhatsApp Sender**. If the form asks for
**Profile about**, fill it in — it is public on your WhatsApp profile.

## 5. Verify and test

Run on the server; replace `<domain>`. Each step says what you should see.

1. **The service is up.**
   ```bash
   docker ps --filter name=xstate-chatbot --format '{{.Names}} {{.Status}}'   # xstate-chatbot ... (healthy)
   docker logs xstate-chatbot 2>&1 | grep 'Configuration check'              # Configuration check: OK
   ```
2. **Kong routes to it.**
   ```bash
   curl -s https://<domain>/xstate-chatbot/health                            # OK
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     https://<domain>/xstate-chatbot/message                                 # 403: unsigned requests are refused
   ```
3. **Twilio reaches it.** Keep the logs open, then send **Hi** to the sender from a test phone.
   ```bash
   docker logs -f xstate-chatbot 2>&1 | grep -E 'Inbound|Rejected|Message sent|Error'
   ```
   You should see `Inbound /xstate-chatbot/message` followed by `Message sent successfully`,
   and the phone gets the language menu.
4. **File a test complaint.** On the phone, reply in order:
   - pick a language, confirm the name, then **1** to file a complaint;
   - pick a category and sub-category (**See more** shows the next page), then the location;
   - the institution name, if asked, then a description of 20+ characters;
   - **1** to skip the attachment, **1** to accept, the confidentiality choice if asked,
     and **1** to submit.

   The bot replies with a reference such as `PG-PGR-2026-10-14-315975`.
5. **Find it in PGR.** Log in as an employee, search the inbox for the reference. It shows
   source **WhatsApp** and status **Pending for assignment**.

Done: the deployment receives WhatsApp messages and files complaints. If a step fails, see
the table below.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Chatbot exits with `Refusing to start: … required setting(s) are unset` | The image is running without this stack's Compose/Ansible defaults: set the listed variables (step 2) |
| No request reaches the server | Webhook not saved, message sent to a different number, or (Sandbox) phone not joined |
| Chatbot logs `Rejected inbound webhook` | Auth Token wrong, or the Twilio URL differs from `https://<domain>` |
| *Invalid mobile number format* | Add the country's row to `common-masters.MobileNumberValidation` for the state tenant |
| Too many cities offered, or the wrong ones | Add a `PGR.WHATSAPP` row to `tenant.citymodule` listing the cities to offer |
| `/xstate-chatbot/health` returns 404 | Kong has no chatbot route: re-run step 3 (Deploy). A redeploy from a branch without this feature removes it again |
| 502, or Kong logs `No route to host`, right after the chatbot container is recreated | Kong still has the old container address: `docker exec kong-gateway kong reload` |
| Bot goes silent after a menu, Twilio log shows error `21617` | A message was over 1,600 characters. Upgrade the chatbot: long menus are paged and long messages are split |
| Bot says *our system has a problem* at Submit; logs show `INVALID_CASE_RELATED_TO` | The bot sends the institution and confidentiality fields only to tenants with an active `RAINMAKER-PGR.ComplaintTemplateType` row for its `caseRelatedTo` (default `IGE`). This error means such a row exists but PGR still rejects it: check the row, or set `CASE_RELATED_TO=` (empty) on the `xstate-chatbot` container to turn the fields off |
| *Your previous session timed out* after a redeploy | Reply **2** to start fresh. Resuming replays the last prompt saved by the old version |
| Bot replies *Sorry, there was an error processing your request* | The number does not match the state's `MobileNumberValidation` rule |
