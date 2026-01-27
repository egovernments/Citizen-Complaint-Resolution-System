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
