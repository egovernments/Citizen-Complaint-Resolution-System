# Changelog
All notable changes to this module will be documented in this file.

## 2.0.0 - 2026-09-15

### Changed
- **Rewritten in Java (Spring Boot 3.2.2 / JDK 17), replacing the Go implementation** (#1982), so the service matches the rest of the `backend/` stack: plain JDBC + query builder + row mapper, Flyway migrations, `@RestControllerAdvice` error handling and the same package layout as `digit-config-service`
- Schema ownership moved from GORM `AutoMigrate` to Flyway. The migration SQL is unchanged and idempotent, so an existing database is baselined and gains the indexes AutoMigrate never created — including the unique index on `(user_id, COALESCE(tenant_id, ''), preference_code)`. The Helm chart's `dbMigration` init container and a compose migrator are enabled to match the sibling services, with the app's embedded Flyway off in those deployments
- Helm/compose values updated for a JVM workload (`appType: java-spring`, heap, tracing, 512Mi limit)

### Preserved
- HTTP contract byte for byte: endpoint paths, request envelopes (including the case-insensitive `RequestInfo`/`requestInfo` both callers rely on), response key casing, which keys are omitted when empty, error codes, messages and statuses
- `/health` remains at the container root rather than under the API context path, so the compose healthcheck, both Kubernetes probes and both Gatus catalogues keep working
- Every `DB_*` / `SERVER_*` environment variable, including the Go duration spellings on the connection-pool settings, making the image a drop-in replacement

## 1.0.0 - 2026-04-16

### Features
- Initial release of `digit-user-preferences-service` — a Go microservice that stores and retrieves per-user notification preferences (channels, language)
- Preferred language resolution: returns user's configured locale for template selection downstream
- Integration with `config-service` and `novu-bridge` for end-to-end notification pipeline
- Data type alignment with DIGIT standard field formats

## 0.1.0 - 2026-02-19

- Initial integration: config-service wired to novu-bridge for template resolution via user preferences
