# Changelog
All notable changes to this module will be documented in this file.

## 1.0.0 - 2026-04-16

### Features
- Initial release of `digit-user-preferences-service` — a Go microservice that stores and retrieves per-user notification preferences (channels, language)
- Preferred language resolution: returns user's configured locale for template selection downstream
- Integration with `config-service` and `novu-bridge` for end-to-end notification pipeline
- Data type alignment with DIGIT standard field formats

## 0.1.0 - 2026-02-19

- Initial integration: config-service wired to novu-bridge for template resolution via user preferences
