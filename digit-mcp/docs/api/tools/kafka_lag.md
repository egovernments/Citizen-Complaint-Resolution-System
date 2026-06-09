# kafka_lag

> Check Kafka consumer group lag for the egov-persister service via Redpanda rpk.

**Group:** `monitoring` | **Risk:** `read` | **DIGIT Service:** `--`

## Description

Checks the Kafka consumer group lag for the `egov-persister` consumer group by running `rpk group describe egov-persister` inside the `digit-redpanda` Docker container. This reveals whether the persister is keeping up with incoming messages or falling behind.

The tool reports per-topic, per-partition details including the current offset, log end offset, and calculated lag. Each topic is assigned a status based on lag thresholds: `OK` when lag is zero, `WARN` when lag is between 1 and 100, and `CRITICAL` when lag exceeds 100. A `totalLag` value and an overall status are also returned.

This is a key diagnostic tool for the DIGIT platform. When PGR complaints or workflow transitions appear to be "lost" (created via API but not visible in search), Kafka lag is often the cause -- the persister has not yet consumed and written the messages to the database. Use this tool as a first check before investigating persister errors or database issues.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| *(none)* | | | | |

## Response

```json
{
  "consumerGroup": "egov-persister",
  "topics": [
    {
      "topic": "save-pgr-request",
      "partitions": [
        {
          "partition": 0,
          "currentOffset": 42,
          "logEndOffset": 42,
          "lag": 0
        }
      ],
      "totalLag": 0,
      "status": "OK"
    },
    {
      "topic": "update-pgr-request",
      "partitions": [
        {
          "partition": 0,
          "currentOffset": 15,
          "logEndOffset": 118,
          "lag": 103
        }
      ],
      "totalLag": 103,
      "status": "CRITICAL"
    }
  ],
  "totalLag": 103,
  "status": "CRITICAL"
}
```

## Examples

### Basic Usage

Check current Kafka lag:

```
kafka_lag({})
```

### Diagnosing Missing Data

If a PGR complaint was created but does not appear in search results:

1. Check Kafka lag: `kafka_lag({})`
2. If lag is high on `save-pgr-request`, the persister is behind -- wait or investigate.
3. If lag is zero, check persister errors: `persister_errors({})`

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Container not found | The `digit-redpanda` Docker container is not running | Start DIGIT services: `cd ~/code/tilt-demo && docker compose -f docker-compose.deploy.yaml up -d` |
| rpk command failed | Redpanda broker not ready or consumer group does not exist | Verify Redpanda is healthy; ensure egov-persister has connected at least once |

## See Also

- [persister_monitor](persister_monitor.md) -- Comprehensive health check combining all monitoring probes
- [persister_errors](persister_errors.md) -- Scan persister logs for error categories
- [Guide: Debugging](../../guides/debugging.md) -- End-to-end debugging workflow
