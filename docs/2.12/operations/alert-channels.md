# Alert delivery — where alerts go and who answers them

Setting up the *channel*: Slack, Google Chat, Teams, email, WhatsApp, SMS — plus routing,
quiet hours, and the on-call rota that turns a notification into a fix.

← back to **[Operations handbook](README.md)** · what to alert on:
**[alerts-setup.md](alerts-setup.md)**

---

## Contents

- [Choosing a channel](#choosing-a-channel)
- [Check this first: can the server reach the internet?](#check-this-first-can-the-server-reach-the-internet)
- [Option A — Grafana contact points](#option-a--grafana-contact-points)
  - [Slack](#slack-recommended-if-you-use-slack)
  - [Google Chat](#google-chat-recommended-if-you-use-google-workspace)
  - [Microsoft Teams](#microsoft-teams-recommended-if-you-use-microsoft-365)
  - [Telegram](#telegram)
  - [Email](#email-needs-work-before-it-will-send)
  - [PagerDuty / Opsgenie](#pagerduty--opsgenie-for-a-real-on-call-rota)
  - [Generic webhook](#generic-webhook-the-escape-hatch)
- [Option B — Gatus native alerting (endpoint down)](#option-b--gatus-native-alerting-endpoint-down)
- [WhatsApp and SMS](#whatsapp-and-sms)
- [Routing: getting the right alert to the right person](#routing-getting-the-right-alert-to-the-right-person)
- [Quiet hours, maintenance windows and silences](#quiet-hours-maintenance-windows-and-silences)
- [The on-call rota](#the-on-call-rota)
- [Escalating to us](#escalating-to-us)
- [Message hygiene](#message-hygiene)

---

## Choosing a channel

Pick **one primary chat channel** and **one wake-someone-up channel**. Two is enough; more
splits attention and nothing gets read.

| Channel | Effort | Good for | Watch out for |
|---|---|---|---|
| **Slack** | 10 min | Everything, if your team lives in Slack | Free-tier message retention; a noisy channel tends to get muted |
| **Google Chat** | 10 min | Google Workspace departments | Space webhooks must be enabled by the Workspace admin |
| **Microsoft Teams** | 10 min | Microsoft 365 departments | Office 365 connectors are being retired — use a **Workflows / Power Automate** webhook |
| **Telegram** | 15 min | Teams without Slack/Teams; works well on personal phones | It is a consumer app; consider whether infrastructure details may leave department control |
| **Email** | 30 min | Records, wide distribution, escalation trail | **Needs SMTP configuration — not set up today.** Slow, easily buried |
| **PagerDuty / Opsgenie** | 1 hour | A genuine 24×7 rota with escalation and acknowledgement | Licence cost |
| **WhatsApp** | Half a day+ | Reaching people who read nothing else | No native Grafana support; see [below](#whatsapp-and-sms) |
| **SMS** | Half a day+ | Last resort when data is unavailable | Per-message cost; no context in 160 characters |

**Recommended starting configuration for a government IT team:**

0. **First, before any of the below:** turn on **[Gatus alerting](#option-b--gatus-native-alerting-endpoint-down)**.
   It is already built and already covers all 57 health checks — it needs one webhook URL and
   nothing else, and it is the only alerting that watches Redis, Elasticsearch, MinIO and
   nginx. Everything else on this page is work; that one is a value.
1. **Primary:** the chat tool the department already uses (Google Chat or Teams for most),
   one dedicated channel — `#digit-alerts`. All `warning` and `critical` alerts land here.
2. **Wake-up:** `critical` only, additionally to a WhatsApp group or SMS to the two on-call
   phones.
3. **Heartbeat:** an external free uptime monitor watching `https://<your-domain>/status/`,
   so you still find out when the whole box is gone.

The third one is worth the ten minutes it takes. Everything running on the server — Grafana,
the alert rules, the contact points — goes down with the server, so **only something outside
it can tell you the server is down.**

---

## Check this first: can the server reach the internet?

Every chat integration works by the server making an outbound HTTPS call. Government servers
are frequently behind an egress firewall or a proxy, in which case none of this will work
and Grafana will fail silently apart from a line in its own log.

Test it before you spend an hour on configuration:

```bash
sudo docker exec digit-grafana curl -sS --max-time 10 -o /dev/null https://slack.com \
  && echo "egress OK" || echo "EGRESS BLOCKED — talk to your network team"
```

(`curl` is the client the Grafana container's own healthcheck uses, so it is present in the
image. Substitute the host your webhook actually points at — reaching `slack.com` says
nothing about `chat.googleapis.com`.)

If it is blocked, your options are: ask the network team to allow outbound HTTPS to the
specific webhook host; route through your corporate proxy (Grafana honours `HTTP_PROXY` /
`HTTPS_PROXY` environment variables); or use an **internal** SMTP relay for email, which is
usually already permitted.

If Grafana appears configured but nothing arrives, its own log tells you why:

```logql
{compose_service="grafana"} |~ `(?i)alerting|notifier|contact|webhook|error`
```

---

## Option A — Grafana contact points

All of these live at `https://<your-domain>/grafana/` → **Alerting** → **Contact points** →
**+ Add contact point**. Give each one a name you will recognise in a routing rule
(`chat-ops`, `oncall-critical`), pick the integration, fill in the fields, and press
**Test** before saving.

### Slack (recommended if you use Slack)

1. In Slack: **Apps → Incoming WebHooks → Add to Slack**, choose the channel, copy the
   webhook URL (`https://hooks.slack.com/services/...`).
2. In Grafana: contact point type **Slack**, paste it into **Webhook URL**.
3. Optional but worth doing — set **Title** and **Text Body** so the message is readable
   at a glance:
   - Title: `{{ .Status | toUpper }}: {{ .CommonLabels.alertname }}`
   - Text: `{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}\n{{ end }}`
4. **Test**, confirm it lands in the channel, **Save**.

> The webhook URL is a credential — anyone with it can post into your channel as you. Do not
> paste it into a ticket, a shared document, or a git repository.

### Google Chat (recommended if you use Google Workspace)

1. In the Google Chat space: **Space name → Apps & integrations → Webhooks → Add webhook**,
   name it `DIGIT Alerts`, copy the URL.
2. In Grafana: contact point type **Google Hangouts Chat**, paste into **URL**.
3. Test and save.

Your Workspace administrator may have webhooks disabled organisation-wide; if the option is
missing, that is why.

### Microsoft Teams (recommended if you use Microsoft 365)

Microsoft is retiring the old Office 365 connectors, so use the Workflows route:

1. In Teams: the channel's **⋯ → Workflows → "Post to a channel when a webhook request is
   received"**. Complete it and copy the generated HTTPS URL.
2. In Grafana: contact point type **Microsoft Teams**, paste into **URL**.
3. Test and save.

If your tenant still offers **Connectors → Incoming Webhook**, that works too, but plan to
migrate.

### Telegram

1. Message `@BotFather` → `/newbot` → copy the **bot token**.
2. Create a group and add the bot, then send one message in the group so there is something
   to read. Get the **chat ID** from a terminal — not from a browser:

   ```bash
   read -rs TG_TOKEN     # paste the token at the prompt; it is not echoed
   curl -s "https://api.telegram.org/bot$TG_TOKEN/getUpdates" \
     | python3 -c 'import json,sys; print(*{u["message"]["chat"]["id"] for u in json.load(sys.stdin)["result"] if "message" in u})'
   unset TG_TOKEN
   ```

   Group chat IDs are negative. Clear the shell history line afterwards if your shell
   records it.
3. In Grafana: contact point type **Telegram**, fill in **BOT API Token** and **Chat ID**.

> **Keep the token out of the browser.** Opening the `getUpdates` URL in the address bar
> writes the bot token into browser history and any synced profile, and it can reach proxy
> logs, corporate TLS inspection and screenshots. Anyone holding the token can post as the
> bot. The response body also contains the group's message text. Treat it like a password.

Cheap, reliable, and it reaches personal phones. Consider whether hostnames and error
messages should be leaving departmental systems onto a consumer platform before you
standardise on it.

### Email (needs work before it will send)

**Email does not work on a stock deployment.** Grafana has no SMTP server configured
(`GF_SMTP_*` is unset), and the default contact point points at the literal placeholder
`<example@email.com>`.

To enable it, the following must be added to the Grafana container's environment — this is a
deployment change, so **raise it with us** rather than editing files on the box:

```
GF_SMTP_ENABLED=true
GF_SMTP_HOST=smtp.yourdepartment.gov:587
GF_SMTP_USER=<user>
GF_SMTP_PASSWORD=<password>
GF_SMTP_FROM_ADDRESS=digit-alerts@yourdepartment.gov
GF_SMTP_FROM_NAME=DIGIT Alerts
```

An **internal** departmental relay is usually the easiest thing to get approved, and often
the only outbound path the firewall permits. Once SMTP works, edit the existing
`email receiver` contact point and replace the placeholder address with a **distribution
list**, never an individual — people change roles.

Email is a poor primary channel (slow, easily buried) and a good secondary one (it creates a
record and reaches people outside the chat tool). Use it for `warning`, not `critical`.

### PagerDuty / Opsgenie (for a real on-call rota)

If the deployment is genuinely 24×7 and you need acknowledgement, escalation and a schedule,
use a paging product rather than building one out of chat. Grafana has native contact points
for both: create a service in PagerDuty/Opsgenie, copy its integration key, paste it into
the contact point. Route only `severity=critical` there.

### Generic webhook (the escape hatch)

Type **Webhook** posts Grafana's alert JSON to any URL you control. This is how you reach
anything without a native integration — an internal ticketing system, a departmental SMS
gateway, a WhatsApp relay, a heartbeat monitor. Grafana supports HTTP basic auth and a
bearer token on the request.

---

## Option B — Gatus native alerting (endpoint down)

**Start here.** This is the fastest, highest-value alerting you can turn on, and unlike
everything in Option A it is **already built and already wired** — it is waiting on one
value.

The health dashboard at `/status/` checks up to 57 endpoints every 30 seconds. Alerting on
those checks ships with the deployment, **switched off**, with every endpoint already opted
in and sensible thresholds already set:

```yaml
alerting:
  slack:
    webhook-url: "${GATUS_SLACK_WEBHOOK_URL}"    # empty = alerting off
    default-alert:
      enabled: true
      failure-threshold: 3      # 3 consecutive failed checks ≈ 90 seconds
      success-threshold: 2      # 2 passes before it says "recovered"
      send-on-resolved: true
```

### Turning it on

**One value:** the deployment variable `gatus_slack_webhook_url`, set to a Slack incoming
webhook URL. Mint the webhook the same way as for a Grafana contact point
([Slack](#slack-recommended-if-you-use-slack), step 1), then **send it to us** — it goes into
this deployment's configuration and applies at the next deploy. Nothing else changes.

Leave it unset and behaviour is exactly as today: Gatus expands the empty variable, drops the
Slack provider with a warning in its own log, and carries on serving the dashboard normally.
It does not refuse to start.

> **The webhook URL is a credential.** Anyone holding it can post into your channel. Send it
> to us through whatever channel you would use for a password — not in a ticket, not in a
> group chat, and never committed to a repository.

### What you get

- **Every endpoint alerts, not a chosen subset.** Every check in the catalogue carries the
  opt-in already — all 57 of them, and therefore however many of those your deployment
  actually runs. The coverage is complete on day one; there is no list to curate.
- **~90 seconds of sustained failure before it fires**, not one failed check. That is what
  stops a single dropped probe or a rolling restart from paging anyone.
- **Recovery messages**, so the channel tells you when it is over.
- **The only alerting that watches Redis, Elasticsearch, MinIO and nginx.** Those four still
  have no metrics of their own, so no Grafana rule can see them. Gatus can.

### Two things to know

- **The catalogue is part of the deployment, not the running box.** Editing
  `gatus/config.yaml` on the server is overwritten at the next deployment, and the same
  catalogue is mirrored in the Kubernetes configuration with CI enforcing that the two match.
  Adding an endpoint, changing a threshold, or using a provider other than Slack is a change
  to ship — **ask us**.
- **Expect noise during your deployment window.** Every service restarts, so a redeploy will
  produce a burst of down-and-recovered messages. That is the main argument for having a
  deployment window everyone knows about; Gatus has no mute-timing equivalent of its own.

### Gatus alerting or Grafana alerting?

Both, eventually — they answer different questions and they overlap less than they look:

| | Gatus | Grafana |
|---|---|---|
| Tells you | *X stopped answering* | *X is unhealthy but still answering* |
| Covers | every endpoint in the catalogue, including the four services with no metrics | anything with a metric or a log line |
| Catches | outages | disks filling, memory creeping, lag climbing, error rates |
| Effort | one variable | a rule at a time |

Gatus catches the outage; Grafana catches the hour before it. **Turn Gatus on first** — it is
one value and it covers the case where nothing is running to raise an alert at all — then
build the five Grafana rules in
[alerts-setup.md § Avoiding alert fatigue](alerts-setup.md#avoiding-alert-fatigue).

**Do not duplicate.** Once Gatus alerts on endpoints being down, there is no value in a
Grafana rule that says the same thing more slowly. Keep Grafana for the conditions Gatus
cannot see.

---

## WhatsApp and SMS

Neither has a native Grafana integration. Both are reachable through a **generic webhook**,
and both need a relay in between. Be clear-eyed about the effort: this is half a day of
work, not a settings change.

### WhatsApp — the honest picture

WhatsApp does not accept arbitrary outbound messages. Business messaging goes through the
WhatsApp Business API (Meta directly, or a provider such as Twilio or 360dialog), and
outside a 24-hour window opened by the *recipient*, you may only send **pre-approved
template messages**. Alerts are by definition unsolicited, so:

> **You must register and get approval for an alert template before any of this works.**
> Something like `DIGIT alert: {{1}} — {{2}} at {{3}}`. Approval takes a day or two. Plan
> for it; it is the part that catches people out.

Three routes, most to least sensible:

1. **Reuse the notification stack that is already there.** These deployments already run a
   Novu + Twilio pipeline for citizen SMS/email/WhatsApp, so the credentials, the provider
   account and the template-approval workflow already exist. A small relay endpoint that
   accepts Grafana's webhook and triggers a WhatsApp workflow is the least new machinery.
   **Talk to us before building it** — we know what is wired.
2. **A standalone relay to the Twilio WhatsApp API.** Grafana webhook → a ~30-line service →
   Twilio. Independent of the DIGIT stack, which is a genuine advantage: if DIGIT is broken,
   your alerting path is not. This is our recommendation if you want WhatsApp to be the
   wake-up channel.
3. **A third-party "WhatsApp webhook" service.** Fastest to set up. Note that your server
   names and error messages would transit a provider you have no contract with, which for a
   government system is usually worth a procurement or security review first.

### SMS

Same shape, simpler: Grafana webhook → your department's SMS gateway or Twilio → the on-call
phones. Worth it as the `critical`-only path in places where mobile data is unreliable.
Keep the message to the alert name and the host — nobody debugs from 160 characters, and the
message is just there to make someone open a laptop.

### Before you build either

Worth checking whether you need it. Telegram reaches the same phones, takes fifteen minutes
and costs nothing. If your staff genuinely only use WhatsApp, that's a real constraint and
route 2 above is the answer. If what you're after is a channel that *feels* more urgent than
chat, severity routing and a separate critical channel usually get you there for far less
work.

---

## Routing: getting the right alert to the right person

**Alerting → Notification policies.** The default policy currently sends everything to
`grafana-default-email`, which cannot deliver — so this needs changing whatever else you do.

A structure that works:

```
Default policy  ──▶  contact point: chat-ops          (your #digit-alerts channel)
  group by: alertname, grafana_folder, service_name
  group wait: 30s · group interval: 5m · repeat interval: 4h
  │
  ├─ severity = critical   ──▶  oncall-critical       (WhatsApp / SMS / PagerDuty)
  │     continue matching: ON   (so it also lands in chat)
  │     repeat interval: 30m
  │
  └─ severity = watchdog   ──▶  heartbeat-webhook     (external heartbeat monitor)
        group wait: 0s · repeat interval: 5m
```

The settings that matter:

- **Group by** — alerts sharing these labels arrive as one message. `alertname` plus
  `service_name` means "pgr-services is out of memory" is one notification, not one per
  container. Never group by nothing; never group by everything.
- **Group wait** (30s) — how long to collect related alerts before the first message. When a
  host dies, ten rules fire within seconds; this makes them one notification.
- **Group interval** (5m) — how long before *new* alerts joining an existing group trigger
  another message.
- **Repeat interval** — how often an unresolved alert is re-sent. **4 hours for chat, 30
  minutes for critical.** Too short and people mute the channel; too long and a weekend
  outage goes unnoticed.
- **Continue matching** — on the critical route, leave this ON so criticals appear in the
  chat channel too. The chat channel should be a complete record.

**Add nested routes only when someone would act differently.** A `team=notifications` route
to the team that owns SMS delivery is worth it; a route per service is not.

---

## Quiet hours, maintenance windows and silences

Three different tools; people reach for the wrong one.

**Mute timings** (Alerting → Notification policies → **Mute timings**) — a recurring
schedule during which a route sends nothing. Use this for your **deployment window**. If
your deployment runs nightly at 02:30, every service restarts and `ServiceRestarted` fires
for all sixteen. Create a mute timing `deployment-window` covering 02:00–03:30 daily and
attach it to the route carrying `warning`.

> **Never mute-time your `critical` route.** If the deployment breaks the system, the
> deployment window is precisely when you need to hear about it. Mute the noise, not the
> alarm.

**Silences** (Alerting → **Silences**) — a one-off, time-bounded suppression matching
specific labels. Use this for planned work: "silence everything with
`service_name=egov-indexer` for the next 2 hours while we rebuild the index." Always set an
expiry, always write the reason in the comment.

**Pausing a rule** — stops evaluation entirely. Use only for a rule that is broken and being
fixed. A paused rule is invisible in the alert list and is forgotten within a week; if a
rule is wrong, fix or delete it.

Quiet hours in the "do not disturb overnight" sense should be built from **severity**, not
silence: `warning` to a chat channel that nobody has to read at night, `critical` to the
phone. Suppressing by time of day suppresses the outages too.

---

## The on-call rota

The technology is the easy half. Write these down somewhere everyone can find them —
a pinned message in the alert channel is fine:

| Question | Write down the answer |
|---|---|
| Who is on call this week? | Name and phone number, and how the rota rotates |
| What hours? | Office hours only, or 24×7? Worth stating explicitly, so nobody is relying on cover that isn't there |
| What does the first responder do? | Acknowledge in the channel, then work through [l2-diagnosis.md](l2-diagnosis.md). The acknowledgement is the important half — it stops two people debugging the same thing and reminds someone to update users |
| When do they escalate internally? | e.g. "no diagnosis in 30 minutes for an S1" |
| When do they escalate to us? | See below |
| Who tells the users? | Somebody must. A holding message on the portal beats silence |
| Where is the incident log? | One place where every alert that fired gets a line: what it was, what was done, was it real |

**The single most valuable habit:** when an alert fires, someone posts in the channel
*within a few minutes*, even if it is only "seen, looking". It stops duplicate work, and it
tells you which alerts nobody is reading.

---

## Escalating to us

Alerts tell you something is wrong. **[incident-report.md](incident-report.md)** is how you
tell us. An alert on its own tells us *what tripped*; the report adds *what is broken, for
whom, since when* — so please send both rather than just forwarding the alert.

Escalate when:

- It is **S1 or S2** ([severity definitions](README.md#severity)).
- The same alert has fired **three times in a week** — that is a systemic problem, not an
  incident.
- The fix would need a **deployment change**: more memory for a service, an extra container,
  a configuration value, node-exporter, an SMTP relay, a change to the Gatus endpoint
  catalogue or its thresholds, or **the Gatus Slack webhook** that turns endpoint alerting
  on.
- You are about to do something on the destroy-list in
  [l2-diagnosis.md](l2-diagnosis.md#commands-that-are-destructive). Ask first.

When you escalate, include **the alert name and the exact time it fired**, plus everything
the report template asks for. The alert name maps directly to a rule and a runbook on our
side, which saves a round trip.

---

## Message hygiene

What appears in a notification decides whether it gets acted on.

- **Every rule needs a `summary` annotation** that names the thing and the number:
  `Disk /dev/sda1 is 96% full on digit-prod-1`. Not `HostDiskSpaceCritical firing`.
- **Every rule needs a runbook link** in the `description`.
- **Use labels people recognise** — `service_name`, `instance`, `mountpoint`. The person
  reading at 3am should not have to open Grafana to find out which server it is.
- **Turn on resolved notifications.** A channel that only reports failure gives you no way
  to know an incident is over.
- **Do not put citizen data in an alert.** Alerts go to chat tools and phones outside the
  system's access controls. Alert on rates and counts, never on the content of a complaint.
  See [incident-report.md § Redaction](incident-report.md#redaction--what-not-to-send-us).
- **One channel, not five.** Split by severity, not by service.
