# Novu Bridge

`novu-bridge` consumes notification events from Kafka (thin domain events and pre-rendered envelopes), resolves recipients, language and text from the `NOTIFICATIONS.*` masters, applies channel and preference gates, delivers through Novu, and records every outcome in `nb_dispatch_log`.

Documentation: [`docs/2.20/notifications/`](../../docs/2.20/notifications/README.md) — setup, migration, developer guide, provider adapters, Kafka topics and the published contract.

Run the component tests with Java 17:

```bash
mvn test
```
