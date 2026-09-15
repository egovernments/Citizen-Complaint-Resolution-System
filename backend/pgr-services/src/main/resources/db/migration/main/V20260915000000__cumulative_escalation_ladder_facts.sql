-- Align complaint_facts with #2048's cumulative absolute escalation fallback.
-- Flyway migrations are append-only, so recreate the latest facts MV rather than
-- changing V20260810000000. ComplaintHierarchy.slaHours remains the primary SLA;
-- when it is absent, use the FINAL absolute escalation threshold, never their sum.
-- Structured exact-service-code slaByLevel overrides follow runtime precedence.
-- ---- grain 2: complaint_facts (CASCADE dropped by the events recreate) ------
DROP MATERIALIZED VIEW IF EXISTS complaint_facts CASCADE;
CREATE MATERIALIZED VIEW complaint_facts AS
WITH RECURSIVE clock AS (SELECT (extract(epoch FROM now())*1000)::bigint AS now_ms),
roll AS (
  SELECT service_request_id,
         min(entered_at)                                            AS created_at,
         max(entered_at)                                            AS last_transition_at,
         count(*)                                                   AS transition_count,
         count(*) FILTER (WHERE is_assignment)                      AS assignment_count,
         count(*) FILTER (WHERE is_escalation)                      AS escalation_count,
         count(*) FILTER (WHERE is_reopen)                          AS reopen_count,
         count(DISTINCT assignee_uuid)                              AS distinct_assignee_count,
         count(DISTINCT actor_uuid)                                 AS distinct_actor_count,
         count(*) FILTER (WHERE actor_is_system)                    AS system_transition_count,
         count(*) FILTER (WHERE NOT actor_is_system)                AS manual_transition_count,
         bool_or(status IN ('REJECTED','CLOSEDAFTERREJECTION'))     AS was_rejected,
         min(entered_at) FILTER (WHERE is_assignment)               AS first_assigned_at,
         min(entered_at) FILTER (WHERE status IN ('RESOLVED','CLOSEDAFTERRESOLUTION')) AS resolved_at,
         max(entered_at) FILTER (WHERE is_escalation)               AS last_escalated_at,
         min(entered_at) FILTER (WHERE is_escalation)               AS first_escalated_at,
         max(dwell_ms)                                              AS max_dwell_ms,
         sum(dwell_ms) FILTER (WHERE assignee_uuid IS NOT NULL)     AS assigned_dwell_ms,
         sum(dwell_ms) FILTER (WHERE assignee_uuid IS NULL)         AS unassigned_dwell_ms
  FROM complaint_events GROUP BY service_request_id
),
cur AS (
  SELECT service_request_id, status AS application_status, status_seq AS current_state_seq,
         status_is_open AS is_open, assignee_uuid AS current_assignee_uuid,
         state_sla_ms AS current_state_sla_ms, business_sla_ms,
         boundary_path, ward_code, zone_code,
         boundary_leaf_code, boundary_leaf_type                     -- #1079
  FROM complaint_events WHERE is_current_state
),
mdms AS (   -- #1494: ComplaintHierarchy LEAF rows (was RAINMAKER-PGR.ServiceDefs).
            -- See the matching CTE in complaint_events above for the leaf-detection and
            -- 'NA' rationale. legacy_service_group was ServiceDefs.menuPath, which the
            -- #917 migration consumed and did NOT carry onto the new master — grouping is
            -- parentCode-driven now, so the fallback is retired to NULL and service_group
            -- resolves from the hierarchy path alone (see the coalesce below).
  SELECT tenantid,
         data->>'code'                   AS service_code,
         (data->>'slaHours')::int        AS mdms_sla_hours,
         NULL::text                      AS legacy_service_group,   -- #1494: retired with menuPath
         (data->>'order')::smallint      AS service_order,
         CASE WHEN upper(btrim(coalesce(data->>'department', data->'departments'->>0))) IN ('NA','')
              THEN NULL
              ELSE btrim(coalesce(data->>'department', data->'departments'->>0))
         END AS department_code
  FROM eg_mdms_data
  WHERE schemacode = 'RAINMAKER-PGR.ComplaintHierarchy' AND isactive
    AND data->>'levelCode' IN (SELECT level_code FROM chlvl)   -- WITH RECURSIVE: forward ref is legal
),
chlvl AS (   -- #1079: levelCodes flagged isLeafServiceCode in ComplaintHierarchyDefinition
  SELECT DISTINCT lvl->>'levelCode' AS level_code
  FROM eg_mdms_data d
  CROSS JOIN LATERAL jsonb_array_elements(d.data->'levels') lvl
  WHERE d.schemacode = 'RAINMAKER-PGR.ComplaintHierarchyDefinition' AND d.isactive
    AND (lvl->>'isLeafServiceCode')::boolean
),
ch AS (   -- ComplaintHierarchy nodes; dedupe by code preferring leaf-level records
          -- (registry leaf detection), then the root (shortest) tenant
  SELECT DISTINCT ON (data->>'code')
         data->>'code'                  AS code,
         NULLIF(data->>'path','')       AS node_path,
         NULLIF(data->>'parentCode','') AS parent_code
  FROM eg_mdms_data
  WHERE schemacode = 'RAINMAKER-PGR.ComplaintHierarchy' AND isactive
  ORDER BY data->>'code',
           (data->>'levelCode' IN (SELECT level_code FROM chlvl)) DESC,
           length(tenantid)
),
chwalk AS (   -- recursive parentCode walk (robust fallback when path is absent)
  SELECT code AS leaf_code, code, parent_code, code::text AS built_path, 1 AS depth
  FROM ch
  UNION ALL
  SELECT w.leaf_code, p.code, p.parent_code, (p.code || '.' || w.built_path), w.depth + 1
  FROM chwalk w
  JOIN ch p ON p.code = w.parent_code
  WHERE w.depth < 12
),
cnp AS (   -- #1079: complaint_node_path per code = master path, else recursive build.
           -- #1111/R5: NULL when the matched node's OWN code contains '.' — legacy flat
           -- imports carry dots INSIDE one code, so any '.'-split of their path would
           -- fabricate garbage level buckets; NULL path => the query-time level expr
           -- falls back to the leaf service_code instead.
           -- R5 widening: ALSO NULL when a dotted code/parentCode appears ANYWHERE in the
           -- node's ancestor chain (chwalk carries the node itself at depth 1, so this
           -- strictly contains the old node+parent predicate) — clean-code nodes anywhere
           -- under a dotted legacy code inherit a polluted path/built_path and would
           -- otherwise survive as the same garbage buckets.
  SELECT ch.code,
         CASE WHEN EXISTS (
                SELECT 1 FROM chwalk w
                WHERE w.leaf_code = ch.code
                  AND (position('.' IN w.code) > 0
                       OR position('.' IN coalesce(w.parent_code, '')) > 0)
              ) THEN NULL
              ELSE coalesce(ch.node_path, walk.built_path) END AS complaint_node_path
  FROM ch
  LEFT JOIN LATERAL (
    SELECT w.built_path FROM chwalk w WHERE w.leaf_code = ch.code
    ORDER BY w.depth DESC LIMIT 1
  ) walk ON true
),
esc_ranked AS ( -- Mirror the runtime singleton rule: one DEFAULT, or one legacy row.
  SELECT tenantid,
         data->>'code'              AS code,
         data->'overrides'         AS overrides,
         data->'defaultSlaByLevel' AS default_levels,
         count(*) OVER (PARTITION BY tenantid) AS record_count,
         count(*) FILTER (WHERE upper(data->>'code') = 'DEFAULT')
           OVER (PARTITION BY tenantid) AS default_count
  FROM eg_mdms_data
  WHERE schemacode = 'RAINMAKER-PGR.EscalationConfig' AND isactive
),
esc AS (
  SELECT tenantid, overrides, default_levels
  FROM esc_ranked
  WHERE (record_count = 1 AND default_count = 1 AND upper(code) = 'DEFAULT')
     OR (default_count = 0 AND record_count = 1 AND code IS NULL)
),
seq AS (
  SELECT id, row_number() OVER (PARTITION BY accountid ORDER BY createdtime, id) AS complaint_seq_for_citizen
  FROM eg_pgr_service_v2
)
SELECT
  s.servicerequestid AS service_request_id, s.id AS pgr_id, s.tenantid AS tenant_id,
  s.accountid AS account_id, 'PGR'::text AS business_service,
  s.servicecode AS service_code, cur.application_status, s.source, s.rating AS rating_raw, s.active,
  length(s.description) AS description_length,
  (s.description IS NOT NULL AND s.description <> '') AS has_description,
  s.createdby AS filed_by_uuid, (s.createdby <> s.accountid) AS filed_on_behalf,
  a.locality AS locality_code, a.pincode, a.city, a.latitude, a.longitude,
  (a.latitude IS NOT NULL AND a.longitude IS NOT NULL) AS has_geo_pin,
  (a.parentid IS NOT NULL) AS has_address,
  cur.boundary_path,
  (length(coalesce(cur.boundary_path,'')) - length(replace(coalesce(cur.boundary_path,''),'|','')) + 1)::smallint AS boundary_depth,
  cur.ward_code, cur.zone_code,
  cur.boundary_leaf_code, cur.boundary_leaf_type,                          -- #1079
  cnp.complaint_node_path,                                                 -- #1079
  cx.complaint_depth,                                                      -- #1079
  coalesce(cx.root_code, m.legacy_service_group) AS service_group,         -- #1079: ROOT category
  cx.service_parent_code,                                                  -- #1079: immediate parent
  m.service_order, m.mdms_sla_hours, m.department_code,
  cur.current_state_seq, cur.current_state_sla_ms, tgt.sla_target_ms,      -- #1028: COALESCE'd target
  (m.mdms_sla_hours IS NOT NULL AND cur.business_sla_ms IS NOT NULL
    AND m.mdms_sla_hours::bigint*3600000 <> cur.business_sla_ms) AS sla_config_mismatch,
  roll.created_at, roll.first_assigned_at, roll.first_assigned_at AS first_response_at,
  roll.resolved_at, roll.last_transition_at, roll.first_escalated_at, roll.last_escalated_at,
  roll.transition_count, roll.assignment_count, roll.escalation_count, roll.reopen_count,
  roll.distinct_assignee_count, roll.distinct_actor_count,
  roll.system_transition_count, roll.manual_transition_count,
  roll.was_rejected, (roll.reopen_count > 0) AS is_reopened,
  cur.is_open, (roll.resolved_at IS NOT NULL) AS is_resolved,
  roll.max_dwell_ms, roll.assigned_dwell_ms, roll.unassigned_dwell_ms,
  cur.current_assignee_uuid,
  (roll.resolved_at - roll.created_at)                            AS resolution_ms,
  (roll.first_assigned_at - roll.created_at)                      AS time_to_assign_ms,
  CASE WHEN cur.is_open THEN clock.now_ms - roll.created_at END   AS open_age_ms,
  CASE WHEN cur.is_open THEN clock.now_ms - roll.last_transition_at END AS current_state_age_ms,
  (roll.first_escalated_at - roll.created_at)                     AS first_escalation_ms,
  CASE WHEN cur.is_open  THEN (tgt.sla_target_ms IS NOT NULL AND (clock.now_ms - roll.created_at) > tgt.sla_target_ms)
       WHEN roll.resolved_at IS NOT NULL THEN (tgt.sla_target_ms IS NOT NULL AND (roll.resolved_at - roll.created_at) > tgt.sla_target_ms)
       ELSE false END                                            AS sla_breached,
  (cur.is_open AND cur.current_state_sla_ms IS NOT NULL
    AND (clock.now_ms - roll.last_transition_at) > cur.current_state_sla_ms) AS current_state_sla_breached,
  CASE WHEN NOT cur.is_open THEN NULL
       WHEN (clock.now_ms - roll.created_at) < 86400000  THEN '<1d'
       WHEN (clock.now_ms - roll.created_at) < 259200000 THEN '1-3d'
       WHEN (clock.now_ms - roll.created_at) < 604800000 THEN '3-7d'
       ELSE '>7d' END                                            AS aging_bucket,
  CASE WHEN NOT cur.is_open OR tgt.sla_target_ms IS NULL THEN NULL
       WHEN (clock.now_ms - roll.created_at) > tgt.sla_target_ms       THEN 'breached'
       WHEN (clock.now_ms - roll.created_at) > 0.8*tgt.sla_target_ms   THEN 'approaching'
       ELSE 'within' END                                         AS sla_status_bucket,
  (s.rating IS NOT NULL) AS has_rating, s.rating, (s.rating IS NOT NULL AND s.rating <= 2) AS is_negative_rating,
  seq.complaint_seq_for_citizen, (seq.complaint_seq_for_citizen = 1) AS is_first_time_complainant,
  (to_timestamp(roll.created_at/1000) AT TIME ZONE COALESCE(tz.resolved_zone, 'Africa/Nairobi'))::date AS created_date,
  date_trunc('week',(to_timestamp(roll.created_at/1000) AT TIME ZONE COALESCE(tz.resolved_zone, 'Africa/Nairobi')))::date AS created_week_start,
  to_char((to_timestamp(roll.created_at/1000) AT TIME ZONE COALESCE(tz.resolved_zone, 'Africa/Nairobi')),'YYYY-MM') AS created_month,
  extract(year FROM (to_timestamp(roll.created_at/1000) AT TIME ZONE COALESCE(tz.resolved_zone, 'Africa/Nairobi')))::smallint AS created_year,
  to_char((to_timestamp(roll.created_at/1000) AT TIME ZONE COALESCE(tz.resolved_zone, 'Africa/Nairobi')),'YYYY-"Q"Q') AS created_quarter,
  extract(hour FROM (to_timestamp(roll.created_at/1000) AT TIME ZONE COALESCE(tz.resolved_zone, 'Africa/Nairobi')))::smallint AS created_hour,
  extract(isodow FROM (to_timestamp(roll.created_at/1000) AT TIME ZONE COALESCE(tz.resolved_zone, 'Africa/Nairobi')))::smallint AS created_dow,
  (extract(isodow FROM (to_timestamp(roll.created_at/1000) AT TIME ZONE COALESCE(tz.resolved_zone, 'Africa/Nairobi'))) IN (6,7)) AS created_is_weekend,
  (extract(hour FROM (to_timestamp(roll.created_at/1000) AT TIME ZONE COALESCE(tz.resolved_zone, 'Africa/Nairobi'))) BETWEEN 8 AND 17) AS created_is_business_hr,
  (to_timestamp(roll.resolved_at/1000) AT TIME ZONE COALESCE(tz.resolved_zone, 'Africa/Nairobi'))::date AS resolved_date,
  to_char((to_timestamp(roll.resolved_at/1000) AT TIME ZONE COALESCE(tz.resolved_zone, 'Africa/Nairobi')),'YYYY-MM') AS resolved_month,
  clock.now_ms AS facts_built_at
FROM eg_pgr_service_v2 s
LEFT JOIN LATERAL (
  SELECT candidate.resolved_zone
  FROM pgr_dashboard_tenant_timezone candidate
  WHERE s.tenantid = candidate.state_root_tenant_id
     OR left(s.tenantid, length(candidate.state_root_tenant_id) + 1)
          = candidate.state_root_tenant_id || '.'
  ORDER BY array_length(string_to_array(candidate.state_root_tenant_id, '.'), 1) DESC,
           candidate.state_root_tenant_id
  LIMIT 1
) tz ON true
CROSS JOIN clock
LEFT JOIN eg_pgr_address_v2 a ON a.parentid = s.id
LEFT JOIN roll ON roll.service_request_id = s.servicerequestid
LEFT JOIN cur  ON cur.service_request_id  = s.servicerequestid
LEFT JOIN LATERAL (                          -- exact city hierarchy, then nearest ancestor/state
  SELECT candidate.service_code, candidate.mdms_sla_hours,
         candidate.legacy_service_group, candidate.service_order,
         candidate.department_code
  FROM mdms candidate
  WHERE candidate.service_code = s.servicecode
    AND (s.tenantid = candidate.tenantid
         OR left(s.tenantid, length(candidate.tenantid) + 1) = candidate.tenantid || '.')
  ORDER BY array_length(string_to_array(candidate.tenantid, '.'), 1) DESC,
           candidate.tenantid
  LIMIT 1
) m ON true
LEFT JOIN cnp ON cnp.code = s.servicecode
CROSS JOIN LATERAL (                         -- #1079: path-derived complaint-axis fields
  SELECT x.arr[1]                            AS root_code,
         array_length(x.arr,1)::smallint     AS complaint_depth,
         x.arr[array_length(x.arr,1)-1]      AS service_parent_code
  FROM (SELECT string_to_array(cnp.complaint_node_path,'.') AS arr) x
) cx
LEFT JOIN LATERAL (                          -- cumulative absolute fallback for this complaint
  SELECT CASE
           WHEN jsonb_typeof(e.overrides -> s.servicecode) = 'array'
             THEN (SELECT v.value::numeric::bigint
                   FROM jsonb_array_elements_text(e.overrides -> s.servicecode)
                        WITH ORDINALITY v(value, ord)
                   ORDER BY v.ord DESC LIMIT 1)
           WHEN jsonb_typeof(e.overrides -> s.servicecode) = 'object'
                AND jsonb_typeof(e.overrides -> s.servicecode -> 'slaByLevel') = 'array'
             THEN (SELECT v.value::numeric::bigint
                   FROM jsonb_array_elements_text(e.overrides -> s.servicecode -> 'slaByLevel')
                        WITH ORDINALITY v(value, ord)
                   ORDER BY v.ord DESC LIMIT 1)
           WHEN jsonb_typeof(e.default_levels) = 'array'
             THEN (SELECT v.value::numeric::bigint
                   FROM jsonb_array_elements_text(e.default_levels)
                        WITH ORDINALITY v(value, ord)
                   ORDER BY v.ord DESC LIMIT 1)
         END AS ladder_sla_ms
  FROM esc e
  WHERE s.tenantid = e.tenantid
     OR left(s.tenantid, length(e.tenantid) + 1) = e.tenantid || '.'
  ORDER BY array_length(string_to_array(e.tenantid, '.'), 1) DESC, e.tenantid
  LIMIT 1
) lad ON true
CROSS JOIN LATERAL (                         -- #1028: the decided SLA-target precedence
  SELECT coalesce(m.mdms_sla_hours::bigint * 3600000,   -- 1) ComplaintHierarchy leaf slaHours
                  lad.ladder_sla_ms,                    -- 2) escalation-ladder total
                  cur.business_sla_ms                   -- 3) workflow SLA (state-root fallback)
         ) AS sla_target_ms
) tgt
LEFT JOIN seq ON seq.id = s.id
WHERE s.active = true;

CREATE UNIQUE INDEX ux_complaint_facts ON complaint_facts(service_request_id);
CREATE INDEX ix_cf_service ON complaint_facts(service_code);
CREATE INDEX ix_cf_status  ON complaint_facts(application_status);
CREATE INDEX ix_cf_created ON complaint_facts(created_week_start);
CREATE INDEX ix_cf_open    ON complaint_facts(is_open) WHERE is_open;
CREATE INDEX ix_cf_ward    ON complaint_facts(ward_code);
-- #1494: department is an RBAC scope axis — applyScope adds `department_code IN (...)`
-- to EVERY facts query for a department-scoped principal, and it is a grouping
-- dimension for the department tiles. The events grain already has ix_ce_dept.
CREATE INDEX ix_cf_dept    ON complaint_facts(department_code);
