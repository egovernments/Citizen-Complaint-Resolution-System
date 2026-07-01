-- Enrich daily open snapshots so open-at-period-end charts/tables can group/filter on
-- workflow stage, channel, category, and per-complaint SLA fields.

ALTER TABLE complaint_open_state_daily
  ADD COLUMN IF NOT EXISTS application_status varchar(64),
  ADD COLUMN IF NOT EXISTS source              varchar(64),
  ADD COLUMN IF NOT EXISTS service_group      varchar(256),
  ADD COLUMN IF NOT EXISTS sla_target_ms      bigint;

UPDATE complaint_open_state_daily d
SET application_status = f.application_status,
    source             = f.source,
    service_group      = f.service_group,
    sla_target_ms      = f.sla_target_ms
FROM complaint_facts f
WHERE f.service_request_id = d.service_request_id
  AND (d.application_status IS NULL
    OR d.source IS NULL
    OR d.service_group IS NULL
    OR d.sla_target_ms IS NULL);

CREATE INDEX IF NOT EXISTS ix_cosd_status ON complaint_open_state_daily(application_status);
CREATE INDEX IF NOT EXISTS ix_cosd_source  ON complaint_open_state_daily(source);
