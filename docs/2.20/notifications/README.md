# Notifications (2.20)

SMS, WhatsApp and email notifications through `novu-bridge` and Novu. Modules publish events
to Kafka; novu-bridge decides who is told, on which channel, in which language and with what
text, from the `NOTIFICATIONS.*` MDMS masters that operators edit in the Configurator.

| You want to | Read |
|---|---|
| Set notifications up and run them (operators, deployers) | [setup-guide.md](./setup-guide.md) |
| Upgrade a 2.12 deployment | [migration.md](./migration.md) |
| Connect a module, swap the DIGIT seams (developers) | [developer-guide.md](./developer-guide.md) |
| Understand the provider adapters, or add a provider | [providers.md](./providers.md) — [How the adapters work](./providers.md#how-the-adapters-work), [Adding a provider](./providers.md#adding-a-provider) |
| Configure the Kafka / Redpanda topics novu-bridge consumes | [kafka-events.md](./kafka-events.md) |
| Integrate against the published interface | [contract/](./contract/README.md) — schemas, OpenAPI, [error codes](./contract/error-codes.md), [outputs](./contract/outputs.md) |

Code: `backend/novu-bridge/` (the bridge), `configurator/src/resources/notification-*`
(screens), `local-setup/scripts/seed-notifications.py` (seed and legacy copy),
`backend/pgr-services/src/main/java/org/egov/pgr/service/notification/ThinEventBuilder.java`
(the complaint producer).

Inbound WhatsApp (citizens messaging the chatbot) is a separate feature:
[../../2.12/notifications/inbound-whatsapp.md](../../2.12/notifications/inbound-whatsapp.md).
