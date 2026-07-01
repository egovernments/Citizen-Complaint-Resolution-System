-- Age columns on daily open snapshots so "oldest open complaint at period end" can be
-- computed from complaint_open_state_daily (point-in-time open cohort) instead of live facts.

ALTER TABLE complaint_open_state_daily
  ADD COLUMN IF NOT EXISTS created_at  bigint,
  ADD COLUMN IF NOT EXISTS open_age_ms bigint;

UPDATE complaint_open_state_daily d
SET created_at = f.created_at
FROM complaint_facts f
WHERE f.service_request_id = d.service_request_id
  AND d.created_at IS NULL;

-- Age at end of snapshot_date (EAT): start of the next calendar day minus filed time.
UPDATE complaint_open_state_daily d
SET open_age_ms = (
      EXTRACT(EPOCH FROM ((d.snapshot_date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Africa/Nairobi')) * 1000
    )::bigint - d.created_at
WHERE d.open_age_ms IS NULL
  AND d.created_at IS NOT NULL;
