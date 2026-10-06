\set ON_ERROR_STOP on
\pset pager off

DO $$
BEGIN
  IF current_database() !~ '^dashboard_perf_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'refusing PGR reset outside a dashboard_perf_* clone: %', current_database();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION dashboard_perf_reject_external_pgr_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.additionaldetails->>'performanceFixture' IS DISTINCT FROM 'dashboard-v1' THEN
    RAISE EXCEPTION 'PGR writes are disabled during the dashboard performance maintenance window'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS dashboard_perf_write_guard ON eg_pgr_service_v2;
CREATE TRIGGER dashboard_perf_write_guard
BEFORE INSERT OR UPDATE ON eg_pgr_service_v2
FOR EACH ROW EXECUTE FUNCTION dashboard_perf_reject_external_pgr_writes();

SELECT pg_advisory_lock(hashtext('ccrs-dashboard-performance-fixture'));

BEGIN;

CREATE TEMP TABLE _all_pgr_targets ON COMMIT PRESERVE ROWS AS
SELECT id AS service_id, servicerequestid AS service_request_id
FROM eg_pgr_service_v2;

DELETE FROM complaint_open_state_daily;

DELETE FROM eg_wf_document_v2 d
USING eg_wf_processinstance_v2 pi, _all_pgr_targets t
WHERE d.processinstanceid = pi.id
  AND pi.businessid = t.service_request_id;

DELETE FROM eg_wf_assignee_v2 a
USING eg_wf_processinstance_v2 pi, _all_pgr_targets t
WHERE a.processinstanceid = pi.id
  AND pi.businessid = t.service_request_id;

DELETE FROM eg_wf_processinstance_v2 pi
USING _all_pgr_targets t
WHERE pi.businessid = t.service_request_id;

DELETE FROM eg_pgr_document_v2 d
USING _all_pgr_targets t
WHERE d.service_id = t.service_id;

DELETE FROM eg_pgr_address_v2 a
USING _all_pgr_targets t
WHERE a.parentid = t.service_id;

DELETE FROM eg_pgr_service_v2 s
USING _all_pgr_targets t
WHERE s.id = t.service_id;

COMMIT;

REFRESH MATERIALIZED VIEW complaint_events;
REFRESH MATERIALIZED VIEW complaint_facts;
REFRESH MATERIALIZED VIEW pgr_mv_kpi;
REFRESH MATERIALIZED VIEW pgr_mv_monthly;
REFRESH MATERIALIZED VIEW pgr_mv_monthly_source;
REFRESH MATERIALIZED VIEW pgr_mv_dimension;

DO $$
DECLARE
  leftovers bigint;
BEGIN
  SELECT count(*) INTO leftovers FROM eg_pgr_service_v2;
  IF leftovers <> 0 THEN
    RAISE EXCEPTION 'clone reset failed: % PGR complaints remain', leftovers;
  END IF;
END $$;

SELECT pg_advisory_unlock(hashtext('ccrs-dashboard-performance-fixture'));
