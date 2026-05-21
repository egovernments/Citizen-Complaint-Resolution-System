-- PGR Dashboard Materialized Views
-- Run on egov DB: docker exec docker-postgres psql -U egov -d egov -f /dev/stdin < pgr-mvs.sql

-- Drop existing views if re-running
DROP MATERIALIZED VIEW IF EXISTS pgr_mv_dimension CASCADE;
DROP MATERIALIZED VIEW IF EXISTS pgr_mv_monthly_source CASCADE;
DROP MATERIALIZED VIEW IF EXISTS pgr_mv_monthly CASCADE;
DROP MATERIALIZED VIEW IF EXISTS pgr_mv_kpi CASCADE;

-- MV 1: Headline KPIs (one row per tenant)
CREATE MATERIALIZED VIEW pgr_mv_kpi AS
SELECT
  s.tenantid,
  COUNT(*)                     AS total,
  COUNT(*) FILTER (WHERE s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION')) AS closed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION'))
        / NULLIF(COUNT(*), 0), 2) AS completion_rate,
  ROUND(AVG(CASE WHEN s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION')
        THEN (s.lastmodifiedtime - s.createdtime) / 86400000.0 END)::numeric, 1) AS avg_resolution_days,
  COUNT(DISTINCT s.accountid)  AS unique_citizens
FROM eg_pgr_service_v2 s
WHERE s.active = true
GROUP BY s.tenantid;

CREATE UNIQUE INDEX ON pgr_mv_kpi (tenantid);

-- MV 2: Monthly time series (one row per tenant x month)
CREATE MATERIALIZED VIEW pgr_mv_monthly AS
SELECT
  s.tenantid,
  TO_CHAR(TO_TIMESTAMP(s.createdtime / 1000), 'Mon-YYYY')       AS month_label,
  DATE_TRUNC('month', TO_TIMESTAMP(s.createdtime / 1000))::date  AS month_date,
  COUNT(*)                     AS total,
  COUNT(*) FILTER (WHERE s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION')) AS closed,
  COUNT(*) FILTER (WHERE s.applicationstatus NOT IN ('RESOLVED','CLOSEDAFTERRESOLUTION')) AS open_count,
  COUNT(DISTINCT s.accountid)  AS unique_citizens
FROM eg_pgr_service_v2 s
WHERE s.active = true
GROUP BY s.tenantid, month_label, month_date;

CREATE UNIQUE INDEX ON pgr_mv_monthly (tenantid, month_date);

-- MV 3: Monthly by source (for source line chart)
CREATE MATERIALIZED VIEW pgr_mv_monthly_source AS
SELECT
  s.tenantid,
  TO_CHAR(TO_TIMESTAMP(s.createdtime / 1000), 'Mon-YYYY')       AS month_label,
  DATE_TRUNC('month', TO_TIMESTAMP(s.createdtime / 1000))::date  AS month_date,
  COALESCE(s.source, 'unknown') AS source,
  COUNT(*) AS total
FROM eg_pgr_service_v2 s
WHERE s.active = true
GROUP BY s.tenantid, month_label, month_date, source;

CREATE UNIQUE INDEX ON pgr_mv_monthly_source (tenantid, month_date, source);

-- MV 4: Dimensional breakdown (status/source/type/boundary)
CREATE MATERIALIZED VIEW pgr_mv_dimension AS
-- By status
SELECT s.tenantid, 'status' AS dimension, s.applicationstatus AS dim_value,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION')) AS closed,
  COUNT(*) FILTER (WHERE s.applicationstatus NOT IN ('RESOLVED','CLOSEDAFTERRESOLUTION')) AS open_count,
  ROUND(AVG(CASE WHEN s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION')
        THEN (s.lastmodifiedtime - s.createdtime) / 86400000.0 END)::numeric, 1) AS avg_resolution_days,
  ROUND(100.0 * COUNT(*) FILTER (WHERE s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION'))
        / NULLIF(COUNT(*), 0), 2) AS completion_rate
FROM eg_pgr_service_v2 s WHERE s.active = true
GROUP BY s.tenantid, s.applicationstatus
UNION ALL
-- By source (channel)
SELECT s.tenantid, 'source', COALESCE(s.source, 'unknown'),
  COUNT(*),
  COUNT(*) FILTER (WHERE s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION')),
  COUNT(*) FILTER (WHERE s.applicationstatus NOT IN ('RESOLVED','CLOSEDAFTERRESOLUTION')),
  ROUND(AVG(CASE WHEN s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION')
        THEN (s.lastmodifiedtime - s.createdtime) / 86400000.0 END)::numeric, 1),
  ROUND(100.0 * COUNT(*) FILTER (WHERE s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION'))
        / NULLIF(COUNT(*), 0), 2)
FROM eg_pgr_service_v2 s WHERE s.active = true
GROUP BY s.tenantid, s.source
UNION ALL
-- By type (serviceCode)
SELECT s.tenantid, 'type', s.servicecode,
  COUNT(*),
  COUNT(*) FILTER (WHERE s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION')),
  COUNT(*) FILTER (WHERE s.applicationstatus NOT IN ('RESOLVED','CLOSEDAFTERRESOLUTION')),
  ROUND(AVG(CASE WHEN s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION')
        THEN (s.lastmodifiedtime - s.createdtime) / 86400000.0 END)::numeric, 1),
  ROUND(100.0 * COUNT(*) FILTER (WHERE s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION'))
        / NULLIF(COUNT(*), 0), 2)
FROM eg_pgr_service_v2 s WHERE s.active = true
GROUP BY s.tenantid, s.servicecode
UNION ALL
-- By boundary (locality)
SELECT s.tenantid, 'boundary', COALESCE(a.locality, 'Unknown'),
  COUNT(*),
  COUNT(*) FILTER (WHERE s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION')),
  COUNT(*) FILTER (WHERE s.applicationstatus NOT IN ('RESOLVED','CLOSEDAFTERRESOLUTION')),
  ROUND(AVG(CASE WHEN s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION')
        THEN (s.lastmodifiedtime - s.createdtime) / 86400000.0 END)::numeric, 1),
  ROUND(100.0 * COUNT(*) FILTER (WHERE s.applicationstatus IN ('RESOLVED','CLOSEDAFTERRESOLUTION'))
        / NULLIF(COUNT(*), 0), 2)
FROM eg_pgr_service_v2 s
LEFT JOIN eg_pgr_address_v2 a ON s.id = a.parentid
WHERE s.active = true
GROUP BY s.tenantid, a.locality;

CREATE UNIQUE INDEX ON pgr_mv_dimension (tenantid, dimension, dim_value);
