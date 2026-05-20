# ValueFirst & Karix SMS Integration — Approach Document

**Project:** Citizen Complaint Resolution System — `novu-bridge`
**Date:** 2026-05-20
**Author:** eGovernments Foundation
**Status:** Draft — Under Review

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [ValueFirst API Quick Reference](#valuefirst-api-quick-reference)
4. [Karix API Quick Reference](#karix-api-quick-reference)
5. [Provider Comparison](#provider-comparison)
6. [Current Implementation Status](#current-implementation-status)
7. [Recommended Approaches](#recommended-approaches)
   - [Approach A — novu-bridge Hosted Adapter (Recommended)](#approach-a--novu-bridge-hosted-adapter-recommended)
   - [Approach B — Direct Java Call (Quick Alternative)](#approach-b--direct-java-call-quick-alternative)
   - [Approach C — Native Novu Provider (Long-term)](#approach-c--native-novu-provider-long-term)
8. [Approach Comparison](#approach-comparison)
9. [Required Code Changes](#required-code-changes)
10. [DLT Compliance (India Mandatory)](#dlt-compliance-india-mandatory)
11. [How to Integrate Any New Module](#how-to-integrate-any-new-module)
12. [Module-Level Changes Required](#module-level-changes-required)
13. [Configuration Reference](#configuration-reference)

---

## Executive Summary

`novu-bridge` currently delivers notifications exclusively over **WhatsApp via Twilio**. This document covers how to add **ValueFirst** and **Karix** as additional providers, both supporting the **SMS** channel.

Neither provider has a native Novu integration. The recommended approach (Approach A) hosts a lightweight adapter endpoint for each provider **inside `novu-bridge` itself** — no separate service to deploy. Novu's `generic-sms` integration calls back into `novu-bridge`, which translates the request and forwards it to the respective provider API.

> **Manager note addressed:** A dedicated section — [How to Integrate Any New Module](#how-to-integrate-any-new-module) — explains the step-by-step onboarding process for modules like PT, BPA, and Trade License, including scheduler-based patterns for modules that do not use workflow events.

---

## System Architecture

### Current Flow (PGR / Complaints module)

```
PGR Module
    │
    │  Kafka: complaints.domain.events
    ▼
┌─────────────────────────────────────────────────────┐
│                    novu-bridge                      │
│                                                     │
│  DomainEventConsumer                                │
│       │                                             │
│       ▼                                             │
│  DispatchPipelineService (11 steps)                 │
│    1. Validate envelope                             │
│    2. Resolve recipient UUID (UserService)          │
│    3. Check notification consent (PreferenceService)│
│    4. Resolve template (ConfigService)              │
│    5. Resolve provider (ConfigService)              │
│    6. Pick strategy (NovuProviderStrategyFactory)   │──► TwilioProviderStrategy
│    7. Build payload (strategy.buildProviderConfig)  │    ValueFirstProviderStrategy (stub)
│    8. Trigger Novu (NovuClient)                     │    KarixProviderStrategy (new)
│    9. Log result (DispatchLogRepository)            │    GenericProviderStrategy
└──────────────────────────┬──────────────────────────┘
                           │
                           │ POST /v1/events/trigger
                           ▼
                    ┌─────────────┐
                    │  Novu API   │
                    │ (self-hosted│
                    │  port 3000) │
                    └──────┬──────┘
                           │  Twilio (WhatsApp)
                           ▼
                       End User
```

### Target Flow (Approach A — novu-bridge hosted adapter)

```
Kafka
  │
  ▼
novu-bridge (DispatchPipelineService)
  │
  │  POST /v1/events/trigger
  ▼
Novu API
  │
  ├── generic-sms (valuefirst-sms) ──► POST /novu-bridge/adapter/valuefirst/send
  │                                         │ (inside novu-bridge)
  │                                         │  XML + Bearer token
  │                                         ▼
  │                                    ValueFirst API
  │
  └── generic-sms (karix-sms) ──────► POST /novu-bridge/adapter/karix/send
                                            │ (inside novu-bridge)
                                            │  JSON + Basic Auth
                                            ▼
                                       Karix API
```

Novu calls back into `novu-bridge` on a dedicated adapter endpoint per provider. No separate service is deployed.

**Key source files:**

| File | Purpose |
|------|---------|
| `consumer/DomainEventConsumer.java` | Reads Kafka events; hands off to pipeline |
| `service/DispatchPipelineService.java` | Orchestrates all 11 dispatch steps |
| `service/provider/ValueFirstProviderStrategy.java` | Builds ValueFirst payload (exists, incomplete) |
| `service/provider/KarixProviderStrategy.java` | Builds Karix payload (new) |
| `service/provider/NovuProviderStrategyFactory.java` | Routes to correct strategy by `providerName` |
| `service/NovuClient.java` | POSTs to Novu `/v1/events/trigger` |
| `service/ConfigServiceClient.java` | Fetches `TemplateBinding` and `ProviderDetail` |
| `web/controller/ValueFirstAdapterController.java` | New: adapter endpoint for ValueFirst |
| `web/controller/KarixAdapterController.java` | New: adapter endpoint for Karix |
| `service/sms/ValueFirstSmsClient.java` | New: token caching + XML + HTTP to ValueFirst |
| `service/sms/KarixSmsClient.java` | New: JSON + Basic Auth HTTP to Karix |
| `schemas/ProviderDetail.json` | MDMS schema — provider credentials per tenant |
| `schemas/TemplateBinding.json` | MDMS schema — event-to-template mapping |

---

## ValueFirst API Quick Reference

### Authentication

ValueFirst uses two-step auth. A Bearer token must be fetched before every SMS send call.

| Method | How | TTL |
|--------|-----|-----|
| Bearer Token | POST to token endpoint with Basic Auth; use returned token | 7 days |

**Token endpoint:**
```
POST https://api.myvfirst.com/psms/api/messages/token?action=generate
Authorization: Basic Base64(username:password)
```

### Send SMS

```
POST https://api.myvfirst.com/psms/servlet/psms.Eservice2
Content-Type: application/xml
Authorization: Bearer <token>
```

**XML body:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE>
  <USER USERNAME="your_username" PASSWORD="your_password"/>
  <SMS UDH="0" CODING="1" TEXT="Your complaint {1} has been registered."
       PROPERTY="0" ID="MSG-001"
       DLTTEMPLATEID="1007158620398745312"
       DLTCONTENTTYPE="1"
       ENTITYID="1001458620398745312">
    <ADDRESS FROM="SENDERID" TO="+919876543210" SEQ="1" TAG="MSG-001"/>
  </SMS>
</MESSAGE>
```

### Key Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `FROM` | Yes | Sender ID (max 11 alphanumeric chars, DLT-registered) |
| `TO` | Yes | Recipient phone in E.164 format (`+91XXXXXXXXXX`) |
| `TEXT` | Yes | Message body; must match DLT-registered template |
| `DLTTEMPLATEID` | Yes (India) | DLT template ID from TRAI portal |
| `DLTCONTENTTYPE` | Yes (India) | `1`=Service Implicit, `2`=Service Explicit, `3`=Transactional, `4`=Promotional |
| `ENTITYID` | Yes (India) | TRAI Principal Entity ID |

### Delivery Reports (DLR)

ValueFirst calls your registered HTTP endpoint with delivery status:

```
GET /dlr?msgid=VF-001&status=DELIVERED&to=+919876543210&from=SENDERID&time=1714300000
```

Status values: `DELIVERED`, `NOT_DELIVERED`, `QUEUED`, `SENT`, `FAILED`, `REJECTED`

---

## Karix API Quick Reference

Karix (part of Tanla Platforms) exposes two API products. The **Power API** is recommended for new integrations.

### Authentication

| API | Method | Details |
|-----|--------|---------|
| Power API (`api.karix.io`) | HTTP Basic Auth | `Authorization: Basic base64(authId:authToken)` — static, no expiry |
| Legacy JSON API (`japi.instaalerts.zone`) | API key in body | `"key": "xxx"` embedded in JSON payload |

The Power API is preferred — static Basic Auth is simpler to manage than ValueFirst's token rotation.

### Send SMS (Power API)

```
POST https://api.karix.io/message/
Authorization: Basic <base64(authId:authToken)>
Content-Type: application/json
Accept: application/json
```

**JSON body:**
```json
{
  "channel": "sms",
  "source": "SENDERID",
  "destination": ["+919876543210"],
  "content": {
    "text": "Your complaint PG-PGR-2026-03-25-043118 has been registered."
  }
}
```

### DLT Compliance Fields (Karix)

DLT fields on the Power API are not explicitly documented per-request — Karix may handle them at the account/template level. **Confirm with Karix support before go-live** whether `dlt_entity_id` and `dlt_template_id` must be passed per request or are configured on the Karix dashboard.

For the legacy JSON API, DLT fields are query string parameters:

| Field | Description |
|-------|-------------|
| `dlt_entity_id` | Principal Entity ID from TRAI portal |
| `dlt_template_id` | Template ID from TRAI portal |
| `dlt_tm_id` | Telemarketer ID (for DLT chain hashing) |

### Delivery Reports (DLR)

Karix sends DLR callbacks to a registered webhook URL. Format varies by API version — confirm with Karix during onboarding.

---

## Provider Comparison

| | ValueFirst | Karix (Power API) |
|---|---|---|
| **Native Novu provider** | No | No |
| **API format** | XML | JSON |
| **Auth type** | Two-step Bearer token (7-day TTL) | Static Basic Auth |
| **Token refresh logic needed** | Yes | No |
| **DLT fields per-request** | Yes — in XML attributes | Confirm with Karix |
| **Adapter complexity** | Higher (XML builder + token cache) | Lower (JSON transform only) |
| **E.164 phone format** | Yes (`+91XXXXXXXXXX`) | Yes (`+91XXXXXXXXXX`) |

---

## Current Implementation Status

### What is already done

| Component | Status | Notes |
|-----------|--------|-------|
| `ValueFirstProviderStrategy.java` | Exists, incomplete | Builds `_passthrough` body; strategy registered and auto-discovered |
| `NovuProviderStrategyFactory.java` | Complete | Routes to ValueFirst when `providerName = "valuefirst"` |
| `ProviderDetail.json` schema | Complete | Generic `credentials` map supports any key-value set |
| `NovuClient.triggerWithProviderConfig()` | Complete | Provider-agnostic; delegates to strategy |

### Gaps that must be closed

| # | Gap | Affected File | Applies to |
|---|-----|---------------|-----------|
| G1 | Novu has no native ValueFirst or Karix provider | Novu instance | Both |
| G2 | `formatWhatsappPhone()` always prepends `whatsapp:` | `DispatchPipelineService.java:L249` | Both |
| G3 | `TemplateBinding.json` `contentSid` pattern is Twilio-only (`^HX...`) | `schemas/TemplateBinding.json` | Both |
| G4 | No Novu bootstrap scripts for ValueFirst / Karix | `config/` | Both |
| G5 | No MDMS seed data for ValueFirst / Karix | `seed-data/` | Both |
| G6 | `ValueFirstProviderStrategy.buildProviderConfig()` uses wrong passthrough format | `ValueFirstProviderStrategy.java` | ValueFirst |
| G7 | `KarixProviderStrategy` does not exist | — | Karix |
| G8 | No adapter endpoints inside `novu-bridge` for either provider | — | Both |
| G9 | No `ValueFirstSmsClient` or `KarixSmsClient` Java classes | — | Both |

---

## Recommended Approaches

---

### Approach A — novu-bridge Hosted Adapter (Recommended)

#### How it works

Each provider gets a dedicated adapter endpoint **inside `novu-bridge`**. Novu's `generic-sms` integration calls these endpoints. No separate service is deployed.

```
novu-bridge triggers Novu  →  Novu calls back into novu-bridge  →  novu-bridge calls provider API
```

#### Why choose this

- No separate service to deploy or maintain
- Adapter code lives in Java alongside the rest of `novu-bridge`
- Novu's dashboard tracks delivery for both WhatsApp (Twilio) and SMS (ValueFirst / Karix)
- Adding a third provider later requires only a new client class + controller + Novu integration registration

#### Cons

- Novu calls back into `novu-bridge` — circular-looking but harmless; they are logically separate operations
- If Novu is down, SMS delivery is blocked (same as WhatsApp today)

---

#### Code changes in novu-bridge

**1. Fix phone formatting (G2) — `DispatchPipelineService.java`**

Replace `formatWhatsappPhone()` with a channel-aware version:

```java
private String formatPhone(String mobile, String channel, String tenantId, RequestInfo requestInfo) {
    if (!StringUtils.hasText(mobile)) return null;
    String normalized = mobile.trim();

    if ("SMS".equalsIgnoreCase(channel)) {
        if (normalized.startsWith("+")) return normalized;
        MobileValidationConfig cfg = mdmsServiceClient.getMobileValidationConfig(tenantId, requestInfo);
        if (normalized.matches(cfg.getPattern())) return cfg.getPrefix() + normalized;
        throw new CustomException("INVALID_MOBILE_NUMBER", "Mobile does not match pattern for SMS channel");
    }

    // WhatsApp path (existing logic unchanged)
    if (normalized.startsWith("whatsapp:")) return normalized;
    if (normalized.startsWith("+")) return "whatsapp:" + normalized;
    MobileValidationConfig cfg = mdmsServiceClient.getMobileValidationConfig(tenantId, requestInfo);
    if (normalized.matches(cfg.getPattern())) return "whatsapp:" + cfg.getPrefix() + normalized;
    throw new CustomException("INVALID_MOBILE_NUMBER", "Mobile does not match pattern for WhatsApp channel");
}
```

Update all callers to pass `context.getChannel()` as the second argument.

**2. Remove Twilio-only contentSid pattern (G3) — `schemas/TemplateBinding.json`**

Remove the `"pattern": "^HX[a-fA-F0-9]{32}$"` constraint from `contentSid`:

```json
"contentSid": {
  "type": "string",
  "description": "Provider-specific template identifier. Twilio: HX + 32 hex chars. ValueFirst / Karix: any alphanumeric string."
}
```

**3. Add `novuIntegrationId` and `senderNumber` to schema and model (G6)**

Add to `schemas/ProviderDetail.json`:
```json
"novuIntegrationId": {
  "type": "string",
  "description": "Novu integration identifier for this provider (e.g. 'valuefirst-sms', 'karix-sms'). Defaults to providerName if absent."
},
"senderNumber": {
  "type": "string",
  "description": "Sender ID or phone number for this provider"
}
```

Add the same fields to `web/models/ResolvedProvider.java`.

**4. Update `NovuClient.java` to use `novuIntegrationId` (G6)**

```java
String novuIntegrationKey = StringUtils.hasText(resolvedProvider.getNovuIntegrationId())
        ? resolvedProvider.getNovuIntegrationId()
        : resolvedProvider.getProviderName().toLowerCase();

Map<String, Object> providerOverrides = new HashMap<>();
providerOverrides.put(novuIntegrationKey, providerConfig);
```

**5. ValueFirst SMS client — `service/sms/ValueFirstSmsClient.java` (G9)**

```java
@Service
@Slf4j
public class ValueFirstSmsClient {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    private String cachedToken;
    private Instant tokenExpiry;

    public String send(String to, String from, String text,
                       String dltTemplateId, String entityId, String contentType) {
        String token = getBearerToken();
        String messageId = "MSG-" + System.currentTimeMillis();
        String xml = buildXml(to, from, text, messageId, dltTemplateId, entityId, contentType);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_XML);
        headers.setBearerAuth(token);

        restTemplate.exchange(config.getVfApiUrl(), HttpMethod.POST,
                new HttpEntity<>(xml, headers), String.class);
        return messageId;
    }

    private synchronized String getBearerToken() {
        if (cachedToken != null && Instant.now().isBefore(tokenExpiry)) return cachedToken;

        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Basic " +
            Base64.getEncoder().encodeToString(
                (config.getVfUsername() + ":" + config.getVfPassword()).getBytes()));

        ResponseEntity<Map> res = restTemplate.exchange(
            config.getVfTokenUrl(), HttpMethod.POST,
            new HttpEntity<>(headers), Map.class);

        cachedToken = (String) res.getBody().get("token");
        tokenExpiry = Instant.now().plus(Duration.ofHours(167)); // refresh before 7-day TTL
        return cachedToken;
    }

    private String buildXml(String to, String from, String text, String id,
                             String dltTemplateId, String entityId, String contentType) {
        return String.format("""
            <?xml version="1.0" encoding="UTF-8"?>
            <MESSAGE>
              <USER USERNAME="%s" PASSWORD="%s"/>
              <SMS UDH="0" CODING="1" TEXT="%s" PROPERTY="0" ID="%s"
                   DLTTEMPLATEID="%s" DLTCONTENTTYPE="%s" ENTITYID="%s">
                <ADDRESS FROM="%s" TO="%s" SEQ="1" TAG="%s"/>
              </SMS>
            </MESSAGE>""",
            esc(config.getVfUsername()), esc(config.getVfPassword()),
            esc(text), id, esc(dltTemplateId), contentType, esc(entityId),
            esc(from), esc(to), id);
    }

    private String esc(String s) {
        if (s == null) return "";
        return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
                .replace("\"","&quot;").replace("'","&apos;");
    }
}
```

**6. ValueFirst adapter endpoint — `web/controller/ValueFirstAdapterController.java` (G8)**

```java
@RestController
@RequestMapping("/novu-bridge/adapter/valuefirst")
@RequiredArgsConstructor
@Slf4j
public class ValueFirstAdapterController {

    private final ValueFirstSmsClient smsClient;

    @PostMapping("/send")
    public ResponseEntity<Map<String, String>> send(@RequestBody Map<String, Object> body) {
        String to          = (String) body.get("to");
        String from        = (String) body.getOrDefault("from", "");
        String text        = (String) body.get("body");
        String dltTemplate = (String) body.getOrDefault("templateId", "");
        String entityId    = (String) body.getOrDefault("entityId", "");
        String contentType = (String) body.getOrDefault("contentType", "1");

        String msgId = smsClient.send(to, from, text, dltTemplate, entityId, contentType);
        return ResponseEntity.ok(Map.of("msgid", msgId, "status", "sent"));
    }

    // DLR callback from ValueFirst
    @GetMapping("/dlr")
    public ResponseEntity<Void> dlr(@RequestParam String msgid,
                                    @RequestParam String status,
                                    @RequestParam String to) {
        log.info("ValueFirst DLR: msgid={} status={} to={}", msgid, status, to);
        // TODO: update nb_dispatch_log
        return ResponseEntity.ok().build();
    }
}
```

**7. Karix SMS client — `service/sms/KarixSmsClient.java` (G9)**

```java
@Service
@Slf4j
public class KarixSmsClient {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    public String send(String to, String from, String text) {
        String credentials = Base64.getEncoder().encodeToString(
            (config.getKarixAuthId() + ":" + config.getKarixAuthToken()).getBytes());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        headers.set("Authorization", "Basic " + credentials);

        Map<String, Object> body = Map.of(
            "channel", "sms",
            "source",  from,
            "destination", List.of(to),
            "content", Map.of("text", text)
        );

        String messageId = "KRX-" + System.currentTimeMillis();
        restTemplate.exchange(config.getKarixApiUrl(), HttpMethod.POST,
                new HttpEntity<>(body, headers), Map.class);
        return messageId;
    }
}
```

> **Note on DLT fields for Karix:** Confirm with Karix support whether `dlt_entity_id` and `dlt_template_id` must be sent per-request on the Power API. If yes, add them to the `body` map above and pass them through from the adapter controller — same pattern as ValueFirst.

**8. Karix adapter endpoint — `web/controller/KarixAdapterController.java` (G8)**

```java
@RestController
@RequestMapping("/novu-bridge/adapter/karix")
@RequiredArgsConstructor
@Slf4j
public class KarixAdapterController {

    private final KarixSmsClient smsClient;

    @PostMapping("/send")
    public ResponseEntity<Map<String, String>> send(@RequestBody Map<String, Object> body) {
        String to   = (String) body.get("to");
        String from = (String) body.getOrDefault("from", "");
        String text = (String) body.get("body");

        String msgId = smsClient.send(to, from, text);
        return ResponseEntity.ok(Map.of("msgid", msgId, "status", "sent"));
    }

    // DLR webhook from Karix
    @PostMapping("/dlr")
    public ResponseEntity<Void> dlr(@RequestBody Map<String, Object> payload) {
        log.info("Karix DLR: {}", payload);
        // TODO: update nb_dispatch_log
        return ResponseEntity.ok().build();
    }
}
```

**9. Register `KarixProviderStrategy` (G7) — `service/provider/KarixProviderStrategy.java`**

```java
@Component("karix")
public class KarixProviderStrategy implements NovuProviderStrategy {

    @Override
    public Map<String, Object> buildProviderConfig(ResolvedProvider provider,
                                                   ResolvedTemplate template,
                                                   String formattedPhone) {
        return Map.of(
            "to",   formattedPhone,
            "from", provider.getSenderNumber(),
            "body", template.getBodyText()
        );
    }
}
```

Register `karix` in `NovuProviderStrategyFactory`.

**10. Register Novu generic-sms integrations — `config/bootstrap-novu-sms-providers.sh` (G4)**

```bash
#!/usr/bin/env bash
set -euo pipefail
NOVU_BASE_URL=${NOVU_BASE_URL:-http://localhost:3000}
NOVU_API_KEY=${NOVU_API_KEY:?Set NOVU_API_KEY}
BRIDGE_URL=${NOVU_BRIDGE_URL:?Set NOVU_BRIDGE_URL}   # e.g. http://novu-bridge:8290

# ValueFirst
curl -s -X POST "$NOVU_BASE_URL/v1/integrations" \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"providerId\": \"generic-sms\",
    \"channel\": \"sms\",
    \"name\": \"ValueFirst SMS\",
    \"identifier\": \"valuefirst-sms\",
    \"active\": true,
    \"credentials\": {
      \"baseUrl\": \"$BRIDGE_URL/novu-bridge/adapter/valuefirst/send\",
      \"apiKeyRequestHeader\": \"x-adapter-key\",
      \"apiKey\": \"${ADAPTER_SECRET_KEY:-changeme}\"
    }
  }" | jq .

# Karix
curl -s -X POST "$NOVU_BASE_URL/v1/integrations" \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"providerId\": \"generic-sms\",
    \"channel\": \"sms\",
    \"name\": \"Karix SMS\",
    \"identifier\": \"karix-sms\",
    \"active\": true,
    \"credentials\": {
      \"baseUrl\": \"$BRIDGE_URL/novu-bridge/adapter/karix/send\",
      \"apiKeyRequestHeader\": \"x-adapter-key\",
      \"apiKey\": \"${ADAPTER_SECRET_KEY:-changeme}\"
    }
  }" | jq .
```

**11. Add MDMS seed data (G5)**

`seed-data/ProviderDetail-valuefirst.json`:
```json
{
  "tenantId": "pg.citya",
  "providerName": "valuefirst",
  "channel": "sms",
  "novuIntegrationId": "valuefirst-sms",
  "senderNumber": "YOUR_VF_SENDER_ID",
  "credentials": {
    "username": "YOUR_VF_USERNAME",
    "password": "YOUR_VF_PASSWORD"
  },
  "isActive": true,
  "priority": 1
}
```

`seed-data/ProviderDetail-karix.json`:
```json
{
  "tenantId": "pg.citya",
  "providerName": "karix",
  "channel": "sms",
  "novuIntegrationId": "karix-sms",
  "senderNumber": "YOUR_KARIX_SENDER_ID",
  "credentials": {
    "authId": "YOUR_KARIX_AUTH_ID",
    "authToken": "YOUR_KARIX_AUTH_TOKEN"
  },
  "isActive": true,
  "priority": 2
}
```

---

### Approach B — Direct Java Call (Quick Alternative)

#### How it works

`novu-bridge` calls the provider's API directly from Java, bypassing Novu entirely for SMS. Novu is still used for WhatsApp via Twilio.

```
novu-bridge
    │
    ├──► NovuClient          (WhatsApp — Twilio — unchanged)
    │
    ├──► ValueFirstSmsClient (SMS — bypasses Novu)
    │         │  XML + Bearer token
    │         ▼
    │    ValueFirst API
    │
    └──► KarixSmsClient      (SMS — bypasses Novu)
              │  JSON + Basic Auth
              ▼
         Karix API
```

#### Why choose this

- No Novu hop for SMS — fewer moving parts
- Full control over retry logic and DLT fields in Java
- `ValueFirstSmsClient` and `KarixSmsClient` from Approach A are reused directly

#### Cons

- SMS delivery is not visible in Novu's dashboard
- DLR handling requires new endpoints in `novu-bridge` (same as Approach A)
- Two code paths in `DispatchPipelineService` (Novu path vs direct path)

#### Implementation

In `DispatchPipelineService.process()`, add a channel-routing branch before calling `NovuClient`:

```java
String provider = resolvedProvider.getProviderName();

if ("SMS".equalsIgnoreCase(context.getChannel())) {
    if ("valuefirst".equalsIgnoreCase(provider)) {
        String msgId = valueFirstSmsClient.send(
            formattedPhone,
            resolvedProvider.getSenderNumber(),
            resolvedTemplate.getBodyText(),
            resolvedTemplate.getDltTemplateId(),
            resolvedTemplate.getDltEntityId(),
            resolvedTemplate.getDltContentType()
        );
        return DispatchResult.builder().novuTriggered(false)
                .providerMessageId(msgId).build();
    }
    if ("karix".equalsIgnoreCase(provider)) {
        String msgId = karixSmsClient.send(
            formattedPhone,
            resolvedProvider.getSenderNumber(),
            resolvedTemplate.getBodyText()
        );
        return DispatchResult.builder().novuTriggered(false)
                .providerMessageId(msgId).build();
    }
}
// else: existing Novu path (WhatsApp / Twilio)
```

`ValueFirstSmsClient` and `KarixSmsClient` are the same classes described in Approach A — they can be shared between approaches.

---

### Approach C — Native Novu Provider (Long-term)

#### How it works

Fork `novuhq/novu`, implement native `valuefirst` and `karix` SMS providers in TypeScript under `packages/providers/src/lib/sms/`, and run a custom Novu build.

#### Why choose this

- Cleanest long-term architecture — no adapter endpoints, no bypass
- Full DLR support via Novu's native webhook pipeline
- Both providers can be contributed back to Novu OSS

#### Cons

- Requires maintaining a Novu fork (ongoing build and deployment overhead)
- Estimated 1–2 weeks to implement and validate both providers
- High operational cost until merged upstream

#### When to choose

Choose this **after** Approach A is running in production for both providers. Migrate once the team has bandwidth and wants to eliminate the adapter endpoints from `novu-bridge`.

---

## Approach Comparison

| Criterion | Approach A (novu-bridge Adapter) | Approach B (Direct Java) | Approach C (Native Novu) |
|-----------|----------------------------------|--------------------------|--------------------------|
| **Implementation effort** | Medium | Medium | High |
| **novu-bridge code changes** | Medium | Medium | Minimal |
| **Requires Novu fork** | No | No | Yes |
| **Separate service to deploy** | No | No | No |
| **Novu dashboard tracking** | Yes | No | Yes |
| **DLR webhook support** | Via adapter endpoints | Via new novu-bridge endpoints | Native |
| **Token rotation (ValueFirst)** | In `ValueFirstSmsClient` | In `ValueFirstSmsClient` | In Novu provider |
| **Recommended for** | Most teams | Teams that don't need Novu dashboard | Long-term / OSS contribution |

---

## Required Code Changes

These changes are required for both Approach A and B:

| File | Change | Gap |
|------|--------|-----|
| `service/DispatchPipelineService.java` | Replace `formatWhatsappPhone()` with channel-aware `formatPhone()` | G2 |
| `schemas/TemplateBinding.json` | Remove Twilio-only `contentSid` pattern | G3 |
| `schemas/ProviderDetail.json` | Add `novuIntegrationId` and `senderNumber` fields | G6 |
| `web/models/ResolvedProvider.java` | Add `novuIntegrationId` and `senderNumber` fields | G6 |
| `service/NovuClient.java` | Use `novuIntegrationId` as the provider override key | G6 |
| `service/provider/ValueFirstProviderStrategy.java` | Update `buildProviderConfig()` for generic-sms passthrough | G6 |
| `service/provider/KarixProviderStrategy.java` | New: Karix strategy class | G7 |
| `service/provider/NovuProviderStrategyFactory.java` | Register `karix` strategy | G7 |
| `service/sms/ValueFirstSmsClient.java` | New: token caching, XML builder, HTTP to ValueFirst | G9 |
| `service/sms/KarixSmsClient.java` | New: JSON builder, Basic Auth, HTTP to Karix | G9 |
| `web/controller/ValueFirstAdapterController.java` | New (Approach A only): adapter endpoint for ValueFirst | G8 |
| `web/controller/KarixAdapterController.java` | New (Approach A only): adapter endpoint for Karix | G8 |
| `config/bootstrap-novu-sms-providers.sh` | New: registers both generic-sms integrations in Novu | G4 |
| `seed-data/ProviderDetail-valuefirst.json` | New: MDMS seed data for ValueFirst | G5 |
| `seed-data/ProviderDetail-karix.json` | New: MDMS seed data for Karix | G5 |
| `application.properties` | Add ValueFirst + Karix config properties | G1 |

---

## DLT Compliance (India Mandatory)

TRAI's DLT mandate applies to **all commercial SMS sent in India**, regardless of provider. Every message must carry three fields.

### Required DLT fields

| Field | Description | Example |
|-------|-------------|---------|
| `dltTemplateId` | TRAI-registered template ID from DLT portal | `1007158620398745312` |
| `dltContentType` | `1`=Service Implicit, `2`=Service Explicit, `3`=Transactional, `4`=Promotional | `1` |
| `dltEntityId` | TRAI Principal Entity ID of the organisation | `1001458620398745312` |

### How to pass DLT fields through the pipeline

**Recommended:** Store per-template in `TemplateBinding`.

Add to `schemas/TemplateBinding.json`:
```json
"dltTemplateId":  { "type": "string", "description": "TRAI DLT registered template ID" },
"dltContentType": { "type": "string", "enum": ["1","2","3","4"] },
"dltEntityId":    { "type": "string", "description": "TRAI Principal Entity ID" }
```

Add the same fields to `ResolvedTemplate.java`. Pass them into the provider strategy's `buildProviderConfig()` and include them in the XML body (ValueFirst) or request body (Karix, if confirmed per-request).

### Karix DLT note

The Karix Power API documentation does not explicitly show DLT fields as per-request parameters — they may be configured at the account or template level on the Karix dashboard. **Confirm this with Karix support before go-live.** If per-request fields are required, add them to `KarixSmsClient.send()` and `KarixAdapterController` following the same pattern as ValueFirst.

---

## How to Integrate Any New Module

This section is a step-by-step reference for onboarding a new DIGIT module (e.g., Property Tax, BPA, Trade License) to send SMS notifications via ValueFirst or Karix through `novu-bridge`. The steps are identical regardless of which SMS provider is used.

### Overview: How PGR currently works

The existing Complaints (PGR) integration is the reference implementation:

```
1. Citizen files a complaint in PGR
2. PGR workflow engine transitions state (e.g., APPLY → PENDINGFORASSIGNMENT)
3. PGR publishes a domain event to Kafka: complaints.domain.events
4. novu-bridge DomainEventConsumer picks up the event
5. DispatchPipelineService runs 9 steps:
     a. Validates the event envelope
     b. Resolves the recipient UUID via UserService
     c. Checks notification consent via PreferenceService
     d. Resolves the message template from ConfigService (TemplateBinding)
     e. Resolves the provider credentials from ConfigService (ProviderDetail)
     f. Picks the right provider strategy (Twilio / ValueFirst / Karix)
     g. Formats the phone number for the channel
     h. Triggers Novu → provider
     i. Logs the result to nb_dispatch_log
```

### Integration patterns

| Pattern | When to use | Example modules |
|---------|-------------|-----------------|
| **Event-driven** | Module has a workflow engine that emits state transitions | BPA, Trade License, Fire NOC, PGR |
| **Scheduler-based** | Module needs time-triggered notifications (due dates, reminders) | Property Tax, Water & Sewerage |

---

### Pattern 1 — Event-driven Integration (e.g., BPA, Trade License)

No `novu-bridge` code changes are needed for new event-driven modules — integration is purely a configuration exercise.

#### Step 1: Identify notification trigger points

Decide which workflow actions should trigger a notification. Example for BPA:

| Event | Trigger | Recipient |
|-------|---------|-----------|
| `BPA.WORKFLOW.APPLY` | Applicant submits plan | Citizen |
| `BPA.WORKFLOW.APPROVE` | Officer approves | Citizen |
| `BPA.WORKFLOW.REJECT` | Officer rejects | Citizen |

#### Step 2: Confirm the module publishes domain events

Check that the module publishes to a Kafka topic with the standard domain event envelope (`eventId`, `eventName`, `module`, `tenantId`, `stakeholders`, `data`). If not, see [Step 2a](#step-2a-adding-event-publishing-to-a-module).

#### Step 3: Add the Kafka topic to novu-bridge

```properties
novu.bridge.kafka.input.topic=${NOVU_BRIDGE_KAFKA_INPUT_TOPIC:complaints.domain.events,bpa.domain.events}
```

#### Step 4: Register message templates in MDMS (TemplateBinding)

```json
{
  "schemaCode": "TemplateBinding",
  "tenantId": "pg.citya",
  "data": {
    "eventName": "BPA.WORKFLOW.APPLY",
    "module": "BPA",
    "channel": "sms",
    "locale": "en_IN",
    "templateId": "bpa-workflow-apply-sms-en",
    "contentSid": "VF-BPA-APPLY-001",
    "dltTemplateId": "1007xxxxxxxxxxxxxxxxx",
    "dltContentType": "1",
    "dltEntityId": "1001xxxxxxxxxxxxxxxxx",
    "paramOrder": ["applicationNo", "applicantName"],
    "requiredVars": ["applicationNo", "applicantName"]
  }
}
```

#### Step 5: Confirm ProviderDetail exists for the tenant

If the tenant already has a ValueFirst or Karix `ProviderDetail` record for the SMS channel, no additional seed data is needed. If it is a new tenant, add the relevant record from the [Configuration Reference](#configuration-reference).

#### Step 6: Register the Novu notification workflow

```bash
curl -X POST "$NOVU_BASE_URL/v1/notification-templates" \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "BPA Workflow Apply",
    "notificationGroupId": "...",
    "triggers": [{ "identifier": "bpa-workflow-apply-sms-en" }],
    "steps": [{ "template": { "type": "sms", "content": "Your BPA application {{1}} is submitted." } }]
  }'

curl -X PUT "$NOVU_BASE_URL/v1/notification-templates/{id}/status" \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  -d '{"active": true}'
```

#### Step 7: Test end-to-end

```bash
curl -X POST http://localhost:8290/novu-bridge/novu-adapter/v1/dispatch/_test-trigger \
  -H "Content-Type: application/json" \
  -d '{
    "templateKey": "bpa-workflow-apply-sms-en",
    "subscriberId": "pg.citya:dd1c8776-...",
    "phone": "+917123456790",
    "payload": { "applicationNo": "BPA-2026-001", "applicantName": "Ravi Kumar" }
  }'
```

---

### Pattern 2 — Scheduler-based Integration (e.g., Property Tax, Water & Sewerage)

Some modules do not have workflow-driven triggers. Notifications are time-triggered — for example, a tax due date reminder 30 days before the deadline.

#### Architecture

```
Scheduler (new component or existing module cron job)
    │  Queries PT service for bills due in 30 days
    │  Publishes domain events to Kafka: pt.domain.events
    ▼
novu-bridge  (same pipeline — no changes needed)
    │
    ▼
ValueFirst / Karix → Citizen SMS
```

#### Step 2a: Adding event publishing to a module

**Option A — Add publishing to the existing module service**

```java
ComplaintsDomainEvent event = ComplaintsDomainEvent.builder()
    .eventId(UUID.randomUUID().toString())
    .eventType("DOMAIN_EVENT")
    .eventName("PT.PAYMENT.DUE_REMINDER")
    .module("PT")
    .entityId(assessment.getAssessmentNumber())
    .tenantId(assessment.getTenantId())
    .actor(Actor.builder().uuid(systemUserId).type("SYSTEM").build())
    .stakeholders(List.of(
        Stakeholder.builder()
            .type("CITIZEN")
            .userId(assessment.getCitizenUuid())
            .mobile(assessment.getCitizenMobile())
            .build()
    ))
    .data(Map.of(
        "assessmentNumber", assessment.getAssessmentNumber(),
        "dueAmount", assessment.getDueAmount().toString(),
        "dueDate", assessment.getDueDate()
    ))
    .build();

producer.push(assessment.getTenantId(), "pt.domain.events", event);
```

**Option B — Standalone scheduler service**

```java
@Scheduled(cron = "0 0 9 * * *")  // daily at 9 AM
public void sendPropertyTaxReminders() {
    List<Assessment> dueAssessments = ptServiceClient.getAssessmentsDueSoon(30);
    for (Assessment a : dueAssessments) {
        domainEventPublisher.publishPtDueReminder(a);
    }
}
```

> Use Kafka (not direct HTTP to `novu-bridge`) so retries, DLQ, and dispatch logging work correctly.

#### Steps 3–7: Same as Pattern 1

---

### Checklist: Integrating a new module

**Module side**
- [ ] Identify which user actions or time triggers should send notifications
- [ ] Confirm domain events are published with the standard envelope format
- [ ] For scheduler-based: implement or deploy a scheduler
- [ ] Populate `data` map with all variables in the message template
- [ ] Ensure `stakeholders` includes the recipient's `userId` and `mobile`

**Configuration (MDMS / config-service)**
- [ ] Register `TemplateBinding` for each `(eventName, channel, locale)` combination
- [ ] Set `paramOrder` matching `{1}`, `{2}` variable positions in the DLT template
- [ ] Set `dltTemplateId`, `dltEntityId`, `dltContentType`
- [ ] Confirm `ProviderDetail` exists for the tenant and channel

**novu-bridge**
- [ ] Add the new Kafka topic to `novu.bridge.kafka.input.topic`
- [ ] No Java code changes required for new event-driven modules

**Novu**
- [ ] Create and activate a Novu notification workflow per template
- [ ] Verify workflow identifier matches `templateId` in `TemplateBinding`

**Testing**
- [ ] Run `/_dry-run` (send=false) to validate template resolution and variable mapping
- [ ] Run `/_test-trigger` to send a real SMS to a test number
- [ ] Check `nb_dispatch_log` for status and error codes

---

### Best practices

1. **One Kafka topic per domain** — use `pt.domain.events`, `bpa.domain.events` etc. for easier filtering and scaling.
2. **Include all template variables in `data`** — missing variables cause `NB_REQUIRED_VARS_MISSING` pipeline failure.
3. **Do not hardcode mobile numbers in schedulers** — always fetch from UserService or the module's citizen record.
4. **Idempotency** — use a stable `eventId` (e.g., `<module>-<entityId>-<action>-<timestamp>`). `novu-bridge` uses it as the idempotency key for `nb_dispatch_log`.
5. **Test with dry-run first** — validate the full pipeline before sending live SMS.
6. **DLT registration before go-live** — register all SMS templates on the TRAI DLT portal before sending to real citizens.

---

## Module-Level Changes Required

### PGR (Complaints) — Reference implementation

| Component | Status | Action needed |
|-----------|--------|---------------|
| Kafka publishing | Done | None |
| `TemplateBinding` MDMS records | Seeded for `COMPLAINTS.WORKFLOW.APPLY` | Add more events as needed |
| `ProviderDetail` MDMS record | Seeded for Twilio (WhatsApp) | Add ValueFirst or Karix record for SMS channel |
| novu-bridge | Running | Apply G2–G9 code fixes |
| Scheduler | Not needed | N/A |

### Property Tax (PT)

| Component | Status | Action needed |
|-----------|--------|---------------|
| Kafka publishing | Not implemented | Add event publishing or deploy standalone scheduler |
| Scheduler | Not implemented | Daily job for bills due in 7 / 15 / 30 days |
| `TemplateBinding` MDMS records | Not seeded | Create for `PT.PAYMENT.DUE_REMINDER`, `PT.PAYMENT.RECEIPT` |
| `ProviderDetail` MDMS record | Not seeded | Add ValueFirst or Karix record per tenant |
| novu-bridge topic config | Complaints only | Add `pt.domain.events` |
| DLT templates | Not registered | Register on TRAI DLT portal before go-live |

### Building Plan Approval (BPA)

| Component | Status | Action needed |
|-----------|--------|---------------|
| Kafka publishing | Check with BPA team | Add publishing at each relevant workflow step |
| `TemplateBinding` MDMS records | Not seeded | Create for `BPA.WORKFLOW.APPLY`, `BPA.WORKFLOW.APPROVE`, `BPA.WORKFLOW.REJECT` |
| `ProviderDetail` MDMS record | Not seeded | Reuse existing record if same tenant |
| novu-bridge topic config | Not configured | Add `bpa.domain.events` |
| Scheduler | Not needed | N/A |

### Trade License (TL)

| Component | Status | Action needed |
|-----------|--------|---------------|
| Kafka publishing | Check with TL team | Add for application events; separate scheduler for renewals |
| Renewal reminder scheduler | Not implemented | 30/15/7 day reminders before license expiry |
| `TemplateBinding` MDMS records | Not seeded | Create for application events and renewal reminders |
| novu-bridge topic config | Not configured | Add `tl.domain.events` |

### Water & Sewerage (WS)

| Component | Status | Action needed |
|-----------|--------|---------------|
| Kafka publishing | Not implemented | Deploy scheduler for payment due events |
| `TemplateBinding` MDMS records | Not seeded | Create for `WS.BILL.DUE_REMINDER`, `WS.CONNECTION.DISCONNECTION_NOTICE` |
| novu-bridge topic config | Not configured | Add `ws.domain.events` |
| Scheduler | Not implemented | Daily job querying WS bills |

---

## Configuration Reference

### Environment variables

```bash
# ValueFirst credentials
VF_USERNAME=your_valuefirst_username
VF_PASSWORD=your_valuefirst_password
VF_SENDER_ID=YOUR_VF_SENDER_ID
VF_DLT_TEMPLATE_ID=1007158620398745312
VF_DLT_CONTENT_TYPE=1
VF_ENTITY_ID=1001458620398745312

# Karix credentials (Power API)
KARIX_AUTH_ID=your_karix_auth_id
KARIX_AUTH_TOKEN=your_karix_auth_token
KARIX_SENDER_ID=YOUR_KARIX_SENDER_ID
KARIX_API_URL=https://api.karix.io/message/

# novu-bridge adapter security
ADAPTER_SECRET_KEY=strong-random-secret

# novu-bridge channel default
NOVU_BRIDGE_CHANNEL=SMS

# Kafka topics
NOVU_BRIDGE_KAFKA_INPUT_TOPIC=complaints.domain.events,pt.domain.events,bpa.domain.events

# Novu bootstrap
NOVU_BRIDGE_URL=http://novu-bridge:8290
```

### MDMS ProviderDetail — ValueFirst SMS

```json
{
  "tenantId": "pg.citya",
  "providerName": "valuefirst",
  "channel": "sms",
  "novuIntegrationId": "valuefirst-sms",
  "senderNumber": "YOUR_VF_SENDER_ID",
  "credentials": {
    "username": "YOUR_VF_USERNAME",
    "password": "YOUR_VF_PASSWORD"
  },
  "isActive": true,
  "priority": 1
}
```

### MDMS ProviderDetail — Karix SMS

```json
{
  "tenantId": "pg.citya",
  "providerName": "karix",
  "channel": "sms",
  "novuIntegrationId": "karix-sms",
  "senderNumber": "YOUR_KARIX_SENDER_ID",
  "credentials": {
    "authId": "YOUR_KARIX_AUTH_ID",
    "authToken": "YOUR_KARIX_AUTH_TOKEN"
  },
  "isActive": true,
  "priority": 2
}
```

### MDMS TemplateBinding — SMS (PGR example)

```json
{
  "tenantId": "pg.citya",
  "eventName": "COMPLAINTS.WORKFLOW.APPLY",
  "module": "PGR",
  "channel": "sms",
  "locale": "en_IN",
  "templateId": "complaints-workflow-apply-sms-en",
  "contentSid": "VF-TMPL-COMPLAINT-APPLY-001",
  "dltTemplateId": "1007158620398745312",
  "dltContentType": "1",
  "dltEntityId": "1001158620398745312",
  "paramOrder": ["complaintNo", "status", "serviceName"],
  "requiredVars": ["complaintNo", "status", "serviceName"]
}
```

---

*End of document.*
