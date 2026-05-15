# Changelog
All notable changes to this module will be documented in this file.

## 1.1.0 - 2026-04-16

### Features
- ValueFirst provider strategy for SMS and WhatsApp messaging
- Locale-based template resolution for WhatsApp notifications
- Separate resolve and search endpoint configuration for flexible service wiring
- Business reference number included in dispatch log for end-to-end traceability
- Default country code logic updated to handle missing/null values gracefully

### Bug Fixes
- Fixed critical security vulnerability: sanitize provider credentials in API responses before returning to callers
- Fixed novu-bridge environment variable mapping in `application.properties`
- Fixed novu-bridge default values to use production service discovery endpoints
- Fixed WhatsApp `contentSid` override — now correctly passes resolved `contentSid` to Novu
- Fixed WhatsApp prefix handling in notification flow
- Fixed `ConfigServiceClient` search endpoint payload structure (`criteria` instead of `filters`)
- Fixed `ArrayList` import in `ConfigServiceClient` causing Maven build failure
- Fixed `priority` field location in provider search results

### Improvements
- Implemented comprehensive encryption solution with enc-client integration for credential security
- Dynamic provider-agnostic resolution with priority-based provider selection
- Added sender number support and improved provider credentials handling
- Integration with `config-service` for template resolution via `template-binding` endpoint

## 1.0.0 - 2026-02-27

### Features
- Initial release of `novu-bridge` — a DIGIT adapter that routes notifications through Novu to SMS/WhatsApp providers
- Provider-agnostic notification dispatch with `DispatchPipelineService` and `ResolvedProvider`
- WhatsApp notification support via Twilio integration
- Locale-aware template selection
