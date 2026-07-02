# Notification Findings Closure Plan

**Date**: 2026-07-02
**Branch**: `feat/pgr-notifications-configure` (HEAD = squashed feature commit `ea1589b11` on `upstream/develop`)
**Closes**: the material findings from the design doc's §5 review-findings table
(`docs/plans/2026-07-02-pgr-notifications-design.md`, published as fork discussion ChakshuGautam/CCRS#59).
**Companion**: the automated-test-plan document in `docs/plans/` owns the §6 test-gap list (G1–G20).
Where a finding's closure *is* a missing test, this plan defers to that document and says so explicitly.

## How to execute this plan

- Every file path below is **relative to the repo root** (`Citizen-Complaint-Resolution-System/`).
- Workstreams W1–W5 are ordered. **W2 depends on W1** (it edits code W1 reshapes). W3, W4, W5 are
  independent of each other and can be done in any order after W1, but do them in the order written
  unless you have a reason not to.
- Each workstream ends with a **gate**: the exact commands that must pass before you move on.
  Commit at each gate (one commit per workstream is fine).
- Anchors below quote the code **as it exists at `ea1589b11`**. Line numbers are approximate and
  will drift as you edit — always locate the quoted text, not the line number. If a quoted anchor
  does not exist in the file, STOP and re-check rather than guessing.
- Java modules build with Maven from their own directory:
  - `cd backend/novu-bridge && mvn -q test`
  - `cd backend/pgr-services && mvn -q test`
  - `cd utilities/default-data-handler && mvn -q test`
- Configurator: `cd configurator && npm run build` (runs `tsc -b` then vite) and `npm run test`
  (vitest).
- **Secrets rule**: this document and your commits go to a public fork. Never commit API keys,
  tokens, passwords, private IPs, or server hostnames/aliases. Ops steps that touch the pilot
  server are described generically.

### Live-verification recipients (owner-authorized)

Where a step says "optionally verify live", the only contact details authorized for use are:

| Audience | Phone | Email |
|----------|-------|-------|
| CITIZEN  | +919415787824 | contact@theflywheel.in |
| PGR_LME  | `<LME_PHONE>` | `<LME_EMAIL>` |
| GRO      | `<GRO_PHONE>` | `<GRO_EMAIL>` |

The LME and GRO values are placeholders — **the owner will supply them**; do not invent numbers.

### Finding IDs used below

- **B1–B20**: the backend review findings, in the order they appear in the review output
  (B1 = unknown-channel SMS fallback … B20 = golden-gate praise).
- **C1–C13**: the configurator review findings (C1 = fire-and-forget blocker … C13 = praise).
- **BR**: the Baileys-removal scope (its own item; W1 implements it verbatim).
- The design doc §5 table numbers (#1–#24) are cross-referenced in the traceability table at the end.

---

## W1 — Baileys decommission + channel gate

**Closes**: BR (full removal scope), B1 (unknown-channel SMS fallback), B10 (dead/misleading
config knobs), stale-Javadoc items from BR.
**Why first**: W2's failure-handling edits wrap the delivery call that this workstream reshapes
(one Novu call instead of a Novu/Baileys branch).

**CRITICAL SEMANTICS (read before editing)**: after removal, an event with `channel=WHATSAPP` must
**persist an explicit SKIPPED row with error code `NB_NO_PROVIDER`** — a valid, logged outcome,
NOT a thrown exception (throwing would DLQ-spam permanently undeliverable events, because seeds
keep authoring WHATSAPP routing rows on purpose). And `getNovuWorkflowId` must **stop defaulting
unknown/null channels to the SMS workflow** — unknown channel is `NB_UNSUPPORTED_CHANNEL`,
persisted as SKIPPED. Never fall through to SMS. A naive deletion of the Baileys branch alone
would route WHATSAPP events into the unprovisioned `complaints-whatsapp` Novu workflow (DLQ spam
or phantom SENT) — the channel-enable gate in step W1.2 is required work, not optional polish.

### W1.1 — Add the channel-enable config + fix `getNovuWorkflowId`

**File**: `backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java`

NOW: the class has four Baileys fields under the comment
`// ---- Baileys WhatsApp send-service (out-of-band HTTP delivery) ----`
(`baileysUrl`, `baileysSendPath`, `baileysToken`, `baileysTimeoutMs` — the last one is already
dead code, nothing reads it), and this method:

```java
public String getNovuWorkflowId(String channel) {
    if (channel == null) {
        return novuWorkflowSms;
    }
    switch (channel.toUpperCase()) {
        case "WHATSAPP":
            return novuWorkflowWhatsapp;
        case "EMAIL":
            return novuWorkflowEmail;
        case "SMS":
        default:
            return novuWorkflowSms;
    }
}
```

AFTER:
1. Delete the four `novu.bridge.whatsapp.baileys.*` `@Value` fields and their section comment.
2. Add a channel-enable field (put it where the Baileys block was):

```java
// ---- Channel delivery gate ----
// Only channels listed here are actually delivered. Any other KNOWN channel
// (e.g. WHATSAPP until a legitimate provider is onboarded as a Novu
// integration) is persisted as SKIPPED / NB_NO_PROVIDER — an honest,
// debuggable outcome, never a fallback to another channel.
@Value("#{'${novu.bridge.channels.enabled:SMS,EMAIL}'.split(',')}")
private java.util.List<String> channelsEnabled;

public boolean isChannelEnabled(String channel) {
    if (channel == null) return false;
    return channelsEnabled.stream().anyMatch(c -> c.trim().equalsIgnoreCase(channel.trim()));
}
```

3. Replace `getNovuWorkflowId` so it can never silently pick SMS:

```java
/**
 * Resolve the fixed Novu workflow id for a channel. Throws for null/unknown
 * channels — callers must gate on a known channel first (the pipeline
 * persists SKIPPED/NB_UNSUPPORTED_CHANNEL instead of ever reaching this
 * throw in normal operation). NEVER defaults to the SMS workflow.
 */
public String getNovuWorkflowId(String channel) {
    if (channel == null) {
        throw new CustomException("NB_UNSUPPORTED_CHANNEL", "channel is null; refusing to guess a Novu workflow");
    }
    switch (channel.toUpperCase()) {
        case "SMS":      return novuWorkflowSms;
        case "WHATSAPP": return novuWorkflowWhatsapp;
        case "EMAIL":    return novuWorkflowEmail;
        default:
            throw new CustomException("NB_UNSUPPORTED_CHANNEL", "No Novu workflow for channel: " + channel);
    }
}
```

Add the import `org.egov.tracer.model.CustomException`. Keep `novuWorkflowWhatsapp` — the
`novu.bridge.workflow.id.whatsapp=complaints-whatsapp` key survives removal so that onboarding a
legitimate WhatsApp provider later is pure Novu configuration + flipping
`novu.bridge.channels.enabled`.

**File**: `backend/novu-bridge/src/main/resources/application.properties`

NOW: contains these four lines (plus their comment):

```
novu.bridge.whatsapp.baileys.url=${NOVU_BRIDGE_BAILEYS_URL:http://baileys-send-service:3040}
novu.bridge.whatsapp.baileys.send.path=${NOVU_BRIDGE_BAILEYS_SEND_PATH:/send}
novu.bridge.whatsapp.baileys.token=${NOVU_BRIDGE_BAILEYS_TOKEN:}
novu.bridge.whatsapp.baileys.timeout.ms=${NOVU_BRIDGE_BAILEYS_TIMEOUT_MS:10000}
```

AFTER: delete them and add, under the `# ---- Config-driven pass-through delivery ----` section:

```
# Channels actually delivered. WHATSAPP is intentionally absent until a
# legitimate provider (Meta Cloud API / Twilio WhatsApp as a Novu integration
# behind a v2-native complaints-whatsapp workflow) is onboarded; until then
# WHATSAPP events persist SKIPPED/NB_NO_PROVIDER in nb_dispatch_log.
novu.bridge.channels.enabled=${NOVU_BRIDGE_CHANNELS_ENABLED:SMS,EMAIL}
```

Verify after this step: `cd backend/novu-bridge && mvn -q -DskipTests compile` — it will FAIL
(DispatchPipelineService still references the deleted fields via BaileysSendClient). That is
expected; proceed to W1.2 before running the gate.

### W1.2 — Remove the Baileys branch from the pipeline; add the SKIPPED gates

**File**: `backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java`

NOW:
- Class Javadoc says `delivers the rendered body — via Novu for SMS/EMAIL, via the Baileys
  send-service for WHATSAPP` (list item 2).
- The class has a `private final BaileysSendClient baileysSendClient;` field and a matching
  constructor parameter.
- `process()` contains this delivery branch:

```java
Contact contact = buildContact(event, context);
String channel = context.getChannel();
NovuClient.NovuResponse response;

if ("WHATSAPP".equalsIgnoreCase(channel)) {
    // WhatsApp is delivered out-of-band via Baileys; strip the Twilio
    // "whatsapp:" prefix so Baileys receives a bare E.164 MSISDN.
    String to = formatRecipientPhone(context.getRecipientMobile(), event.getTenantId(), "sms", requestInfo);
    log.info("Routing WHATSAPP via Baileys: eventId={}, to={}, txn={}",
            event.getEventId(), to, context.getTransactionId());
    response = baileysSendClient.send(to, context.getRenderedBody());
} else {
    // SMS / EMAIL: identify the subscriber then trigger the per-channel Novu workflow.
    response = novuClient.identifyThenTrigger(...);
}
```

- `formatRecipientPhone()` ends with a comment block mentioning "the Baileys path" and
  "The WHATSAPP-via-Baileys route in process() passes channel=\"sms\" here precisely to get bare
  E.164."

AFTER:
1. Remove the `baileysSendClient` field, its constructor parameter, and its assignment.
2. Rewrite the class Javadoc list item 2 to:
   `delivers the rendered body via the per-channel Novu workflow for every ENABLED channel
   (novu.bridge.channels.enabled); known-but-disabled channels (e.g. WHATSAPP with no
   provider) persist an explicit SKIPPED/NB_NO_PROVIDER row, and`
3. In `process()`, immediately AFTER the dry-run block (`if (!send) { ... }`) and BEFORE
   `Contact contact = buildContact(event, context);`, insert the two channel gates:

```java
String channel = context.getChannel();
// Gate 1: unknown/null channel — never guess, never fall back to SMS.
if (!isKnownChannel(channel)) {
    persist(event, context, "SKIPPED", "NB_UNSUPPORTED_CHANNEL",
            "Unknown channel: " + channel, null, 1);
    return DispatchResult.builder()
            .valid(true).preferenceAllowed(true).derivedContext(context)
            .novuTriggered(false)
            .diagnostics(Collections.singletonList("Unsupported channel " + channel + " skipped"))
            .build();
}
// Gate 2: known channel with no enabled provider (e.g. WHATSAPP pre-onboarding).
if (!config.isChannelEnabled(channel)) {
    persist(event, context, "SKIPPED", "NB_NO_PROVIDER",
            "No provider enabled for channel " + channel, null, 1);
    return DispatchResult.builder()
            .valid(true).preferenceAllowed(true).derivedContext(context)
            .novuTriggered(false)
            .diagnostics(Collections.singletonList("Channel " + channel + " has no enabled provider; skipped"))
            .build();
}
```

   and add the helper:

```java
private static final Set<String> KNOWN_CHANNELS = Set.of("SMS", "WHATSAPP", "EMAIL");

private boolean isKnownChannel(String channel) {
    return channel != null && KNOWN_CHANNELS.contains(channel.toUpperCase());
}
```

4. Replace the whole `if ("WHATSAPP"...) { ... } else { ... }` delivery branch with the
   unconditional Novu call (delete the local `String channel = context.getChannel();` there —
   it now lives above the gates):

```java
Contact contact = buildContact(event, context);
NovuClient.NovuResponse response = novuClient.identifyThenTrigger(
        subscriberId,
        contact,
        channel,
        context.getRenderedBody(),
        context.getRenderedSubject(),
        context.getTransactionId(),
        event.getData());
```

5. In `formatRecipientPhone()`, replace the trailing comment
   (`// Twilio Programmable WhatsApp requires ... passes channel="sms" here precisely to get bare E.164.`)
   with:
   `// Twilio Programmable WhatsApp requires the "whatsapp:" prefix; SMS takes raw E.164.`
   Do NOT delete the method — `testTrigger()` still uses it.
6. Remove the now-unused `BaileysSendClient` import if present (it's in the same package, so
   there may be none).

### W1.3 — Delete the Baileys classes; restore the bare `"whatsapp"` alias

1. Delete `backend/novu-bridge/src/main/java/org/egov/novubridge/service/BaileysSendClient.java`
   (whole file).
2. Delete `backend/novu-bridge/src/main/java/org/egov/novubridge/service/provider/BaileysProviderStrategy.java`
   (whole file).
3. **File**: `backend/novu-bridge/src/main/java/org/egov/novubridge/service/provider/WhatsAppBusinessApiProviderStrategy.java`
   NOW: `supports(String providerName)` carries a NOTE comment beginning
   `// NOTE: deliberately does NOT claim the bare "whatsapp" alias — that` (the diff removed the
   bare alias specifically to avoid shadowing Baileys) and matches only
   `"whatsapp-business-api"` / `"meta"`-style names.
   AFTER: restore the bare alias — add `|| "whatsapp".equalsIgnoreCase(providerName)` to the
   `supports()` return expression and replace the NOTE comment with:
   `// Owns the bare "whatsapp" alias again now that the Baileys strategy is removed.`

### W1.4 — Fix the stale Javadoc / comments (the "bypass the log" family)

These comments claimed direct Baileys/Telegram sends bypass `nb_dispatch_log`. Post-removal,
**every** WHATSAPP outcome DOES land in `nb_dispatch_log` (as SKIPPED/NB_NO_PROVIDER) — an
observability improvement worth stating.

1. **File**: `backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/DispatchLogController.java`
   NOW (class Javadoc): `<p><b>Observability boundary:</b> {@code nb_dispatch_log} records ONLY the sends
   that went through novu-bridge's Novu-backed SMS/Email path. Direct Baileys / Telegram WhatsApp
   deliveries bypass Novu and are NOT written here, ...`
   AFTER: replace that paragraph with:
   `<p><b>Observability:</b> every event consumed from the domain topic lands here with an
   explicit terminal status — SENT, SKIPPED (preference denied / no provider / unsupported
   channel) or FAILED. Channels without an enabled provider (e.g. WHATSAPP before a legitimate
   provider is onboarded) appear as SKIPPED/NB_NO_PROVIDER rather than being invisible.`
2. **File**: `backend/novu-bridge/src/main/java/org/egov/novubridge/repository/DispatchLogRepository.java`
   NOW (Javadoc on `list(...)`): `<p>Observability boundary: nb_dispatch_log records ONLY sends that went
   through novu-bridge's Novu-backed SMS/Email path. Direct Baileys/Telegram WhatsApp sends bypass
   Novu and are NOT tracked here, ...`
   AFTER: replace with the same corrected paragraph as above (adapted to plain-text Javadoc).
3. **File**: `backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/IntegrationController.java`
   NOW (class Javadoc): `<p><b>Observability boundary:</b> this lists the Novu-side provider
   configuration only. Direct Baileys / Telegram WhatsApp senders that bypass Novu are configured
   elsewhere and are not represented here.`
   AFTER: `<p><b>Observability boundary:</b> this lists the Novu-side provider configuration
   only. All delivery now goes through Novu; channels with no active Novu integration are gated
   off via novu.bridge.channels.enabled and show up in the dispatch log as SKIPPED.`
4. **File**: `backend/pgr-services/src/test/java/org/egov/pgr/service/notification/NotificationConfigDrivenEmissionTest.java`
   NOW (class Javadoc, ~line 49): `* dispatched to its channel's send (Novu for SMS/EMAIL, Baileys for WHATSAPP).`
   AFTER: `* dispatched via the per-channel Novu workflow (channels without an enabled provider are SKIPPED at the bridge).`

### W1.5 — Rewrite the novu-bridge tests

1. Delete `backend/novu-bridge/src/test/java/org/egov/novubridge/service/provider/BaileysProviderStrategyTest.java`
   (4 tests, all Baileys-specific). Its one durable concern — who owns the bare `"whatsapp"`
   alias — is re-pinned by adding to the EXISTING pipeline test class (below) a small test that
   asserts `new WhatsAppBusinessApiProviderStrategy().supports("whatsapp")` is true (adjust to
   the class's actual construction; it has no dependencies or trivially mockable ones).
2. **File**: `backend/novu-bridge/src/test/java/org/egov/novubridge/service/DispatchPipelinePassThroughTest.java`
   NOW: mocks `BaileysSendClient` (field ~line 36, `mock(...)` in setup ~line 48, constructor arg
   ~line 61) and has `whatsappEvent_routesToBaileys_notNovu()` plus
   `verify(baileysSendClient, never())...` assertions in the SMS/EMAIL/preference tests.
   AFTER:
   - Remove the `baileysSendClient` field/mock/constructor-arg and every
     `verify(baileysSendClient, ...)` line.
   - The test constructs a real `NovuBridgeConfiguration` (it's `@Data`, so setters exist). In
     setup, set the new field: `config.setChannelsEnabled(List.of("SMS", "EMAIL"));` — otherwise
     the `@Value` default is null in a plain-JUnit instantiation and every channel would skip.
   - Replace `whatsappEvent_routesToBaileys_notNovu` with:

```java
@Test
void whatsappEvent_noEnabledProvider_persistsSkippedNoProvider_neverFallsBackToSms() {
    ComplaintsDomainEvent event = /* same WHATSAPP event builder the old test used */;
    DispatchResult result = service.process(event, true, null);

    assertFalse(result.getNovuTriggered());
    // No Novu trigger at all — in particular NOT the SMS workflow.
    verify(novuClient, never()).identifyThenTrigger(any(), any(), any(), any(), any(), any(), any());
    // Explicit SKIPPED/NB_NO_PROVIDER dispatch row.
    ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
    verify(dispatchLogRepository).upsert(captor.capture());
    assertEquals("SKIPPED", captor.getValue().getStatus());
    assertEquals("NB_NO_PROVIDER", captor.getValue().getLastErrorCode());
    assertEquals("WHATSAPP", captor.getValue().getChannel());
}
```

   - Add an unknown-channel test (the bridge must defend independently of PGR's router):

```java
@Test
void unknownChannel_isSkippedWithUnsupportedChannel_notDefaultedToSms() {
    // Same event builder with channel = "PIGEON".
    DispatchResult result = service.process(event, true, null);
    assertFalse(result.getNovuTriggered());
    verify(novuClient, never()).identifyThenTrigger(any(), any(), any(), any(), any(), any(), any());
    // upsert captured status == "SKIPPED", lastErrorCode == "NB_UNSUPPORTED_CHANNEL"
}
```

   (Match the mock/argument style already used in the file — it uses plain JUnit + Mockito with a
   real `EnvelopeValidator`.)

### W1.6 — Delete the standalone service

```bash
git rm -r utilities/baileys-send-service
```

This removes the whole module: `Dockerfile`, `.dockerignore` (if tracked), `README.md`,
`package.json`, `package-lock.json` (~2.5k lines), `src/server.js`. The `node_modules/` dir there
is untracked — delete it from disk too (`rm -rf utilities/baileys-send-service`) after the
`git rm`.

### W1.7 — Strip compose / Ansible references

1. **File**: `local-setup/docker-compose.egov-digit.yaml`
   - In the `novu-bridge:` service's `depends_on:` block, delete the entry (including its
     4-line comment starting `# WhatsApp delivery target. In pass-through mode the bridge routes`):

     ```yaml
     baileys-send-service:
       condition: service_started
     ```

   - In the `novu-bridge:` `environment:` block, delete these two env lines and their 2-line
     comment (`# WhatsApp delivery via the self-hosted Baileys send-service (D7). ...`):

     ```yaml
     NOVU_BRIDGE_BAILEYS_URL: ${NOVU_BRIDGE_BAILEYS_URL:-http://baileys-send-service:3040/send}
     NOVU_BRIDGE_BAILEYS_TOKEN: ${NOVU_BRIDGE_BAILEYS_TOKEN:-}
     ```

     and in their place add the channel gate:

     ```yaml
     # Channels actually delivered. WHATSAPP stays OFF until a legitimate
     # provider is onboarded as a Novu integration (then just add it here).
     NOVU_BRIDGE_CHANNELS_ENABLED: ${NOVU_BRIDGE_CHANNELS_ENABLED:-SMS,EMAIL}
     ```

   - Change the legacy default-channel knob — NOW: `NOVU_BRIDGE_CHANNEL: ${NOVU_BRIDGE_CHANNEL:-whatsapp}`.
     AFTER: `NOVU_BRIDGE_CHANNEL: ${NOVU_BRIDGE_CHANNEL:-SMS}`. (This only affects legacy
     stakeholders[] envelopes that carry no channel; defaulting them to WHATSAPP post-removal
     would skip them all with NB_NO_PROVIDER.)
   - Delete the entire `baileys-send-service:` service block **including** its section-header
     comment (starts `# ==================== Baileys WhatsApp send-service (opt-in) ==========`
     and ends just before the `networks:` top-level key).
   - In the top-level `volumes:` map, delete the line `baileys_auth_data: null`.
   - **B10 dead knobs, same file**: delete the env line `NOVU_BRIDGE_RENDERED_BODY_MODE: 'true'`
     and the env line `NOVU_BRIDGE_IDENTIFY_ENABLED: 'true'` together with their explanatory
     comments (grep confirms no Java code reads either — pass-through and identify are
     unconditional). Rewrite the comment above `NOVU_BRIDGE_CONFIG_HOST` — NOW it claims the
     config-service props are `kept one release for rollback to the legacy resolve path`; the
     legacy client class was deleted in this same PR, so rollback means pinning an old image.
     See item 3 below for deleting the Java-side fields.
2. **File**: `local-setup/docker-compose.bomet.yml`
   NOW (line ~28): a comment `# Requires the pass-through novu-bridge + baileys-send-service (notifications ...`.
   AFTER: reword to `# Requires the pass-through novu-bridge (notifications ...` (keep the rest).
3. **B10, Java side** — `backend/novu-bridge/src/main/java/org/egov/novubridge/config/NovuBridgeConfiguration.java`
   and `backend/novu-bridge/src/main/resources/application.properties`:
   grep the module for `getConfigHost|getConfigResolvePath|getConfigSearchPath` — as of
   `ea1589b11` there are NO usages outside the configuration class itself. Delete the three
   fields (`configHost`, `configResolvePath`, `configSearchPath`) and the three
   `novu.bridge.config.*` property lines plus their `# DEPRECATED (config-driven cutover, D8)`
   comment block. (If your grep DOES find a usage, leave that trio in place and note it —
   don't break compilation.)
4. **B10, PGR side** — `backend/pgr-services/src/main/java/org/egov/pgr/config/PGRConfiguration.java`:
   NOW:

   ```java
   @Value("#{'${pgr.notification.channels.default:SMS}'.split(',')}")
   private java.util.List<String> notificationDefaultChannels;
   ```

   Grep confirms `notificationDefaultChannels` has zero readers. Delete the field and the line
   `pgr.notification.channels.default=SMS` from
   `backend/pgr-services/src/main/resources/application.properties`.
5. **File**: `local-setup/ansible/templates/digit.env.j2`
   - Delete the `BAILEYS_IMAGE=...` line and its 3-line comment
     (`# baileys-send-service image. Self-hosted WhatsApp delivery (design D7). ...`).
   - Delete the `# ── Baileys WhatsApp send-service (design D7) ──` block: the comment lines,
     `BAILEYS_SEND_TOKEN=...`, `NOVU_BRIDGE_BAILEYS_URL=...`, `NOVU_BRIDGE_BAILEYS_TOKEN=...`.
   - Add in its place:

     ```
     # Channels the bridge actually delivers. Add WHATSAPP only after a
     # legitimate provider is configured as a Novu integration.
     NOVU_BRIDGE_CHANNELS_ENABLED={{ novu_bridge_channels_enabled | default('SMS,EMAIL') }}
     ```

6. **File**: `local-setup/ansible/playbook-deploy.yml`
   Delete the task block headed by the comment
   `# ==================== Build baileys-send-service locally ==============` — i.e. the comment
   lines plus the task `- name: "Build baileys-send-service image locally (when build_baileys)"`
   including its `register: baileys_build_run` and the `when:` list containing
   `build_baileys | default(false)`.
7. **File**: `local-setup/ansible/inventory/host_vars/_example.yml`
   Delete: the `build_baileys: false` key with its comment block (`# Build the Baileys
   send-service locally ...`), the `baileys_send_token: ""` key with its comment block
   (`# Baileys send-service bearer token. MANDATORY in production ...`), the commented
   `# baileys_image: ...` pin line (it references the internal registry — remove the whole
   line), and reword the `enable_novu` comment that currently says the notifications profile
   needs `... + the pass-through novu_bridge_image + baileys_image (below)` to mention only
   `novu_bridge_image`. Optionally document `novu_bridge_channels_enabled` next to
   `enable_novu`.
8. **File**: `local-setup/ansible/inventory/host_vars/bomet.yml.example`
   Same treatment: delete `build_baileys: true` (+comment), `baileys_send_token: ""`
   (+comment block), the commented `# baileys_image:` pin line, and trim `+ Baileys stack`
   from the `enable_novu` comment.
9. **Untracked/ops (do NOT commit, no hostnames in commits)**: real tenant host_vars files under
   `local-setup/ansible/inventory/host_vars/` are gitignored; on the deploy controller, remove
   `build_baileys` / `baileys_send_token` / `baileys_image` keys from any real tenant YAML.
   On the pilot server itself: `docker rm -f baileys-send-service`,
   `docker volume rm <project>_baileys_auth_data`, unlink the paired device from the WhatsApp
   phone (Linked devices), and discard/rotate the send token wherever it was stored.

### W1.8 — Docs sweep

**Files**: `docs/plans/2026-06-29-pgr-config-driven-notifications-design.md` and
`docs/plans/2026-06-29-pgr-config-driven-notifications-implementation.md` (~95 Baileys mentions
between them; `grep -rli baileys docs/` to enumerate).

Do NOT rewrite history wholesale. Make one surgical edit: find design decision **D7** (the
Baileys-specific decision) in each doc and insert a superseded banner directly under its heading:

> **SUPERSEDED (2026-07-02)**: Baileys was development scaffolding only and has been removed
> (see `docs/plans/2026-07-02-notification-findings-closure-plan.md`, W1). WHATSAPP delivery is
> gated behind `novu.bridge.channels.enabled` and persists SKIPPED/`NB_NO_PROVIDER` until a
> legitimate provider (Meta WhatsApp Cloud API or Twilio WhatsApp, as a Novu integration behind a
> v2-native `complaints-whatsapp` workflow) is onboarded.

Other Baileys mentions in those two docs stay as historical record. The newer
`docs/plans/2026-07-02-pgr-notifications-design.md` already describes the target architecture —
no edit needed there.

Configurator copy: `grep -rn -i baileys configurator/src` — the Logs screen header/comment in
`configurator/src/resources/notification-logs/NotificationLogList.tsx` describes the
"direct WhatsApp not tracked" observability boundary; reword to match W1.4's corrected text
(WHATSAPP now appears as SKIPPED rows). W3.6 touches the same file's comments again.

### W1 gate

```bash
cd backend/novu-bridge && mvn -q test                     # all green, incl. the 2 new tests
cd ../pgr-services && mvn -q test                          # all green (Javadoc-only change)
grep -rni baileys backend/ utilities/ local-setup/ configurator/src \
  --include='*.java' --include='*.yaml' --include='*.yml' --include='*.j2' \
  --include='*.properties' --include='*.ts' --include='*.tsx'   # ZERO hits
docker compose -f local-setup/docker-compose.egov-digit.yaml config -q   # parses clean
```

E2E note: the pilot's live e2e script asserts per-channel `nb_dispatch_log` rows; after this
workstream its WHATSAPP assertions must expect `status=SKIPPED` / `NB_NO_PROVIDER` instead of
SENT — that flip is owned by the companion test plan (G18) and is a good regression test that the
gate works. If verifying live, the citizen recipient is the owner-authorized contact listed at
the top of this plan.

---

## W2 — novu-bridge robustness + PGR emitter fixes

**Closes**: B2 (FAILED rows), B3 (RestTemplate timeouts), B5 (role-pool pagination/dupes),
B6 (channel-appropriate contact filtering), B8 (dedupe key burned early), B14 (epoch heuristic),
B15 (splitter NPE), B19 partial (fromState WARN), B9 (documentation of the locale limitation).
**Depends on**: W1 (edits the same `process()` body).

### W2.1 — Persist FAILED on delivery failure (B2)

**File**: `backend/novu-bridge/src/main/java/org/egov/novubridge/service/DispatchPipelineService.java`

NOW (post-W1): `process()` calls `novuClient.identifyThenTrigger(...)` bare; when it throws, the
exception propagates to `DomainEventConsumer.listen()`, which only logs and DLQs
(`publishDlq(...)` in `backend/novu-bridge/src/main/java/org/egov/novubridge/consumer/DomainEventConsumer.java`).
No `persist(..., "FAILED", ...)` exists anywhere — the Logs screen shows nothing for exactly the
failures it exists to surface. `persist(...)` currently writes `"SENT"` unconditionally after the
call.

AFTER: wrap delivery, persist FAILED, **rethrow** so the consumer's DLQ routing is unchanged;
also stop persisting SENT when the response itself is a non-2xx:

```java
NovuClient.NovuResponse response;
try {
    response = novuClient.identifyThenTrigger(
            subscriberId, contact, channel,
            context.getRenderedBody(), context.getRenderedSubject(),
            context.getTransactionId(), event.getData());
} catch (CustomException ce) {
    persist(event, context, "FAILED", ce.getCode(), ce.getMessage(), null, 1);
    throw ce;   // consumer logs + DLQs as before
} catch (Exception e) {
    persist(event, context, "FAILED", "NB_DELIVERY_ERROR", e.getMessage(), null, 1);
    throw e;
}

Integer sc = response != null ? response.getStatusCode() : null;
boolean delivered = sc != null && sc >= 200 && sc < 300;
if (!delivered) {
    persist(event, context, "FAILED", "NB_NOVU_TRIGGER_FAILED",
            "Novu returned status " + sc, response != null ? response.getResponse() : null, 1);
    return DispatchResult.builder()
            .valid(true).preferenceAllowed(true).derivedContext(context)
            .novuTriggered(false).novuStatusCode(sc)
            .novuResponse(response != null ? response.getResponse() : null)
            .diagnostics(Collections.singletonList("Novu trigger failed: status " + sc))
            .build();
}
// existing "SENT" persist + success DispatchResult follow unchanged
```

Before writing this, read `NovuClient.trigger(...)` to confirm how non-2xx surfaces: if
RestTemplate throws `HttpStatusCodeException` on 4xx/5xx and `NovuClient` does not catch it, the
try/catch above handles it; the `delivered` check then covers any path where a non-2xx is
returned as a `NovuResponse` instead. Handle BOTH; whichever branch turns out to be dead is
harmless defense.

Add a unit test to `DispatchPipelinePassThroughTest` (same mock style):
`novuTriggerThrows_persistsFailed_thenRethrows` — stub
`novuClient.identifyThenTrigger(...)` to throw `new CustomException("NB_NOVU_TRIGGER_FAILED", "boom")`,
assert `process` rethrows AND `dispatchLogRepository.upsert` captured `status="FAILED"`,
`lastErrorCode="NB_NOVU_TRIGGER_FAILED"`. (The companion test plan's G7 extends this.)

### W2.2 — RestTemplate connect/read timeouts (B3)

**File**: `backend/novu-bridge/src/main/java/org/egov/novubridge/config/MainConfiguration.java`

NOW (whole class body):

```java
@Bean
public RestTemplate restTemplate() {
    return new RestTemplate();
}
```

No timeouts — one hung endpoint (Novu, preference service, MDMS) stalls the `@KafkaListener`
thread indefinitely and triggers max.poll.interval rebalance loops. The old
`novu.bridge.whatsapp.baileys.timeout.ms` was dead config and is already deleted by W1.

AFTER:

```java
@Bean
public RestTemplate restTemplate(
        @Value("${novu.bridge.http.connect.timeout.ms:5000}") int connectTimeoutMs,
        @Value("${novu.bridge.http.read.timeout.ms:10000}") int readTimeoutMs) {
    SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
    f.setConnectTimeout(connectTimeoutMs);
    f.setReadTimeout(readTimeoutMs);
    return new RestTemplate(f);
}
```

(imports: `org.springframework.beans.factory.annotation.Value`,
`org.springframework.http.client.SimpleClientHttpRequestFactory`.)

Add to `backend/novu-bridge/src/main/resources/application.properties`:

```
# Outbound HTTP timeouts — every call runs on the Kafka listener thread; a
# hung endpoint must fail fast instead of stalling the consumer group.
novu.bridge.http.connect.timeout.ms=${NOVU_BRIDGE_HTTP_CONNECT_TIMEOUT_MS:5000}
novu.bridge.http.read.timeout.ms=${NOVU_BRIDGE_HTTP_READ_TIMEOUT_MS:10000}
```

### W2.3 — Channel-appropriate contact filtering, both layers (B6)

**Layer 1 — PGR emission.**
**File**: `backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java`, in
`processConfigDriven()`.

NOW (inside the recipient loop):

```java
if (recipient == null
        || (!StringUtils.hasText(recipient.phone) && !StringUtils.hasText(recipient.email))) {
    log.info("No contact for a {} recipient on complaint {}; skipping", ...);
    continue;
}
```

A phone-only recipient on an EMAIL row still gets an event → the bridge triggers
`complaints-email`, Novu accepts, `nb_dispatch_log` says SENT, and the email step fails invisibly
inside Novu — phantom SENT rows.

AFTER: replace with a per-channel requirement:

```java
if (recipient == null) continue;
boolean hasRequiredContact = "EMAIL".equalsIgnoreCase(channel)
        ? StringUtils.hasText(recipient.email)
        : StringUtils.hasText(recipient.phone);   // SMS + WHATSAPP need a phone
if (!hasRequiredContact) {
    log.info("Recipient {} lacks the contact required for {} on complaint {}; skipping this channel",
            recipient.userUuid, channel, request.getService().getServiceRequestId());
    continue;
}
```

Note: do NOT add this recipient to `emitted` — a later row on a channel they DO have contact for
must still fire (consistent with W2.5).

**Layer 2 — bridge defense** (the bridge consumes a shared topic and must defend independently).
**File**: `DispatchPipelineService.java`, immediately after W1.2's two channel gates and after
`Contact contact = buildContact(event, context);` — add:

```java
boolean hasRequiredContact = "EMAIL".equalsIgnoreCase(channel)
        ? StringUtils.hasText(contact.getEmail())
        : StringUtils.hasText(contact.getPhone());
if (!hasRequiredContact) {
    persist(event, context, "SKIPPED", "NB_CONTACT_MISSING",
            "Recipient has no " + ("EMAIL".equalsIgnoreCase(channel) ? "email" : "phone")
            + " for channel " + channel, null, 1);
    return DispatchResult.builder()
            .valid(true).preferenceAllowed(true).derivedContext(context)
            .novuTriggered(false)
            .diagnostics(Collections.singletonList("Missing contact for channel " + channel))
            .build();
}
```

(This requires moving the `buildContact` call above the delivery try/catch if W2.1 placed it
differently — order in `process()` ends up: validate → derive → preference gate → dry-run →
channel gates (W1.2) → buildContact → contact gate (this step) → delivery try/catch (W2.1).)

Unit tests: in `DispatchPipelinePassThroughTest`, add
`emailEvent_withoutEmail_skippedContactMissing` (EMAIL event, contact.email=null, assert SKIPPED
row + `novuClient` never triggered). In pgr-services'
`NotificationConfigDrivenEmissionTest`, add a case: EMAIL routing row + citizen with phone but no
email → `producer.push` never called for EMAIL (mirror the existing test builders).

### W2.4 — Role-pool pagination, cap+WARN, dedupe, and per-invocation memoization (B5)

**File**: `backend/pgr-services/src/main/java/org/egov/pgr/service/NotificationService.java`

NOW: `resolveUsersByRole(String roleCode, String tenantId, RequestInfo ri)` posts
`{RequestInfo, tenantId, userType:"EMPLOYEE", roleCodes:[roleCode]}` with **no**
pageSize/pageNumber — egov-user caps un-limited searches at its default page size (10 in stock
config), so a 30-holder role pool silently notifies only the first page. The pool is also
re-fetched once per RoutingMatch — a role authored on SMS+WHATSAPP+EMAIL fires three identical
tenant-wide searches per event.

AFTER, three changes:

1. **Config** — add to `backend/pgr-services/src/main/java/org/egov/pgr/config/PGRConfiguration.java`
   (next to the other `pgr.notification.*` values):

```java
@Value("${pgr.notification.rolepool.page.size:100}")
private Integer notificationRolePoolPageSize;

@Value("${pgr.notification.rolepool.max.pages:10}")
private Integer notificationRolePoolMaxPages;
```

   and to `backend/pgr-services/src/main/resources/application.properties`:

```
pgr.notification.rolepool.page.size=100
pgr.notification.rolepool.max.pages=10
```

2. **Pagination loop + dedupe** — in `resolveUsersByRole`, wrap the fetch in a page loop and
   collect into a `LinkedHashMap<String, ResolvedRecipient>` keyed by uuid (drops duplicates
   across pages / data races):

```java
Map<String, ResolvedRecipient> byUuid = new LinkedHashMap<>();
int pageSize = config.getNotificationRolePoolPageSize();
int maxPages = config.getNotificationRolePoolMaxPages();
for (int page = 0; page < maxPages; page++) {
    userSearchRequest.put("pageSize", pageSize);
    userSearchRequest.put("pageNumber", page);
    // ... existing fetchResult + users extraction ...
    if (CollectionUtils.isEmpty(users)) break;
    for (LinkedHashMap<String, Object> raw : users) {
        // existing mapContactUser + contact checks; then:
        if (StringUtils.hasText(u.getUuid())) byUuid.putIfAbsent(u.getUuid(), recipient);
        else out-of-band recipients without uuid: add to a side list as today
    }
    if (users.size() < pageSize) break;               // last page
    if (page == maxPages - 1)
        log.warn("Role pool '{}' in tenant {} exceeds the {}-user notification cap; remaining holders NOT notified",
                roleCode, tenantId, pageSize * maxPages);
}
return new ArrayList<>(byUuid.values());
```

   **Verify against the running egov-user before trusting the loop**: stock egov-user's
   `/user/_search` accepts `pageSize` and `pageNumber` in the request body. Confirm with a
   two-page manual search against a dev stack (or read the egov-user `UserSearchRequest` model in
   the deployed version). If `pageNumber` turns out to be unsupported in the deployed build, fall
   back to a single request with `pageSize = pageSize * maxPages` and keep the WARN when
   `users.size() == pageSize * maxPages`.

3. **Memoization** — in `processConfigDriven()`, before the `for (RoutingMatch match : matches)`
   loop, add `Map<String, List<ResolvedRecipient>> audienceCache = new HashMap<>();` and change
   the resolution call site from `resolveByAudience(audience, match.isAssigneeOnly(), request)`
   to:

```java
String audienceKey = audience.toUpperCase(Locale.ROOT) + "|" + match.isAssigneeOnly();
recipients = audienceCache.computeIfAbsent(audienceKey,
        k -> resolveByAudience(audience, match.isAssigneeOnly(), request));
```

   Keep the existing try/catch semantics: `computeIfAbsent` with a lambda that may throw needs the
   try/catch around it exactly as the current code has around `resolveByAudience` (an exception
   must `continue` to the next match, and must NOT poison the cache — do not cache on exception).
   Simplest correct shape: check `containsKey` first; on miss call inside try/catch and `put` only
   on success.

Unit test (pgr-services, extend `NotificationConfigDrivenEmissionTest` style or a new
`NotificationRolePoolResolutionTest`): stub `serviceRequestRepository.fetchResult` to return a
full page (100 users) then a second page (3 users) → assert 103 events; and a duplicate uuid on
both pages → counted once. The companion test plan's G4 covers the wider resolver-edge matrix.

### W2.5 — Consume the dedupe key only after successful publish (B8)

**File**: `NotificationService.java`, `processConfigDriven()`.

NOW:

```java
String dedupeKey = channel + "|" + recipient.subscriberKey();
if (!emitted.add(dedupeKey)) continue;
try {
    if (!rendered) { body = templateRenderer.render(...); rendered = true; }
    if (body == null) break; // template missing for this (audience,channel): skip whole row
    publishRenderedEvent(request, recipient, channel, eventName, action, toState, body);
} catch (Exception ex) { ... }
```

The key is burned BEFORE render/publish — if the first matching row's template is missing or
publish throws, a LATER routing match (different audience, same channel) that would have
successfully notified the same user is silently skipped.

AFTER:

```java
String dedupeKey = channel + "|" + recipient.subscriberKey();
if (emitted.contains(dedupeKey)) continue;
try {
    if (!rendered) { body = templateRenderer.render(...); rendered = true; }
    if (body == null) break;
    publishRenderedEvent(request, recipient, channel, eventName, action, toState, body);
    emitted.add(dedupeKey);   // only a successful publish consumes the key
} catch (Exception ex) { ... }
```

Note `publishRenderedEvent` returns void and early-returns (without throwing) when
`subscriberKey()` is blank — that early-return also logs a warn; consuming the key in that case
is harmless because the key would be `channel|null`. Leave as-is.

Unit test: in `NotificationConfigDrivenEmissionTest`, add
`missingTemplateOnFirstRow_doesNotBlockSecondRowSameSubscriber`: two routing matches (audiences
A then B, same channel SMS, same single holder), renderer returns null for A's template and a
body for B's → exactly one `producer.push`.

### W2.6 — `formatCreatedDate` epoch heuristic (B14)

**File**: `NotificationService.java`. There are TWO occurrences of the broken heuristic — one in
`formatCreatedDate(...)` (used by the config-driven path) and one earlier in the legacy path
(~line 525). Both read:

```java
Instant.ofEpochMilli(t > 10 ? t : t * 1000)
```

(variable named `createdTime` at the legacy site). The threshold `10` is meaningless: any
epoch-seconds value is `> 10` and gets treated as millis, yielding a 1970 date.

AFTER (both sites):

```java
Instant.ofEpochMilli(t > 1_000_000_000_000L ? t : t * 1000)
```

(values above ~Sep 2001 in millis are treated as millis; anything smaller as seconds).

### W2.7 — Splitter: skip+WARN on malformed authoring rows (B15)

**File**: `utilities/default-data-handler/src/main/java/org/egov/handler/service/DataHandlerService.java`

NOW: `emitNotificationRouting(...)` builds
`String uniqueIdentifier = String.join(".", PGR_BUSINESS_SERVICE, action, toState, audience, channel);`
from values obtained with `.asText(null)` — a notification missing `audience`/`channel`, or an
action missing `nextState` (→ `toState` null), throws NPE inside `String.join`. Likewise
`emitNotificationTemplates(...)` joins `audience, action, toState, channel, locale`. And
`createPgrWorkflowConfig` catches ONLY `IOException` (with the rethrow commented out), so the NPE
propagates raw out of tenant setup AFTER the workflow was already POSTed.

AFTER:

1. In `emitNotificationRouting`, right after the four `asText(null)` reads, add:

```java
if (action == null || toState == null || audience == null || channel == null) {
    log.warn("Skipping malformed notification routing row (action={}, toState={}, audience={}, channel={}) — all four are required",
            action, toState, audience, channel);
    continue;
}
```

2. In `emitNotificationTemplates`, after reading `audience/action/toState` add the same guard for
   those three (`continue` the outer loop), and inside the bodies loop after reading
   `channel/locale` add a guard for those two plus a non-null `body.path("body").asText(null)`
   (`continue` the inner loop). Same WARN pattern.
3. In `createPgrWorkflowConfig`, add a second catch AFTER the `IOException` catch:

```java
} catch (RuntimeException e) {
    log.error("PGR workflow/notification seed emission failed part-way for tenant {} — "
            + "workflow may already be POSTed; MDMS emission is idempotent and safe to re-run",
            targetTenantId, e);
}
```

   (Do not rethrow — matches the existing swallow-and-log posture of this method; the emission is
   idempotent and re-runnable.)

Test: this workstream ships the guard; the full splitter golden round-trip is the companion test
plan's G1 (P0 there). Minimal check here: `cd utilities/default-data-handler && mvn -q test`
(contextLoads still passes) and `mvn -q -DskipTests compile`.

### W2.8 — fromState: make the non-enforcement loud (B19, partial)

**File**: `backend/pgr-services/src/main/java/org/egov/pgr/service/notification/NotificationRouter.java`

NOW: the class Javadoc already says `fromState is documentation-only and optional: ... (the Kafka
consumer path doesn't carry fromState — risk R1)`, and `route(...)` filters:

```java
Object rowFrom = row.get("fromState");
// fromState optional: match when the row leaves it blank OR it equals the request's.
if (rowFrom != null && StringUtils.hasText(fromState)
        && !fromState.equalsIgnoreCase(rowFrom.toString())) continue;
```

`processConfigDriven()` always passes `fromState=null`, so an authored fromState is silently
ignored — a support trap (config that looks enforceable but isn't).

AFTER: directly after the `rowFrom` read, add a one-time-per-row WARN when the constraint cannot
be enforced:

```java
if (rowFrom != null && !rowFrom.toString().isBlank() && !StringUtils.hasText(fromState)) {
    log.warn("NotificationRouting row {}.{}.{} authors fromState='{}' but the runtime path does not "
            + "supply fromState — the row matches EVERY transition into toState. Clear fromState "
            + "or wait for fromState support.", businessService, action, toState, rowFrom);
}
```

Full enforcement (resolving fromState from the workflow ProcessInstance) is **deferred** — it
adds a workflow query per event and the schema/configurator currently always author
`fromState: null` (see W5.6 which also labels the field in the descriptor help). Unit test: add
one case to `NotificationRouterTest` asserting the row still matches (behavior pinned) — the WARN
itself needs no assertion.

### W2.9 — Document the single-locale limitation (B9)

**File**: `NotificationService.java`, on `processConfigDriven()`.

NOW the method silently renders everything with `String locale = config.getNotificationDefaultLocale();`
and every `ResolvedRecipient.locale` is the same default.

AFTER: add to the method's Javadoc (create one if absent):

```java
/**
 * ...
 * KNOWN LIMITATION (accepted for the single-locale pilot): rendering uses the
 * instance default locale (pgr.notification.default.locale) for every
 * recipient. The NotificationTemplate `locale` dimension and Contact.locale
 * are carried but not yet resolved per recipient. Per-recipient localization
 * requires resolving a real user locale and rendering per (audience, channel,
 * locale) group — tracked in the design doc's open items.
 */
```

No behavior change. Per-recipient locale resolution is **deferred** (companion test plan G20
pins it when built).

### W2 gate

```bash
cd backend/novu-bridge && mvn -q test
cd ../pgr-services && mvn -q test \
  -Dtest='NotificationRouterTest,TemplateRendererTest,NotificationConfigDrivenEmissionTest,NotificationGoldenOutputTest,NotificationRolePoolResolutionTest'
cd ../pgr-services && mvn -q test                          # full suite too
cd ../../utilities/default-data-handler && mvn -q test
```

All green, including the new tests from W2.1/W2.3/W2.4/W2.5.

---

## W3 — Proxy hardening + shipped route

**Closes**: B4 (unauthenticated proxy + missing route), C5 (client-side-only masking + false JWT
claims), B13 (denylist redaction → allowlist), B18 (PII at INFO), C11 (dead route constant).

### W3.1 — Server-side auth on `/novu-adapter/v1/*` GETs

**Mechanism** (concrete, available in this stack): DIGIT access tokens are opaque OAuth tokens
minted by egov-user; the standard introspection endpoint is **`POST /user/_details?access_token=<token>`**
on egov-user (verified present in the deployed egov-user: `UserController` has
`@PostMapping("/_details")`). It returns the authenticated user with roles for a valid token and
a 401 for an invalid one. novu-bridge already has the user-service host configured
(`novu.bridge.user.host`, wired in compose as `NOVU_BRIDGE_USER_HOST: http://egov-user:8107`).
The configurator ALREADY sends `Authorization: Bearer <token>` on these calls
(`configurator/packages/data-provider/src/providers/dataProvider.ts`, the `customFetchList`
helper: `if (token) headers['Authorization'] = `Bearer ${token}`;`) — so no UI change is needed.

**New file**: `backend/novu-bridge/src/main/java/org/egov/novubridge/web/filters/ProxyAuthFilter.java`

A `org.springframework.web.filter.OncePerRequestFilter`:

- `shouldNotFilter`: return true unless the request path (within the servlet context) starts with
  `/novu-adapter/v1/logs` or `/novu-adapter/v1/integrations`, or if the method is `OPTIONS`
  (CORS preflight must pass).
- `doFilterInternal`:
  1. If `novu.bridge.proxy.auth.enabled` is false → pass through (escape hatch for local dev).
  2. Read `Authorization` header; require `Bearer <token>` → else respond
     `401 {"error":"missing bearer token"}` (set `application/json`).
  3. `POST {userHost}{novu.bridge.user.details.path}?access_token=<token>` with an empty JSON
     body via the shared `RestTemplate`. Non-2xx or exception → 401.
  4. Parse the response body; the authenticated user object carries `type` and `roles[]` (each
     with a `code`). Allow when `type == "EMPLOYEE"` AND at least one role code is in the
     configured allowlist → else 403.
  5. Cache successful validations in a `ConcurrentHashMap<tokenHash, expiryMillis>` with a 60s
     TTL so the Logs screen's polling doesn't hammer egov-user (hash the token —
     `sha256`/`Objects.hash` — never store it raw).

**Config** — add to `NovuBridgeConfiguration.java` + `application.properties`:

```
novu.bridge.proxy.auth.enabled=${NOVU_BRIDGE_PROXY_AUTH_ENABLED:true}
novu.bridge.user.details.path=${NOVU_BRIDGE_USER_DETAILS_PATH:/user/_details}
novu.bridge.proxy.allowed.roles=${NOVU_BRIDGE_PROXY_ALLOWED_ROLES:EMPLOYEE,SUPERUSER,GRO,PGR_LME}
```

(the roles list is the EMPLOYEE/ADMIN-shaped gate the review asked for; tenants can tighten it).

Register the filter in `MainConfiguration.java` with a `FilterRegistrationBean<ProxyAuthFilter>`
and `addUrlPatterns("/novu-adapter/v1/*")` — remember the servlet context path `/novu-bridge` is
NOT part of the pattern. The POST diagnostics under the same namespace
(`DispatchController`: `_validate`, `_dry-run`, `_test-trigger`) get gated by the same pattern —
that is intended (they can leak subscriber info); they are additionally NOT routed publicly
(W3.4 routes only the two GET paths).

Unit test: `backend/novu-bridge/src/test/java/org/egov/novubridge/web/filters/ProxyAuthFilterTest.java`
— plain JUnit with `MockHttpServletRequest/Response`: (a) no header → 401, filter chain not
invoked; (b) mocked RestTemplate returning a valid EMPLOYEE-with-allowed-role body → chain
invoked; (c) valid token but roles disjoint from allowlist → 403; (d) egov-user 401 → 401.

### W3.2 — Server-side recipient masking in the /logs response

**File**: `backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/DispatchLogController.java`

NOW: `logs(...)` returns `DispatchLogEntry` rows verbatim. `recipient_value` is the subscriberId —
`tenantId:userUuid` normally, but it **falls back to `tenantId:mobile`** when the uuid was missing
(see `NotificationService.ResolvedRecipient.subscriberKey()`), and `transaction_id` embeds the
same subscriberId. The configurator masks client-side only
(`NotificationLogList.tsx` `maskRecipient()`), which is false comfort — the raw value still
crosses the wire.

AFTER: mask on the server so the full value never reaches the browser. In the controller, after
fetching `data` and before building the response, map each entry:

```java
List<DispatchLogEntry> masked = data.stream()
        .map(e -> e.toBuilder()
                .recipientValue(PiiMask.mask(e.getRecipientValue()))
                .transactionId(PiiMask.maskEmbedded(e.getTransactionId()))
                .build())
        .collect(Collectors.toList());
```

(`DispatchLogEntry` is a Lombok builder model — add `@Builder(toBuilder = true)` if `toBuilder`
isn't already enabled; check the class first.)

**New file**: `backend/novu-bridge/src/main/java/org/egov/novubridge/util/PiiMask.java` with two
static methods, mirroring the UI's masking rules so operators see identical shapes:

- `mask(String v)`: null-safe. If the value contains `@` → keep first char of the local part +
  `***@` + domain. Else replace every run of **7+ digits** with `***` + its last 3 digits
  (regex `(\d{4,})(\d{3})` applied to runs of `\d{7,}`). UUIDs (hex + dashes, digit runs < 7)
  pass through untouched — they are not PII.
- `maskEmbedded(String v)`: apply the same digit-run/email rules to an arbitrary string (covers
  `complaintId:action:toState:tenant:mobile:channel` transaction ids where the subscriber
  segment is a phone).

Unit test `PiiMaskTest`: phone-bearing subscriberId `tenant.city:0712345678` →
`tenant.city:***678`; uuid subscriberId unchanged; email → `c***@example.org`; transactionId with
embedded phone masked; null → null.

Keep the client-side `maskRecipient()` in `NotificationLogList.tsx` as defense-in-depth; add a
comment there pointing at the server-side mask:
`// Server also masks recipient_value/transaction_id (novu-bridge PiiMask) — this is defense-in-depth for older bridges.`

### W3.3 — Allowlist redaction on /integrations (B13)

**File**: `backend/novu-bridge/src/main/java/org/egov/novubridge/web/controllers/IntegrationController.java`

NOW: `redactCredentials()` deep-copies the Novu integration objects and masks every value nested
under any `credentials` key — correct for Novu v2.3.0's schema but denylist-by-location: a
secret stored OUTSIDE a `credentials` key, or a `credentials` list, would pass through unmasked.

AFTER: replace the redaction with an **allowlist projection** — for each integration object,
build a fresh map containing ONLY: `_id`, `providerId`, `channel`, `name`, `identifier`,
`active`, `primary`, `environmentId` (read the current response-building code to match the actual
key names Novu returns; drop any of these that don't exist rather than inventing them). Nothing
else — in particular no `credentials` key at all, masked or otherwise. Update the class Javadoc
paragraph `<p><b>Secrets stay server-side.</b>` to describe the allowlist. Keep/adjust any
existing unit coverage; the endpoint-contract test is the companion plan's G10.

Check first: `grep -rn "providerId\|channel\|active" configurator/src/resources/notification-providers/`
to confirm the Providers screen reads only allowlisted fields; if it renders anything beyond the
list above, add that (non-secret) field to the allowlist instead of breaking the screen.

### W3.4 — Ship the Kong route declaratively (B4 part 2)

**File**: `local-setup/kong/kong.yml`

NOW: no `novu-bridge` service/route exists — and the host-nginx template's catch-all
`location / { proxy_pass ...kong... }` forwards unmatched paths to Kong, so on a stock deploy the
configurator's Logs/Providers screens 404 at Kong. (This one file is mounted read-only into the
Kong container by every compose variant — `docker-compose.egov-digit.yaml`,
`docker-compose.deploy.yaml`, `docker-compose.yml`, `docker-compose.registry.yml`,
`docker-compose.db-migrations.yml` — so a single edit ships everywhere.)

AFTER: append alongside the other service entries (e.g. after the `pgr-service` block), routing
ONLY the two read-only GETs (the POST diagnostics stay unrouted on purpose):

```yaml
- name: novu-bridge-proxy
  url: http://novu-bridge:8080
  routes:
  - name: novu-bridge-logs-route
    methods:
    - GET
    paths:
    - /novu-bridge/novu-adapter/v1/logs
    strip_path: false
  - name: novu-bridge-integrations-route
    methods:
    - GET
    paths:
    - /novu-bridge/novu-adapter/v1/integrations
    strip_path: false
```

(The novu-bridge container listens on 8080 with servlet context `/novu-bridge` — its own
healthcheck hits `http://127.0.0.1:8080/novu-bridge/health` — so `strip_path: false` with the
context-path-prefixed route path is correct. Auth happens **inside** novu-bridge via W3.1's
filter; Kong stays a dumb router here, consistent with every other route in this file. Note the
`novu-bridge` service is profile-gated under `notifications` — when the profile is off, Kong
returns 503 for these paths instead of 404, which is acceptable and honest.)

**File**: `local-setup/ansible/templates/nginx-site.conf.j2`

NOW: a comment block starting `# novu-bridge REST endpoints (diagnostics: _validate, _dry-run,`
says the bridge is NOT exposed and tells operators to add a `location /novu-bridge/` block for
public access. That advice is now wrong twice over (the catch-all already forwards to Kong; and
hand-wiring an unauthenticated proxy is exactly what W3 forbids).

AFTER: replace the comment block with:

```
# novu-bridge: the read-only configurator proxy endpoints
# (GET /novu-bridge/novu-adapter/v1/logs|integrations) are routed by Kong
# (see local-setup/kong/kong.yml) and auth-gated INSIDE novu-bridge by
# validating the DIGIT bearer token against egov-user /user/_details.
# The POST diagnostic endpoints (_validate/_dry-run/_test-trigger) are
# deliberately NOT routed publicly. Do NOT hand-wire an unauthenticated
# location block for them.
```

### W3.5 — Fix the false "JWT-gated" comments + dead constant (C5 comments, C11)

1. **File**: `configurator/src/api/config.ts`
   NOW (lines ~10-21): a comment claiming the route is `gated by the same DIGIT JWT the SPA
   already sends`, plus `NOVU_BRIDGE_BASE_PATH` and `getNovuBridgeBaseUrl()` which grep shows
   have **no consumer** (the registry hardcodes its own copies).
   AFTER: delete the whole block (constant + function + comment). The single source of truth is
   the registry (next item).
2. **File**: `configurator/packages/data-provider/src/providers/resourceRegistry.ts`
   NOW: the `customPath` doc-comment (~line 27) and the notification-log/provider entry comments
   (~lines 166-167) repeat the JWT-gating claim.
   AFTER: reword to the real posture, e.g.:
   `// Routed by Kong (local-setup/kong/kong.yml); novu-bridge validates the Bearer token
   server-side against egov-user /user/_details and masks recipient PII in responses.`
   Do not change the `customPath` values themselves.
   Note: `packages/data-provider/dist/` contains build output mirroring these comments — run the
   package build if it has one (`cd configurator/packages/data-provider && npm run build` if a
   build script exists) or leave dist alone if it is regenerated by the app build; do not
   hand-edit dist files.

### W3.6 — Mask PII in log statements; drop DEBUG default (B18)

Reuse W3.2's `PiiMask` (novu-bridge) and add a tiny equivalent private helper in pgr-services.

1. `backend/novu-bridge/.../DispatchPipelineService.java`: the `Derived context:` log line
   currently prints `recipientPhone={}, email={}` raw (`context.getRecipientMobile(), context.getEmail()`)
   → wrap both with `PiiMask.mask(...)`. Grep the module for other raw prints:
   `grep -rn "Mobile\|phone\|getEmail" backend/novu-bridge/src/main/java --include='*.java' | grep "log\."`
   and wrap each (`PreferenceServiceClient`, `NovuClient` channel-phone logs, `UserServiceClient`
   mobile warn).
2. `backend/pgr-services/.../NotificationService.java`: `publishRenderedEvent`'s
   `log.info("Published config-driven {} notification: complaint={} subscriber={} txn={}", ...)`
   prints `subscriberId` and `transactionId`, both of which can embed a raw mobile when the uuid
   was missing → mask both with a private `maskPii(String)` helper implementing the same
   7+-digit-run rule as `PiiMask` (don't create a cross-module dependency for one method).
3. `backend/novu-bridge/src/main/resources/application.properties`
   NOW:

   ```
   logging.level.org.egov.novubridge=DEBUG
   logging.level.org.egov.novubridge.service.DispatchPipelineService=DEBUG
   ```

   AFTER: both to `INFO` (env-overridable if you want:
   `logging.level.org.egov.novubridge=${NOVU_BRIDGE_LOG_LEVEL:INFO}`).

### W3 gate

```bash
cd backend/novu-bridge && mvn -q test          # incl. ProxyAuthFilterTest + PiiMaskTest
cd ../pgr-services && mvn -q test
cd ../../configurator && npm run build         # tsc -b + vite, must be clean
docker compose -f local-setup/docker-compose.egov-digit.yaml config -q
# Optional live check on a dev stack (requires the notifications profile up):
#   curl -s -o /dev/null -w '%{http_code}' 'http://localhost:<kong-port>/novu-bridge/novu-adapter/v1/logs?tenantId=pg'
#   → 401 without a token; 200 with a valid EMPLOYEE token; recipient_value masked in the body.
```

---

## W4 — MDMS notification-cache TTL (pgr-services)

**Closes**: B7 (no TTL/invalidation + false "fall back to legacy" comment).

### W4.1 — TTL on the two notification caches

**File**: `backend/pgr-services/src/main/java/org/egov/pgr/util/MDMSUtils.java`

NOW:

```java
private final Map<String, List<Object>> notificationRoutingCache = new ConcurrentHashMap<>();
private final Map<String, List<Object>> notificationTemplateCache = new ConcurrentHashMap<>();
```

with `getNotificationRouting`/`getNotificationTemplates` doing get-or-fetch and caching non-empty
results **forever** — so configurator edits to NotificationRouting/NotificationTemplate are
invisible until a pgr-services restart, defeating the whole point of live authoring.

AFTER — a 60-second TTL (the bridge already uses the same TTL pattern for subscriber identify):

1. Add config. `PGRConfiguration.java`:

```java
@Value("${pgr.notification.mdms.cache.ttl.ms:60000}")
private Long notificationMdmsCacheTtlMs;
```

   `application.properties`:

```
# Configurator edits to NotificationRouting/NotificationTemplate become
# visible within this window — no restart needed.
pgr.notification.mdms.cache.ttl.ms=60000
```

2. Replace the cache value type with a timestamped entry:

```java
private static final class TimedRows {
    final List<Object> rows;
    final long fetchedAt;
    TimedRows(List<Object> rows) { this.rows = rows; this.fetchedAt = System.currentTimeMillis(); }
    boolean fresh(long ttlMs) { return System.currentTimeMillis() - fetchedAt < ttlMs; }
}
private final Map<String, TimedRows> notificationRoutingCache = new ConcurrentHashMap<>();
private final Map<String, TimedRows> notificationTemplateCache = new ConcurrentHashMap<>();
```

3. Rewrite both getters identically (shown for routing):

```java
public List<Object> getNotificationRouting(String tenantId) {
    String stateTenant = multiStateInstanceUtil.getStateLevelTenant(tenantId);
    long ttl = config.getNotificationMdmsCacheTtlMs();
    TimedRows cached = notificationRoutingCache.get(stateTenant);
    if (cached != null && cached.fresh(ttl)) return cached.rows;
    List<Object> fetched = fetchNotificationMaster(stateTenant,
            MDMS_NOTIFICATION_ROUTING_MASTER, MDMS_NOTIFICATION_ROUTING_JSONPATH);
    if (!fetched.isEmpty()) {
        notificationRoutingCache.put(stateTenant, new TimedRows(fetched));
        return fetched;
    }
    // Empty fetch = transient MDMS miss OR genuinely unseeded tenant. Never
    // cache empties (retry next event); serve a stale non-empty entry if we
    // have one rather than dropping notifications during an MDMS blip.
    return cached != null ? cached.rows : fetched;
}
```

   (The stale-serve branch is deliberate: a fetch failure during an MDMS outage keeps
   notifications flowing with the last-known config instead of dropping them.)

4. Update the field comment block (currently says `Edits in MDMS still need a pgr-services
   restart to refresh.`) to describe the TTL + stale-serve semantics.

### W4.2 — Correct the false-fallback error message (B7 second half)

Same file, `fetchNotificationMaster` NOW logs on exception:

```java
log.error("Failed to load notification master {} for tenant {}; config-driven notifications "
        + "will fall back to legacy for this tenant", masterName, stateTenant, e);
```

That claim is **false**: with `pgr.notification.config.driven=true` the legacy path never runs
AND `ComplaintDomainEventService` suppresses the coarse stakeholders[] event, so an MDMS outage
(or unseeded tenant) means the event is consumed and ALL notifications are silently dropped.

AFTER:

```java
log.error("Failed to load notification master {} for tenant {} — there is NO legacy fallback "
        + "when pgr.notification.config.driven=true: notifications for this tenant will be "
        + "DROPPED (or served from a stale cache entry) until MDMS recovers or the tenant is seeded",
        masterName, stateTenant, e);
```

Also update the identical claim in the Javadoc of `getNotificationRouting`
(`Returns an empty list (never null) on MDMS failure so callers fall back to the legacy hardcoded
path.` → `Returns an empty list (never null) on MDMS failure; callers DROP the event's
notifications in that case — there is no legacy fallback when the config-driven flag is on.`).

### W4.3 — Cache-semantics unit test

**New file**: `backend/pgr-services/src/test/java/org/egov/pgr/util/MDMSUtilsNotificationCacheTest.java`

Mockito over `MDMSUtils` with mocked `ServiceRequestRepository` + `MultiStateInstanceUtil`
(identity state-tenant) + a `PGRConfiguration` stub returning a small TTL. Cases:

1. `nonEmptyResult_isCached_withinTtl` — two calls inside the TTL → `fetchResult` invoked once.
2. `emptyResult_isNotCached_retriesNextCall` — MDMS returns empty twice → `fetchResult` invoked
   twice.
3. `ttlExpiry_refetches_andServesNewRows` — TTL of e.g. 50ms, first call returns rows A, sleep
   80ms (or inject a clock if you prefer — a `Thread.sleep` under 100ms is acceptable here),
   second call returns rows B → caller sees B.
4. `fetchFailureAfterTtl_servesStaleRows` — first call rows A; after TTL the mock throws → caller
   still gets A (stale-serve), no exception.

Mock shape: `serviceRequestRepository.fetchResult(any(), any(MdmsCriteriaReq.class))` returning a
map that the configured JSONPath (`MDMS_NOTIFICATION_ROUTING_JSONPATH`) extracts rows from — copy
the response-shape setup from however `NotificationRouterTest` stubs `MDMSUtils` inputs, or build
the raw `{"mdms":[{"data":{...}}]}` map to satisfy the JsonPath. Read the constants in
`backend/pgr-services/src/main/java/org/egov/pgr/util/PGRConstants.java` for the exact JSONPath
before writing the stub.

### W4 gate

```bash
cd backend/pgr-services && mvn -q test -Dtest=MDMSUtilsNotificationCacheTest
cd backend/pgr-services && mvn -q test    # full suite still green
```

Operational note for the PR description: with the TTL, a configurator edit takes effect within
60s with no restart — closing the operator-facing half of finding B7. (The companion test plan's
G12 references these same cases.)

---

## W5 — Configurator write-path fixes (contains THE BLOCKER)

**Closes**: C1 (blocker: fire-and-forget writes), C2 (duplicate/partial-write), C3 (edit-with-key-
change doubles the notification), C4 (remove-then-re-add permanently broken), C9 (stale help /
assigneeOnly note), C10 (committed artifacts), C12 partial (dead `q` input), C5 note (client-side
masking comment — the real fix is W3.2).

All component work is in
`configurator/src/resources/notification-configure/NotificationConfigure.tsx`; provider work is in
`configurator/packages/data-provider/`.

### W5.1 — Make every mutation actually awaited (C1 — BLOCKER)

NOW: `NotificationForm` declares

```tsx
const [create] = useCreate();
const [update] = useUpdate();
```

and `TransitionRow` declares `const [deleteOne] = useDelete();`, then `save()` / `remove()` do
`await create('notification-routing', {...})` etc. In ra-core 5.14.5, without
`{ returnPromise: true }` the mutation callable returns react-query's fire-and-forget `mutate`
(void, never rejects): every `await` resolves immediately, the routing/template writes are not
sequenced, all `try/catch` here is dead code, and the success toasts fire even when the MDMS
write failed.

AFTER: pass `{ returnPromise: true }` as the **call-time third argument** on every mutation call
in this file (the mode is already pessimistic, so no react-admin warning fires):

- in `save()`:
  - `await update('notification-routing', { id: seed.routingId, data: routingData, previousData: {} }, { returnPromise: true });`
  - `await create('notification-routing', { data: routingData }, { returnPromise: true });`
  - `await update('notification-template', { id: seed.templateId, data: templateData, previousData: {} }, { returnPromise: true });`
  - `await create('notification-template', { data: templateData }, { returnPromise: true });`
- in `remove()`:
  - `await deleteOne('notification-routing', { id: r.id, previousData: r }, { returnPromise: true });`
  - `await deleteOne('notification-template', { id: t.id, previousData: t }, { returnPromise: true });`

With real promises, the existing `catch (err) { notify('Save failed: ...') }` blocks come alive
unchanged. Sanity-check there are no other `create(`/`update(`/`deleteOne(` call sites in this
file (`grep -n "await create\|await update\|await deleteOne" NotificationConfigure.tsx`).

### W5.2 — Make MDMS phantom-200 an explicit error (C2 prerequisite)

**File**: `configurator/packages/data-provider/src/client/DigitApiClient.ts`

NOW: `mdmsCreate(...)` ends with `return (data.mdms || [])[0] as MdmsRecord;` — MDMS v2 returns
HTTP 200 with an **empty** `mdms` array for duplicate creates (known phantom-200 behavior), so
this returns `undefined`, and `normalizeMdmsRecord` (`dataProvider.ts`: `let data = mdms.data || {};`)
throws a TypeError that the (previously dead) catch swallowed.

AFTER:

```ts
const record = (data.mdms || [])[0] as MdmsRecord | undefined;
if (!record) {
  // MDMS v2 "phantom 200": duplicate creates return 200 with an empty mdms
  // array. Surface it as a typed, matchable error instead of undefined.
  throw new Error(`MDMS_DUPLICATE: create for '${uniqueIdentifier}' returned no record — a record with this uniqueIdentifier already exists (possibly inactive).`);
}
return record;
```

Keep the `MDMS_DUPLICATE:` prefix stable — W5.3 string-matches it.

### W5.3 — Add-path: update-or-reactivate on duplicate; template-first ordering (C2 + C4)

Two provider changes, then the component change.

**(a) Provider: allow updating an inactive row.**
**File**: `configurator/packages/data-provider/src/providers/dataProvider.ts`, `update()` mdms
branch.

NOW:

```ts
const records = await client.mdmsSearch(tenantId, config.schema!, { uniqueIdentifiers: [String(params.id)] });
const existing = records.find((r) => r.isActive);
if (!existing) throw new Error(`Record not found: ${params.id}`);
```

An inactive (soft-deleted) row can never be resurrected through the UI — and `delete()` in the
same file soft-deletes via `client.mdmsUpdate(existing, false)`, leaving the uniqueIdentifier
occupied. That is why Remove → re-Add is permanently broken today.

AFTER: honor an opt-in meta flag:

```ts
const includeInactive = Boolean((params.meta as { includeInactive?: boolean } | undefined)?.includeInactive);
const existing = records.find((r) => r.isActive) ?? (includeInactive ? records[0] : undefined);
if (!existing) throw new Error(`Record not found: ${params.id}`);
```

and make sure the subsequent `client.mdmsUpdate(existing, true)` call passes `isActive: true`
(read the rest of the branch: it strips `_*` metadata into `existing.data` then calls
`mdmsUpdate`; confirm the second argument is `true` — if the branch currently preserves the old
active flag, force `true` when `includeInactive` is set: reactivation is the point).

**(b) Component: dedupe-aware Add with template-first ordering.**
**File**: `NotificationConfigure.tsx`, `NotificationForm.save()`.

The uid schemes are deterministic and derivable client-side (they mirror the server's x-unique
derivation, documented in this file's header comment):

- routing uid: `${businessService}.${action}.${toState}.${audience}.${channel}`
- template uid: `${audience}.${action}.${toState}.${channel}.${locale}`

Replace the create-or-update block (currently: routing write first, then template write) with:

```tsx
const routingUid = [ctx.businessService, ctx.action, ctx.toState, audience, channel].join('.');
const templateUid = [audience, ctx.action, ctx.toState, channel, DEFAULT_LOCALE].join('.');

/** create → on MDMS_DUPLICATE fall back to update-with-reactivation. */
const upsert = async (resource: string, uid: string, data: Record<string, unknown>) => {
  try {
    await create(resource, { data }, { returnPromise: true });
  } catch (err) {
    if (String((err as Error)?.message ?? '').includes('MDMS_DUPLICATE')) {
      await update(resource, { id: uid, data, previousData: {}, meta: { includeInactive: true } },
        { returnPromise: true });
    } else {
      throw err;
    }
  }
};

if (isEdit && seed?.routingId && seed?.templateId && keyUnchanged(seed, audience, channel)) {
  // In-place edit, key unchanged: plain updates as today (with returnPromise).
  await update('notification-template', { id: seed.templateId, data: templateData, previousData: {} }, { returnPromise: true });
  await update('notification-routing', { id: seed.routingId, data: routingData, previousData: {} }, { returnPromise: true });
} else {
  // TEMPLATE FIRST: an orphan template (R5 warn) is harmless; an active
  // routing row without a template is a live misfire (R2 error). If the
  // routing write fails after the template landed, the operator retries and
  // upsert() resolves the duplicate.
  await upsert('notification-template', templateUid, templateData);
  await upsert('notification-routing', routingUid, routingData);
  // ... W5.4 old-pair deactivation goes here ...
}
```

If the second write throws, the existing catch now (post-W5.1) shows
`Save failed: ...` — tell the operator what happened by extending that message:

```tsx
notify(`Save failed: ${(err as Error)?.message ?? 'unknown error'} — if the template was saved but routing failed, click Save again to complete the pair.`, { type: 'error' });
```

This closes both C2 modes: (1) partial write is recoverable-by-retry with an honest error instead
of a silent half-pair; (2) duplicate Add (the natural "change the message" gesture, or re-Add
after Remove) lands as an update/reactivation instead of a swallowed TypeError with a lying
success toast. And it closes C4: the reactivation branch (`meta.includeInactive` + isActive=true)
resurrects the soft-deleted row that shares the uid.

### W5.4 — Edit that changes the key deactivates the old pair (C3)

Same `save()`, in the create/upsert branch. NOW the comment says
`We update when the key is unchanged (same id derives), else create the new pair.` — but the old
pair stays ACTIVE, so the "edited" notification fires twice at runtime.

AFTER: `NotificationForm` needs delete capability — add `const [deleteOne] = useDelete();` next
to the existing hooks (import `useDelete` from the same ra-core import block at the top of the
file — `useGetList` etc. are already imported there). Then, after the two `upsert` calls, when
this was an edit whose key changed:

```tsx
if (isEdit && !keyUnchanged(seed!, audience, channel)) {
  // The old (audience, channel) pair must stop firing — otherwise the "edit"
  // doubled the notification.
  if (seed?.routingId) {
    await deleteOne('notification-routing', { id: seed.routingId, previousData: {} }, { returnPromise: true });
  }
  if (seed?.templateId) {
    try {
      await deleteOne('notification-template', { id: seed.templateId, previousData: {} }, { returnPromise: true });
    } catch {
      /* old template may be shared/absent — routing deactivation already stops the send */
    }
  }
}
```

(Ordering: deactivate AFTER the new pair is fully written, so a mid-flight failure leaves the old
behavior intact rather than no notification at all.)

### W5.5 — Component-level regression tests

**New file**: `configurator/src/resources/notification-configure/notificationWritePath.test.ts`

The write logic above is testable without rendering: extract the `upsert` helper and the
save-orchestration into a small pure module if that keeps the test simple, OR test at the
provider level. Minimum vitest cases (mock `create`/`update`/`deleteOne` as vi.fn returning
promises):

1. duplicate create (`MDMS_DUPLICATE` rejection) → update called with
   `meta: { includeInactive: true }` and the derived uid.
2. template write succeeds + routing write rejects → the error propagates (no success path).
3. key-changed edit → old routingId and templateId each deleted after the new pair writes.
4. non-duplicate create error → rethrown (not converted to update).

Also add one provider test in `configurator/packages/data-provider` (next to existing tests, if
`DigitApiClient.test.ts` has a harness): `mdmsCreate` with a `{ mdms: [] }` response → throws an
error whose message contains `MDMS_DUPLICATE`. The full UI flow (G9) belongs to the companion
test plan.

### W5.6 — Descriptor help text; assigneeOnly + fromState notes (C9, B19 tie-in)

1. **File**: `configurator/src/admin/schemaDescriptors/notification-routing.ts`
   NOW (~line 24): audience help says `'CITIZEN or EMPLOYEE'` — contradicting the headline
   feature (audience = ANY workflow role code).
   AFTER: `'CITIZEN (the complaint filer), any workflow role code (e.g. GRO, PGR_LME) to notify
   every holder, or EMPLOYEE (legacy alias for the current assignee).'`
   Also find the `fromState` field descriptor in the same file and append to its help:
   `'Not currently enforced at runtime — a value here matches EVERY transition into toState.
   Leave blank.'`
   `assigneeOnly`: the schema supports it but no UI surface sets it (NotificationConfigure
   hardcodes `assigneeOnly: false`). Do NOT build the control in this plan — add a code comment
   at the hardcoded line in `NotificationConfigure.tsx`:
   `// assigneeOnly is schema-supported but deliberately not exposed here yet — see the findings-closure plan (C9, deferred).`
2. **File**: `configurator/src/admin/schemaDescriptors/notification-template.ts`
   NOW (~line 18): same stale `'CITIZEN or EMPLOYEE'` phrasing → same replacement as above.

### W5.7 — Repo hygiene: committed artifacts + dead `q` input (C10, C12 partial)

1. Remove the generated files and ignore them:

```bash
git rm configurator/e2e/report/index.html \
       configurator/e2e/results/.last-run.json \
       configurator/scripts/i18n-missing.json
```

   Add to `configurator/.gitignore` (create the entries if absent):

```
e2e/report/
e2e/results/
scripts/i18n-missing.json
```

2. **File**: `configurator/src/resources/notification-logs/NotificationLogList.tsx`
   NOW: the filter array includes `<SearchFilterInput key="q" source="q" alwaysOn />` and a code
   comment admits the dataProvider drops `q` for this resource — a dead field operators type
   into.
   AFTER: delete that filter entry (the `referenceNumber` filter is the real search). Leave the
   rest of the filters unchanged.
3. Add the defense-in-depth comment to `maskRecipient()` per W3.2's last paragraph (skip if W3
   already added it).

### W5 gate

```bash
cd configurator && npm run build     # tsc -b + vite build, clean
cd configurator && npm run test      # vitest: existing 11 validateNotifications tests + new write-path tests
cd configurator/packages/data-provider && npm test 2>/dev/null || true   # run if the package has a test script
```

Manual smoke (dev stack with the notifications profile): on a PGR transition row —
Add a CITIZEN·SMS notification (both rows created, success toast only on success), Add the SAME
key again with a new body (update path, body actually changes), Remove it, Add it again
(reactivation path works), Edit it to CITIZEN·EMAIL (old SMS pair deactivated — only one chip
remains after refresh, and only EMAIL fires on the next transition).

---

## WONTFIX / explicitly deferred findings

| Finding | Severity | Disposition | Reason (one line) |
|---------|----------|-------------|-------------------|
| B9 per-recipient localization not implemented | minor | **DEFER** (documented in W2.9) | Single-locale pilot renders correctly; real fix needs per-user locale resolution + per-(audience,channel,locale) render groups — design open item, test G20. |
| B11 redelivery idempotency is log-level only | minor | **WONTFIX (re-open on new provider)** | Post-W1 ALL delivery goes through Novu, which dedupes triggers on transactionId; a pre-send SENT-row check only matters when a non-Novu provider returns — add it then. |
| B12 identify TTL cache grows unbounded | nit | **WONTFIX** | Evict-on-read entries are ~100 bytes for subscribers seen once; slow-burn at pilot scale — revisit with Caffeine if the bridge ever serves high-cardinality tenants. |
| B16 splitter test missing | minor | **DEFER → companion test plan G1 (P0 there)** | It IS a test, not a code fix; W2.7 lands the NPE guard, G1 lands the golden round-trip. |
| B17 divergent seed sources (dev seed = legacy policy, splitter = role-pool policy) | minor | **DEFER (tracked as design open item 6)** | Consolidating means regenerating the 33-row dev seed from the splitter AND rebasing the golden-parity fixtures on it — a scoped follow-up, not a safe drive-by; the pilot seeds via the splitter path only. |
| B19 fromState enforcement | minor | **PARTIAL (W2.8 WARN + W5.6 help text); full enforcement DEFERRED** | Enforcing needs a workflow ProcessInstance lookup per event; nothing authors fromState today, so loud non-enforcement + "leave blank" guidance removes the trap. |
| C6 R4 UUID-resolution has zero test coverage | minor | **DEFER → companion test plan G8** | Pure test gap; no code change in this plan. |
| C7 template key lacks businessService | minor | **WONTFIX until a second workflow onboards** | PGR is the only BusinessService on every target deployment; changing the x-unique key now would orphan all seeded rows — re-open as a schema migration before onboarding workflow #2 (the shared-REOPEN-chip quirk is documented by this row). |
| C8 `en_IN` hardcoded in checker + Configure tab | minor | **WONTFIX for the pilot** | Backend default locale is `en_IN` on every current deployment and seeds are 33/33 `en_IN`; the real fix (config-driven default locale + non-default-locale siblings surfaced) belongs to the multi-locale rollout with B9/G20. |
| C12 duplicated ValidationPanel JSX (~90 lines) | nit | **WONTFIX (refactor-only)** | Pure duplication with no behavior risk; extract a shared `<NotificationValidationPanel/>` opportunistically next time either screen changes. The dead `q` input half of C12 IS fixed (W5.7). |
| B20 / C13 (praise) | — | No action | Keep the golden gate, the parameterized repository, and the pure checker exactly as they are. |

---

## Traceability: finding → closing step

| ID | Finding (short) | Severity | Design §5 # | Disposition |
|----|-----------------|----------|-------------|-------------|
| B1 | Unknown/null channel falls back to SMS workflow | major | 2 | **W1.1** (getNovuWorkflowId throws) + **W1.2** (SKIPPED/NB_UNSUPPORTED_CHANNEL gate) + W1.5 test |
| B2 | Delivery failures never write FAILED | major | 3 | **W2.1** |
| B3 | RestTemplate has no timeouts; baileys timeout dead config | major | 4 | **W2.2** (timeouts); dead property deleted in **W1.1** |
| B4 | Unauthenticated /novu-adapter/v1/* + no shipped route | major | 5 | **W3.1** (auth filter) + **W3.2** (server-side masking) + **W3.4** (Kong route + nginx comment) |
| B5 | Role-pool search truncates; duplicate searches per channel | major | 6 | **W2.4** (pagination loop + cap WARN + uuid dedupe + per-invocation memoization) |
| B6 | No channel-appropriate contact filtering (phantom SENT / DLQ noise) | major | 7 | **W2.3** (PGR emission filter + bridge NB_CONTACT_MISSING defense) |
| B7 | MDMS caches never invalidate; false "legacy fallback" comment | major | 8 | **W4.1** (60s TTL + stale-serve) + **W4.2** (corrected ERROR log) + **W4.3** (tests) |
| B8 | Dedupe key burned before render/publish succeeds | minor | 12 | **W2.5** |
| B9 | Per-recipient localization not implemented | minor | 13 | **W2.9** doc note; DEFER (see WONTFIX table) |
| B10 | Dead/misleading knobs (RENDERED_BODY_MODE, IDENTIFY_ENABLED, channels.default, inert rollback props) | minor | 24 | **W1.7** items 1, 3, 4 |
| B11 | Idempotency log-level only; Baileys path had none | minor | 15 | WONTFIX (Baileys path deleted in W1; Novu dedupes on transactionId) |
| B12 | Identify TTL cache unbounded | nit | 24 | WONTFIX |
| B13 | Credential redaction denylist-by-location | nit | 24 | **W3.3** (allowlist projection) |
| B14 | formatCreatedDate epoch heuristic wrong | nit | — | **W2.6** |
| B15 | Splitter NPE aborts tenant setup; only IOException caught | minor | 16 | **W2.7** |
| B16 | Splitter golden round-trip test missing | minor | 17 | DEFER → companion test plan G1 |
| B17 | Two divergent seed sources; regen script clobbers rows | minor | 18 | DEFER (design open item 6) |
| B18 | MSISDNs logged at INFO; bridge ships at DEBUG | minor | 19 | **W3.6** |
| B19 | Authored fromState silently ignored | minor | 14 | **W2.8** (WARN) + **W5.6** (help text); full enforcement deferred |
| B20 | Golden-output parity gate (praise) | praise | — | No action |
| BR | Baileys removal scope (code, service, compose, ansible, docs, ops, tests) | — | 2 (note) | **W1.1–W1.8** (verbatim scope) |
| C1 | Fire-and-forget writes: awaits are no-ops, toasts lie | **blocker** | 1 | **W5.1** |
| C2 | No duplicate/partial-write handling; phantom-200 → swallowed TypeError | major | 9 | **W5.2** + **W5.3** |
| C3 | Key-changing edit never deactivates the old pair | major | 10 | **W5.4** |
| C4 | Remove → re-Add permanently broken (soft-delete uid collision) | major | 11 | **W5.3** (includeInactive reactivation) |
| C5 | Client-side-only masking; comments claim JWT gating | major | 5 | **W3.2** (server-side mask) + **W3.5** (comments) + **W5.7**.3 (defense-in-depth note) |
| C6 | R4 UUID resolution untested | minor | 20 | DEFER → companion test plan G8 |
| C7 | Template key lacks businessService | minor | 21 | WONTFIX until 2nd workflow (see table above) |
| C8 | en_IN hardcoded vs configurable backend locale | minor | 22 | WONTFIX for pilot (see table above) |
| C9 | Stale "CITIZEN or EMPLOYEE" help; assigneeOnly unreachable | minor | 23 | **W5.6** (help fixed; assigneeOnly explicitly deferred with comment) |
| C10 | Committed Playwright report / .last-run.json / i18n-missing.json | nit | 24 | **W5.7**.1 |
| C11 | Dead NOVU_BRIDGE_BASE_PATH constant + duplicated path | nit | 24 | **W3.5** |
| C12 | Duplicated ValidationPanel JSX + dead `q` input | nit | 24 | `q` input: **W5.7**.2; JSX dedup: WONTFIX |
| C13 | Data-provider engineering (praise) | praise | — | No action |

Every blocker and major above maps to a concrete workstream step; every minor is either fixed,
partially fixed with the remainder explicitly deferred, or WONTFIXed with a stated reason. Test
gaps (G1–G20) are owned by the companion test plan and cross-referenced where a workstream lands
their prerequisite behavior (W1→G2/G18, W2→G4/G6/G7, W3→G10, W4→G12, W5→G9).
