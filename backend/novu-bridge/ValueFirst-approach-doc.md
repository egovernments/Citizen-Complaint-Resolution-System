# ValueFirst SMS Integration — Approach Document

**Project:** Citizen Complaint Resolution System — `novu-bridge`
**Date:** 2026-04-28
**Author:** eGovernments Foundation
**Status:** Draft

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture](#current-architecture)
3. [ValueFirst API Reference](#valuefirst-api-reference)
4. [What Is Already Implemented](#what-is-already-implemented)
5. [Gap Analysis](#gap-analysis)
6. [Approach 1 — Novu Generic-SMS Integration (Recommended Quick Path)](#approach-1--novu-generic-sms-integration-recommended-quick-path)
7. [Approach 2 — Proxy Adapter Microservice](#approach-2--proxy-adapter-microservice)
8. [Approach 3 — Native Novu Provider (OSS Contribution)](#approach-3--native-novu-provider-oss-contribution)
9. [Approach 4 — Direct ValueFirst API Call (Bypass Novu SMS)](#approach-4--direct-valuefirst-api-call-bypass-novu-sms)
10. [Approach 5 — SMPP High-Throughput Path](#approach-5--smpp-high-throughput-path)
11. [Cross-Cutting: DLT Compliance (India Mandatory)](#cross-cutting-dlt-compliance-india-mandatory)
12. [Required Code Changes in novu-bridge](#required-code-changes-in-novu-bridge)
13. [Configuration Reference](#configuration-reference)
14. [Comparison Matrix](#comparison-matrix)
15. [Recommended Implementation Plan](#recommended-implementation-plan)

---

## Executive Summary

The `novu-bridge` service currently delivers notifications exclusively over **WhatsApp via Twilio**. ValueFirst (vfirst.com) is a CPaaS provider used widely in India that supports both **SMS** and **WhatsApp** channels.

A `ValueFirstProviderStrategy` class already exists in the codebase (`service/provider/ValueFirstProviderStrategy.java`), but it is incomplete and cannot function end-to-end because:

1. **Novu has no native ValueFirst provider** — you cannot simply point Novu at ValueFirst the same way it works with Twilio.
2. The pipeline's `formatWhatsappPhone()` method hardcodes a `whatsapp:` prefix, breaking plain SMS routing.
3. The `TemplateBinding` schema enforces a Twilio-only `contentSid` pattern (`HXabc...`), rejecting ValueFirst template IDs.
4. No Novu bootstrap script or MDMS seed data exists for ValueFirst.

This document describes five approaches to close these gaps, with full implementation details grounded in the existing codebase.

---

## Current Architecture

```
Domain Module
    │
    │ Kafka: complaints.domain.events
    ▼
┌──────────────────────────────────────────────┐
│               novu-bridge                    │
│                                              │
│  DomainEventConsumer                         │
│       │                                      │
│       ▼                                      │
│  DispatchPipelineService                     │
│    1. EnvelopeValidator.validate()           │
│    2. UserServiceClient.resolveUserUuid()    │
│    3. PreferenceServiceClient (consent)      │
│    4. ConfigServiceClient.resolveTemplate()  │
│    5. ConfigServiceClient.resolveProvider()  │
│    6. NovuProviderStrategyFactory            │──► TwilioProviderStrategy
│    7. NovuClient.triggerWithProviderConfig() │    ValueFirstProviderStrategy (stub)
│    8. DispatchLogRepository.upsert()         │    VonageProviderStrategy
└──────────────────────┬───────────────────────┘    GenericProviderStrategy
                       │
                       │ POST /v1/events/trigger
                       ▼
                ┌─────────────┐
                │  Novu API   │
                │ (self-hosted│
                │  port 3000) │
                └──────┬──────┘
                       │
                       │ Twilio integration (WhatsApp)
                       ▼
                  End User
```

**Key files:**

| File | Role |
|------|------|
| `service/provider/ValueFirstProviderStrategy.java` | Builds Novu override payload for ValueFirst (exists, incomplete) |
| `service/provider/NovuProviderStrategyFactory.java` | Selects the right strategy by `providerName` |
| `service/NovuClient.java` | POSTs to Novu `/v1/events/trigger` |
| `service/DispatchPipelineService.java` | Orchestrates the full 11-step pipeline |
| `service/ConfigServiceClient.java` | Fetches `TemplateBinding` and `ProviderDetail` from config-service |
| `schemas/ProviderDetail.json` | MDMS schema for provider credentials per tenant |
| `schemas/TemplateBinding.json` | MDMS schema for event-to-template mapping |
| `config/bootstrap-novu-whatsapp.sh` | Creates Novu integrations and workflows |

---

## ValueFirst API Reference

### Endpoints

| Purpose | URL | Method |
|---------|-----|--------|
| Send SMS (XML API — recommended) | `https://api.myvfirst.com/psms/servlet/psms.Eservice2` | POST |
| Send SMS (legacy HTTP API) | `http://www.myvaluefirst.com/smpp/sendsms` | GET or POST |
| Generate Bearer Token | `https://api.myvfirst.com/psms/api/messages/token?action=generate` | POST |

### Authentication

**Bearer Token (recommended):**
- Obtained by POSTing to the token endpoint with Basic Auth (username:password Base64-encoded).
- Token TTL: 7 days. Must be rotated before expiry.
- Header: `Authorization: Bearer <token>`

**Username/Password (legacy):**
- Passed as query parameters `username` and `password` in the legacy HTTP API.
- Not recommended for production.

### XML API Request Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE>
  <USER USERNAME="your_username" PASSWORD="your_password"/>
  <SMS UDH="0" CODING="1" TEXT="Your OTP is 4567" PROPERTY="0" ID="MSG-001"
       DLTTEMPLATEID="1007158620398745312"
       DLTCONTENTTYPE="1"
       ENTITYID="1001458620398745312">
    <ADDRESS FROM="SENDER_ID" TO="+919876543210" SEQ="1" TAG="MSG-001"/>
  </SMS>
</MESSAGE>
```

### Key Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `FROM` | Yes | Sender ID (max 11 alphanumeric chars) |
| `TO` | Yes | Recipient phone with country code |
| `TEXT` | Yes | Message body (160 chars GSM / 70 Unicode) |
| `ID` | Yes | Unique client-generated message ID |
| `DLTTEMPLATEID` | Yes (India) | DLT-registered template ID |
| `DLTCONTENTTYPE` | Yes (India) | 1=Service Implicit, 2=Service Explicit, 3=Transactional, 4=Promotional |
| `ENTITYID` | Yes (India) | DLT Principal Entity ID |
| `CODING` | No | 1 = text (default) |
| `UDH` | No | 0 = single SMS |

### Response

Success response is an XML echo of the submitted message with ValueFirst's `MSN ID`. Example:

```xml
<MESSAGE>
  <MSN ID="VF-2026-001" STATUS="0"/>
</MESSAGE>
```

### Delivery Report (DLR) Webhook

ValueFirst calls your registered HTTP endpoint (GET/POST) with:

```
msgid=VF-2026-001&status=DELIVERED&to=+919876543210&from=SENDERID&time=1714300000
```

Status values: `DELIVERED`, `NOT_DELIVERED`, `QUEUED`, `SENT`, `FAILED`, `REJECTED`

---

## What Is Already Implemented

The following pieces are **already in the codebase** and do not need to be written from scratch:

### 1. `ValueFirstProviderStrategy.java`
- Registered as a Spring `@Component`, automatically picked up by `NovuProviderStrategyFactory`.
- Matches on `providerName = "valuefirst"` or `"vf"`.
- Builds a `_passthrough` body with `templateId` and `templateVars` (ValueFirst format).
- Supports channels: `sms`, `whatsapp`.

### 2. `NovuProviderStrategyFactory.java`
- Already scans all `NovuProviderStrategy` beans and routes to ValueFirst when `providerName = "valuefirst"`.
- Falls back to `GenericProviderStrategy` for unknown providers.

### 3. `ProviderDetail.json` schema
- Generic `credentials` map (`object` type) already supports any key-value credential set — no schema change needed for ValueFirst credentials.

### 4. `NovuClient.triggerWithProviderConfig()`
- Provider-agnostic; already accepts any `ResolvedProvider` and delegates payload construction to the strategy.

---

## Gap Analysis

These gaps must be resolved regardless of which approach is chosen:

| # | Gap | Affected File(s) | Impact |
|---|-----|-----------------|--------|
| G1 | **Novu has no native ValueFirst SMS provider** — Novu cannot route to ValueFirst without one | Novu instance / bootstrap | Delivery fails at Novu layer |
| G2 | `formatWhatsappPhone()` always prepends `whatsapp:` — breaks plain SMS | `DispatchPipelineService.java:L180` | SMS to ValueFirst gets wrong phone format |
| G3 | `TemplateBinding.json` `contentSid` pattern is `^HX[a-fA-F0-9]{32}$` — Twilio-only | `schemas/TemplateBinding.json` | ValueFirst template IDs rejected at config level |
| G4 | `validateContentSid()` fails for non-HX content SIDs unless they pass the softer path | `DispatchPipelineService.java:L296` | Template validation throws for ValueFirst |
| G5 | `novu.bridge.channel` is `WHATSAPP` by default — no `SMS` routing in pipeline | `application.properties` | Channel mismatch in DerivedContext |
| G6 | No Novu bootstrap script for ValueFirst / `generic-sms` integration | `config/` | Manual Novu setup required, error-prone |
| G7 | No MDMS seed data (`ProviderDetail`) for ValueFirst | `seed-data/` | Config-service lookup returns nothing |
| G8 | `ValueFirstProviderStrategy.buildProviderConfig()` uses `_passthrough` body format — only works if Novu understands it | `ValueFirstProviderStrategy.java:L55` | Novu silently ignores unknown passthrough fields |

---

## Approach 1 — Novu Generic-SMS Integration (Recommended Quick Path)

### How It Works

Novu ships a built-in `generic-sms` provider that accepts any HTTP API endpoint via configuration. You bootstrap Novu to create a `generic-sms` integration pointing to a ValueFirst adapter endpoint. `novu-bridge` continues to call Novu exactly as it does today; Novu handles the last-mile delivery to ValueFirst.

```
novu-bridge
    │  POST /v1/events/trigger  (unchanged)
    ▼
Novu API
    │  uses "generic-sms" integration
    ▼
ValueFirst Adapter (thin Node.js/Spring proxy)
    │  POST XML
    ▼
ValueFirst API (api.myvfirst.com)
```

### Trade-offs

| Pro | Con |
|-----|-----|
| Minimal changes to `novu-bridge` | Requires an adapter service to translate JSON → XML |
| No Novu fork needed | DLR webhooks need forwarding through adapter |
| Works with Novu Cloud or self-hosted | Extra network hop |
| Fastest to production | Token rotation managed outside novu-bridge |

### Step 1 — Fix G2: Channel-Aware Phone Formatting

In `DispatchPipelineService.java`, the `formatWhatsappPhone()` method must respect the channel:

```java
// DispatchPipelineService.java — replace formatWhatsappPhone()

private String formatPhone(String mobile, String channel, String tenantId, RequestInfo requestInfo) {
    if (!StringUtils.hasText(mobile)) return null;
    String normalized = mobile.trim();

    if ("SMS".equalsIgnoreCase(channel)) {
        // ValueFirst expects E.164 format: +91XXXXXXXXXX
        if (normalized.startsWith("+")) return normalized;
        MobileValidationConfig cfg = mdmsServiceClient.getMobileValidationConfig(tenantId, requestInfo);
        if (normalized.matches(cfg.getPattern())) return cfg.getPrefix() + normalized;
        throw new CustomException("INVALID_MOBILE_NUMBER", "Mobile does not match pattern for SMS channel");
    }

    // WhatsApp path (existing logic)
    if (normalized.startsWith("whatsapp:")) return normalized;
    if (normalized.startsWith("+")) return "whatsapp:" + normalized;
    MobileValidationConfig cfg = mdmsServiceClient.getMobileValidationConfig(tenantId, requestInfo);
    if (normalized.matches(cfg.getPattern())) return "whatsapp:" + cfg.getPrefix() + normalized;
    throw new CustomException("INVALID_MOBILE_NUMBER", "Mobile does not match pattern for WhatsApp channel");
}
```

Update all callers of `formatWhatsappPhone()` to pass `context.getChannel()`.

### Step 2 — Fix G3: Relax TemplateBinding contentSid Pattern

In `schemas/TemplateBinding.json`, replace the Twilio-specific pattern:

```json
"contentSid": {
  "type": "string",
  "description": "Provider-specific template identifier (Twilio: HX..., ValueFirst: alphanumeric)",
  "examples": ["HX350aa0b139780ea87f554276b1f68d6c", "VF-TMPL-OTP-001"]
}
```

Remove the `"pattern": "^HX[a-fA-F0-9]{32}$"` line entirely — validation is now delegated to each `NovuProviderStrategy.isContentSidValid()`.

### Step 3 — Fix G4: Soften Pipeline ContentSid Validation

In `DispatchPipelineService.java`, `validateContentSid()` already has a softer path for non-HX strings. Verify it is reachable for ValueFirst:

```java
private void validateContentSid(String contentSid) {
    if (!StringUtils.hasText(contentSid)) {
        throw new CustomException("NB_CONTENT_SID_INVALID", "ContentSid cannot be empty");
    }
    // Twilio-format: strict check
    if (contentSid.startsWith("HX") || contentSid.startsWith("hx")) {
        if (!TWILIO_CONTENT_SID_PATTERN.matcher(contentSid).matches()) {
            throw new CustomException("NB_CONTENT_SID_INVALID",
                    "Invalid Twilio contentSid; expected HX followed by 32 hex chars");
        }
    }
    // All other providers: any non-empty string is valid
}
```

No code change needed here — this is already correct. Confirm that `resolveContentSid()` does not accidentally apply the Twilio guard to ValueFirst templates.

### Step 4 — Fix G8: Update ValueFirstProviderStrategy for generic-sms

When Novu routes via `generic-sms`, the `_passthrough` structure it understands is:

```json
{
  "providers": {
    "generic-sms": {
      "to": "+919876543210",
      "from": "SENDER_ID",
      "content": "Your OTP is 4567"
    }
  }
}
```

Update `ValueFirstProviderStrategy.buildProviderConfig()`:

```java
@Override
public Map<String, Object> buildProviderConfig(ResolvedProvider resolvedProvider,
                                               ResolvedTemplate resolvedTemplate,
                                               Map<String, String> contentVariables) {
    Map<String, Object> config = new HashMap<>();

    // Credentials passed through to generic-sms Novu integration
    if (resolvedProvider.getCredentials() != null) {
        config.put("credentials", resolvedProvider.getCredentials());
    }

    // Sender ID
    if (StringUtils.hasText(resolvedProvider.getSenderNumber())) {
        config.put("from", resolvedProvider.getSenderNumber());
    }

    // Template ID for DLT-compliant messaging
    String templateId = resolvedTemplate.getContentSid();
    if (StringUtils.hasText(templateId)) {
        // Build the message body by interpolating variables into the template
        // ValueFirst matches template variables positionally: {{var1}}, {{var2}}
        Map<String, Object> body = new HashMap<>();
        body.put("templateId", templateId);
        if (contentVariables != null && !contentVariables.isEmpty()) {
            // Map 1→var1, 2→var2 per ValueFirst convention
            Map<String, Object> vars = new LinkedHashMap<>();
            contentVariables.forEach((k, v) -> vars.put("var" + k, v));
            body.put("templateVars", vars);
        }
        Map<String, Object> passthrough = new HashMap<>();
        passthrough.put("body", body);
        config.put("_passthrough", passthrough);
    }

    return config;
}
```

**Important:** The `providerName` in `NovuClient.triggerWithProviderConfig()` must match the Novu integration identifier. For `generic-sms`, the override key must be `"generic-sms"`, not `"valuefirst"`. Update `NovuClient`:

```java
// NovuClient.java — in triggerWithProviderConfig()
// Use the Novu integration identifier, not the business provider name
String novuIntegrationKey = resolvedProvider.getNovuIntegrationId() != null
        ? resolvedProvider.getNovuIntegrationId()
        : resolvedProvider.getProviderName().toLowerCase();

Map<String, Object> providerOverrides = new HashMap<>();
providerOverrides.put(novuIntegrationKey, providerConfig);
```

Add `novuIntegrationId` field to `ResolvedProvider.java` and `ProviderDetail.json`.

### Step 5 — Fix G6: Bootstrap Novu with generic-sms for ValueFirst

Create `config/bootstrap-novu-valuefirst-sms.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Load env
ENV_FILE=${NOVU_ENV_FILE:-.env.novu}
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

NOVU_BASE_URL=${NOVU_BASE_URL:-http://localhost:3000}
NOVU_API_KEY=${NOVU_API_KEY:?Set NOVU_API_KEY}
ADAPTER_BASE_URL=${VALUEFIRST_ADAPTER_URL:?Set VALUEFIRST_ADAPTER_URL}
SENDER_ID=${VF_SENDER_ID:?Set VF_SENDER_ID}

echo "=== Creating ValueFirst generic-sms integration in Novu ==="
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
      \"baseUrl\": \"$ADAPTER_BASE_URL/send\",
      \"apiKeyRequestHeader\": \"x-adapter-key\",
      \"apiKey\": \"${ADAPTER_SECRET_KEY:-changeme}\",
      \"from\": \"$SENDER_ID\",
      \"idPath\": \"msgid\",
      \"datePath\": \"time\"
    }
  }" | jq .

echo "=== Done ==="
```

### Step 6 — Build the ValueFirst Adapter Service

Create a thin Node.js adapter (`config/valuefirst-adapter/server.js`):

```js
const express = require('express');
const axios   = require('axios');
const app     = express();
app.use(express.json());

// In-memory token cache
let token = null, tokenExpiry = null;

async function getToken() {
  if (token && tokenExpiry && Date.now() < tokenExpiry) return token;
  const res = await axios.post(
    'https://api.myvfirst.com/psms/api/messages/token?action=generate',
    {},
    { headers: { Authorization: 'Basic ' +
        Buffer.from(`${process.env.VF_USERNAME}:${process.env.VF_PASSWORD}`).toString('base64') } }
  );
  token = res.data.token;
  tokenExpiry = Date.now() + (6 * 24 + 23) * 3600 * 1000; // 6d 23h
  return token;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

// POST /send — called by Novu generic-sms integration
app.post('/send', async (req, res) => {
  try {
    const { to, from, body } = req.body;
    const t   = await getToken();
    const mid = `MSG-${Date.now()}`;

    // Pull DLT fields from passthrough if present
    const dltTemplateId  = req.body.templateId  || process.env.VF_DLT_TEMPLATE_ID  || '';
    const entityId       = req.body.entityId     || process.env.VF_ENTITY_ID        || '';
    const contentType    = req.body.contentType  || process.env.VF_DLT_CONTENT_TYPE || '1';

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE>
  <USER USERNAME="${process.env.VF_USERNAME}" PASSWORD="${process.env.VF_PASSWORD}"/>
  <SMS UDH="0" CODING="1" TEXT="${escapeXml(body)}" PROPERTY="0" ID="${mid}"
       DLTTEMPLATEID="${dltTemplateId}" DLTCONTENTTYPE="${contentType}" ENTITYID="${entityId}">
    <ADDRESS FROM="${escapeXml(from || process.env.VF_SENDER_ID)}" TO="${escapeXml(to)}" SEQ="1" TAG="${mid}"/>
  </SMS>
</MESSAGE>`;

    await axios.post(
      'https://api.myvfirst.com/psms/servlet/psms.Eservice2', xml,
      { headers: { 'Content-Type': 'application/xml', Authorization: `Bearer ${t}` } }
    );

    res.json({ msgid: mid, time: new Date().toISOString(), status: 'sent' });
  } catch (e) {
    console.error('Send failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /dlr — ValueFirst delivery report callback
app.get('/dlr', (req, res) => {
  const { msgid, status, to, from, time } = req.query;
  console.log('DLR:', { msgid, status, to, from, time });
  // TODO: forward to Novu webhook or write to dispatch_log
  res.sendStatus(200);
});

app.listen(3001, () => console.log('ValueFirst adapter :3001'));
```

### Step 7 — Fix G7: Add MDMS Seed Data for ValueFirst

Create `seed-data/ProviderDetail-valuefirst.json`:

```json
{
  "tenantId": "pg.citya",
  "providerName": "valuefirst",
  "channel": "sms",
  "novuIntegrationId": "valuefirst-sms",
  "credentials": {
    "username": "YOUR_VF_USERNAME",
    "password": "YOUR_VF_PASSWORD"
  },
  "senderNumber": "YOUR_SENDER_ID",
  "novuApiKey": "",
  "isActive": true,
  "priority": 1
}
```

### Step 8 — Add `novuIntegrationId` to ProviderDetail Schema

In `schemas/ProviderDetail.json`:

```json
"novuIntegrationId": {
  "type": "string",
  "description": "Novu integration identifier to use in overrides (e.g. 'valuefirst-sms', 'twilio-whatsapp'). Defaults to providerName if absent."
},
"senderNumber": {
  "type": "string",
  "description": "Sender ID or phone number for this provider"
}
```

---

## Approach 2 — Proxy Adapter Microservice

### How It Works

A standalone Spring Boot or Node.js service acts as the bridge between Novu and ValueFirst. `novu-bridge` calls Novu normally; Novu routes SMS to the adapter; the adapter calls ValueFirst's XML API.

This is **identical to Approach 1** in its novu-bridge changes. The adapter is deployed as a separate service rather than a sidecar script.

### Additional Steps vs Approach 1

1. **Dockerize the adapter:**

```dockerfile
# config/valuefirst-adapter/Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js .
EXPOSE 3001
CMD ["node", "server.js"]
```

2. **Add Helm chart** under `deploy-as-code/helm/charts/common-services/valuefirst-adapter/` with appropriate `Deployment`, `Service`, and `ConfigMap` resources.

3. **Register DLR URL** with ValueFirst by contacting their support team and providing `https://your-adapter.domain/dlr`.

4. **Forward DLR events to Novu or dispatch_log:**

```js
// In the adapter's /dlr handler
app.get('/dlr', async (req, res) => {
  const { msgid, status } = req.query;
  // Option A: Update dispatch_log directly via novu-bridge internal API
  await axios.post(`${process.env.NOVU_BRIDGE_URL}/novu-bridge/novu-adapter/v1/dispatch/_dlr`, {
    msgid, status, ...req.query
  });
  res.sendStatus(200);
});
```

---

## Approach 3 — Native Novu Provider (OSS Contribution)

### How It Works

Fork `novuhq/novu`, implement a `valuefirst` provider under `packages/providers/src/lib/sms/valuefirst/`, and run a custom Novu build. This eliminates the adapter entirely — Novu calls ValueFirst directly.

### When to Choose

- Your team self-hosts Novu and controls the build.
- You want to eliminate the adapter hop.
- You intend to contribute the provider upstream.

### Implementation

Create the following in the Novu repository fork:

**`packages/providers/src/lib/sms/valuefirst/valuefirst.provider.ts`**

```typescript
import axios from 'axios';
import { SmsEventStatusEnum, ISmsOptions, ISmsProvider, ISmsWebhookBody } from '@novu/stateless';

export interface IValueFirstConfig {
  username: string;
  password: string;
  from: string;
  apiKey?: string;        // pre-generated Bearer token (optional; generated if absent)
  dlrUrl?: string;
}

export class ValueFirstSmsProvider implements ISmsProvider {
  id = 'valuefirst';
  channelType = 'SMS' as const;

  private cachedToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(private config: IValueFirstConfig) {}

  private async getBearerToken(): Promise<string> {
    if (this.config.apiKey) return this.config.apiKey;
    if (this.cachedToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.cachedToken;
    }
    const res = await axios.post(
      'https://api.myvfirst.com/psms/api/messages/token?action=generate',
      {},
      { headers: { Authorization: 'Basic ' +
          Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64') } }
    );
    this.cachedToken = res.data.token;
    this.tokenExpiry = new Date(Date.now() + (6 * 24 + 23) * 3600 * 1000);
    return this.cachedToken!;
  }

  async sendMessage(options: ISmsOptions) {
    const token = await this.getBearerToken();
    const messageId = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const xml = this.buildXml(options.to, options.from ?? this.config.from,
                               options.content, messageId);

    const res = await axios.post(
      'https://api.myvfirst.com/psms/servlet/psms.Eservice2',
      xml,
      { headers: { 'Content-Type': 'application/xml', Authorization: `Bearer ${token}` } }
    );

    return { id: this.extractId(res.data) ?? messageId, date: new Date().toISOString() };
  }

  private buildXml(to: string, from: string, text: string, id: string): string {
    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    return `<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE>
  <USER USERNAME="${esc(this.config.username)}" PASSWORD="${esc(this.config.password)}"/>
  <SMS UDH="0" CODING="1" TEXT="${esc(text)}" PROPERTY="0" ID="${id}">
    <ADDRESS FROM="${esc(from)}" TO="${esc(to)}" SEQ="1" TAG="${id}"/>
  </SMS>
</MESSAGE>`;
  }

  private extractId(xml: string): string | null {
    const m = xml.match(/ID="([^"]+)"/);
    return m ? m[1] : null;
  }

  getMessageId(body: Record<string, unknown> | Record<string, unknown>[]): string {
    if (Array.isArray(body)) return body[0]?.msgid as string;
    return body.msgid as string;
  }

  parseEventBody(body: Record<string, unknown>, id: string): ISmsWebhookBody {
    return {
      id, from: body.from as string, to: body.to as string,
      status: this.getStatus(body.status as string),
      date: (body.time as string) ?? new Date().toISOString(),
      content: body.text as string,
    };
  }

  getStatus(status: string): SmsEventStatusEnum {
    const map: Record<string, SmsEventStatusEnum> = {
      DELIVERED:     SmsEventStatusEnum.DELIVERED,
      NOT_DELIVERED: SmsEventStatusEnum.FAILED,
      QUEUED:        SmsEventStatusEnum.QUEUED,
      SENT:          SmsEventStatusEnum.SENT,
      FAILED:        SmsEventStatusEnum.FAILED,
      REJECTED:      SmsEventStatusEnum.FAILED,
    };
    return map[status?.toUpperCase()] ?? SmsEventStatusEnum.UNKNOWN;
  }
}
```

**`packages/providers/src/lib/sms/valuefirst/index.ts`**

```typescript
export { ValueFirstSmsProvider } from './valuefirst.provider';
export type { IValueFirstConfig } from './valuefirst.provider';
```

**Register** in `packages/providers/src/lib/sms/index.ts`:

```typescript
export * from './valuefirst';
```

**Add enum value** in `SmsProviderIdEnum`:

```typescript
ValueFirst = 'valuefirst',
```

**novu-bridge change:** Remove the adapter entirely. Create a Novu `valuefirst` integration (not `generic-sms`) via an updated bootstrap script using the native provider's credentials format.

---

## Approach 4 — Direct ValueFirst API Call (Bypass Novu SMS)

### How It Works

`novu-bridge` calls ValueFirst's HTTP API **directly** from Java, bypassing Novu entirely for SMS delivery. Novu is still used for subscriber management and audit, but not for the actual SMS send.

### When to Choose

- You want zero dependency on Novu for SMS delivery.
- You need full control over retry, DLT fields, and DLR processing in Java.
- You are building a long-term self-managed SMS path.

### Implementation

Add a `ValueFirstDirectClient.java` service:

```java
// service/ValueFirstDirectClient.java
@Service
@Slf4j
public class ValueFirstDirectClient {

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;

    // Token cache
    private String cachedToken;
    private Instant tokenExpiry;

    public ValueFirstDirectClient(RestTemplate restTemplate, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    public String sendSms(String to, String from, String text,
                          String dltTemplateId, String entityId, String contentType) {
        String token = getBearerToken();
        String messageId = "MSG-" + System.currentTimeMillis();

        String xml = buildXml(to, from, text, messageId, dltTemplateId, entityId, contentType);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_XML);
        headers.setBearerAuth(token);

        ResponseEntity<String> response = restTemplate.exchange(
            "https://api.myvfirst.com/psms/servlet/psms.Eservice2",
            HttpMethod.POST,
            new HttpEntity<>(xml, headers),
            String.class
        );

        log.info("ValueFirst response: status={}, body={}", response.getStatusCode(), response.getBody());
        return messageId;
    }

    private String getBearerToken() {
        if (cachedToken != null && tokenExpiry != null && Instant.now().isBefore(tokenExpiry)) {
            return cachedToken;
        }
        // POST to token endpoint with Basic Auth
        HttpHeaders headers = new HttpHeaders();
        String creds = config.getVfUsername() + ":" + config.getVfPassword();
        headers.set("Authorization", "Basic " + Base64.getEncoder().encodeToString(creds.getBytes()));

        ResponseEntity<Map> res = restTemplate.exchange(
            "https://api.myvfirst.com/psms/api/messages/token?action=generate",
            HttpMethod.POST,
            new HttpEntity<>(headers),
            Map.class
        );

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
            escapeXml(config.getVfUsername()),
            escapeXml(config.getVfPassword()),
            escapeXml(text), id,
            escapeXml(dltTemplateId), contentType, escapeXml(entityId),
            escapeXml(from), escapeXml(to), id);
    }

    private String escapeXml(String s) {
        if (s == null) return "";
        return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
                .replace("\"","&quot;").replace("'","&apos;");
    }
}
```

Add a `ValueFirstProviderStrategy` override in `DispatchPipelineService` to intercept the SMS channel and call `ValueFirstDirectClient` instead of `NovuClient`. This requires adding a channel-routing branch in `process()`.

Add to `application.properties`:

```properties
novu.bridge.valuefirst.api.url=https://api.myvfirst.com/psms/servlet/psms.Eservice2
novu.bridge.valuefirst.token.url=https://api.myvfirst.com/psms/api/messages/token?action=generate
novu.bridge.valuefirst.username=${VF_USERNAME}
novu.bridge.valuefirst.password=${VF_PASSWORD}
novu.bridge.valuefirst.sender.id=${VF_SENDER_ID}
```

---

## Approach 5 — SMPP High-Throughput Path

### How It Works

ValueFirst supports SMPP (Short Message Peer-to-Peer), the telecom binary protocol. Suitable for deployments sending 500 000+ SMS per day where HTTP API latency matters.

### When to Choose

- Traffic exceeds 500 000 SMS/day.
- Sub-second delivery confirmation is required.
- Your team has SMPP operational experience.

### Implementation Sketch (Java)

Add dependency:

```xml
<!-- pom.xml -->
<dependency>
    <groupId>org.jsmpp</groupId>
    <artifactId>jsmpp</artifactId>
    <version>3.0.0</version>
</dependency>
```

Create `SmppClient.java`:

```java
@Service
@Slf4j
public class ValueFirstSmppClient implements SmesMessageReceiverListener {

    private SMPPSession session;

    @PostConstruct
    public void connect() throws Exception {
        session = new SMPPSession();
        session.connectAndBind(
            System.getenv("VF_SMPP_HOST"),
            Integer.parseInt(System.getenv().getOrDefault("VF_SMPP_PORT", "2775")),
            new BindParameter(BindType.BIND_TRX,
                System.getenv("VF_SMPP_SYSTEM_ID"),
                System.getenv("VF_SMPP_PASSWORD"),
                "cp", TypeOfNumber.UNKNOWN, NumberingPlanIndicator.UNKNOWN, null)
        );
        session.setMessageReceiverListener(this);
        log.info("SMPP session bound to ValueFirst");
    }

    public String sendSms(String from, String to, String text) throws Exception {
        return session.submitShortMessage(
            "CMT", TypeOfNumber.ALPHANUMERIC, NumberingPlanIndicator.UNKNOWN, from,
            TypeOfNumber.INTERNATIONAL, NumberingPlanIndicator.E164, to,
            new ESMClass(), (byte)0, (byte)1,
            null, null, new RegisteredDelivery(SMSCDeliveryReceipt.SUCCESS_FAILURE),
            (byte)0, new GeneralDataCoding(Alphabet.ALPHA_DEFAULT, MessageClass.CLASS1, false),
            (byte)0, text.getBytes()
        );
    }

    @Override
    public void onAcceptDeliverSm(DeliverSm deliverSm) {
        log.info("DLR: from={} to={} message={}", deliverSm.getSourceAddr(),
                 deliverSm.getDestAddress(), new String(deliverSm.getShortMessage()));
    }

    @PreDestroy
    public void disconnect() {
        if (session != null) session.unbindAndClose();
    }
}
```

---

## Cross-Cutting: DLT Compliance (India Mandatory)

TRAI's DLT mandate applies to **all** commercial SMS sent in India. ValueFirst requires these fields in every request:

| Field | Description | Example |
|-------|-------------|---------|
| `DLTTEMPLATEID` | TRAI-registered template ID | `1007158620398745312` |
| `DLTCONTENTTYPE` | 1=Service Implicit, 2=Service Explicit, 3=Transactional, 4=Promotional | `1` |
| `ENTITYID` | TRAI-registered Principal Entity ID | `1001458620398745312` |

### How to Pass DLT Fields Through the Pipeline

**Option A — Per-template in TemplateBinding (recommended):**

Add to `schemas/TemplateBinding.json`:

```json
"dltTemplateId": {
  "type": "string",
  "description": "TRAI DLT registered template ID for this message"
},
"dltContentType": {
  "type": "string",
  "enum": ["1", "2", "3", "4"],
  "description": "1=Service Implicit, 2=Service Explicit, 3=Transactional, 4=Promotional"
},
"dltEntityId": {
  "type": "string",
  "description": "TRAI Principal Entity ID"
}
```

Add the same fields to `ResolvedTemplate.java`. Pass them into `ValueFirstProviderStrategy.buildProviderConfig()` and include them in the XML or passthrough body.

**Option B — Per-event via `data` map:**

Have the publishing module include DLT fields in the domain event `data` map:

```json
"data": {
  "complaintNo": "PG-PGR-2026-03-25-043118",
  "dltTemplateId": "1007158620398745312",
  "dltEntityId": "1001458620398745312"
}
```

Read them in `ValueFirstProviderStrategy.buildProviderConfig()` from `contentVariables` or pass the raw `data` map.

---

## Required Code Changes in novu-bridge

The following table summarises every file that must change, regardless of which approach is taken:

| File | Change | Gap Fixed |
|------|--------|-----------|
| `service/DispatchPipelineService.java` | Replace `formatWhatsappPhone()` with channel-aware `formatPhone()` | G2 |
| `service/DispatchPipelineService.java` | Pass `context.getChannel()` to phone-format call | G2 |
| `schemas/TemplateBinding.json` | Remove Twilio-only `contentSid` pattern | G3 |
| `schemas/ProviderDetail.json` | Add `novuIntegrationId` and `senderNumber` fields | G8 |
| `web/models/ResolvedProvider.java` | Add `novuIntegrationId` and `senderNumber` fields | G8 |
| `service/NovuClient.java` | Use `novuIntegrationId` as override key instead of `providerName` | G8 |
| `service/provider/ValueFirstProviderStrategy.java` | Update `buildProviderConfig()` for correct generic-sms passthrough | G8 |
| `config/bootstrap-novu-valuefirst-sms.sh` | New: creates Novu generic-sms integration for ValueFirst | G6 |
| `seed-data/ProviderDetail-valuefirst.json` | New: MDMS seed data for ValueFirst per tenant | G7 |
| `application.properties` | Add `novu.bridge.channel=SMS` as configurable env default | G5 |

---

## Configuration Reference

### Environment Variables

```bash
# ValueFirst credentials
VF_USERNAME=your_valuefirst_username
VF_PASSWORD=your_valuefirst_password
VF_SENDER_ID=YOUR_SENDER_ID
VF_DLT_TEMPLATE_ID=1007158620398745312
VF_DLT_CONTENT_TYPE=1
VF_ENTITY_ID=1001458620398745312

# Adapter service (Approaches 1 & 2)
VALUEFIRST_ADAPTER_URL=http://valuefirst-adapter.egov:3001
ADAPTER_SECRET_KEY=strong-random-secret

# SMPP (Approach 5)
VF_SMPP_HOST=smpp.myvfirst.com
VF_SMPP_PORT=2775
VF_SMPP_SYSTEM_ID=your_smpp_system_id
VF_SMPP_PASSWORD=your_smpp_password

# novu-bridge channel override
NOVU_BRIDGE_CHANNEL=SMS
```

### MDMS ProviderDetail Record (ValueFirst)

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

### MDMS TemplateBinding Record (ValueFirst SMS)

```json
{
  "tenantId": "pg.citya",
  "eventName": "COMPLAINTS.WORKFLOW.APPLY",
  "channel": "sms",
  "locale": "en_IN",
  "templateId": "complaints-workflow-apply-sms",
  "contentSid": "VF-TMPL-COMPLAINT-APPLY-001",
  "dltTemplateId": "1007158620398745312",
  "dltContentType": "1",
  "dltEntityId": "1001458620398745312",
  "paramOrder": ["complaintNo", "status", "serviceName"],
  "requiredVars": ["complaintNo", "status", "serviceName"]
}
```

---

## Comparison Matrix

| Criterion | Approach 1 (Generic-SMS + Adapter) | Approach 2 (Adapter Microservice) | Approach 3 (Native Novu Provider) | Approach 4 (Direct Java Call) | Approach 5 (SMPP) |
|-----------|------------------------------------|------------------------------------|-----------------------------------|-------------------------------|-------------------|
| **Implementation effort** | Medium | Medium-High | High | Medium | Very High |
| **novu-bridge code changes** | Small | Small | Minimal | Medium | Small |
| **Requires Novu fork** | No | No | Yes | No | No |
| **DLR webhook support** | Via adapter | Via adapter | Native | Native | Native |
| **DLT compliance** | Via adapter | Via adapter | In provider | In Java client | In SMPP client |
| **Token rotation** | Adapter handles | Adapter handles | Provider handles | Java client handles | Session-based |
| **Time to production** | 1–2 days | 2–4 days | 1–2 weeks | 2–3 days | 2–4 weeks |
| **Multi-tenant support** | Yes (per integration) | Yes | Yes | Yes | Shared session |
| **Throughput** | Medium | Medium | Medium | Medium | Very High |
| **Operational complexity** | Low-Medium | Medium | Low (after merge) | Low | High |

---

## Recommended Implementation Plan

For the eGovernments / DIGIT deployment context (government sector, India, DLT-mandatory, multi-tenant):

### Phase 1 — Immediate (Week 1)

1. Apply the **6 code fixes** listed in [Required Code Changes](#required-code-changes-in-novu-bridge).
2. Deploy the **ValueFirst adapter** (`config/valuefirst-adapter/`) alongside `novu-bridge`.
3. Run `bootstrap-novu-valuefirst-sms.sh` to register the Novu `generic-sms` integration.
4. Seed MDMS with `ProviderDetail` and updated `TemplateBinding` records for one pilot tenant.
5. Test end-to-end using `/_test-trigger` and `/_dry-run` endpoints.

### Phase 2 — Short-term (Weeks 2–4)

1. Add DLT fields (`dltTemplateId`, `dltEntityId`, `dltContentType`) to `TemplateBinding` schema and seed all templates.
2. Wire DLR webhook in the adapter to write back to `nb_dispatch_log` via a new internal `novu-bridge` endpoint.
3. Add token rotation monitoring and alerting (token expires every 7 days).
4. Roll out to all tenants via MDMS per-tenant `ProviderDetail` records.

### Phase 3 — Long-term (Month 2+)

1. Evaluate **Approach 3** (native Novu provider) and submit a PR upstream — this removes the adapter entirely.
2. If daily SMS volume exceeds 500 000, pilot **Approach 5** (SMPP) on a non-production tenant.
3. Consider running ValueFirst (SMS) and Twilio (WhatsApp) simultaneously using Novu's multi-channel workflow — one domain event triggers both channels based on user preference.

---

*End of document.*
