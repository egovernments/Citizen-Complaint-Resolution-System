# Novu Bridge

`novu-bridge` consumes pre-rendered PGR notification events, applies channel and preference gates, triggers fixed Novu workflows, and records trigger outcomes.

The single current architecture, enablement, provider, Configurator, verification, and rollback guide is [`docs/2.12/notifications/README.md`](../../docs/2.12/notifications/README.md).

Run the component tests with Java 17:

```bash
mvn test
```
