-- ============================================================================
-- Add per-complaint assignment booleans to complaint_facts so the dashboard's
-- First-Assignment-Rate KPI (assigned-exactly-once / assigned-at-least-once)
-- becomes expressible: the analytics filter grammar can only predicate on
-- whitelisted *filterable* columns, and assignment_count is a *measure* (not
-- filterable). Mirrors the existing is_reopened = (reopen_count > 0) pattern.
--   has_been_assigned = (assignment_count > 0)
--   is_reassigned     = (assignment_count > 1)
-- Postgres has no ALTER MATERIALIZED VIEW ... ADD COLUMN, so the MV is recreated
-- verbatim from V20260608000000 with only these two columns added.
-- ============================================================================
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
mdms AS (   -- ServiceDefs; dedupe by serviceCode preferring the root (shortest) tenant
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
  -- timestamps
  roll.created_at, roll.first_assigned_at, roll.first_assigned_at AS first_response_at,
  roll.resolved_at, roll.last_transition_at, roll.first_escalated_at, roll.last_escalated_at,
  -- counts
  roll.transition_count, roll.assignment_count, roll.escalation_count, roll.reopen_count,
  roll.distinct_assignee_count, roll.distinct_actor_count,
  roll.system_transition_count, roll.manual_transition_count,
  roll.was_rejected, (roll.reopen_count > 0) AS is_reopened,
  (coalesce(roll.assignment_count,0) > 0) AS has_been_assigned,
  (coalesce(roll.assignment_count,0) > 1) AS is_reassigned,
  cur.is_open, (roll.resolved_at IS NOT NULL) AS is_resolved,
  roll.max_dwell_ms, roll.assigned_dwell_ms, roll.unassigned_dwell_ms,
  cur.current_assignee_uuid,
  -- durations
  (roll.resolved_at - roll.created_at)                            AS resolution_ms,
  (roll.first_assigned_at - roll.created_at)                      AS time_to_assign_ms,
  CASE WHEN cur.is_open THEN clock.now_ms - roll.created_at END   AS open_age_ms,
  CASE WHEN cur.is_open THEN clock.now_ms - roll.last_transition_at END AS current_state_age_ms,
  (roll.first_escalated_at - roll.created_at)                     AS first_escalation_ms,
  -- SLA
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
  -- rating
  (s.rating IS NOT NULL) AS has_rating, s.rating, (s.rating IS NOT NULL AND s.rating <= 2) AS is_negative_rating,
  -- citizen sequence
  seq.complaint_seq_for_citizen, (seq.complaint_seq_for_citizen = 1) AS is_first_time_complainant,
  -- calendar (EAT / UTC+3)
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
