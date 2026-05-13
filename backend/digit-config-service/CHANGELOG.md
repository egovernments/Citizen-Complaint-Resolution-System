# Changelog
All notable changes to this module will be documented in this file.

## 1.0.0 - 2026-04-16

### Features
- Initial production release of `digit-config-service` — a DIGIT-native configuration service for managing notification providers, templates, and channel bindings
- MDMS v2 schema-backed storage via a single `eg_config_data` table
- Provider management: `provider_detail` API for storing SMS/WhatsApp/email provider credentials
- Template binding: `template_binding` API to associate notification templates with providers and locales
- Provider-agnostic dispatch pipeline: selects highest-priority provider at runtime
- Encryption support for provider credentials using egov enc-client; conditional encryption toggle via service flag
- State-level tenant ID support for encryption consistency across multi-tenant environments

### Bug Fixes
- Fixed credentials parsing to return as JSON object instead of string
- Fixed decryption payload format for enc-client integration
- Fixed MDMS v2 host configuration to use correct service endpoint
- Fixed unchecked cast warning in `EncryptionDecryptionUtil`
- Fixed build failure by properly handling MDMS dependency in tests

### Improvements
- Comprehensive logging added to config service flow for observability
- Removed unused `enc-client` Maven dependency that caused initialization failures; replaced with direct REST calls
- Consolidated config-service to single MDMS-v2-style table
- Replaced `filters` with `criteria` in search payload for API consistency
- Added `RequestInfo` and `UserInfo` models accepting all frontend fields
