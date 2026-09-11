-- Widen the nb_dispatch_log idempotency key for the per-recipient pre-rendered
-- event model. PGR now emits ONE event per (recipient x channel) carrying a
-- stable transactionId (serviceRequestId:action:toState:subscriberId:channel),
-- so the dedup key moves from (event_id, channel) to
-- (transaction_id, channel, recipient_value). This lets two recipients on the
-- same channel coexist while still deduping Kafka redelivery of the same event.
--
-- NOTE: do NOT edit the applied V20260217124000 migration (Flyway checksum);
-- this is an additive, out-of-order migration (spring.flyway.out-of-order=true).

ALTER TABLE nb_dispatch_log ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(256);

-- Backfill existing rows so the new NOT NULL + unique index can be created.
UPDATE nb_dispatch_log
   SET transaction_id = event_id || ':' || channel
 WHERE transaction_id IS NULL;

ALTER TABLE nb_dispatch_log ALTER COLUMN transaction_id SET NOT NULL;

-- Drop the old (event_id, channel) unique key; replace with the per-recipient key.
DROP INDEX IF EXISTS uk_nb_dispatch_event_channel;

CREATE UNIQUE INDEX IF NOT EXISTS uk_nb_dispatch_txn_channel_recipient
    ON nb_dispatch_log (transaction_id, channel, recipient_value);

CREATE INDEX IF NOT EXISTS idx_nb_dispatch_transaction_id
    ON nb_dispatch_log (transaction_id);
