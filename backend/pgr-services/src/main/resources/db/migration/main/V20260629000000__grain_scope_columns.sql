-- ============================================================================
-- S2: add the department row-scope axis to the events + daily grains, and the
-- citizen axis (account_id) to the daily grain, so a department/citizen-scoped
-- principal gets DATA on those grains instead of a fail-closed scope_incomplete.
--
-- complaint_events gains department_code (from MDMS ServiceDefs by service_code,
-- exactly as complaint_facts derives it). Recreating the events MV CASCADE-drops
-- complaint_facts (which reads FROM complaint_events), so facts is reproduced
-- verbatim from V20260608000000. complaint_open_state_daily (a table) gains
-- department_code + account_id and is backfilled from complaint_facts.
--
-- NOTE: this supersedes the events/facts definitions in V20260608000000. Edit
-- BOTH if the grain shape changes again (flyway migrations are append-only — the
-- original cannot be edited without breaking deployed checksums).
-- ============================================================================

-- ---- grain 1: complaint_events (+ department_code) --------------------------
DROP MATERIALIZED VIEW IF EXISTS complaint_events CASCADE;
CREATE MATERIALIZED VIEW complaint_events AS
WITH svc AS (
  SELECT s.servicerequestid, s.id AS pgr_id, s.tenantid, s.servicecode, s.accountid,
         s.source, s.createdtime AS complaint_created_at, s.createdby AS filed_by_uuid,
         a.locality AS locality_code, a.latitude, a.longitude,
         (a.latitude IS NOT NULL AND a.longitude IS NOT NULL) AS has_geo_pin
  FROM eg_pgr_service_v2 s
  LEFT JOIN eg_pgr_address_v2 a ON a.parentid = s.id
),
bnd AS (
  SELECT DISTINCT ON (code) code,
         (ancestralmaterializedpath || '|' || code) AS boundary_path
  FROM boundary_relationship
  ORDER BY code, length(ancestralmaterializedpath) DESC
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
  svc.locality_code, svc.has_geo_pin,
  svc.complaint_created_at,
  (tx.entered_at - svc.complaint_created_at)   AS complaint_age_at_event_ms,
  bnd.boundary_path,
  split_part(bnd.boundary_path,'|',2)          AS zone_code,
  split_part(bnd.boundary_path,'|',3)          AS ward_code,
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
LEFT JOIN bs  ON bs.tenantid = tx.tenantid AND bs.businessservice = tx.businessservice
LEFT JOIN asg ON asg.processinstanceid = tx.event_id
LEFT JOIN mdms m ON m.service_code = svc.servicecode
LEFT JOIN eg_user ua ON ua.uuid = tx.actor_uuid;

CREATE UNIQUE INDEX ux_complaint_events ON complaint_events(event_id);
CREATE INDEX ix_ce_timeline ON complaint_events(service_request_id, seq_no);
CREATE INDEX ix_ce_status   ON complaint_events(status);
CREATE INDEX ix_ce_assignee ON complaint_events(assignee_uuid);
CREATE INDEX ix_ce_week     ON complaint_events(occurred_week_start);
CREATE INDEX ix_ce_dept     ON complaint_events(department_code);

-- ---- grain 2: complaint_facts (reproduced verbatim — CASCADE dropped it) ----
DROP MATERIALIZED VIEW IF EXISTS complaint_facts CASCADE;
CREATE MATERIALIZED VIEW complaint_facts AS
WITH clock AS (SELECT (extract(epoch FROM now())*1000)::bigint AS now_ms),
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
         boundary_path, ward_code, zone_code
  FROM complaint_events WHERE is_current_state
),
mdms AS (
  SELECT DISTINCT ON (data->>'serviceCode')
         data->>'serviceCode'            AS service_code,
         (data->>'slaHours')::int        AS mdms_sla_hours,
         NULLIF(data->>'menuPath','')    AS service_group,
         (data->>'order')::smallint      AS service_order,
         data->>'department'             AS department_code
  FROM eg_mdms_data
  WHERE schemacode = 'RAINMAKER-PGR.ServiceDefs' AND isactive
  ORDER BY data->>'serviceCode', length(tenantid)
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
  m.service_group, m.service_order, m.mdms_sla_hours, m.department_code,
  cur.current_state_seq, cur.current_state_sla_ms, cur.business_sla_ms AS sla_target_ms,
  (m.mdms_sla_hours IS NOT NULL AND cur.business_sla_ms IS NOT NULL
    AND m.mdms_sla_hours*3600000 <> cur.business_sla_ms) AS sla_config_mismatch,
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
  CASE WHEN cur.is_open  THEN (cur.business_sla_ms IS NOT NULL AND (clock.now_ms - roll.created_at) > cur.business_sla_ms)
       WHEN roll.resolved_at IS NOT NULL THEN (cur.business_sla_ms IS NOT NULL AND (roll.resolved_at - roll.created_at) > cur.business_sla_ms)
       ELSE false END                                            AS sla_breached,
  (cur.is_open AND cur.current_state_sla_ms IS NOT NULL
    AND (clock.now_ms - roll.last_transition_at) > cur.current_state_sla_ms) AS current_state_sla_breached,
  CASE WHEN NOT cur.is_open THEN NULL
       WHEN (clock.now_ms - roll.created_at) < 86400000  THEN '<1d'
       WHEN (clock.now_ms - roll.created_at) < 259200000 THEN '1-3d'
       WHEN (clock.now_ms - roll.created_at) < 604800000 THEN '3-7d'
       ELSE '>7d' END                                            AS aging_bucket,
  CASE WHEN NOT cur.is_open OR cur.business_sla_ms IS NULL THEN NULL
       WHEN (clock.now_ms - roll.created_at) > cur.business_sla_ms       THEN 'breached'
       WHEN (clock.now_ms - roll.created_at) > 0.8*cur.business_sla_ms   THEN 'approaching'
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
LEFT JOIN seq ON seq.id = s.id
WHERE s.active = true;

CREATE UNIQUE INDEX ux_complaint_facts ON complaint_facts(service_request_id);
CREATE INDEX ix_cf_service ON complaint_facts(service_code);
CREATE INDEX ix_cf_status  ON complaint_facts(application_status);
CREATE INDEX ix_cf_created ON complaint_facts(created_week_start);
CREATE INDEX ix_cf_open    ON complaint_facts(is_open) WHERE is_open;
CREATE INDEX ix_cf_ward    ON complaint_facts(ward_code);

-- ---- grain 3: complaint_open_state_daily (+ department_code, + account_id) ---
ALTER TABLE complaint_open_state_daily ADD COLUMN IF NOT EXISTS department_code varchar(256);
ALTER TABLE complaint_open_state_daily ADD COLUMN IF NOT EXISTS account_id       varchar(128);
CREATE INDEX IF NOT EXISTS ix_cosd_dept    ON complaint_open_state_daily(department_code);
CREATE INDEX IF NOT EXISTS ix_cosd_account ON complaint_open_state_daily(account_id);

-- Backfill the new columns on existing snapshots from the current facts row.
UPDATE complaint_open_state_daily d
   SET department_code = f.department_code,
       account_id      = f.account_id
  FROM complaint_facts f
 WHERE f.service_request_id = d.service_request_id
   AND (d.department_code IS NULL OR d.account_id IS NULL);
