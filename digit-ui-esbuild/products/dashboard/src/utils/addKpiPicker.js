/**
 * Build the Add-KPI picker list: exclude tiles already on the grid, filter by
 * search query (label + id), and sort alphabetically by display label (#1755).
 */
export function buildAvailableKpis(catalogItems, visibleLayoutIds = [], query = "") {
  const visible = new Set(visibleLayoutIds || []);
  const q = String(query || "")
    .trim()
    .toLowerCase();

  return (catalogItems || [])
    .filter((it) => it && !visible.has(it.id))
    .filter((it) => {
      if (!q) return true;
      const metric = String(it.metric || "").toLowerCase();
      const id = String(it.id || "").toLowerCase();
      return metric.includes(q) || id.includes(q);
    })
    .slice()
    .sort((a, b) =>
      String(a.metric || "").localeCompare(String(b.metric || ""), undefined, {
        sensitivity: "base",
      })
    );
}
