\set ON_ERROR_STOP on
\pset pager off

SELECT pg_advisory_lock(hashtext('ccrs-dashboard-performance-fixture'));

BEGIN;
SET LOCAL TIME ZONE 'UTC';

CREATE TEMP TABLE _perf_config ON COMMIT PRESERVE ROWS AS
SELECT :'run_id'::text            AS run_id,
       substring(md5(:'run_id'), 1, 12) AS run_hash,
       :'tenant_id'::text         AS tenant_id,
       :'row_count'::integer      AS row_count,
       :'anchor_time'::timestamptz AS anchor_time,
       :'service_code'::text      AS service_code,
       :'locality_code'::text     AS locality_code;

DO $$
DECLARE
  relation_name text;
  config record;
BEGIN
  SELECT * INTO config FROM _perf_config;

  IF config.run_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$' THEN
    RAISE EXCEPTION 'run_id must match ^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$';
  END IF;
  IF config.row_count NOT IN (3000, 50000, 100000) THEN
    RAISE EXCEPTION 'row_count must be exactly 3000, 50000, or 100000';
  END IF;

  FOREACH relation_name IN ARRAY ARRAY[
    'eg_pgr_service_v2', 'eg_pgr_address_v2', 'eg_pgr_document_v2',
    'eg_wf_businessservice_v2', 'eg_wf_state_v2',
    'eg_wf_processinstance_v2', 'eg_wf_assignee_v2', 'eg_wf_document_v2',
    'eg_mdms_data', 'boundary_relationship', 'eg_user',
    'complaint_events', 'complaint_facts', 'complaint_open_state_daily',
    'pgr_mv_kpi', 'pgr_mv_monthly', 'pgr_mv_monthly_source', 'pgr_mv_dimension'
  ] LOOP
    IF to_regclass('public.' || relation_name) IS NULL THEN
      RAISE EXCEPTION 'required dashboard relation public.% is missing', relation_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM eg_pgr_service_v2 s
    WHERE s.additionaldetails->>'performanceFixture' = 'dashboard-v1'
      AND s.additionaldetails->>'performanceRunId' = config.run_id
  ) THEN
    RAISE EXCEPTION 'fixture run % already exists; teardown it before setup', config.run_id;
  END IF;
END $$;

CREATE TEMP TABLE _perf_codes ON COMMIT PRESERVE ROWS AS
WITH config AS (SELECT * FROM _perf_config),
leaf_levels AS (
  SELECT DISTINCT level->>'levelCode' AS level_code
  FROM eg_mdms_data d
  CROSS JOIN LATERAL jsonb_array_elements(d.data->'levels') level
  CROSS JOIN config c
  WHERE d.schemacode = 'RAINMAKER-PGR.ComplaintHierarchyDefinition'
    AND d.isactive
    AND level->>'isLeafServiceCode' = 'true'
    AND (d.tenantid = c.tenant_id OR c.tenant_id LIKE d.tenantid || '.%')
),
candidates AS (
  SELECT DISTINCT d.data->>'code' AS code
  FROM eg_mdms_data d
  CROSS JOIN config c
  WHERE d.schemacode = 'RAINMAKER-PGR.ComplaintHierarchy'
    AND d.isactive
    AND d.data->>'levelCode' IN (SELECT level_code FROM leaf_levels)
    AND (d.tenantid = c.tenant_id OR c.tenant_id LIKE d.tenantid || '.%')
    AND (c.service_code = '' OR d.data->>'code' = c.service_code)
    AND nullif(btrim(d.data->>'code'), '') IS NOT NULL
)
SELECT row_number() OVER (ORDER BY code)::integer AS ordinal, code
FROM candidates;

CREATE TEMP TABLE _perf_localities ON COMMIT PRESERVE ROWS AS
WITH config AS (SELECT * FROM _perf_config),
candidates AS (
  SELECT DISTINCT br.code, br.boundarytype
  FROM boundary_relationship br
  CROSS JOIN config c
  WHERE (br.tenantid = c.tenant_id OR c.tenant_id LIKE br.tenantid || '.%')
    AND (c.locality_code = '' OR br.code = c.locality_code)
    AND nullif(btrim(br.code), '') IS NOT NULL
),
preferred AS (
  SELECT *
  FROM candidates
  WHERE lower(boundarytype) = 'ward'
     OR NOT EXISTS (SELECT 1 FROM candidates WHERE lower(boundarytype) = 'ward')
)
SELECT row_number() OVER (ORDER BY code)::integer AS ordinal, code
FROM preferred;

CREATE TEMP TABLE _perf_workflow ON COMMIT PRESERVE ROWS AS
WITH config AS (SELECT * FROM _perf_config),
business_service AS (
  SELECT bs.*
  FROM eg_wf_businessservice_v2 bs
  CROSS JOIN config c
  WHERE bs.businessservice = 'PGR'
    AND (bs.tenantid = c.tenant_id OR c.tenant_id LIKE bs.tenantid || '.%')
  ORDER BY length(bs.tenantid) DESC, bs.tenantid
  LIMIT 1
)
SELECT bs.businessservice,
       bs.businessservicesla,
       max(st.uuid) FILTER (WHERE st.state = 'PENDINGFORASSIGNMENT') AS pending_id,
       max(st.sla)  FILTER (WHERE st.state = 'PENDINGFORASSIGNMENT') AS pending_sla,
       max(st.uuid) FILTER (WHERE st.state = 'PENDINGATLME') AS assigned_id,
       max(st.sla)  FILTER (WHERE st.state = 'PENDINGATLME') AS assigned_sla,
       max(st.uuid) FILTER (WHERE st.state = 'RESOLVED') AS resolved_id,
       max(st.sla)  FILTER (WHERE st.state = 'RESOLVED') AS resolved_sla,
       max(st.uuid) FILTER (WHERE st.state = 'REJECTED') AS rejected_id,
       max(st.sla)  FILTER (WHERE st.state = 'REJECTED') AS rejected_sla
FROM business_service bs
JOIN eg_wf_state_v2 st ON st.businessserviceid = bs.uuid
GROUP BY bs.businessservice, bs.businessservicesla;

DO $$
DECLARE
  workflow record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _perf_codes) THEN
    RAISE EXCEPTION 'no active ComplaintHierarchy leaf codes match tenant/override';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _perf_localities) THEN
    RAISE EXCEPTION 'no boundary localities match tenant/override';
  END IF;
  SELECT * INTO workflow FROM _perf_workflow;
  IF workflow IS NULL THEN
    RAISE EXCEPTION 'no PGR business service matches tenant';
  END IF;
  IF workflow.pending_id IS NULL OR workflow.assigned_id IS NULL
     OR workflow.resolved_id IS NULL OR workflow.rejected_id IS NULL THEN
    RAISE EXCEPTION 'PGR workflow must provide PENDINGFORASSIGNMENT, PENDINGATLME, RESOLVED, and REJECTED states';
  END IF;
END $$;

CREATE TEMP TABLE _perf_actors ON COMMIT PRESERVE ROWS AS
WITH config AS (SELECT * FROM _perf_config), candidates AS (
  SELECT DISTINCT btrim(u.uuid::text) AS uuid
  FROM eg_user u
  CROSS JOIN config c
  WHERE u.uuid IS NOT NULL
    AND u.active
    AND u.type = 'EMPLOYEE'
    AND (u.tenantid = c.tenant_id OR c.tenant_id LIKE u.tenantid || '.%')
  ORDER BY btrim(u.uuid::text)
  LIMIT 500
)
SELECT row_number() OVER (ORDER BY uuid)::integer AS ordinal, uuid
FROM candidates;

INSERT INTO _perf_actors (ordinal, uuid)
SELECT 1, '00000000-0000-4000-8000-000000001109'
WHERE NOT EXISTS (SELECT 1 FROM _perf_actors);

CREATE TEMP TABLE _perf_rows ON COMMIT PRESERVE ROWS AS
WITH config AS (SELECT * FROM _perf_config),
counts AS (
  SELECT (SELECT count(*) FROM _perf_codes)::integer AS code_count,
         (SELECT count(*) FROM _perf_localities)::integer AS locality_count,
         (SELECT count(*) FROM _perf_actors)::integer AS actor_count
),
generated AS (
  SELECT n,
         c.*,
         counts.*,
         CASE
           WHEN n % 100 < 12 THEN (n * 37) % 7
           WHEN n % 100 < 35 THEN 7 + ((n * 37) % 23)
           WHEN n % 100 < 60 THEN 30 + ((n * 37) % 60)
           WHEN n % 100 < 80 THEN 90 + ((n * 37) % 90)
           ELSE 180 + ((n * 37) % 185)
         END::integer AS age_days,
         CASE
           WHEN n % 100 < 55 THEN 'resolved'
           WHEN n % 100 < 65 THEN 'pending'
           WHEN n % 100 < 85 THEN 'assigned'
           WHEN n % 100 < 95 THEN 'rejected'
           ELSE 'reopened'
         END AS outcome
  FROM config c
  CROSS JOIN counts
  CROSS JOIN LATERAL generate_series(1, c.row_count) n
),
timed AS (
  SELECT g.*,
         least(
           date_trunc('day', g.anchor_time) - (g.age_days * interval '1 day')
             + CASE WHEN g.n % 4 <> 0
                    THEN (9 + (g.n % 9)) * interval '1 hour'
                    ELSE (19 + (g.n % 4)) * interval '1 hour' END,
           g.anchor_time - interval '1 hour'
         ) AS created_at
  FROM generated g
),
milliseconds AS (
  SELECT t.*,
         (extract(epoch FROM t.created_at) * 1000)::bigint AS created_ms,
         greatest(3600000::bigint,
                  (extract(epoch FROM (t.anchor_time - t.created_at)) * 1000)::bigint) AS available_ms
  FROM timed t
)
SELECT m.n,
       m.outcome,
       m.run_id,
       m.run_hash,
       m.tenant_id,
       m.anchor_time,
       'p1109' || m.run_hash || lpad(m.n::text, 6, '0') AS service_id,
       'PERF-1109-' || m.run_hash || '-' || lpad(m.n::text, 6, '0') AS service_request_id,
       (SELECT code FROM _perf_codes
        WHERE ordinal = 1 + CASE WHEN m.n % 2 = 0
          THEN ((m.n * 17) % greatest(1, ceil(m.code_count * 0.2)::integer))
          ELSE ((m.n * 17) % m.code_count) END) AS service_code,
       (SELECT code FROM _perf_localities
        WHERE ordinal = 1 + CASE WHEN m.n % 2 = 0
          THEN ((m.n * 13) % greatest(1, ceil(m.locality_count * 0.2)::integer))
          ELSE ((m.n * 13) % m.locality_count) END) AS locality_code,
       (SELECT uuid FROM _perf_actors WHERE ordinal = 1 + ((m.n - 1) % m.actor_count)) AS actor_uuid,
       (SELECT uuid FROM _perf_actors WHERE ordinal = 1 + (m.n % m.actor_count)) AS assignee_uuid,
       'perf-citizen-' || m.run_hash || '-' ||
         CASE WHEN m.n % 10 < 7 THEN lpad(m.n::text, 6, '0')
              WHEN m.n % 10 < 9 THEN lpad((m.n / 3)::text, 6, '0')
              ELSE lpad((m.n / 25)::text, 6, '0') END AS account_id,
       CASE WHEN m.n % 100 < 55 THEN 'web'
            WHEN m.n % 100 < 80 THEN 'mobile'
            WHEN m.n % 100 < 95 THEN 'CSC'
            ELSE 'whatsapp' END AS source,
       CASE m.outcome WHEN 'resolved' THEN 'RESOLVED'
                      WHEN 'pending' THEN 'PENDINGFORASSIGNMENT'
                      WHEN 'assigned' THEN 'PENDINGATLME'
                      WHEN 'rejected' THEN 'REJECTED'
                      ELSE 'PENDINGFORASSIGNMENT' END AS application_status,
       CASE WHEN m.outcome = 'resolved' AND (m.n * 31 + 7) % 100 < 65 THEN
              CASE WHEN (m.n * 17 + 3) % 100 < 5 THEN 1
                   WHEN (m.n * 17 + 3) % 100 < 15 THEN 2
                   WHEN (m.n * 17 + 3) % 100 < 35 THEN 3
                   WHEN (m.n * 17 + 3) % 100 < 70 THEN 4
                   ELSE 5 END
            END::smallint AS rating,
       m.created_ms,
       m.available_ms,
       m.created_ms + least(3600000::bigint,
                            greatest(60000::bigint, (m.available_ms * 0.10)::bigint)) AS assigned_ms,
       m.created_ms + least(7200000::bigint,
                            greatest(120000::bigint, (m.available_ms * 0.20)::bigint)) AS reassigned_ms,
       m.created_ms + CASE WHEN m.n % 5 = 0
                            THEN least((m.available_ms * 0.80)::bigint, 10 * 86400000::bigint)
                            ELSE least((m.available_ms * 0.80)::bigint, 2 * 86400000::bigint)
                          END AS resolved_ms,
       m.created_ms + (m.available_ms * 0.90)::bigint AS reopened_ms,
       (m.n % 5 = 0) AS has_reassignment,
       (m.n % 10 = 0) AS is_escalated,
       (m.n % 20 = 0) AS has_multiple_assignees
FROM milliseconds m;

INSERT INTO eg_pgr_service_v2
  (id, tenantid, servicecode, servicerequestid, description, accountid,
   additionaldetails, applicationstatus, rating, source, createdby, createdtime,
   lastmodifiedby, lastmodifiedtime, active)
SELECT r.service_id, r.tenant_id, r.service_code, r.service_request_id,
       'Deterministic dashboard performance fixture ' || r.run_id || ' #' || r.n,
       r.account_id,
       jsonb_build_object(
         'performanceFixture', 'dashboard-v1',
         'performanceRunId', r.run_id,
         'ordinal', r.n,
         'anchorTime', to_char(r.anchor_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
       ),
       r.application_status, r.rating, r.source, r.actor_uuid, r.created_ms,
       r.actor_uuid,
       CASE r.outcome WHEN 'resolved' THEN r.resolved_ms
                      WHEN 'reopened' THEN r.reopened_ms
                      WHEN 'assigned' THEN r.assigned_ms
                      ELSE r.created_ms END,
       true
FROM _perf_rows r;

INSERT INTO eg_pgr_address_v2
  (tenantid, id, parentid, city, locality, district, region, state, country,
   latitude, longitude, createdby, createdtime, lastmodifiedby, lastmodifiedtime,
   additionaldetails)
SELECT r.tenant_id,
       'a1109' || r.run_hash || lpad(r.n::text, 6, '0'),
       r.service_id,
       split_part(r.tenant_id, '.', 2), r.locality_code,
       split_part(r.tenant_id, '.', 2), split_part(r.tenant_id, '.', 1),
       split_part(r.tenant_id, '.', 1), 'fixture',
       CASE WHEN r.n % 5 <> 0 THEN (-0.300000 + ((r.n * 37) % 1000) / 10000.0)::numeric(9,6) END,
       CASE WHEN r.n % 5 <> 0 THEN (36.700000 + ((r.n * 53) % 1000) / 10000.0)::numeric(10,7) END,
       r.actor_uuid, r.created_ms, r.actor_uuid, r.created_ms,
       jsonb_build_object('performanceFixture', 'dashboard-v1', 'performanceRunId', r.run_id)
FROM _perf_rows r;

CREATE TEMP TABLE _perf_events ON COMMIT PRESERVE ROWS AS
WITH workflow AS (SELECT * FROM _perf_workflow)
SELECT 'w1109' || r.run_hash || lpad(r.n::text, 6, '0') || 'a' AS event_id,
       r.*, 'APPLY'::text AS action, w.pending_id AS status_id,
       w.pending_sla AS state_sla, r.created_ms AS event_ms, false AS escalated
FROM _perf_rows r CROSS JOIN workflow w
UNION ALL
SELECT 'w1109' || r.run_hash || lpad(r.n::text, 6, '0') || 'b',
       r.*, 'ASSIGN', w.assigned_id, w.assigned_sla, r.assigned_ms, r.is_escalated
FROM _perf_rows r CROSS JOIN workflow w
WHERE r.outcome IN ('resolved', 'assigned', 'reopened')
UNION ALL
SELECT 'w1109' || r.run_hash || lpad(r.n::text, 6, '0') || 'c',
       r.*, 'REASSIGN', w.assigned_id, w.assigned_sla, r.reassigned_ms, r.is_escalated
FROM _perf_rows r CROSS JOIN workflow w
WHERE r.outcome IN ('resolved', 'assigned', 'reopened') AND r.has_reassignment
UNION ALL
SELECT 'w1109' || r.run_hash || lpad(r.n::text, 6, '0') || 'd',
       r.*, 'RESOLVE', w.resolved_id, w.resolved_sla, r.resolved_ms, false
FROM _perf_rows r CROSS JOIN workflow w
WHERE r.outcome IN ('resolved', 'reopened')
UNION ALL
SELECT 'w1109' || r.run_hash || lpad(r.n::text, 6, '0') || 'e',
       r.*, 'REJECT', w.rejected_id, w.rejected_sla,
       r.created_ms + (r.available_ms * 0.60)::bigint, false
FROM _perf_rows r CROSS JOIN workflow w
WHERE r.outcome = 'rejected'
UNION ALL
SELECT 'w1109' || r.run_hash || lpad(r.n::text, 6, '0') || 'f',
       r.*, 'REOPEN', w.pending_id, w.pending_sla, r.reopened_ms, false
FROM _perf_rows r CROSS JOIN workflow w
WHERE r.outcome = 'reopened';

INSERT INTO eg_wf_processinstance_v2
  (id, tenantid, businessservice, businessid, action, status, comment,
   assigner, assignee, statesla, previousstatus, createdby, lastmodifiedby,
   createdtime, lastmodifiedtime, modulename, businessservicesla, rating, escalated)
SELECT e.event_id, e.tenant_id, w.businessservice, e.service_request_id,
       e.action, e.status_id,
       'Dashboard performance fixture ' || e.run_id,
       e.actor_uuid, NULL, e.state_sla, NULL, e.actor_uuid, e.actor_uuid,
       e.event_ms, e.event_ms, 'pgr-services', w.businessservicesla,
       CASE WHEN e.action = 'RESOLVE' THEN e.rating END, e.escalated
FROM _perf_events e CROSS JOIN _perf_workflow w;

INSERT INTO eg_wf_assignee_v2
  (processinstanceid, tenantid, assignee, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT e.event_id, e.tenant_id, e.assignee_uuid, e.actor_uuid, e.actor_uuid, e.event_ms, e.event_ms
FROM _perf_events e
WHERE e.action IN ('ASSIGN', 'REASSIGN')
UNION ALL
SELECT e.event_id, e.tenant_id, e.actor_uuid, e.actor_uuid, e.actor_uuid, e.event_ms, e.event_ms
FROM _perf_events e
WHERE e.action IN ('ASSIGN', 'REASSIGN') AND e.has_multiple_assignees;

COMMIT;

\echo Refreshing complaint_events, then complaint_facts
\if :refresh_concurrently
REFRESH MATERIALIZED VIEW CONCURRENTLY complaint_events;
REFRESH MATERIALIZED VIEW CONCURRENTLY complaint_facts;
\else
REFRESH MATERIALIZED VIEW complaint_events;
REFRESH MATERIALIZED VIEW complaint_facts;
\endif

BEGIN;
INSERT INTO complaint_open_state_daily
  (snapshot_date, service_request_id, tenant_id, is_open, sla_breached,
   sla_status_bucket, aging_bucket, boundary_path, ward_code, zone_code,
   service_code, current_assignee_uuid, department_code, account_id)
SELECT (c.anchor_time AT TIME ZONE 'UTC')::date,
       f.service_request_id, f.tenant_id, f.is_open, f.sla_breached,
       f.sla_status_bucket, f.aging_bucket, f.boundary_path, f.ward_code,
       f.zone_code, f.service_code, f.current_assignee_uuid,
       f.department_code, f.account_id
FROM complaint_facts f
CROSS JOIN _perf_config c
WHERE f.service_request_id LIKE 'PERF-1109-' || c.run_hash || '-%'
  AND f.is_open
ON CONFLICT (snapshot_date, service_request_id) DO NOTHING;
COMMIT;

\echo Refreshing legacy dashboard materialized views
\if :refresh_concurrently
REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_kpi;
REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_monthly_source;
REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_dimension;
\else
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
  base_count bigint;
  fact_count bigint;
  event_count bigint;
  expected_events bigint;
BEGIN
  SELECT * INTO config FROM _perf_config;
  SELECT count(*) INTO base_count
  FROM eg_pgr_service_v2
  WHERE additionaldetails->>'performanceFixture' = 'dashboard-v1'
    AND additionaldetails->>'performanceRunId' = config.run_id;
  SELECT count(*) INTO fact_count FROM complaint_facts
  WHERE service_request_id LIKE 'PERF-1109-' || config.run_hash || '-%';
  SELECT count(*) INTO event_count FROM complaint_events
  WHERE service_request_id LIKE 'PERF-1109-' || config.run_hash || '-%';
  SELECT count(*) INTO expected_events FROM _perf_events;

  IF base_count <> config.row_count THEN
    RAISE EXCEPTION 'base fixture validation failed: expected %, found %', config.row_count, base_count;
  END IF;
  IF fact_count <> config.row_count THEN
    RAISE EXCEPTION 'complaint_facts validation failed: expected %, found %', config.row_count, fact_count;
  END IF;
  IF event_count <> expected_events THEN
    RAISE EXCEPTION 'complaint_events validation failed: expected %, found %', expected_events, event_count;
  END IF;
END $$;

SELECT c.run_id,
       c.row_count AS seeded_complaints,
       (SELECT count(*) FROM complaint_events e WHERE e.service_request_id LIKE 'PERF-1109-' || c.run_hash || '-%') AS materialized_events,
       (SELECT count(*) FROM complaint_facts f WHERE f.service_request_id LIKE 'PERF-1109-' || c.run_hash || '-%') AS materialized_facts,
       (SELECT count(*) FROM complaint_open_state_daily d WHERE d.service_request_id LIKE 'PERF-1109-' || c.run_hash || '-%') AS daily_snapshot_rows
FROM _perf_config c;

SELECT pg_advisory_unlock(hashtext('ccrs-dashboard-performance-fixture'));
