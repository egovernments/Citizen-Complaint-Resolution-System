const NUMERIC_COLUMN_TYPES = new Set([
  "integer",
  "percent",
  "hours",
  "hoursDays",
  "rating",
  "trend",
]);

export function isNumericColumnType(type) {
  return NUMERIC_COLUMN_TYPES.has(type);
}

function getTagsSortValue(row) {
  const items = row.statusTagItems?.length
    ? row.statusTagItems
    : (Array.isArray(row.statusTags) ? row.statusTags : []).map((label) => ({ label }));
  return items.map((item) => item.label).join(", ").toLowerCase();
}

/** Raw value used for ordering — null/undefined sorts last. */
export function getTableSortValue(row, column) {
  if (!column) return null;

  if (column.type === "tags") {
    const value = getTagsSortValue(row);
    return value || null;
  }

  const raw = row[column.id];

  if (isNumericColumnType(column.type)) {
    if (raw == null || !Number.isFinite(Number(raw))) return null;
    return Number(raw);
  }

  const text = String(raw ?? "").trim();
  return text ? text.toLowerCase() : null;
}

export function compareTableRows(left, right, column) {
  const a = getTableSortValue(left, column);
  const b = getTableSortValue(right, column);

  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  return String(a).localeCompare(String(b));
}

export function sortTableRows(rows, columns, sortState) {
  if (!sortState?.key || !rows?.length) return rows ?? [];

  const column = columns.find((entry) => entry.id === sortState.key);
  if (!column) return rows;

  const next = [...rows];
  next.sort((left, right) => {
    const result = compareTableRows(left, right, column);
    return sortState.direction === "asc" ? result : -result;
  });
  return next;
}

export function getDefaultSortDirection(column) {
  return isNumericColumnType(column?.type) ? "desc" : "asc";
}
