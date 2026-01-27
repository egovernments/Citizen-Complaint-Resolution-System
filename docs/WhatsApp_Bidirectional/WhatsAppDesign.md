```md
# DIGIT WhatsApp Bidirectional Notifications (Novu for WhatsApp) — Implementation Context

This document is the authoritative context for implementing WhatsApp bidirectional conversation + outbound WhatsApp notifications in DIGIT using **Novu only for WhatsApp delivery**, while keeping **DIGIT Config Service** as the system-of-record for templates and notification policies.

We will **build a lightweight User Preferences Service** (new), and **will not modify the existing DIGIT user service**.

---

## 1) High-level decisions (frozen)

### 1.1 MDMS vs Configs vs Service DB
- **MDMS v2**: stable vocabulary only (allowed values shared across services).
- **Config Service**: runtime behavior/policy and content that changes frequently; must be versioned, activatable, rollback-able, auditable.
- **Service DB**: user-owned state (consent, language preference, etc.).

Rule of thumb:
- **MDMS answers:** “what values are valid?”
- **Configs answer:** “what behavior/content is active now (tenant/env/time)?”
- **Service DB answers:** “what did this user choose/consent to?”

### 1.2 Novu usage
- Novu is used **ONLY for WhatsApp outbound delivery orchestration**.
- Novu is not used for SMS/email.
- Novu is not used for inbound conversation.
- **One Novu project per DIGIT tenant** is recommended for strong isolation.
- Multiple workflows per project (e.g., `PGR_CREATED`, `PGR_STATUS_CHANGED`), WhatsApp steps only.

### 1.3 Templates ownership
- **Canonical templates live in DIGIT Config Service**, not in MDMS and not as primary source in Novu.
- Novu workflows can remain thin (“delivery pipes”) while DIGIT resolves template content, language, consent, and policies.

### 1.4 Environment isolation
- Separate environments: dev/stage/prod.
- Each environment has its own deployments (and its own Config Service instance and DB).
- No cross-environment config sharing at runtime; promotion is done via export/import or GitOps-style seeding.

### 1.5 New lightweight User Preferences Service
- We will build **digit-user-preferences-service** as a lightweight service to store:
  - consent per channel (WhatsApp now; later SMS/Email)
  - preferred language (locale)
  - optional default tenant / scoped tenant
- This service will **not** modify or extend the existing DIGIT user service.
- It can be treated as “closer to the UI”:
  - UI can call it directly for create/update/search
  - backend integrations (digit-novu-bridge) read from it for consent and locale decisions

---

## 2) Components & responsibilities

### 2.1 Inbound conversation (as-is, no channel-gateway)
Inbound conversational flow remains **direct**:
- **WhatsApp Provider Webhook → x-state-chatbot**

Notes:
- No separate channel-gateway for inbound conversational messages.
- x-state-chatbot continues to:
  - verify/provider-authenticate inbound requests as needed (implementation detail)
  - manage conversation state
  - call DIGIT domain APIs (PGR create/status etc.)
  - send conversational replies through the WhatsApp provider adapter path used today

### 2.2 Optional: channel-gateway (receipts/observability only)
**channel-gateway** is optional and used only if/when required for:
- delivery receipts / read receipts webhooks
- provider callback normalization
- forwarding receipt events to Kafka for analytics/observability

Non-goal:
- channel-gateway is not part of inbound conversation routing in this design.

### 2.3 New component (to build): digit-user-preferences-service (lightweight)
Responsibilities:
- Store and serve **user preferences** needed for messaging:
  - preferredLanguage (locale)
  - consent per channel + scope (GLOBAL/TENANT; later MODULE)
- Provide APIs for:
  - consent create/update (upsert)
  - consent revoke
  - consent verify
  - preferences create/update/search
- Provide a single “getEffectivePreferences” style API if needed for UI convenience.
- Keep schema flexible for future additions, but enforce validation via JSON schema stored in MDMS v2 if needed.

Non-goals:
- No changes to DIGIT user service.
- No authentication source-of-truth responsibilities; it trusts DIGIT auth and stores preference state.

### 2.4 New component (to build): digit-novu-bridge
**digit-novu-bridge** is an outbound-only integration service that triggers WhatsApp notifications through Novu.

Inputs:
- Kafka domain events from DIGIT modules (initially PGR): created, status changed, workflow transitions, etc.

Core responsibilities:
1) **Policy enforcement** (from Config Service):
   - Event classification (TRANSACTIONAL / CAMPAIGN).
   - Event-channel enablement (WhatsApp enabled for this event?).
   - Feature-flag gates (rollout).
   - Quiet hours windows + exemptions (typically transactional exempt).
   - Rate limiting policy.
   - Retry/backoff policy (bridge-level behavior for trigger failures).

2) **Consent & preferences enforcement** (from digit-user-preferences-service):
   - Check WhatsApp consent for the user for the relevant scope.
   - Fetch preferred language/locale for message resolution.

3) **Template resolution & rendering** (from Config Service):
   - Determine template to use for event + WhatsApp channel via bindings.
   - Resolve effective locale via language strategy.
   - Render final message text using payload variables from the event.

4) **Trigger Novu**:
   - Call Novu “trigger workflow” for WhatsApp.
   - Use transactionId for idempotency/deduplication.
   - Ensure subscriber is identifiable (subscriberId strategy below).
   - Pass rendered message and metadata in Novu payload.

5) **Audit & correlation**:
   - Log/emit:
     - tenantId, eventType, recipient identifiers
     - activeConfigSetId (or config versions/checksums) used
     - transactionId
     - Novu workflow identifier used
     - outcomes/errors

Non-goals:
- digit-novu-bridge does not store canonical templates.
- digit-novu-bridge does not implement SMS/email.
- digit-novu-bridge is not a conversation engine.

---

## 3) Identity & naming conventions

### 3.1 Novu workflow identifier naming
- Workflow identifier = DIGIT eventType (e.g., `PGR_CREATED`, `PGR_STATUS_CHANGED`).
- One Novu workflow per eventType per tenant (within that tenant’s Novu project).

### 3.2 Novu subscriber strategy
Prefer:
- `subscriberId = DIGIT user UUID` when available.  
Fallback:
- `subscriberId = normalized phone` (E.164) or stable hash if required.  
Always attach:
- `phone` = E.164 number (WhatsApp target) in subscriber channels.

### 3.3 Correlation / transactionId
- transactionId should be stable and reproducible per send attempt.  
Recommended:
- `transactionId = <eventId or msgId> + ":" + <channel> + ":" + <recipient>`.

---

## 4) MDMS v2 vocabulary (stable reference lists)

### 4.1 MDMS Module: DIGIT-Notification
Masters:
- Channel: WHATSAPP, SMS, EMAIL
- EventCategory: TRANSACTIONAL, CAMPAIGN
- BackoffType: FIXED, EXPONENTIAL
- Locale: en_IN, hi_IN, ta_IN (tenant may support subset)
- FeatureFlagName: WHATSAPP_OUTBOUND_ENABLED (and other flag codes as needed)

### 4.2 MDMS Module: DIGIT-UserPreferences
Masters:
- ConsentScope: GLOBAL, TENANT (later MODULE)
- KeywordAction: REVOKE_CONSENT_ALL, GRANT_CONSENT_TENANT, SEND_HELP, CONFIRM_OPT_IN, CONFIRM_OPT_OUT

MDMS is only vocabulary; mappings and behavior live in Config Service.

---

## 5) Config Service model (catalog-style, stable configCode)

### 5.1 Config identity
Each config is identified as:
- namespace
- configName
- configCode (stable)
- tenantId
- environment (or physical env isolation)
- version
- status (DRAFT/APPROVED/ACTIVE etc.)

**ConfigSets** are used to activate a coherent set of config versions.

### 5.2 Reference implementation guidance (IMPORTANT for Codex)
- **Use the existing MDMS v2 service codebase as the starting point** for implementing the Config Service.
- The MDMS v2 patterns for:
  - module + master modeling
  - schema validation
  - versioning
  - search APIs
  - audit fields
are intentionally similar to what is required for configs.
- The Config Service can be implemented by **copying the MDMS v2 codebase** and then modifying:
  - terminology (module/master → namespace/config)
  - semantics (reference data → runtime behavior)
  - activation logic (ConfigSets instead of “latest wins”)
  - resolve API (context-based matching instead of static lookup)
- Codex should treat MDMS v2 as a **structural and architectural reference**, not as a dependency.

### 5.3 Config catalog (what must exist)

> Note: `configCode` is NOT overloaded with locale/channel/eventType. Matching dimensions live inside entries.

#### A) Templates & bindings (canonical DIGIT content)
1) namespace: `notification-orchestrator`  
   - configName: `template`  
   - configCode: `OOTB_TEMPLATES`  
   - entries match on: `{ templateCode, locale }`  
   - value contains: `{ text/body, placeholders[], metadata }`

2) namespace: `notification-orchestrator`  
   - configName: `template-binding`  
   - configCode: `OOTB_TEMPLATE_BINDINGS`  
   - entries match on: `{ eventType, channel }`  
   - value contains: `{ templateCode, languageStrategyRef?, metadata }`

#### B) Event routing policies
3) namespace: `notification-orchestrator`  
   - configName: `event-channel-enablement`  
   - configCode: `EVENT_CHANNELS`  
   - entries match on: `{ eventType }`  
   - value contains: `{ enabledChannels[], disabledChannels[] }`

4) namespace: `notification-orchestrator`  
   - configName: `event-classification`  
   - configCode: `EVENT_CATEGORY_MAP`  
   - entries match on: `{ eventType }`  
   - value contains: `{ category }`

#### C) Delivery guardrails
5) namespace: `notification-orchestrator`  
   - configName: `rate-limit-policy`  
   - configCode: `RATE_LIMITS`  
   - entries match on: `{ channel?, category?, eventType? }` (override hierarchy)  
   - value contains: thresholds + burst + policy metadata

6) namespace: `notification-orchestrator`  
   - configName: `quiet-hours-policy`  
   - configCode: `QUIET_HOURS`  
   - entries match on: `{ DEFAULT }` (and optional per-tenant overrides)  
   - value contains: windows[] + exemptions[]

7) namespace: `notification-orchestrator`  
   - configName: `retry-policy`  
   - configCode: `RETRY_POLICIES`  
   - entries match on: `{ channel }`  
   - value contains: maxRetries + backoff + dlq settings

#### D) Preferences & consent behavior
8) namespace: `notification-orchestrator`  
   - configName: `language-strategy`  
   - configCode: `LANGUAGE_STRATEGY`  
   - entries match on: `{ DEFAULT }` and/or `{ channel }`  
   - value contains: precedence order + fallback

9) namespace: `user-preferences`  
   - configName: `consent-evaluation-policy`  
   - configCode: `CONSENT_POLICY`  
   - entries match on: `{ DEFAULT }` and optional overrides  
   - value contains: evaluationOrder + defaultDecision + exemptions

10) namespace: `user-preferences`  
    - configName: `keyword-actions`  
    - configCode: `KEYWORD_ACTIONS`  
    - entries match on: `{ channel, locale }`  
    - value contains: keywords[] → action + response message keys

#### E) Rollout gates
11) namespace: `notification-orchestrator`  
    - configName: `feature-flag`  
    - configCode: `FEATURE_FLAGS`  
    - entries match on: `{ flagName }`  
    - value contains: enabled + allow/deny list + percentage

---

## 6) Outbound WhatsApp flow (canonical)

Trigger source:
- PGR (and later other modules) emits Kafka event.

digit-novu-bridge steps:
1) Parse event → extract tenantId, eventType, recipients, variables.
2) Resolve enablement:
   - `EVENT_CHANNELS` for eventType includes WHATSAPP?
   - `FEATURE_FLAGS` allow WHATSAPP_OUTBOUND_ENABLED?
3) Resolve classification:
   - `EVENT_CATEGORY_MAP` → category
4) Enforce quiet hours:
   - `QUIET_HOURS` windows and exemptions (often exempt TRANSACTIONAL)
5) Enforce rate limits:
   - `RATE_LIMITS` using `{eventType, category, channel=WHATSAPP}`
6) Consent check:
   - digit-user-preferences-service verifies consent for WHATSAPP for appropriate scope.
7) Resolve language:
   - `LANGUAGE_STRATEGY` + user preferred locale + tenant default locale
8) Resolve template:
   - `OOTB_TEMPLATE_BINDINGS` for `{eventType, channel=WHATSAPP}` → templateCode
   - `OOTB_TEMPLATES` for `{templateCode, locale}` → template content
9) Render message text:
   - Substitute placeholders from event variables.
10) Trigger Novu:
   - workflowIdentifier = eventType
   - subscriberId + phone
   - payload contains rendered message + metadata
   - transactionId for idempotency
11) Log audit:
   - transactionId, configSet/version ids, decision path, result.

---

## 7) Implementation checklist for Codex

### 7.1 digit-user-preferences-service (new)
- Spring Boot service with Postgres storage.
- APIs:
  - `/consent/_upsert`, `/consent/_revoke`, `/consent/_verify`
  - `/preferences/_create`, `/preferences/_update`, `/preferences/_search`
- Schema:
  - consent records keyed by (phone/userId, channel, scope, scopedTenantId, module)
  - preference record with preferredLanguage (and optional defaultTenantId)
- Use DIGIT common contracts (RequestInfo/ResponseInfo, AuditDetails).
- Keep it lightweight; it is UI-friendly and safe for backend reads.

### 7.2 digit-novu-bridge
- Kafka consumer(s) for PGR events.
- Policy resolution client for Config Service:
  - resolve config entries by configCode + match context.
- Preferences client for digit-user-preferences-service:
  - verify consent for WhatsApp
  - fetch preferred language
- Template rendering module:
  - placeholder extraction + substitution + safe defaults
- Novu client:
  - trigger workflow API call
  - subscriber create/update if needed
- Observability:
  - structured logs with correlationId/transactionId
  - metrics: triggers, skipped (no consent), throttled, failed, success

### 7.3 Config Service expectations
- Supports configCode catalog configs with entries.
- Supports ConfigSets (activate a set of versions).
- Supports “resolve” API:
  - given namespace/configName/configCode + match context (eventType, channel, locale, etc.)
  - returns effective entry + version + checksum + activeConfigSetId.

### 7.4 Novu tenant bootstrap (ops)
- For each DIGIT tenant:
  - create Novu project (or manually)
  - create workflows matching eventTypes used (PGR)
  - configure WhatsApp integration credentials
  - grant government users access to that tenant’s project
- Decide governance:
  - staging-first workflow edits, then promote to prod
  - restrict prod permissions

---
```
