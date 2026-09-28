/**
 * The Citizen (public) dashboard's KPI reference list and preview layout
 * (CCRS#1883), matching the approved prototype.
 *
 * Deliberately STATIC. Product scoped this pass to a read-only preview and a
 * read-only KPI list; making either editable needs a server-side public layout
 * plus a publish API, which is parked for a later release. Keeping the shape
 * here — rather than inline in the screen — means the eventual swap to a live
 * `/v2/analytics/public/catalog/_search` read replaces one module.
 */

export interface PublicDashboardKpi {
  /** Display name, as the prototype's KPI table lists it. */
  name: string;
  /** Plain-language definition — the "What it measures" column. */
  measures: string;
  /** Upstream data the measure is derived from. */
  source: string;
  /** How often the underlying data moves. */
  refresh: 'Near real time' | 'Daily';
}

export const PUBLIC_DASHBOARD_KPIS: PublicDashboardKpi[] = [
  {
    name: 'Complaints received',
    measures: 'Complaints registered during the selected period',
    source: 'Complaints',
    refresh: 'Near real time',
  },
  {
    name: 'Complaints resolved',
    measures: 'Complaints moved to Resolved or Closed in the period',
    source: 'Complaints + Workflow',
    refresh: 'Near real time',
  },
  {
    name: 'Resolution rate',
    measures: 'Share of received complaints that were resolved',
    source: 'Complaints',
    refresh: 'Near real time',
  },
  {
    name: 'SLA compliance',
    measures: 'Share of resolved complaints completed within the agreed SLA',
    source: 'Complaints + SLA',
    refresh: 'Near real time',
  },
  {
    name: 'Complaint trend over time',
    measures: 'Complaints created and resolved per month',
    source: 'Complaints',
    refresh: 'Daily',
  },
  {
    name: 'Complaints by service',
    measures: 'Complaint counts grouped by service or complaint type',
    source: 'Complaints + Master data',
    refresh: 'Daily',
  },
  {
    name: 'Resolution performance',
    measures: 'Resolution outcomes and timeliness over the period',
    source: 'Complaints + SLA',
    refresh: 'Daily',
  },
  {
    name: 'Geographic distribution',
    measures: 'Where complaints are being reported across the city',
    source: 'Complaints + Boundary',
    refresh: 'Daily',
  },
];

/** Shape of a tile in the static preview. */
export type PreviewTileKind = 'metric' | 'chart' | 'map';

export interface PreviewTile {
  label: string;
  kind: PreviewTileKind;
  /** Column span within a 4-column grid at desktop width. */
  span: 1 | 2 | 3 | 4;
}

/**
 * Tile order/size mirrors the prototype: four metric cards across the top, then
 * a wide trend chart beside a narrower one, then a chart beside the map.
 */
export const PUBLIC_DASHBOARD_PREVIEW_TILES: PreviewTile[] = [
  { label: 'Complaints received', kind: 'metric', span: 1 },
  { label: 'Complaints resolved', kind: 'metric', span: 1 },
  { label: 'Resolution rate', kind: 'metric', span: 1 },
  { label: 'SLA compliance', kind: 'metric', span: 1 },
  { label: 'Complaint trends', kind: 'chart', span: 3 },
  { label: 'Complaints by service', kind: 'chart', span: 1 },
  { label: 'Resolution performance', kind: 'chart', span: 2 },
  { label: 'Geographic distribution', kind: 'map', span: 2 },
];
