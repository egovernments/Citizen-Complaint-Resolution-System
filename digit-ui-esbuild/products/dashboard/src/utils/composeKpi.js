/**
 * Evaluates a viz.compose rule against already-fetched results.
 * The rule comes from the backend (viz.compose in the KpiDefinition).
 * The FE engine evaluates it; it does NOT know the rule a priori.
 *
 * @param compose - the viz.compose object from the KpiDef tile descriptor
 * @param results - the results map from runKpiBatch (keyed by kpiId)
 * @returns the computed scalar value, or null if sources not yet available
 */
export function evaluateCompose(compose, results) {
  if (!compose || !compose.type) return null;
  const { type, sourceKpiIds } = compose;

  const sourceData = sourceKpiIds.map(id => {
    const r = results[id];
    return r && r.rows && r.rows[0] ? r.rows[0] : null;
  });

  if (sourceData.some(d => d === null)) return null; // sources not loaded yet

  switch (type) {
    case 'openRateComplement': {
      const pct = sourceData[0].pct ?? sourceData[0].total;
      return pct != null ? (1 - pct) * 100 : null;
    }
    case 'netBacklogDaily': {
      const inflow = sourceData[0].total ?? 0;
      const outflow = sourceData[1]?.total ?? 0;
      return inflow - outflow;
    }
    // 'dailyAvgFromWeekly' / 'hourlyAvgFromDaily': the backend's D1a composition (calendar-
    // aware, tenant-timeZone-correct — see BusinessCalendar / #29) is now the sole authority
    // for these averages. This engine must NEVER recompute an "elapsed periods since asOf"
    // average with browser-local Date math (setDate/setHours/new Date() are all local-clock
    // reads that silently disagree with the tenant's configured calendar). Returning null
    // here is intentional: KpiTile's resolveScalar falls through to the backend's
    // result.value whenever evaluateCompose yields null.
    case 'dailyAvgFromWeekly':
    case 'hourlyAvgFromDaily':
      return null;
    default:
      return null;
  }
}

/** These calendar-aware rules are evaluated by pgr-services and must never use raw row totals. */
export function requiresBackendComposition(compose) {
  return compose?.type === 'dailyAvgFromWeekly' || compose?.type === 'hourlyAvgFromDaily';
}
