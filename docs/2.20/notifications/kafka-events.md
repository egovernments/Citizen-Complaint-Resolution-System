# Kafka (Redpanda) events consumed by novu-bridge

Which topics novu-bridge reads, how to add one, how a producer publishes to it, and how to
confirm an event arrived. Compose runs Redpanda (`digit-redpanda`); the Helm charts use the
`kafka-kraft` chart (`kafka-kraft-controller-headless.backbone:9092`). The wire formats are in
[contract/](./contract/README.md).

## Topics

| Topic | Property (env) | Consumer | Carries |
|---|---|---|---|
| `complaints.domain.events` | `novu.bridge.kafka.input.topics` (`NOVU_BRIDGE_KAFKA_INPUT_TOPICS`) | `DomainEventConsumer` | pgr-services' thin events |
| `notifications.events` | same list | `DomainEventConsumer` | Module-neutral topic for any other producer |
| `egov.core.notification.sms` | `novu.bridge.kafka.core.sms.topic` (`NOVU_BRIDGE_CORE_SMS_TOPIC`); switch: `NOVU_BRIDGE_CORE_SMS_ENABLED` | `CoreSmsConsumer` | DIGIT core `SMSRequest` (login OTPs, password resets) |
| `novu-bridge.dlq` | `novu.bridge.kafka.dlq.topic` (`NOVU_BRIDGE_KAFKA_DLQ_TOPIC`) | — (produced by the bridge) | Events that failed ([contract/outputs.md](./contract/outputs.md#the-dlq)) |

Consumer group `novu-bridge`, `auto-offset-reset=earliest`, no message key required, no
headers read (`spring.json.use.type.headers=false`); the value is a JSON object. Topics are
bound at startup — restart novu-bridge after changing the list.

On every input topic the bridge reads `kind` from the raw JSON: `"THIN"` (case-insensitive) is
a thin event, anything else is a pre-rendered envelope. The **topic never decides handling**;
`eventType` must be on the allowlist `novu.bridge.event.types` (`NOVU_BRIDGE_EVENT_TYPES`,
default `COMPLAINTS_WORKFLOW_TRANSITIONED,CORE_SMS`) or the event is
`REJECTED / NB_UNSUPPORTED_EVENT_TYPE` and sent to the DLQ.

## Create the topics

Redpanda and Kafka auto-create topics on first produce by default, but create them up front so
the consumer is subscribed before the first event.

**Compose.** `./deploy.sh` (with `enable_novu: true`) runs the task
`novu — ensure notification input + core-sms + dlq topics exist` in
`local-setup/ansible/playbook-deploy.yml`, which is equivalent to:

```bash
sudo docker exec digit-redpanda rpk topic create \
  complaints.domain.events notifications.events egov.core.notification.sms novu-bridge.dlq -p 1 -r 1
sudo docker exec digit-redpanda rpk topic list
```

`TOPIC_ALREADY_EXISTS` is harmless.

**Helm.** Either list the topic under `provisioning.topics` in the `kafka-kraft` values
(`devops/deploy-as-code/charts/backbone-services/kafka-kraft/values.yaml`, with
`provisioning.enabled: true`), or create it from a broker pod (adjust the pod name to your
release):

```bash
kubectl -n backbone exec kafka-kraft-controller-0 -- kafka-topics.sh \
  --bootstrap-server localhost:9092 --create --if-not-exists \
  --topic notifications.events --partitions 1 --replication-factor 1
```

## Add a producer or a topic

1. **Prefer `notifications.events`.** A new topic is needed only if you want isolation. To add
   one, append it to the input list:
   - Compose: `NOVU_BRIDGE_KAFKA_INPUT_TOPICS=complaints.domain.events,notifications.events,<new>`
     in `/opt/digit/.env` (interpolated into the `novu-bridge` service in
     `local-setup/docker-compose.egov-digit.yaml`), and add `<new>` to the playbook's topic
     task so it is created on every deploy.
   - Helm: the `NOVU_BRIDGE_KAFKA_INPUT_TOPICS` value in
     `devops/deploy-as-code/charts/common-services/novu-bridge/values.yaml`.

   Because the group reads from `earliest`, a topic that already holds messages is replayed
   from the start the first time the bridge subscribes.
2. **Allowlist the producer's `eventType`.** `NOVU_BRIDGE_EVENT_TYPES` is not in the Compose
   service or the Helm values; add it to both (Compose: a line in the `novu-bridge`
   `environment:` block, e.g.
   `NOVU_BRIDGE_EVENT_TYPES: ${NOVU_BRIDGE_EVENT_TYPES:-COMPLAINTS_WORKFLOW_TRANSITIONED,CORE_SMS,XYZ_LICENCE_EVENT}`),
   and to the default in `backend/novu-bridge/src/main/resources/application.properties` if it
   should ship.
3. **Thin events only:** declare the events in `NOTIFICATIONS.EventCatalogue` and seed routing
   and templates — see [developer-guide.md](./developer-guide.md#plug-a-module-in). An
   uncatalogued `eventName` is `REJECTED / NB_EVENT_NOT_IN_CATALOGUE` (except on a tenant with
   no catalogue rows at all).
4. Restart novu-bridge.

## Publish an event

Produce a JSON object to the topic; no key or headers are needed. With DIGIT's
`CustomKafkaTemplate` that is `producer.push(tenantId, "notifications.events", event)`.

**Thin event** (preferred) — [thin-event-v1.schema.json](./contract/thin-event-v1.schema.json).
Required: `kind: "THIN"`, `eventId`, `eventType`, `module`, `eventName`, `tenantId`. Send
`entityId` (becomes the Logs reference number) and a deterministic `transactionSeed`.

```json
{ "kind": "THIN", "eventId": "11111111-2222-3333-4444-555555555555",
  "eventType": "XYZ_LICENCE_EVENT", "module": "XYZ", "eventName": "XYZ.LICENCE.RENEWED",
  "tenantId": "ke.bomet", "entityType": "LICENCE", "entityId": "XYZ-LIC-2026-0042",
  "transactionSeed": "XYZ-LIC-2026-0042:RENEWED",
  "actors": { "holder": { "userId": "2c4e6a80-1111-4222-8333-944455556666", "type": "CITIZEN" } },
  "data": { "licence_no": "XYZ-LIC-2026-0042", "valid_until": "31/12/2027" } }
```

**Pre-rendered envelope** — [envelope-v1.schema.json](./contract/envelope-v1.schema.json),
one message per recipient × channel. Required: `eventId`, `eventType`, `eventName`, `tenantId`,
`channel`, `subscriberId`, `renderedBody`; send a deterministic `transactionId` (the dispatch
log's idempotency key). Full example:
[examples/05-module-neutral-sms.json](./contract/examples/05-module-neutral-sms.json).

Local smoke test on Compose (one JSON object per line):

```bash
jq -c . my-event.json | sudo docker exec -i digit-redpanda rpk topic produce notifications.events
```

Before touching Kafka, `POST /novu-bridge/novu-adapter/v1/dispatch/_resolve` with
`{"RequestInfo": {...}, "event": {...thin event...}}` (admin role) shows what the thin event
would produce without sending anything.

## Verify delivery

1. **Logs screen** (Configurator → Notifications → **Logs**), filter **Complaint #** by your
   `entityId`; or `GET /novu-bridge/novu-adapter/v1/logs?tenantId=<t>&referenceNumber=<entityId>`.
   Every outcome is a row — including `SKIPPED` decisions and `REJECTED` events.
2. **Nothing on Logs?** Read the DLQ:
   ```bash
   sudo docker exec digit-redpanda rpk topic consume novu-bridge.dlq -o start -n 20
   ```
   Each message is `{event, sourceTopic, errorCode, errorMessage}`. Core-SMS translation
   failures (`NB_INVALID_CORE_SMS`) appear only here. There is no automatic replay: fix the
   cause and re-produce `event`; the ledger upserts, so rows are not duplicated.
3. **Still nothing?** The bridge is not subscribed: check `rpk topic list`, the input-topic
   env, and `docker logs novu-bridge` for the consumer assignment.

`SENT` means the transport accepted the message; see
[setup-guide.md §8.3](./setup-guide.md#83-delivery-receipts) for receipts.
