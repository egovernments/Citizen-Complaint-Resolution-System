# Novu Bridge

`novu-bridge` consumes notification events from Kafka (thin domain events and pre-rendered envelopes), resolves recipients, language and text from the `NOTIFICATIONS.*` masters, applies channel and preference gates, delivers through Novu, and records every outcome in `nb_dispatch_log`.

Documentation: [`docs/releases/2.20/notifications/`](../../docs/releases/2.20/notifications/README.md) — setup, migration, developer guide, provider adapters, Kafka topics and the published contract.

Per-tenant Novu accounts (#2203): with `NOVU_BRIDGE_TENANT_ACCOUNTS_ENABLED`, each root tenant can have its own Novu organization, created and managed by the bridge through the internal API `/novu-adapter/v1/tenants/**`, and `POST /novu-adapter/v1/messages/_send` sends a sign-in code through it. Design, operations and the contract: [`tenant-accounts.md`](../../docs/releases/2.20/notifications/tenant-accounts.md) and [`contract/openapi.yaml`](src/main/resources/contract/openapi.yaml).

Run the component tests with Java 17:

```bash
mvn test
```
