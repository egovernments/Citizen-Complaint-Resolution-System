\set ON_ERROR_STOP on
\pset pager off

SELECT pg_advisory_lock(hashtext('ccrs-dashboard-performance-fixture'));

BEGIN;
CREATE TEMP TABLE _perf_cleanup ON COMMIT PRESERVE ROWS AS
SELECT :'run_id'::text AS run_id,
       substring(md5(:'run_id'), 1, 12) AS run_hash;

DO $$
DECLARE
  config record;
BEGIN
  SELECT * INTO config FROM _perf_cleanup;
  IF config.run_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$' THEN
    RAISE EXCEPTION 'run_id must match ^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$';
  END IF;
END $$;

-- Some deployments do not carry the PGR address foreign-key index. Without
-- it, PostgreSQL scans the full address table once for every service row being
-- deleted. This run-scoped support index is deliberately named, used only for
-- cleanup, and dropped after the zero-leftover validation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attname = 'parentid'
    WHERE i.indrelid = 'eg_pgr_address_v2'::regclass
      AND i.indisvalid
      AND i.indkey[0] = a.attnum
  ) THEN
    CREATE INDEX pgr_perf_fixture_address_parentid_idx
      ON eg_pgr_address_v2(parentid);
  END IF;
END $$;

CREATE TEMP TABLE _perf_targets ON COMMIT PRESERVE ROWS AS
SELECT s.id AS service_id, s.servicerequestid AS service_request_id
FROM eg_pgr_service_v2 s
CROSS JOIN _perf_cleanup c
WHERE s.additionaldetails->>'performanceFixture' = 'dashboard-v1'
  AND s.additionaldetails->>'performanceRunId' = c.run_id;

DELETE FROM complaint_open_state_daily d
USING _perf_cleanup c
WHERE d.service_request_id LIKE 'PERF-1109-' || c.run_hash || '-%';

DELETE FROM eg_wf_document_v2 d
USING eg_wf_processinstance_v2 pi, _perf_cleanup c
WHERE d.processinstanceid = pi.id
  AND pi.businessid LIKE 'PERF-1109-' || c.run_hash || '-%';

DELETE FROM eg_wf_assignee_v2 a
USING eg_wf_processinstance_v2 pi, _perf_cleanup c
WHERE a.processinstanceid = pi.id
  AND pi.businessid LIKE 'PERF-1109-' || c.run_hash || '-%';

DELETE FROM eg_wf_processinstance_v2 pi
USING _perf_cleanup c
WHERE pi.businessid LIKE 'PERF-1109-' || c.run_hash || '-%';

DELETE FROM eg_pgr_document_v2 d
USING _perf_targets t
WHERE d.service_id = t.service_id;

DELETE FROM eg_pgr_address_v2 a
USING _perf_targets t
WHERE a.parentid = t.service_id;

DELETE FROM eg_pgr_service_v2 s
USING _perf_targets t
WHERE s.id = t.service_id;
COMMIT;

\echo Refreshing dashboard grains after fixture removal
\if :refresh_concurrently
REFRESH MATERIALIZED VIEW CONCURRENTLY complaint_events;
REFRESH MATERIALIZED VIEW CONCURRENTLY complaint_facts;
REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_kpi;
REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_monthly_source;
REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_dimension;
\else
REFRESH MATERIALIZED VIEW complaint_events;
REFRESH MATERIALIZED VIEW complaint_facts;
REFRESH MATERIALIZED VIEW pgr_mv_kpi;
REFRESH MATERIALIZED VIEW pgr_mv_monthly;
REFRESH MATERIALIZED VIEW pgr_mv_monthly_source;
REFRESH MATERIALIZED VIEW pgr_mv_dimension;
\endif

ANALYZE complaint_events;
ANALYZE complaint_facts;
ANALYZE complaint_open_state_daily;
ANALYZE pgr_mv_kpi;
ANALYZE pgr_mv_monthly;
ANALYZE pgr_mv_monthly_source;
ANALYZE pgr_mv_dimension;

DO $$
DECLARE
  config record;
  leftovers bigint;
BEGIN
  SELECT * INTO config FROM _perf_cleanup;
  SELECT
      (SELECT count(*) FROM eg_pgr_service_v2 s
       WHERE s.additionaldetails->>'performanceFixture' = 'dashboard-v1'
         AND s.additionaldetails->>'performanceRunId' = config.run_id)
    + (SELECT count(*) FROM eg_wf_processinstance_v2 pi
       WHERE pi.businessid LIKE 'PERF-1109-' || config.run_hash || '-%')
    + (SELECT count(*) FROM complaint_events e
       WHERE e.service_request_id LIKE 'PERF-1109-' || config.run_hash || '-%')
    + (SELECT count(*) FROM complaint_facts f
       WHERE f.service_request_id LIKE 'PERF-1109-' || config.run_hash || '-%')
    + (SELECT count(*) FROM complaint_open_state_daily d
       WHERE d.service_request_id LIKE 'PERF-1109-' || config.run_hash || '-%')
  INTO leftovers;

  IF leftovers <> 0 THEN
    RAISE EXCEPTION 'fixture teardown validation failed: % run-scoped rows remain', leftovers;
  END IF;
END $$;

SELECT c.run_id, count(t.*) AS removed_complaints, 0 AS remaining_rows
FROM _perf_cleanup c LEFT JOIN _perf_targets t ON true
GROUP BY c.run_id;

DROP INDEX IF EXISTS pgr_perf_fixture_address_parentid_idx;

SELECT pg_advisory_unlock(hashtext('ccrs-dashboard-performance-fixture'));
