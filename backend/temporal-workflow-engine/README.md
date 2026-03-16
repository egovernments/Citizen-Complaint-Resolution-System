# Temporal Workflow Engine

This module provides a generic, config-driven Temporal workflow orchestration engine for DIGIT services using Spring Boot 3, Kafka, and REST APIs.

## Architecture

```text
+---------------------+        +---------------------------+
| Citizen / Staff App |        | Temporal UI / Prometheus |
+----------+----------+        +-------------+-------------+
           |                                   |
           v                                   v
+----------+-----------------------------------+----------+
|              Temporal Workflow Engine                  |
|  REST Controller  Workflow Client  Workers  Kafka I/O  |
+----+--------------------+------------------+------------+
     |                    |                  |
     | start/signal       | execute          | pub/sub
     v                    v                  v
+----+---------+   +------+---------+   +----+----------------+
| Temporal SDK |<->| Temporal Server|   | Kafka Topics        |
| + Workflow   |   | + Task Queue   |   | save/update/assign  |
+----+---------+   +------+---------+   +----+----------------+
     |                    |
     | activities         |
     v                    v
+----+--------------------+-----------------------------------+
| DIGIT Producers / Consumers                                 |
| PGR | PT | TL | Notifications | Other DIGIT services        |
+-------------------------------------------------------------+
```

## Runtime Model

1. Business services persist their own records and emit Kafka events.
2. This engine consumes those events, maps them to a configured workflow, and starts or signals a Temporal workflow.
3. Workflow states, transitions, timers, and timeout actions are loaded from `workflow-definitions.json`.
4. The engine exposes workflow snapshot APIs for current state, actions, and orchestration metadata.

## Project Structure

```text
temporal-workflow-engine
├── src/main/java/.../config
├── src/main/java/.../controller
├── src/main/java/.../engine
├── src/main/java/.../client
├── src/main/java/.../kafka
├── src/main/java/.../workers
├── src/main/resources
├── postman
└── target
```

## Run

```bash
docker compose up --build
```

## Manual Local Setup

From the repo root, start the shared DIGIT stack with Tilt:

```bash
cd /home/admin2/egov/repos/digit/cms/Citizen-Complaint-Resolution-System/local-setup
TILT_PORT=10351 tilt up --stream
```

Wait for these local-setup services to be healthy:

- `postgres` on `localhost:15432`
- `pgr-services` on `localhost:18083`
- `mdms-v2` on `localhost:18094`
- `egov-persister` on `localhost:18091`

In a second terminal, start the Temporal adapter stack:

```bash
cd /home/admin2/egov/repos/digit/cms/Citizen-Complaint-Resolution-System/backend/temporal-workflow-engine
docker compose up -d --build
```

Check the engine stack:

```bash
docker compose ps
curl -s http://localhost:8096/temporal-workflow-engine/actuator/health
```

Expected local ports:

- Engine API: `http://localhost:8096/temporal-workflow-engine`
- Temporal gRPC: `localhost:7233`
- Temporal UI: `http://localhost:8088`
- Kafka: `localhost:19093` by default when connected to the shared local stack

## Postman

For engine APIs, import these files:

- `postman/temporal-workflow-engine.postman_collection.json`
- `postman/temporal-workflow-engine.local.postman_environment.json`

For end-to-end workflow transition testing with PGR as the business service, use the PGR collection in:

- `/home/admin2/egov/repos/digit/cms/Citizen-Complaint-Resolution-System/backend/pgr-services/src/main/resources/pgr-postmand.json`

Run the collection against the local DIGIT gateway so `pgr-services` emits Kafka events and this engine consumes them. Then verify the resulting workflow snapshot through:

- `GET /temporal-workflow-engine/workflow-engine/v1/process/{workflowId}`

The deterministic workflow id format is:

- `wf-<normalized-tenantId>-<normalized-businessId>`

The engine Postman collection can be used to query snapshots directly after business-service API calls complete.

## Sample Test Flow

1. Start the shared DIGIT stack with Tilt.
2. Start this engine with `spring.kafka.bootstrap-servers=localhost:19093` and `temporal.target=localhost:7233`.
3. Run the PGR Postman collection against `http://localhost:18000`.
4. Read the created complaint id from the PGR response.
5. Query the engine snapshot using `wf-<tenant>-<complaint-id>`.
