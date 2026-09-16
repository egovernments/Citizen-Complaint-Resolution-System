-- PGR now has one escalation implementation: pgr-services reads
-- RAINMAKER-PGR.EscalationConfig and submits the ESCALATE workflow self-loop.
-- Retain the generic workflow auto-escalator for other products, but deactivate
-- any old PGR rows so an upgraded environment cannot run both implementations.
DO $$
BEGIN
  IF to_regclass('public.eg_mdms_data') IS NOT NULL THEN
    UPDATE public.eg_mdms_data
       SET isactive = false,
           lastmodifiedby = coalesce(lastmodifiedby, 'pgr-escalation-v2-migration'),
           lastmodifiedtime = (extract(epoch FROM clock_timestamp()) * 1000)::bigint
     WHERE isactive
       AND schemacode IN (
             'Workflow.AutoEscalation',
             'Workflow.AutoEscalationStatesToIgnore'
           )
       AND (
             upper(coalesce(data->>'businessService', '')) LIKE 'PGR%'
             OR upper(coalesce(data->>'module', '')) LIKE 'PGR%'
           );
  END IF;
END $$;
