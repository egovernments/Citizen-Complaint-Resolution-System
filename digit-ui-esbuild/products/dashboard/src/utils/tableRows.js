const FILTER_OPERATORS = {
  eq: (value, expected) => value === expected,
  gte: (value, expected) => Number(value) >= Number(expected),
  gt: (value, expected) => Number(value) > Number(expected),
  lte: (value, expected) => Number(value) <= Number(expected),
  lt: (value, expected) => Number(value) < Number(expected),
};

function comparisonKey(row, joinBy) {
  return joinBy.map((key) => String(row?.[key] ?? "")).join("\u001f");
}

function percentChange(current, prior) {
  const currentValue = Number(current);
  const priorValue = Number(prior);
  if (!Number.isFinite(currentValue)) return null;
  if (!Number.isFinite(priorValue) || priorValue === 0) return currentValue === 0 ? 0 : 100;
  return ((currentValue - priorValue) / Math.abs(priorValue)) * 100;
}

function applyComparison(rows, priorRows, comparison) {
  if (!comparison || comparison.period !== "prior" || comparison.mode !== "percentChange") {
    return rows;
  }

  const joinBy = Array.isArray(comparison.joinBy) ? comparison.joinBy : [];
  if (!joinBy.length || !comparison.valueKey || !comparison.outputKey) return rows;

  const priorByKey = new Map(
    (priorRows || []).map((row) => [comparisonKey(row, joinBy), row])
  );
  return rows.map((row) => {
    const prior = priorByKey.get(comparisonKey(row, joinBy));
    return {
      ...row,
      [comparison.outputKey]: percentChange(
        row?.[comparison.valueKey],
        prior?.[comparison.valueKey]
      ),
    };
  });
}

function applyRowFilter(rows, rowFilter) {
  if (!rowFilter?.column) return rows;
  const entry = Object.entries(FILTER_OPERATORS).find(([operator]) =>
    Object.prototype.hasOwnProperty.call(rowFilter, operator)
  );
  if (!entry) return rows;
  const [operator, predicate] = entry;
  return rows.filter((row) => predicate(row?.[rowFilter.column], rowFilter[operator]));
}

/**
 * Apply catalog-declared, presentation-neutral table transforms. The result is
 * still rendered by DashboardTable, so its chrome, sorting, localisation and
 * cell formatting remain the single visual implementation for every table.
 */
export function transformTableRows(result, viz) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const compared = applyComparison(rows, result?.priorRows, viz?.comparison);
  return applyRowFilter(compared, viz?.rowFilter).map((row, index) => ({
    ...row,
    id:
      row?.id ??
      (viz?.comparison?.joinBy?.length
        ? comparisonKey(row, viz.comparison.joinBy)
        : String(index)),
  }));
}
