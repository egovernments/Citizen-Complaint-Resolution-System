# WhatsApp Bidirectional Notifications - High Level Design

## Purpose
Implement outbound WhatsApp notifications for DIGIT (PGR-first) using Novu for delivery only, while keeping DIGIT Config Service as the system-of-record for templates and policies, and a lightweight User Preferences Service for consent and locale.

## System Context
- Inbound WhatsApp conversation remains direct: Provider -> x-state-chatbot.
- Outbound notifications are triggered from domain events (Kafka) and delivered via Novu.
- Config and preference data are resolved at send time by digit-novu-bridge.

## Services to Build (New)
- **digit-user-preferences-service**
  - Stores user consent and preferred language (JSONB payload by preferenceCode).
  - Exposes `/_upsert` and `/_search` APIs with RequestInfo/ResponseInfo.
  - No changes to existing DIGIT user service.
- **digit-novu-bridge**
  - Consumes Kafka domain events (PGR workflow events).
  - Enforces policy (Config Service), consent/locale (User Preferences).
  - Renders templates and triggers Novu workflows.
  - Emits audit/observability data.
- **DIGIT Config Service**
  - New service (based on MDMS v2 patterns) for runtime policies/templates.
  - Supports versioned configs and activation via ConfigSets.
  - Provides template preview API for testing.

## Services to Modify (Existing)
- **PGR / Workflow event publishing**
  - Ensure required workflow events are emitted to Kafka with payload fields used by notifications.
  - If already present, no code change; only topic/payload contract confirmation.
- **Deployment / Infra**
  - Add new services, topics, and secrets (Novu API keys, provider tokens).

## Services Used As-Is (DIGIT / External)
- **x-state-chatbot** (inbound conversation remains unchanged)
- **MDMS v2** (vocabulary only; no runtime behavior)
- **PGR service** (domain source of workflow events)
- **Kafka** (event transport)
- **Novu** (WhatsApp delivery orchestration only)
- **WhatsApp Provider** (delivery channel)

## Why Dedicated Config Service (instead of only MDMS v2)
If requirements are limited to storing and searching records, MDMS v2 can be sufficient. A dedicated Config Service is needed because runtime configuration requires deterministic behavior, consistent precedence, and predictable performance.

### Justification
1. Runtime contract mismatch
- MDMS-style access is browse/search oriented.
- Runtime consumers typically require a single best-match config, not a list.

2. Deterministic precedence must be centralized
- Tenant/locale specificity and wildcard fallback need one shared contract.
- Implementing fallback in each consumer causes behavior drift.

3. Performance model differs
- Runtime resolution must be index-backed and low-latency.
- Fetch-and-filter patterns degrade at scale and are harder to operate.

4. Synchronous operational behavior
- Runtime config updates often need immediate read-after-write consistency.
- A synchronous Config Service write path reduces eventual-consistency surprises.

5. Explicit domain semantics
- Runtime config requires explicit selector keys, fallback semantics, and tie-break rules.
- A dedicated service makes these semantics testable and auditable.

### Recommended split
1. Keep MDMS v2 schema APIs for schema governance.
2. Use Config Service for synchronous config CRUD/search and deterministic runtime resolve.

## Key Flows
1) PGR workflow event -> Kafka -> digit-novu-bridge.
2) digit-novu-bridge -> Config Service (policy + template bindings).
3) digit-novu-bridge -> User Preferences Service (consent + locale).
4) digit-novu-bridge -> Novu (trigger workflow with rendered message).
5) Delivery status optional: Novu -> bridge (webhook) for auditing.

## Non-Goals
- No changes to DIGIT user service.
- No inbound conversation routing changes.
- No SMS/email delivery via Novu.
