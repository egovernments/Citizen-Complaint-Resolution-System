\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

WITH config AS (
  SELECT :'run_id'::text AS run_id, substring(md5(:'run_id'), 1, 12) AS run_hash
)
SELECT jsonb_pretty(jsonb_build_object(
  'runId', c.run_id,
  'fixture', 'dashboard-v1',
  'baseComplaints', (SELECT count(*) FROM eg_pgr_service_v2 s
    WHERE s.additionaldetails->>'performanceFixture' = 'dashboard-v1'
      AND s.additionaldetails->>'performanceRunId' = c.run_id),
  'workflowEvents', (SELECT count(*) FROM eg_wf_processinstance_v2 pi
    WHERE pi.businessid LIKE 'PERF-1109-' || c.run_hash || '-%'),
  'materializedEvents', (SELECT count(*) FROM complaint_events e
    WHERE e.service_request_id LIKE 'PERF-1109-' || c.run_hash || '-%'),
  'materializedFacts', (SELECT count(*) FROM complaint_facts f
    WHERE f.service_request_id LIKE 'PERF-1109-' || c.run_hash || '-%'),
  'dailySnapshotRows', (SELECT count(*) FROM complaint_open_state_daily d
    WHERE d.service_request_id LIKE 'PERF-1109-' || c.run_hash || '-%')
))
FROM config c;
