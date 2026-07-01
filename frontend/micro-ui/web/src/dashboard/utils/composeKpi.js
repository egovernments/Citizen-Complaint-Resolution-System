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
  const { type, sourceKpiIds, elapsedFromAsOf } = compose;

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
    case 'dailyAvgFromWeekly': {
      const total = sourceData[0].total ?? 0;
      if (!elapsedFromAsOf) return null;
      // Get asOf from the source result to avoid client clock authority
      const asOf = results[sourceKpiIds[0]]?.asOf;
      const daysElapsed = asOf ? elapsedDaysSince(startOfWeek(new Date(asOf)), new Date(asOf)) : null;
      return daysElapsed && daysElapsed > 0 ? total / daysElapsed : null;
    }
    case 'hourlyAvgFromDaily': {
      const total = sourceData[0].total ?? 0;
      if (!elapsedFromAsOf) return null;
      const asOf = results[sourceKpiIds[0]]?.asOf;
      const hoursElapsed = asOf ? elapsedHoursSince(startOfDay(new Date(asOf)), new Date(asOf)) : null;
      return hoursElapsed && hoursElapsed > 0 ? total / hoursElapsed : null;
    }
    case 'resolvedOverFiledRate': {
      const resolved = sourceData[0]?.total ?? 0;
      const filed = sourceData[1]?.total ?? 0;
      return filed === 0 ? 0 : resolved / filed;
    }
    case 'reopenedOverFiledRate': {
      const reopened = sourceData[0]?.total ?? 0;
      const filed = sourceData[1]?.total ?? 0;
      return filed === 0 ? 0 : reopened / filed;
    }
    case 'slaComplianceRate': {
      const compliant = sourceData[0]?.total ?? 0;
      const resolved = sourceData[1]?.total ?? 0;
      const openBreached = sourceData[2]?.total ?? 0;
      const eligible = resolved + openBreached;
      return eligible === 0 ? 0 : compliant / eligible;
    }
    default:
      return null;
  }
}

function startOfWeek(d) {
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

function startOfDay(d) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  return start;
}

function elapsedDaysSince(start, now) {
  return Math.max(1, Math.floor((now - start) / 86400000));
}

function elapsedHoursSince(start, now) {
  return Math.max(1, Math.floor((now - start) / 3600000));
}
