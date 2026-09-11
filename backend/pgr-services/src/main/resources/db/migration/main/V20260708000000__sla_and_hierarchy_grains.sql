-- ============================================================================
-- #1028 (SLA target sourcing) + #1079 (arbitrary-depth hierarchy grains).
--
-- ---- #1028: sla_target_ms ---------------------------------------------------
-- sla_target_ms was sourced ONLY from workflow eg_wf_businessservice_v2 joined
-- on the EXACT tenant. The PGR business service exists only at the state root
-- (`ke`), so every city-tenant (`ke.*`) complaint got sla_target_ms = NULL:
-- the dashboard SLA column rendered blank and sla_breached / sla_status_bucket /
-- SLA-compliance KPIs undercounted (NULL target can never breach).
--
-- New sla_target_ms semantics (per-complaint COALESCE):
--   1) MDMS ServiceDefs slaHours -> ms  (mdms_sla_hours * 3600000, per subtype);
--   2) escalation-ladder total from MDMS RAINMAKER-PGR.EscalationConfig
--      (SUM of overrides-><serviceCode> if present, else SUM of
--      defaultSlaByLevel; values already in ms); config resolved from the
--      complaint's exact tenant, else its state root (split_part(tenantid,'.',1));
--   3) workflow businessservicesla, with the tenant join FIXED to fall back to
--      the state root (exact tenant preferred via longest-match).
-- sla_breached and sla_status_bucket now derive from the new sla_target_ms.
-- sla_config_mismatch keeps its original semantics (MDMS slaHours vs the
-- workflow value, where the workflow value exists) — only the workflow value's
-- tenant fallback (fix 3) widens where it applies.
--
-- ---- #1079: registry-driven hierarchy axes ----------------------------------
-- JURISDICTION: zone_code/ward_code were extracted by FIXED position
-- (split_part(boundary_path,'|',2|3)), which mislabels any tenant whose tree
-- is not exactly root>zone>ward. They are now resolved from the level registry:
-- ward_code = the path segment whose boundarytype matches the tenant's 'Ward'
-- level (case-insensitive, from boundary_hierarchy); zone_code = the segment
-- at the level directly ABOVE ward (the ward level's parentBoundaryType).
-- FALLBACK when the tenant's hierarchy has no Ward level: ward_code = leaf
-- segment, zone_code = parent-of-leaf. New columns boundary_leaf_code /
-- boundary_leaf_type carry the leaf node regardless of depth. boundary_path
-- ('|'-delimited) and boundary_depth are unchanged.
--
-- COMPLAINT: the taxonomy now rides RAINMAKER-PGR.ComplaintHierarchy (node
-- dedupe prefers records at levels flagged isLeafServiceCode in
-- ComplaintHierarchyDefinition — registry leaf detection, not a
-- department-IS-NOT-NULL heuristic). New complaint_node_path ('.'-delimited)
-- comes from ComplaintHierarchy.path verbatim, with a recursive parentCode
-- walk as fallback (COALESCE(path, recursive)); complaint_depth = segment
-- count. service_group is now the ROOT category (first path segment, falling
-- back to legacy ServiceDefs.menuPath where a code has no hierarchy node);
-- NEW service_parent_code = the leaf's immediate parent (== service_group on
-- 2-level tenants, so existing service_group consumers are unaffected there).
-- ServiceDefs is still joined for mdms_sla_hours / service_order /
-- department_code (no regression).
--
-- complaint_open_state_daily (a table) is NOT rewritten: historical snapshots
-- keep the values as computed on their snapshot date; forward snapshots pick
-- up the new definitions automatically (the scheduler copies its columns from
-- complaint_facts). MVs are refreshed manually in ops, unchanged.
--
-- NOTE: this supersedes the events/facts definitions in V20260629000000 (which
-- superseded V20260608000000). Edit ALL if the grain shape changes again
-- (flyway migrations are append-only — the originals cannot be edited without
-- breaking deployed checksums).
-- ============================================================================

-- ---- grain 1: complaint_events ----------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS complaint_events CASCADE;
CREATE MATERIALIZED VIEW complaint_events AS
WITH RECURSIVE svc AS (
  SELECT s.servicerequestid, s.id AS pgr_id, s.tenantid, s.servicecode, s.accountid,
         s.source, s.createdtime AS complaint_created_at, s.createdby AS filed_by_uuid,
         a.locality AS locality_code, a.latitude, a.longitude,
         (a.latitude IS NOT NULL AND a.longitude IS NOT NULL) AS has_geo_pin
  FROM eg_pgr_service_v2 s
  LEFT JOIN eg_pgr_address_v2 a ON a.parentid = s.id
),
bnd0 AS (   -- one row per boundary code: full root->leaf path + the node's own (leaf) type,
            -- tenant and hierarchy; longest ancestral path wins (as before)
  SELECT DISTINCT ON (code) code, tenantid, hierarchytype,
         boundarytype AS leaf_type,
         (ancestralmaterializedpath || '|' || code) AS boundary_path
  FROM boundary_relationship
  ORDER BY code, length(ancestralmaterializedpath) DESC
),
btype AS (  -- per-node level type (same dedupe rule), to type every path segment
  SELECT DISTINCT ON (code) code, boundarytype
  FROM boundary_relationship
  ORDER BY code, length(ancestralmaterializedpath) DESC
),
wardlvl AS (   -- #1079: the tenant's 'Ward' level and the level directly above it,
               -- from the boundary_hierarchy level registry
  SELECT DISTINCT ON (h.tenantid, h.hierarchytype) h.tenantid, h.hierarchytype,
         lvl->>'boundaryType'       AS ward_type,
         lvl->>'parentBoundaryType' AS zone_type
  FROM boundary_hierarchy h
  CROSS JOIN LATERAL jsonb_array_elements(h.boundaryhierarchy) lvl
  WHERE lower(lvl->>'boundaryType') = 'ward'
),
bnd AS (   -- #1079: registry-resolved named levels per boundary code.
           -- FALLBACK (no Ward level in the tenant's hierarchy): leaf / parent-of-leaf.
  SELECT b.code, b.boundary_path,
         b.code      AS boundary_leaf_code,
         b.leaf_type AS boundary_leaf_type,
         CASE WHEN w.ward_type IS NOT NULL THEN seg.ward_seg
              ELSE segs.arr[array_length(segs.arr,1)] END     AS ward_code,
         CASE WHEN w.ward_type IS NOT NULL THEN seg.zone_seg
              ELSE segs.arr[array_length(segs.arr,1)-1] END   AS zone_code
  FROM bnd0 b
  LEFT JOIN wardlvl w ON w.tenantid = b.tenantid AND w.hierarchytype = b.hierarchytype
  CROSS JOIN LATERAL (SELECT string_to_array(b.boundary_path,'|') AS arr) segs
  LEFT JOIN LATERAL (
    SELECT max(s.seg) FILTER (WHERE lower(bt.boundarytype) = lower(w.ward_type)) AS ward_seg,
           max(s.seg) FILTER (WHERE lower(bt.boundarytype) = lower(w.zone_type)) AS zone_seg
    FROM unnest(segs.arr) s(seg)
    LEFT JOIN btype bt ON bt.code = s.seg
  ) seg ON true
),
bs AS (
  SELECT DISTINCT ON (tenantid, businessservice) tenantid, businessservice, businessservicesla
  FROM eg_wf_businessservice_v2
),
asg AS (
  SELECT processinstanceid, count(*) AS assignee_count,
         (array_agg(assignee ORDER BY assignee))[1] AS assignee_uuid
  FROM eg_wf_assignee_v2 GROUP BY processinstanceid
),
mdms AS (   -- ServiceDefs; dedupe by serviceCode preferring the root (shortest) tenant
  SELECT DISTINCT ON (data->>'serviceCode')
         data->>'serviceCode' AS service_code,
         data->>'department'  AS department_code
  FROM eg_mdms_data
  WHERE schemacode = 'RAINMAKER-PGR.ServiceDefs' AND isactive
  ORDER BY data->>'serviceCode', length(tenantid)
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
cnp AS (   -- #1079: complaint_node_path per code = master path, else recursive build
  SELECT ch.code,
         coalesce(ch.node_path, walk.built_path) AS complaint_node_path
  FROM ch
  LEFT JOIN LATERAL (
    SELECT w.built_path FROM chwalk w WHERE w.leaf_code = ch.code
    ORDER BY w.depth DESC LIMIT 1
  ) walk ON true
),
tx AS (
  SELECT pi.id AS event_id, pi.businessid AS service_request_id, pi.tenantid,
         pi.businessservice, pi.action, pi.assigner AS actor_uuid,
         pi.escalated, pi.rating AS event_rating, pi.comment,
         pi.createdtime AS entered_at,
         st.state AS status, st.seq AS status_seq, st.sla AS state_sla_ms,
         st.isterminatestate AS status_is_terminal,
         lead(pi.createdtime) OVER w AS exited_at,
         lag(st.state)        OVER w AS previous_status,
         lag(st.seq)          OVER w AS previous_status_seq,
         row_number()         OVER w AS seq_no,
         (lead(pi.id) OVER w IS NULL) AS is_current_state
  FROM eg_wf_processinstance_v2 pi
  LEFT JOIN eg_wf_state_v2 st ON st.uuid = pi.status
  WINDOW w AS (PARTITION BY pi.businessid ORDER BY pi.createdtime, pi.id)
)
SELECT
  tx.event_id, tx.service_request_id, tx.tenantid AS tenant_id,
  tx.businessservice AS business_service, tx.seq_no, tx.is_current_state,
  tx.action, tx.status, tx.previous_status,
  coalesce(tx.status_is_terminal,false)        AS status_is_terminal,
  (NOT coalesce(tx.status_is_terminal,false))  AS status_is_open,
  tx.actor_uuid, asg.assignee_uuid,
  (ua.type = 'SYSTEM')                         AS actor_is_system,
  tx.entered_at, tx.exited_at,
  (tx.exited_at - tx.entered_at)               AS dwell_ms,
  tx.status_seq, tx.previous_status_seq,
  (tx.status_seq - tx.previous_status_seq)     AS seq_delta,
  (tx.status_seq < tx.previous_status_seq)     AS is_backward_transition,
  tx.state_sla_ms,
  CASE WHEN tx.state_sla_ms IS NOT NULL AND tx.exited_at IS NOT NULL
       THEN (tx.exited_at - tx.entered_at) > tx.state_sla_ms END AS state_sla_breached_on_exit,
  bs.businessservicesla                        AS business_sla_ms,
  (tx.action IN ('ASSIGN','REASSIGN'))         AS is_assignment,
  (tx.action = 'REOPEN')                       AS is_reopen,
  coalesce(tx.escalated,false)                 AS is_escalation,
  CASE WHEN coalesce(tx.escalated,false)
       THEN (CASE WHEN ua.type='SYSTEM' THEN 'auto' ELSE 'manual' END) END AS escalation_source,
  (tx.comment IS NOT NULL AND tx.comment <> '') AS has_comment,
  length(tx.comment)                           AS comment_length,
  tx.event_rating,
  coalesce(asg.assignee_count,0)               AS assignee_count,
  (coalesce(asg.assignee_count,0) > 1)         AS has_multiple_assignees,
  svc.accountid AS account_id, svc.source, svc.servicecode AS service_code,
  m.department_code,                                                      -- S2: department row-scope axis
  cnp.complaint_node_path,                                                -- #1079: complaint taxonomy axis
  array_length(string_to_array(cnp.complaint_node_path,'.'),1)::smallint AS complaint_depth,
  svc.locality_code, svc.has_geo_pin,
  svc.complaint_created_at,
  (tx.entered_at - svc.complaint_created_at)   AS complaint_age_at_event_ms,
  bnd.boundary_path,
  bnd.zone_code,                               -- #1079: registry-resolved (was split_part pos 2)
  bnd.ward_code,                               -- #1079: registry-resolved (was split_part pos 3)
  bnd.boundary_leaf_code,                      -- #1079: leaf node, depth-agnostic
  bnd.boundary_leaf_type,
  (to_timestamp(tx.entered_at/1000) AT TIME ZONE 'Etc/GMT-3')::date AS occurred_date,
  date_trunc('week',(to_timestamp(tx.entered_at/1000) AT TIME ZONE 'Etc/GMT-3'))::date AS occurred_week_start,
  to_char((to_timestamp(tx.entered_at/1000) AT TIME ZONE 'Etc/GMT-3'),'YYYY-MM') AS occurred_month,
  extract(hour   FROM (to_timestamp(tx.entered_at/1000) AT TIME ZONE 'Etc/GMT-3'))::smallint AS occurred_hour,
  extract(isodow FROM (to_timestamp(tx.entered_at/1000) AT TIME ZONE 'Etc/GMT-3'))::smallint AS occurred_dow,
  (extract(isodow FROM (to_timestamp(tx.entered_at/1000) AT TIME ZONE 'Etc/GMT-3')) IN (6,7)) AS occurred_is_weekend,
  (extract(hour  FROM (to_timestamp(tx.entered_at/1000) AT TIME ZONE 'Etc/GMT-3')) BETWEEN 8 AND 17) AS occurred_is_business_hr
FROM tx
LEFT JOIN svc ON svc.servicerequestid = tx.service_request_id
LEFT JOIN bnd ON bnd.code = svc.locality_code
LEFT JOIN cnp ON cnp.code = svc.servicecode
LEFT JOIN LATERAL (                          -- #1028 fix 3: exact tenant, else state root
  SELECT b.businessservicesla
  FROM bs b
  WHERE b.businessservice = tx.businessservice
    AND b.tenantid IN (tx.tenantid, split_part(tx.tenantid,'.',1))
  ORDER BY length(b.tenantid) DESC
  LIMIT 1
) bs ON true
LEFT JOIN asg ON asg.processinstanceid = tx.event_id
LEFT JOIN mdms m ON m.service_code = svc.servicecode
LEFT JOIN eg_user ua ON ua.uuid = tx.actor_uuid;

CREATE UNIQUE INDEX ux_complaint_events ON complaint_events(event_id);
CREATE INDEX ix_ce_timeline ON complaint_events(service_request_id, seq_no);
CREATE INDEX ix_ce_status   ON complaint_events(status);
CREATE INDEX ix_ce_assignee ON complaint_events(assignee_uuid);
CREATE INDEX ix_ce_week     ON complaint_events(occurred_week_start);
CREATE INDEX ix_ce_dept     ON complaint_events(department_code);

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
mdms AS (
  SELECT DISTINCT ON (data->>'serviceCode')
         data->>'serviceCode'            AS service_code,
         (data->>'slaHours')::int        AS mdms_sla_hours,
         NULLIF(data->>'menuPath','')    AS legacy_service_group,   -- #1079: fallback only
         (data->>'order')::smallint      AS service_order,
         data->>'department'             AS department_code
  FROM eg_mdms_data
  WHERE schemacode = 'RAINMAKER-PGR.ServiceDefs' AND isactive
  ORDER BY data->>'serviceCode', length(tenantid)
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
cnp AS (   -- #1079: complaint_node_path per code = master path, else recursive build
  SELECT ch.code,
         coalesce(ch.node_path, walk.built_path) AS complaint_node_path
  FROM ch
  LEFT JOIN LATERAL (
    SELECT w.built_path FROM chwalk w WHERE w.leaf_code = ch.code
    ORDER BY w.depth DESC LIMIT 1
  ) walk ON true
),
esc AS (   -- #1028 fix 2: EscalationConfig ladder source (one record per tenant, at state root)
  SELECT tenantid,
         data->'overrides'         AS overrides,
         data->'defaultSlaByLevel' AS default_levels
  FROM eg_mdms_data
  WHERE schemacode = 'RAINMAKER-PGR.EscalationConfig' AND isactive
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
  (to_timestamp(roll.created_at/1000) AT TIME ZONE 'Etc/GMT-3')::date AS created_date,
  date_trunc('week',(to_timestamp(roll.created_at/1000) AT TIME ZONE 'Etc/GMT-3'))::date AS created_week_start,
  to_char((to_timestamp(roll.created_at/1000) AT TIME ZONE 'Etc/GMT-3'),'YYYY-MM') AS created_month,
  extract(year FROM (to_timestamp(roll.created_at/1000) AT TIME ZONE 'Etc/GMT-3'))::smallint AS created_year,
  to_char((to_timestamp(roll.created_at/1000) AT TIME ZONE 'Etc/GMT-3'),'YYYY-"Q"Q') AS created_quarter,
  extract(hour FROM (to_timestamp(roll.created_at/1000) AT TIME ZONE 'Etc/GMT-3'))::smallint AS created_hour,
  extract(isodow FROM (to_timestamp(roll.created_at/1000) AT TIME ZONE 'Etc/GMT-3'))::smallint AS created_dow,
  (extract(isodow FROM (to_timestamp(roll.created_at/1000) AT TIME ZONE 'Etc/GMT-3')) IN (6,7)) AS created_is_weekend,
  (extract(hour FROM (to_timestamp(roll.created_at/1000) AT TIME ZONE 'Etc/GMT-3')) BETWEEN 8 AND 17) AS created_is_business_hr,
  (to_timestamp(roll.resolved_at/1000) AT TIME ZONE 'Etc/GMT-3')::date AS resolved_date,
  to_char((to_timestamp(roll.resolved_at/1000) AT TIME ZONE 'Etc/GMT-3'),'YYYY-MM') AS resolved_month,
  clock.now_ms AS facts_built_at
FROM eg_pgr_service_v2 s
CROSS JOIN clock
LEFT JOIN eg_pgr_address_v2 a ON a.parentid = s.id
LEFT JOIN roll ON roll.service_request_id = s.servicerequestid
LEFT JOIN cur  ON cur.service_request_id  = s.servicerequestid
LEFT JOIN mdms m ON m.service_code = s.servicecode
LEFT JOIN cnp ON cnp.code = s.servicecode
CROSS JOIN LATERAL (                         -- #1079: path-derived complaint-axis fields
  SELECT x.arr[1]                            AS root_code,
         array_length(x.arr,1)::smallint     AS complaint_depth,
         x.arr[array_length(x.arr,1)-1]      AS service_parent_code
  FROM (SELECT string_to_array(cnp.complaint_node_path,'.') AS arr) x
) cx
LEFT JOIN LATERAL (                          -- #1028 fix 2: ladder total for this complaint's
  SELECT CASE                                -- service code, from the nearest EscalationConfig
           WHEN jsonb_typeof(e.overrides -> s.servicecode) = 'array'   -- (exact tenant, else state root)
             THEN (SELECT sum(v.value::numeric)::bigint
                   FROM jsonb_array_elements_text(e.overrides -> s.servicecode) v)
           WHEN jsonb_typeof(e.default_levels) = 'array'
             THEN (SELECT sum(v.value::numeric)::bigint
                   FROM jsonb_array_elements_text(e.default_levels) v)
         END AS ladder_sla_ms
  FROM esc e
  WHERE e.tenantid IN (s.tenantid, split_part(s.tenantid,'.',1))
  ORDER BY length(e.tenantid) DESC
  LIMIT 1
) lad ON true
CROSS JOIN LATERAL (                         -- #1028: the decided SLA-target precedence
  SELECT coalesce(m.mdms_sla_hours::bigint * 3600000,   -- 1) ServiceDefs slaHours
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
