# Changelog
All notable changes to this module will be documented in this file.

## 2.0.0 - 2026-09-15

### Changed
- **Rewritten in Java (Spring Boot 3.2.2 / JDK 17), replacing the Go implementation** (#1982), so the service matches the rest of the `backend/` stack: plain JDBC + query builder + row mapper, Flyway migrations, `@RestControllerAdvice` error handling and the same package layout as `digit-config-service`
- Schema ownership moved from GORM `AutoMigrate` to Flyway. The migration SQL is unchanged and idempotent, so an existing database is baselined and gains the indexes AutoMigrate never created — including the unique index on `(user_id, COALESCE(tenant_id, ''), preference_code)`. The Helm chart's `dbMigration` init container and a compose migrator are enabled to match the sibling services, with the app's embedded Flyway off in those deployments
- Helm/compose values updated for a JVM workload (`appType: java-spring`, heap, tracing, 512Mi limit)

### Fixed (review round 1, PR #2081)
- Ownership is enforced on both endpoints: a citizen principal may only read and write their own record, and a tenant-only `_search` is refused. Both endpoints key on the body `userId`, so without this any caller reaching the route could read or overwrite another citizen's consent (CWE-639). Privileged roles and service-to-service calls (novu-bridge posts an empty `requestInfo`) are unaffected; `ENFORCE_OWNERSHIP=false` restores the old behaviour
- The migration collapses duplicate keys before creating the unique index. A GORM-created database has no such index and can hold duplicates, which would have failed the migration and left the pod unable to start
- A caller-supplied `id` that is not a UUID is a 400 (`INVALID_ID`) instead of a 500 from the driver's cast
- The notification payload parser matches keys case-insensitively, as `encoding/json` did. A lower-cased `consent.sms` block was reaching the table with its status unvalidated
- The upsert lookup trims its key, so padded input updates the existing row instead of failing the insert with a duplicate-key 500
- Internal errors and malformed-body errors return fixed messages; the database and parser text is logged instead (CWE-209)
- The language allowlist, the paging defaults and the pool knobs are configuration rather than constants buried in Java. The language list in particular is tenant data: the citizen profile screen offers whatever MDMS `StateInfo.languages` carries
- The test resources no longer shadow `application.properties` with a second copy, so the shipped defaults are what the suite exercises

### Fixed (review round 2, PR #2081)
- The UUID check is a canonical-format match, not `UUID.fromString`, which zero-pads short groups and so accepted `1-2-3-4-5` for PostgreSQL to reject with the 500 the check exists to prevent
- The ownership principal is resolved by the same method that stamps the audit columns (uuid, then id, then requesterId). A `userInfo` carrying only a numeric id was being read as service-to-service and skipping the check, while the enricher happily recorded that id as the author; a present-but-unidentifiable caller now fails closed
- Privileged roles are tenant-scoped: a role only lifts the check for its own tenant or a descendant, so an admin in one tenant can no longer rewrite another tenant's citizens
- `EMPLOYEE` dropped from the default privileged roles. HRMS forces it onto every employee, so it covered every field worker and CSR rather than administrators
- Database TLS restored. `appType: java-spring` makes the common chart inject `SPRING_DATASOURCE_URL` from `egov-config`, which carries no `sslmode` and silently overrode `db-ssl-mode: require`; the chart never injected that block while this was a Go service, so the switch to a JVM workload had turned TLS off. `sslmode` is now a driver property that survives the injected URL
- Actuator pinned to `/actuator` in the chart. The same injected block sets the base path to `/`, where actuator answers `/health` ahead of `HealthController`, replacing the documented response shape and the `isReachable()` check with `DataSourceHealthIndicator`

### Fixed (review round 3, PR #2081)
- `/health` is served by actuator with a named `database` health indicator instead of a hand-written controller. The response is byte-identical, including the 503 on an unreachable database, and it removes both the controller and the chart override that had been added to stop actuator shadowing it
- `PRIVILEGED_ROLES` and `ENFORCE_OWNERSHIP` are chart values overridable per environment from `env.yaml`, not literals in the service chart

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
