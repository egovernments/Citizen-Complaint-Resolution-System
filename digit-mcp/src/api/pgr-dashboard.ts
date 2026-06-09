import type { ServerResponse } from 'node:http';
import { digitDb } from '../services/digit-db.js';

const MV_NAMES = ['pgr_mv_kpi', 'pgr_mv_monthly', 'pgr_mv_monthly_source', 'pgr_mv_dimension'] as const;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let lastRefreshTime = 0;
let refreshInProgress = false;

/** Fire-and-forget concurrent refresh of all materialized views. */
function maybeRefreshViews(): void {
  const now = Date.now();
  if (refreshInProgress || now - lastRefreshTime < REFRESH_INTERVAL_MS) return;

  refreshInProgress = true;
  const start = Date.now();

  Promise.all(
    MV_NAMES.map((mv) =>
      digitDb.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${mv}`).catch((err) => {
        console.error(`[pgr-dashboard] Failed to refresh ${mv}: ${err instanceof Error ? err.message : err}`);
      })
    )
  )
    .then(() => {
      lastRefreshTime = Date.now();
      console.error(`[pgr-dashboard] Refreshed all MVs in ${Date.now() - start}ms`);
    })
    .catch(() => {})
    .finally(() => {
      refreshInProgress = false;
    });
}

export async function handlePgrDashboard(
  res: ServerResponse,
  query: Record<string, string>
): Promise<void> {
  const tenantId = query.tenantId;
  if (!tenantId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'tenantId query parameter is required' }));
    return;
  }

  if (!digitDb.isHealthy()) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'DIGIT database not available' }));
    return;
  }

  // Trigger async refresh if stale (doesn't block response)
  maybeRefreshViews();

  // DIGIT tenant hierarchy: root tenant (e.g. 'ke') should match child tenants (e.g. 'ke.nairobi').
  // If tenantId has no dot, use prefix match; otherwise exact match.
  const isRoot = !tenantId.includes('.');
  const tenantFilter = isRoot
    ? `tenantid = $1 OR tenantid LIKE $1 || '.%'`
    : `tenantid = $1`;

  try {
    const deptQuery = `
      WITH service_dept AS (
        SELECT DISTINCT ON (data->>'serviceCode')
          data->>'serviceCode' AS service_code,
          data->>'department'  AS dept_code
        FROM eg_mdms_data
        WHERE schemacode = 'RAINMAKER-PGR.ServiceDefs' AND isactive = true
      ),
      dept_names AS (
        SELECT DISTINCT ON (data->>'code')
          data->>'code' AS dept_code,
          data->>'name' AS dept_name
        FROM eg_mdms_data
        WHERE schemacode = 'common-masters.Department' AND isactive = true
      )
      SELECT
        COALESCE(dn.dept_name, sd.dept_code, 'Unknown') AS department,
        SUM(dim.total)::int       AS total,
        SUM(dim.closed)::int      AS closed,
        SUM(dim.open_count)::int  AS open_count,
        ROUND(AVG(dim.avg_resolution_days)::numeric, 1) AS avg_resolution_days,
        ROUND(100.0 * SUM(dim.closed) / NULLIF(SUM(dim.total), 0), 2) AS completion_rate
      FROM pgr_mv_dimension dim
      LEFT JOIN service_dept sd ON sd.service_code = dim.dim_value
      LEFT JOIN dept_names dn ON dn.dept_code = sd.dept_code
      WHERE dim.dimension = 'type' AND (${tenantFilter})
      GROUP BY COALESCE(dn.dept_name, sd.dept_code, 'Unknown')
      ORDER BY total DESC`;

    const [kpiRows, monthlyRows, monthlySourceRows, dimensionRows, deptRows] = await Promise.all([
      digitDb.query(`SELECT * FROM pgr_mv_kpi WHERE ${tenantFilter}`, [tenantId]),
      digitDb.query(`SELECT * FROM pgr_mv_monthly WHERE ${tenantFilter} ORDER BY month_date`, [tenantId]),
      digitDb.query(`SELECT * FROM pgr_mv_monthly_source WHERE ${tenantFilter} ORDER BY month_date, source`, [tenantId]),
      digitDb.query(`SELECT * FROM pgr_mv_dimension WHERE ${tenantFilter} ORDER BY dimension, total DESC`, [tenantId]),
      digitDb.query(deptQuery, [tenantId]),
    ]);

    const kpi = kpiRows[0] || { total: 0, closed: 0, completion_rate: 0, avg_resolution_days: null, unique_citizens: 0 };

    // Clean up numeric types from Postgres (they come as strings)
    const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
    const num = (v: unknown): number => Number(v) || 0;

    const response = {
      kpi: {
        total: num(kpi.total),
        closed: num(kpi.closed),
        completion_rate: num(kpi.completion_rate),
        avg_resolution_days: numOrNull(kpi.avg_resolution_days),
        unique_citizens: num(kpi.unique_citizens),
      },
      monthly: monthlyRows.map((r) => ({
        month_label: r.month_label,
        month_date: r.month_date,
        total: num(r.total),
        closed: num(r.closed),
        open_count: num(r.open_count),
        unique_citizens: num(r.unique_citizens),
      })),
      monthly_source: monthlySourceRows.map((r) => ({
        month_label: r.month_label,
        month_date: r.month_date,
        source: r.source,
        total: num(r.total),
      })),
      dimensions: dimensionRows.map((r) => ({
        dimension: r.dimension,
        dim_value: r.dim_value,
        total: num(r.total),
        closed: num(r.closed),
        open_count: num(r.open_count),
        avg_resolution_days: numOrNull(r.avg_resolution_days),
        completion_rate: num(r.completion_rate),
      })),
      departments: deptRows.map((r) => ({
        department: r.department,
        total: num(r.total),
        closed: num(r.closed),
        open_count: num(r.open_count),
        avg_resolution_days: numOrNull(r.avg_resolution_days),
        completion_rate: num(r.completion_rate),
      })),
      refreshed_at: new Date().toISOString(),
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    });
    res.end(JSON.stringify(response));
  } catch (err) {
    console.error(`[pgr-dashboard] Query error: ${err instanceof Error ? err.message : err}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to query dashboard data' }));
  }
}
