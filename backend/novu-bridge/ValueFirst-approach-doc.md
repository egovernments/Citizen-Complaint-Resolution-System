# ValueFirst WhatsApp / SMS Integration — Approach Document

**Project:** Citizen Complaint Resolution System — `novu-bridge`
**Date:** 2026-05-20
**Author:** eGovernments Foundation
**Status:** Draft — Under Review

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [ValueFirst API Quick Reference](#valuefirst-api-quick-reference)
4. [Current Implementation Status](#current-implementation-status)
5. [Recommended Approaches](#recommended-approaches)
   - [Approach A — ValueFirst Adapter + Novu Generic-SMS (Recommended)](#approach-a--valuefirst-adapter--novu-generic-sms-recommended)
   - [Approach B — Direct Java Call (Quick Alternative)](#approach-b--direct-java-call-quick-alternative)
   - [Approach C — Native Novu Provider (Long-term)](#approach-c--native-novu-provider-long-term)
6. [Approach Comparison](#approach-comparison)
7. [Required Code Changes](#required-code-changes)
8. [DLT Compliance (India Mandatory)](#dlt-compliance-india-mandatory)
9. [How to Integrate Any New Module with ValueFirst](#how-to-integrate-any-new-module-with-valuefirst)
10. [Module-Level Changes Required](#module-level-changes-required)
11. [Configuration Reference](#configuration-reference)

---

## Executive Summary

`novu-bridge` currently delivers notifications exclusively over **WhatsApp via Twilio**. This document covers how to add **ValueFirst** as a second provider, supporting both **SMS** and **WhatsApp** channels.

A `ValueFirstProviderStrategy` class already exists in the codebase but is incomplete. The main gap is that **Novu has no native ValueFirst provider**, so we need a bridging strategy. Three viable approaches are described below. **Approach A is recommended** for most teams — it is the fastest to production, requires the fewest code changes, and does not require a Novu fork.

> **Manager note addressed:** A dedicated section — [How to Integrate Any New Module with ValueFirst](#how-to-integrate-any-new-module-with-valuefirst) — explains the step-by-step onboarding process for modules like PT, BPA, and Trade License, including scheduler-based patterns for modules that do not use workflow events.

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
│    8. Trigger Novu (NovuClient)                     │    VonageProviderStrategy
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

**Key source files:**

| File | Purpose |
|------|---------|
| `consumer/DomainEventConsumer.java` | Reads Kafka events; hands off to pipeline |
| `service/DispatchPipelineService.java` | Orchestrates all 11 dispatch steps |
| `service/provider/ValueFirstProviderStrategy.java` | Builds ValueFirst payload (exists, incomplete) |
| `service/provider/NovuProviderStrategyFactory.java` | Routes to correct strategy by `providerName` |
| `service/NovuClient.java` | POSTs to Novu `/v1/events/trigger` |
| `service/ConfigServiceClient.java` | Fetches `TemplateBinding` and `ProviderDetail` |
| `schemas/ProviderDetail.json` | MDMS schema — provider credentials per tenant |
| `schemas/TemplateBinding.json` | MDMS schema — event-to-template mapping |

---

## ValueFirst API Quick Reference

### Authentication

ValueFirst supports two auth methods. **Bearer token is recommended for production.**

| Method | How | TTL |
|--------|-----|-----|
| Bearer Token | POST to token endpoint with Basic Auth; use returned token | 7 days |
| Username/Password | Passed as query params in legacy HTTP API | N/A |

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

## Current Implementation Status

### What is already done

| Component | Status | Notes |
|-----------|--------|-------|
| `ValueFirstProviderStrategy.java` | Exists, incomplete | Builds `_passthrough` body; strategy is registered and auto-discovered |
| `NovuProviderStrategyFactory.java` | Complete | Routes to ValueFirst when `providerName = "valuefirst"` |
| `ProviderDetail.json` schema | Complete | Generic `credentials` map supports any key-value set |
| `NovuClient.triggerWithProviderConfig()` | Complete | Provider-agnostic; delegates to strategy |

### Gaps that must be closed

| # | Gap | Affected File | Impact |
|---|-----|---------------|--------|
| G1 | Novu has no native ValueFirst provider | Novu instance / bootstrap | SMS delivery fails at Novu layer |
| G2 | `formatWhatsappPhone()` always prepends `whatsapp:` | `DispatchPipelineService.java:L249` | Wrong phone format for SMS channel |
| G3 | `TemplateBinding.json` `contentSid` pattern is Twilio-only (`^HX...`) | `schemas/TemplateBinding.json` | ValueFirst template IDs rejected |
| G4 | No Novu bootstrap script for ValueFirst | `config/` | Manual setup required |
| G5 | No MDMS seed data for ValueFirst | `seed-data/` | Config lookup returns nothing |
| G6 | `ValueFirstProviderStrategy.buildProviderConfig()` uses wrong passthrough format | `ValueFirstProviderStrategy.java` | Novu ignores unknown passthrough fields |

---

## Recommended Approaches

Three approaches are recommended. SMPP (high-throughput telecom protocol) is excluded as it only becomes relevant above 500,000 SMS/day and adds significant operational overhead.

---

### Approach A — ValueFirst Adapter + Novu Generic-SMS (Recommended)

#### How it works

Deploy a thin adapter service (Node.js or Spring Boot) that sits between Novu and ValueFirst. Novu uses its built-in `generic-sms` integration to call this adapter, which translates the JSON payload into ValueFirst's XML format.

```
novu-bridge
    │  POST /v1/events/trigger  (no change)
    ▼
Novu API  (generic-sms integration)
    │  POST JSON
    ▼
ValueFirst Adapter  (translate JSON → XML)
    │  POST XML + Bearer token
    ▼
ValueFirst API
```

#### Why choose this

- **Fastest to production** (1–2 working days)
- Minimal changes to `novu-bridge` — most logic stays in the adapter
- No Novu fork required
- Token rotation, DLR forwarding, and retry logic are all isolated in the adapter
- Easy to test and replace independently

#### Cons

- Extra network hop (adapter service)
- Requires deploying and operating the adapter service
- DLT fields must be passed through from `novu-bridge` to adapter

#### Code changes in novu-bridge

**1. Fix phone formatting (G2) — `DispatchPipelineService.java`**

Replace `formatWhatsappPhone()` with a channel-aware version:

```java
private String formatPhone(String mobile, String channel, String tenantId, RequestInfo requestInfo) {
    if (!StringUtils.hasText(mobile)) return null;
    String normalized = mobile.trim();

    if ("SMS".equalsIgnoreCase(channel)) {
        // ValueFirst expects E.164: +91XXXXXXXXXX
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

Remove the `"pattern": "^HX[a-fA-F0-9]{32}$"` constraint from `contentSid`. Replace its description:

```json
"contentSid": {
  "type": "string",
  "description": "Provider-specific template identifier. Twilio: HX + 32 hex chars. ValueFirst: any alphanumeric string."
}
```

**3. Add `novuIntegrationId` to schema and model (G6)**

Add to `schemas/ProviderDetail.json`:
```json
"novuIntegrationId": {
  "type": "string",
  "description": "Novu integration ID to use in provider overrides (e.g. 'valuefirst-sms'). Defaults to providerName if absent."
},
"senderNumber": {
  "type": "string",
  "description": "Sender ID or phone number for this provider"
}
```

Add the same fields to `web/models/ResolvedProvider.java`.

**4. Update `NovuClient.java` to use `novuIntegrationId`**

```java
// Use Novu integration ID as the override key
String novuIntegrationKey = StringUtils.hasText(resolvedProvider.getNovuIntegrationId())
        ? resolvedProvider.getNovuIntegrationId()
        : resolvedProvider.getProviderName().toLowerCase();

Map<String, Object> providerOverrides = new HashMap<>();
providerOverrides.put(novuIntegrationKey, providerConfig);
```

**5. Register ValueFirst adapter in Novu**

Create `config/bootstrap-novu-valuefirst-sms.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
NOVU_BASE_URL=${NOVU_BASE_URL:-http://localhost:3000}
NOVU_API_KEY=${NOVU_API_KEY:?Set NOVU_API_KEY}
ADAPTER_URL=${VALUEFIRST_ADAPTER_URL:?Set VALUEFIRST_ADAPTER_URL}
SENDER_ID=${VF_SENDER_ID:?Set VF_SENDER_ID}

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
      \"baseUrl\": \"$ADAPTER_URL/send\",
      \"apiKeyRequestHeader\": \"x-adapter-key\",
      \"apiKey\": \"${ADAPTER_SECRET_KEY:-changeme}\",
      \"from\": \"$SENDER_ID\"
    }
  }" | jq .
```

**6. ValueFirst Adapter service (`config/valuefirst-adapter/server.js`)**

```js
const express = require('express');
const axios   = require('axios');
const app     = express();
app.use(express.json());

let token = null, tokenExpiry = null;

async function getToken() {
  if (token && tokenExpiry && Date.now() < tokenExpiry) return token;
  const res = await axios.post(
    'https://api.myvfirst.com/psms/api/messages/token?action=generate', {},
    { headers: { Authorization: 'Basic ' +
        Buffer.from(`${process.env.VF_USERNAME}:${process.env.VF_PASSWORD}`).toString('base64') } }
  );
  token = res.data.token;
  tokenExpiry = Date.now() + (6 * 24 + 23) * 3600 * 1000; // refresh before 7-day TTL
  return token;
}

function escapeXml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

app.post('/send', async (req, res) => {
  try {
    const { to, from, body } = req.body;
    const t   = await getToken();
    const mid = `MSG-${Date.now()}`;
    const dltTemplateId = req.body.templateId  || process.env.VF_DLT_TEMPLATE_ID || '';
    const entityId      = req.body.entityId    || process.env.VF_ENTITY_ID       || '';
    const contentType   = req.body.contentType || process.env.VF_DLT_CONTENT_TYPE || '1';

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE>
  <USER USERNAME="${process.env.VF_USERNAME}" PASSWORD="${process.env.VF_PASSWORD}"/>
  <SMS UDH="0" CODING="1" TEXT="${escapeXml(body)}" PROPERTY="0" ID="${mid}"
       DLTTEMPLATEID="${dltTemplateId}" DLTCONTENTTYPE="${contentType}" ENTITYID="${entityId}">
    <ADDRESS FROM="${escapeXml(from || process.env.VF_SENDER_ID)}" TO="${escapeXml(to)}" SEQ="1" TAG="${mid}"/>
  </SMS>
</MESSAGE>`;

    await axios.post('https://api.myvfirst.com/psms/servlet/psms.Eservice2', xml,
      { headers: { 'Content-Type': 'application/xml', Authorization: `Bearer ${t}` } });

    res.json({ msgid: mid, time: new Date().toISOString(), status: 'sent' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DLR callback from ValueFirst
app.get('/dlr', (req, res) => {
  const { msgid, status, to } = req.query;
  console.log('DLR received:', { msgid, status, to });
  // TODO: forward to novu-bridge dispatch log update endpoint
  res.sendStatus(200);
});

app.listen(3001, () => console.log('ValueFirst adapter listening on :3001'));
```

**7. Add MDMS seed data**

Create `seed-data/ProviderDetail-valuefirst.json`:
```json
{
  "tenantId": "pg.citya",
  "providerName": "valuefirst",
  "channel": "sms",
  "novuIntegrationId": "valuefirst-sms",
  "senderNumber": "YOUR_SENDER_ID",
  "credentials": {
    "username": "YOUR_VF_USERNAME",
    "password": "YOUR_VF_PASSWORD"
  },
  "isActive": true,
  "priority": 1
}
```

---

### Approach B — Direct Java Call (Quick Alternative)

#### How it works

`novu-bridge` calls ValueFirst's HTTP API directly from Java, bypassing Novu entirely for SMS delivery. Novu is still used for subscriber management and WhatsApp delivery; only the SMS path is handled directly.

```
novu-bridge
    │
    ├──► NovuClient  (WhatsApp — unchanged)
    │
    └──► ValueFirstDirectClient  (SMS — new Java class)
             │  POST XML + Bearer token
             ▼
         ValueFirst API
```

#### Why choose this

- No adapter service to deploy or maintain
- Full control over retry logic, DLT fields, and DLR handling in Java
- Best if you want a self-contained Spring Boot service with no external dependencies

#### Cons

- Token rotation and XML construction live in Java — adds complexity to `novu-bridge`
- DLR handling requires exposing a new endpoint in `novu-bridge`
- More `novu-bridge` code changes than Approach A

#### Implementation

Add `service/ValueFirstDirectClient.java`:

```java
@Service
@Slf4j
public class ValueFirstDirectClient {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    private String cachedToken;
    private Instant tokenExpiry;

    public String sendSms(String to, String from, String text,
                          String dltTemplateId, String entityId, String contentType) {
        String token = getBearerToken();
        String messageId = "MSG-" + System.currentTimeMillis();
        String xml = buildXml(to, from, text, messageId, dltTemplateId, entityId, contentType);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_XML);
        headers.setBearerAuth(token);

        restTemplate.exchange(
            config.getVfApiUrl(), HttpMethod.POST,
            new HttpEntity<>(xml, headers), String.class);

        return messageId;
    }

    private String getBearerToken() {
        if (cachedToken != null && Instant.now().isBefore(tokenExpiry)) return cachedToken;

        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", "Basic " +
            Base64.getEncoder().encodeToString(
                (config.getVfUsername() + ":" + config.getVfPassword()).getBytes()));

        ResponseEntity<Map> res = restTemplate.exchange(
            config.getVfTokenUrl(), HttpMethod.POST,
            new HttpEntity<>(headers), Map.class);

        cachedToken = (String) res.getBody().get("token");
        tokenExpiry = Instant.now().plus(Duration.ofHours(167)); // 6d 23h
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
            escapeXml(config.getVfUsername()), escapeXml(config.getVfPassword()),
            escapeXml(text), id, escapeXml(dltTemplateId), contentType, escapeXml(entityId),
            escapeXml(from), escapeXml(to), id);
    }

    private String escapeXml(String s) {
        if (s == null) return "";
        return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
                .replace("\"","&quot;").replace("'","&apos;");
    }
}
```

In `DispatchPipelineService.process()`, add a channel-routing branch before calling `NovuClient`:

```java
if ("SMS".equalsIgnoreCase(context.getChannel()) &&
    "valuefirst".equalsIgnoreCase(resolvedProvider.getProviderName())) {
    // Bypass Novu for ValueFirst SMS
    String messageId = valueFirstDirectClient.sendSms(
        formattedPhone,
        resolvedProvider.getSenderNumber(),
        resolvedTemplate.getBodyText(),          // interpolated message body
        resolvedTemplate.getDltTemplateId(),
        resolvedTemplate.getDltEntityId(),
        resolvedTemplate.getDltContentType()
    );
    persist(event, context, resolvedTemplate, "SENT", null, null,
            Map.of("msgid", messageId), 1);
    return DispatchResult.builder()...novuTriggered(false).build();
}
// else: existing Novu path
```

Add to `application.properties`:
```properties
novu.bridge.valuefirst.api.url=https://api.myvfirst.com/psms/servlet/psms.Eservice2
novu.bridge.valuefirst.token.url=https://api.myvfirst.com/psms/api/messages/token?action=generate
novu.bridge.valuefirst.username=${VF_USERNAME}
novu.bridge.valuefirst.password=${VF_PASSWORD}
novu.bridge.valuefirst.sender.id=${VF_SENDER_ID}
```

---

### Approach C — Native Novu Provider (Long-term)

#### How it works

Fork `novuhq/novu`, implement a `valuefirst` SMS provider under `packages/providers/src/lib/sms/valuefirst/`, and run a custom Novu build. This eliminates the adapter entirely.

#### Why choose this

- Cleanest long-term architecture — no adapter, no bypass
- Full DLR support via Novu's native webhook pipeline
- Can be contributed back to the Novu OSS project

#### Cons

- Requires maintaining a Novu fork (high operational overhead)
- Build and deployment pipeline changes for Novu itself
- Estimated 1–2 weeks to implement and validate

#### When to choose

Choose this **after** Approach A is running in production. Migrate to this once the team has bandwidth and wants to eliminate the adapter.

#### Core implementation (TypeScript — Novu fork)

Create `packages/providers/src/lib/sms/valuefirst/valuefirst.provider.ts` in the Novu fork:

```typescript
import axios from 'axios';
import { SmsEventStatusEnum, ISmsOptions, ISmsProvider } from '@novu/stateless';

export class ValueFirstSmsProvider implements ISmsProvider {
  id = 'valuefirst';
  channelType = 'SMS' as const;

  private cachedToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(private config: { username: string; password: string; from: string }) {}

  private async getBearerToken(): Promise<string> {
    if (this.cachedToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.cachedToken;
    }
    const res = await axios.post(
      'https://api.myvfirst.com/psms/api/messages/token?action=generate', {},
      { headers: { Authorization: 'Basic ' +
          Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64') } }
    );
    this.cachedToken = res.data.token;
    this.tokenExpiry = new Date(Date.now() + (6 * 24 + 23) * 3600 * 1000);
    return this.cachedToken!;
  }

  async sendMessage(options: ISmsOptions) {
    const token = await this.getBearerToken();
    const id = `MSG-${Date.now()}`;
    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE>
  <USER USERNAME="${esc(this.config.username)}" PASSWORD="${esc(this.config.password)}"/>
  <SMS UDH="0" CODING="1" TEXT="${esc(options.content)}" PROPERTY="0" ID="${id}">
    <ADDRESS FROM="${esc(this.config.from)}" TO="${esc(options.to)}" SEQ="1" TAG="${id}"/>
  </SMS>
</MESSAGE>`;

    await axios.post('https://api.myvfirst.com/psms/servlet/psms.Eservice2', xml,
      { headers: { 'Content-Type': 'application/xml', Authorization: `Bearer ${token}` } });

    return { id, date: new Date().toISOString() };
  }

  getStatus(status: string): SmsEventStatusEnum {
    const map: Record<string, SmsEventStatusEnum> = {
      DELIVERED: SmsEventStatusEnum.DELIVERED,
      NOT_DELIVERED: SmsEventStatusEnum.FAILED,
      FAILED: SmsEventStatusEnum.FAILED,
      QUEUED: SmsEventStatusEnum.QUEUED,
      SENT: SmsEventStatusEnum.SENT,
    };
    return map[status?.toUpperCase()] ?? SmsEventStatusEnum.UNKNOWN;
  }
}
```

Register the provider in `packages/providers/src/lib/sms/index.ts` and add `ValueFirst = 'valuefirst'` to `SmsProviderIdEnum`.

---

## Approach Comparison

| Criterion | Approach A (Adapter + Generic-SMS) | Approach B (Direct Java) | Approach C (Native Novu) |
|-----------|------------------------------------|--------------------------|--------------------------|
| **Implementation effort** | Medium | Medium | High |
| **novu-bridge code changes** | Small | Medium | Minimal |
| **Requires Novu fork** | No | No | Yes |
| **Separate service to deploy** | Yes (adapter) | No | No |
| **DLR webhook support** | Via adapter | Via new endpoint | Native |
| **DLT compliance** | In adapter + passthrough | In Java client | In provider |
| **Token rotation** | Adapter handles | Java handles | Provider handles |
| **Operational complexity** | Low–Medium | Low | Low (after merge) |
| **Recommended for** | Most teams | Teams preferring pure Java | Long-term / OSS contribution |

---

## Required Code Changes

These changes are **required for Approach A** (and mostly apply to B and C as well):

| File | Change | Gap |
|------|--------|-----|
| `service/DispatchPipelineService.java` | Replace `formatWhatsappPhone()` with channel-aware `formatPhone()` | G2 |
| `schemas/TemplateBinding.json` | Remove Twilio-only `contentSid` pattern | G3 |
| `schemas/ProviderDetail.json` | Add `novuIntegrationId` and `senderNumber` fields | G6 |
| `web/models/ResolvedProvider.java` | Add `novuIntegrationId` and `senderNumber` fields | G6 |
| `service/NovuClient.java` | Use `novuIntegrationId` as the provider override key | G6 |
| `service/provider/ValueFirstProviderStrategy.java` | Update `buildProviderConfig()` for generic-sms passthrough format | G6 |
| `config/bootstrap-novu-valuefirst-sms.sh` | New: creates Novu `generic-sms` integration | G4 |
| `seed-data/ProviderDetail-valuefirst.json` | New: MDMS seed data per tenant | G5 |
| `application.properties` | Add `NOVU_BRIDGE_CHANNEL=SMS` as env-configurable default | G1 |

---

## DLT Compliance (India Mandatory)

TRAI's DLT mandate applies to **all commercial SMS sent in India**. Every message must carry three additional fields.

### Required DLT fields

| Field | Description | Example |
|-------|-------------|---------|
| `DLTTEMPLATEID` | TRAI-registered template ID from DLT portal | `1007158620398745312` |
| `DLTCONTENTTYPE` | `1`=Service Implicit, `2`=Service Explicit, `3`=Transactional, `4`=Promotional | `1` |
| `ENTITYID` | TRAI Principal Entity ID of the organisation | `1001458620398745312` |

### How to pass DLT fields through the pipeline

**Recommended:** Store per-template in `TemplateBinding` (config-service / MDMS).

Add to `schemas/TemplateBinding.json`:
```json
"dltTemplateId":  { "type": "string", "description": "TRAI DLT registered template ID" },
"dltContentType": { "type": "string", "enum": ["1","2","3","4"] },
"dltEntityId":    { "type": "string", "description": "TRAI Principal Entity ID" }
```

Add the same fields to `ResolvedTemplate.java`. Pass them into `ValueFirstProviderStrategy.buildProviderConfig()` and include them in the XML body or adapter passthrough.

**Alternative:** Include DLT fields in the domain event `data` map (useful when different templates of the same module have different DLT IDs):

```json
"data": {
  "complaintNo": "PG-PGR-2026-03-25-043118",
  "dltTemplateId": "1007158620398745312",
  "dltEntityId": "1001458620398745312"
}
```

---

## How to Integrate Any New Module with ValueFirst

This section is a step-by-step reference for onboarding a new DIGIT module (e.g., Property Tax, BPA, Trade License) to send WhatsApp or SMS notifications via ValueFirst through `novu-bridge`.

### Overview: How PGR currently works

The existing Complaints (PGR) integration is the reference implementation. Here is the complete flow:

```
1. Citizen files a complaint in PGR
2. PGR module's workflow engine transitions state (e.g., APPLY → PENDINGFORASSIGNMENT)
3. PGR publishes a domain event to Kafka topic: complaints.domain.events
4. novu-bridge DomainEventConsumer picks up the event
5. DispatchPipelineService runs 9 steps:
     a. Validates the event envelope (required fields, eventName, module)
     b. Resolves the recipient's UUID via UserService
     c. Checks notification consent via PreferenceService
     d. Resolves the message template from ConfigService / MDMS (TemplateBinding)
     e. Resolves the provider credentials from ConfigService / MDMS (ProviderDetail)
     f. Picks the right provider strategy (Twilio / ValueFirst / etc.)
     g. Formats the phone number for the channel (WhatsApp or SMS)
     h. Triggers Novu → Twilio/ValueFirst
     i. Logs the result to nb_dispatch_log
```

The event published by PGR has this structure:

```json
{
  "eventId": "uuid",
  "eventType": "DOMAIN_EVENT",
  "eventName": "COMPLAINTS.WORKFLOW.APPLY",
  "module": "PGR",
  "entityId": "PG-PGR-2026-03-25-043118",
  "tenantId": "pg.citya",
  "actor": { "uuid": "...", "type": "CITIZEN" },
  "workflow": { "action": "APPLY", "fromState": "DRAFT", "toState": "PENDINGFORASSIGNMENT" },
  "stakeholders": [
    { "type": "CITIZEN", "userId": "dd1c8776-...", "mobile": "712345679" }
  ],
  "context": { "locale": "en_IN" },
  "data": {
    "complaintNo": "PG-PGR-2026-03-25-043118",
    "serviceName": "Pothole",
    "status": "Submitted"
  }
}
```

### What needs to change for a new module

There are two integration patterns depending on the module type:

| Pattern | When to use | Example modules |
|---------|-------------|-----------------|
| **Event-driven** | Module has a workflow engine that emits state transitions | BPA, Trade License, Fire NOC, PGR |
| **Scheduler-based** | Module needs time-triggered notifications (due dates, reminders) | Property Tax, Water & Sewerage, Birth/Death certificate |

---

### Pattern 1 — Event-driven Integration (e.g., BPA, Trade License)

These modules already publish workflow transition events. Adding notifications is purely a configuration exercise — **no code changes** in `novu-bridge` are needed.

#### Step 1: Identify notification trigger points

Decide which workflow actions should trigger a notification. Example for BPA (Building Plan Approval):

| Event | Trigger | Recipient |
|-------|---------|-----------|
| `BPA.WORKFLOW.APPLY` | Applicant submits plan | Citizen |
| `BPA.WORKFLOW.APPROVE` | Officer approves plan | Citizen |
| `BPA.WORKFLOW.REJECT` | Officer rejects plan | Citizen |

#### Step 2: Confirm the module publishes domain events

Check that the module is already publishing to a Kafka topic with the standard domain event envelope (`eventId`, `eventName`, `module`, `tenantId`, `stakeholders`, `data`). If not, work with the module team to add publishing (see [Step 2a](#step-2a-adding-event-publishing-to-a-module) below).

#### Step 3: Add the Kafka topic to novu-bridge

In `application.properties`:
```properties
# Add BPA topic alongside complaints topic
novu.bridge.kafka.input.topic=${NOVU_BRIDGE_KAFKA_INPUT_TOPIC:complaints.domain.events,bpa.domain.events}
```

Or deploy a separate `novu-bridge` instance with the BPA topic — useful for isolating notification pipelines by domain.

#### Step 4: Register message templates in MDMS (TemplateBinding)

For each notification event, create a `TemplateBinding` record in config-service / MDMS:

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

> **Note:** `contentSid` is the ValueFirst template ID (or Twilio `HX...` for WhatsApp). `paramOrder` must match the `{1}`, `{2}` variable positions in your DLT-registered template.

#### Step 5: Confirm ProviderDetail exists for the tenant

If the tenant already uses ValueFirst for PGR, the same `ProviderDetail` record will be picked up automatically — no additional seed data is needed. If it is a new tenant, add:

```json
{
  "schemaCode": "ProviderDetail",
  "tenantId": "pg.citya",
  "data": {
    "tenantId": "pg.citya",
    "providerName": "valuefirst",
    "channel": "sms",
    "novuIntegrationId": "valuefirst-sms",
    "senderNumber": "YOUR_SENDER_ID",
    "credentials": { "username": "YOUR_VF_USERNAME", "password": "YOUR_VF_PASSWORD" },
    "isActive": true,
    "priority": 1
  }
}
```

#### Step 6: Register the Novu notification workflow

Run the bootstrap script (or Postman collection) to create a Novu workflow for the new event:

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
```

Then activate it:
```bash
curl -X PUT "$NOVU_BASE_URL/v1/notification-templates/{id}/status" \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  -d '{"active": true}'
```

#### Step 7: Test end-to-end

Use the `/_test-trigger` endpoint in `novu-bridge` to send a test event without going through Kafka:

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

Then test via the full Kafka path with a dry-run endpoint (`send=false`) before going live.

---

### Pattern 2 — Scheduler-based Integration (e.g., Property Tax, Water & Sewerage)

Some modules do not have workflow-driven notification triggers. Instead, notifications are time-triggered — for example, sending a tax due date reminder 30 days before the deadline. These require a **scheduler** component that periodically fetches records and publishes domain events.

#### Architecture

```
Scheduler (new component or existing module cron job)
    │  Queries PT service for bills due in 30 days
    │  Formats each record as a domain event
    │  Publishes to Kafka: pt.domain.events
    ▼
novu-bridge  (same pipeline as PGR — no changes needed)
    │
    ▼
ValueFirst → Citizen SMS
```

#### Step 2a: Adding event publishing to a module

This applies to both event-driven modules that do not yet publish events, and scheduler-based modules that need a new scheduler.

**Option A — Add publishing to the existing module service**

In the PT service (or relevant module), add a Kafka producer call at the right trigger point (workflow state change, record save, etc.):

```java
// In PropertyTaxService.java (or scheduler)
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
    .context(ContextInfo.builder().locale("en_IN").build())
    .data(Map.of(
        "assessmentNumber", assessment.getAssessmentNumber(),
        "propertyId", assessment.getPropertyId(),
        "dueAmount", assessment.getDueAmount().toString(),
        "dueDate", assessment.getDueDate()
    ))
    .build();

producer.push(assessment.getTenantId(), "pt.domain.events", event);
```

**Option B — Write a standalone scheduler service**

If modifying the module service is not possible, deploy a separate scheduler that:
1. Calls the PT service API to fetch records needing notification
2. Constructs domain events
3. Publishes to `pt.domain.events`

A simple Spring Boot `@Scheduled` job is sufficient for most use cases:

```java
@Scheduled(cron = "0 0 9 * * *")  // daily at 9 AM
public void sendPropertyTaxReminders() {
    List<Assessment> dueAssessments = ptServiceClient.getAssessmentsDueSoon(30); // next 30 days
    for (Assessment a : dueAssessments) {
        domainEventPublisher.publishPtDueReminder(a);
    }
}
```

> **Important:** Use Kafka (not direct HTTP calls to `novu-bridge`) so that retries, DLQ, and dispatch logging work correctly.

#### Steps 3–7: Same as Pattern 1

Once events are being published to the Kafka topic, follow Steps 3–7 from Pattern 1 above (add topic to novu-bridge, seed MDMS, bootstrap Novu workflow, test).

---

### Checklist: Integrating a new module

Use this checklist when onboarding any new module:

**Module side**
- [ ] Identify which user actions or time triggers should send notifications
- [ ] Confirm domain events are published to Kafka with the standard envelope format
- [ ] For scheduler-based: implement or deploy a scheduler that publishes events
- [ ] Populate the `data` map with all variables referenced in the message template
- [ ] Ensure `stakeholders` array includes the intended recipient's `userId` and `mobile`

**Configuration (MDMS / config-service)**
- [ ] Register `TemplateBinding` for each `(eventName, channel, locale)` combination
- [ ] Set `paramOrder` matching the `{1}`, `{2}` variable positions in the DLT template
- [ ] Set `dltTemplateId`, `dltEntityId`, `dltContentType` (mandatory for SMS in India)
- [ ] Confirm `ProviderDetail` exists for the tenant and channel

**novu-bridge**
- [ ] Add the new Kafka topic to `novu.bridge.kafka.input.topic` (or deploy a dedicated instance)
- [ ] No Java code changes required for new event-driven modules

**Novu**
- [ ] Create and activate a Novu notification workflow for each new template
- [ ] Verify workflow identifier matches `templateId` in `TemplateBinding`

**Testing**
- [ ] Run `/_dry-run` (send=false) to validate template resolution and variable mapping
- [ ] Run `/_test-trigger` to send a real notification to a test mobile number
- [ ] Check `nb_dispatch_log` for status and any error codes

---

### Best practices

1. **One Kafka topic per domain** — use `pt.domain.events`, `bpa.domain.events` etc. rather than a single shared topic. This makes filtering, monitoring, and scaling easier.
2. **Include all template variables in `data`** — missing variables cause the pipeline to fail with `NB_REQUIRED_VARS_MISSING`. Always populate `data` with every key listed in `requiredVars` and `paramOrder`.
3. **Do not hardcode mobile numbers in the scheduler** — always fetch the citizen's mobile from the user service or the module's own citizen record. Never publish test numbers to production events.
4. **Idempotency** — use a stable, unique `eventId` (e.g., `<module>-<entityId>-<action>-<timestamp>`). `novu-bridge` uses `eventId` as the idempotency key for `nb_dispatch_log`.
5. **Test with dry-run first** — always use `send=false` mode to validate the entire pipeline before sending live SMS.
6. **DLT registration before go-live** — for any new module, ensure all SMS templates are DLT-registered and the `dltTemplateId` is confirmed before sending to real citizens.

---

## Module-Level Changes Required

This section summarises, per module, what changes are needed to enable ValueFirst notifications.

### PGR (Complaints) — Reference implementation

| Component | Status | Action needed |
|-----------|--------|---------------|
| Kafka publishing | Already done | None |
| `TemplateBinding` MDMS records | Already seeded for `COMPLAINTS.WORKFLOW.APPLY` | Add more events as needed |
| `ProviderDetail` MDMS record | Seeded for Twilio (WhatsApp) | Add ValueFirst record for SMS channel |
| novu-bridge | Running | Apply G2–G6 code fixes from [Required Code Changes](#required-code-changes) |
| Scheduler | Not needed | N/A |

### Property Tax (PT)

Property Tax notifications are typically time-triggered (demand notices, payment reminders, penalty alerts) rather than workflow-triggered.

| Component | Status | Action needed |
|-----------|--------|---------------|
| Kafka publishing | Not implemented | Add event publishing to PT service **or** deploy standalone scheduler |
| Scheduler | Not implemented | Write `@Scheduled` job to query bills due in 7 / 15 / 30 days |
| `TemplateBinding` MDMS records | Not seeded | Create records for `PT.PAYMENT.DUE_REMINDER`, `PT.PAYMENT.RECEIPT` etc. |
| `ProviderDetail` MDMS record | Not seeded | Add ValueFirst record for each PT tenant |
| novu-bridge topic config | `complaints.domain.events` only | Add `pt.domain.events` to input topic list |
| DLT templates | Not registered | Register PT message templates on TRAI DLT portal before go-live |

**Scheduler recommendation for PT:** A daily scheduled job (cron `0 0 9 * * *`) that:
1. Fetches all active assessments with dues payable in the next 30 days
2. Excludes assessments where a reminder was already sent in the last 24 hours (use `nb_dispatch_log` for deduplication)
3. Publishes a `PT.PAYMENT.DUE_REMINDER` domain event per assessment to `pt.domain.events`

### Building Plan Approval (BPA)

BPA has a multi-stage workflow (APPLY → FIELDINSPECTION → APPROVE/REJECT). Notifications are workflow-triggered.

| Component | Status | Action needed |
|-----------|--------|---------------|
| Kafka publishing | Check with BPA team | Add event publishing at each relevant workflow step |
| `TemplateBinding` MDMS records | Not seeded | Create for `BPA.WORKFLOW.APPLY`, `BPA.WORKFLOW.APPROVE`, `BPA.WORKFLOW.REJECT` |
| `ProviderDetail` MDMS record | Not seeded | Reuse existing ValueFirst record if same tenant |
| novu-bridge topic config | Not configured | Add `bpa.domain.events` to input topics |
| Scheduler | Not needed | N/A |

### Trade License (TL)

Trade License notifications are a mix of workflow-triggered (application status) and time-triggered (renewal reminders).

| Component | Status | Action needed |
|-----------|--------|---------------|
| Kafka publishing | Check with TL team | Add event publishing for application events; separate scheduler for renewal reminders |
| Renewal reminder scheduler | Not implemented | Schedule 30/15/7 day reminders before license expiry |
| `TemplateBinding` MDMS records | Not seeded | Create for application events and renewal reminders |
| novu-bridge topic config | Not configured | Add `tl.domain.events` |

### Water & Sewerage (WS)

Similar to PT — primarily time-triggered for bill due dates and disconnection notices.

| Component | Status | Action needed |
|-----------|--------|---------------|
| Kafka publishing | Not implemented | Deploy scheduler to publish payment due events |
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
VF_SENDER_ID=YOUR_SENDER_ID
VF_DLT_TEMPLATE_ID=1007158620398745312
VF_DLT_CONTENT_TYPE=1
VF_ENTITY_ID=1001458620398745312

# Adapter service (Approach A only)
VALUEFIRST_ADAPTER_URL=http://valuefirst-adapter.egov:3001
ADAPTER_SECRET_KEY=strong-random-secret

# novu-bridge channel
NOVU_BRIDGE_CHANNEL=SMS

# Kafka topics (comma-separated for multiple modules)
NOVU_BRIDGE_KAFKA_INPUT_TOPIC=complaints.domain.events,pt.domain.events,bpa.domain.events
```

### MDMS ProviderDetail — ValueFirst SMS

```json
{
  "tenantId": "pg.citya",
  "providerName": "valuefirst",
  "channel": "sms",
  "novuIntegrationId": "valuefirst-sms",
  "senderNumber": "YOUR_SENDER_ID",
  "credentials": {
    "username": "YOUR_VF_USERNAME",
    "password": "YOUR_VF_PASSWORD"
  },
  "isActive": true,
  "priority": 1
}
```

### MDMS TemplateBinding — ValueFirst SMS (PGR example)

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
