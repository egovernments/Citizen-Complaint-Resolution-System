/**
 * PGR Dashboard E2E
 *
 * Verifies the legacy configurator dashboard's default-off route/navigation
 * contract, and the employee-app dashboard that replaced it.
 */
import { test, expect, type Page } from '@playwright/test';
import { CONFIGURATOR_BASE } from '../utils/configurator-auth';
import { loginEmployeeBrowser } from '../utils/employee-ui';
import { ADMIN_USER, ADMIN_PASS, BASE_URL } from '../utils/env';
import { tenantSlug } from '../utils/identity-bff';

type CcrsBuildFlags = {
  legacyPgrDashboardEnabled: boolean;
  legacyPgrDashboardRaw: string;
};

async function readLegacyDashboardFlag(page: Page): Promise<CcrsBuildFlags> {
  const flags = await page.evaluate(() => (
    window as Window & { __CCRS_BUILD_FLAGS__?: CcrsBuildFlags }
  ).__CCRS_BUILD_FLAGS__);

  expect(flags, 'Configurator must publish its baked feature-flag contract').toBeDefined();
  expect(typeof flags?.legacyPgrDashboardEnabled).toBe('boolean');
  expect(typeof flags?.legacyPgrDashboardRaw).toBe('string');

  const expectedRaw = process.env.VITE_ENABLE_LEGACY_PGR_DASHBOARD;
  if (expectedRaw !== undefined) {
    expect(
      flags?.legacyPgrDashboardRaw,
      'The loaded Configurator bundle must match the feature flag expected by the test job',
    ).toBe(expectedRaw);
  }

  return flags as CcrsBuildFlags;
}

async function navigateToLegacyDashboard(page: Page): Promise<CcrsBuildFlags> {
  await page.goto(`${CONFIGURATOR_BASE}/manage/pgr-dashboard`, {
    waitUntil: 'networkidle',
    timeout: 30_000,
  });
  return readLegacyDashboardFlag(page);
}

// The chromium project's storageState (auth.setup) already holds the
// Configurator session. A per-test loginConfigurator timed out: the Keycloak
// SSO cookie skips the sign-in form it waits for.
test.describe('PGR Dashboard', () => {
  test('route and navigation follow the baked feature flag', {
    annotation: {
      type: 'description',
      description: `Checks the deployed Configurator bundle's own feature-flag contract. With rollback mode disabled, the legacy route redirects directly to /manage and its navigation entry is absent. With rollback mode enabled, the route and navigation entry remain available. If VITE_ENABLE_LEGACY_PGR_DASHBOARD is supplied to the test job, its value must exactly match the value baked into the loaded bundle.`,
    },
    tag: ['@area:configurator-manage', '@area:dashboard', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'],
  }, async ({ page }) => {
    const flags = await navigateToLegacyDashboard(page);

    if (flags.legacyPgrDashboardEnabled) {
      await expect(page).toHaveURL(/\/manage\/pgr-dashboard\/?$/);
      await expect(page.locator('button', { hasText: 'PGR Dashboard' })).toBeVisible();
      return;
    }

    await expect(page).toHaveURL(/\/manage\/?$/);
    await expect(page.locator('h1', { hasText: 'PGR Dashboard' })).toHaveCount(0);
    await expect(page.locator('button', { hasText: 'PGR Dashboard' })).toHaveCount(0);
  });
});

/*
 * The configurator's Chart.js "PGR Dashboard" (/manage/pgr-dashboard) is a
 * rollback surface since #1386 (627954ea7): VITE_ENABLE_LEGACY_PGR_DASHBOARD
 * defaults to false and no deployment bakes it on, so its seven UI checks only
 * ever skipped. The dashboard v2.20 ships is the catalog-driven supervisor
 * dashboard in the employee app (products/dashboard, ported in #1062 /
 * 32d32e6aa) at /<slug>/digit-ui/employee/dashboard: its tiles, default layout
 * and data all come from /pgr-services/v2/analytics (packs, catalog/_search,
 * _query). The tests below check that dashboard's equivalent of each legacy
 * check — heading, KPI tiles, chart widgets, widget titles, nav entry, KPI
 * values, and the per-dimension breakdowns — against what the analytics API
 * itself returned for the same page load, so nothing pins one tenant's pack.
 */

type Tile = { kpiId: string; titleKey?: string; viz?: { kind?: string; title?: string; titleKey?: string } };
type Pack = { tiles: Tile[]; defaultLayout: { kpiId: string }[] };
type QueryResult = { rowCount?: number; rows?: unknown[] };

const CARD_KINDS = new Set(['number-tile-delta', 'number-tile', 'scalar', 'number-tile-sparkline', 'sparkline-card']);
const MAP_KINDS = new Set(['map', 'choropleth-map']);
const TABLE_KINDS = new Set(['data-table', 'table', 'sla-risk-table']);

interface LoadedDashboard {
  pack: Pack;
  catalog: Tile[];
  messages: Map<string, string>;
  results: Map<string, QueryResult>;
  errors: Map<string, unknown>;
  layoutTiles: Tile[];
  /** The title the page resolves for a tile: its seeded titleKey message, else the catalog's English. */
  titleOf: (tile: Tile) => string;
}

async function openEmployeeDashboard(page: Page): Promise<LoadedDashboard> {
  const loggedIn = await loginEmployeeBrowser(page, ADMIN_USER, ADMIN_PASS);
  expect(loggedIn, 'ADMIN_USER must sign in to the employee app').not.toBeNull();

  const messages = new Map<string, string>();
  const results = new Map<string, QueryResult>();
  const errors = new Map<string, unknown>();
  let pack: Pack | undefined;
  let catalog: Tile[] | undefined;
  page.on('response', async (response) => {
    const url = response.url();
    if (!/\/(localization\/messages\/v1\/_search|pgr-services\/v2\/analytics\/)/.test(url)) return;
    const body = await response.json().catch(() => null);
    if (!body) return;
    if (url.includes('/localization/')) {
      for (const m of body.messages || []) messages.set(m.code, m.message);
    } else if (/\/analytics\/packs/.test(url)) {
      pack = body;
    } else if (/\/analytics\/catalog\/_search/.test(url)) {
      catalog = body.tiles;
    } else if (/\/analytics\/_query/.test(url)) {
      for (const [key, value] of Object.entries(body.results || {})) results.set(key, value as QueryResult);
      for (const [key, value] of Object.entries(body.errors || {})) errors.set(key, value);
    }
  });

  await page.goto(`${BASE_URL}/${tenantSlug()}/digit-ui/employee/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // The route redirects to /employee when egov-accesscontrol denies the
  // analytics capability (products/dashboard/roles.js), so staying here is the
  // access check itself.
  await expect(page.locator('h1')).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/employee\/dashboard\/?$/);
  await expect.poll(() => Boolean(pack && catalog), { message: 'analytics packs + catalog/_search answered', timeout: 30_000 }).toBe(true);
  const layoutIds = pack!.defaultLayout.map((l) => l.kpiId).filter((id) => pack!.tiles.some((t) => t.kpiId === id));
  expect(layoutIds.length, 'the analytics pack seeds a default layout').toBeGreaterThan(0);
  // Every default tile is answered by the _query batch (as a result or an error).
  await expect.poll(() => layoutIds.filter((id) => !results.has(id) && !errors.has(id)), {
    message: 'every default tile answered by /analytics/_query',
    timeout: 45_000,
  }).toEqual([]);
  await expect(page.locator('.dashboard-grid-layout .kpi-tile--loading')).toHaveCount(0, { timeout: 30_000 });

  const titleOf = (tile: Tile) => {
    const key = tile.viz?.titleKey || tile.titleKey;
    return (key && messages.get(key)) || tile.viz?.title || tile.kpiId;
  };
  return {
    pack: pack!,
    catalog: catalog!,
    messages,
    results,
    errors,
    layoutTiles: layoutIds.map((id) => pack!.tiles.find((t) => t.kpiId === id)!),
    titleOf,
  };
}

/** A grid widget, found by the "Remove <title>" button every widget carries. */
function widget(page: Page, dash: LoadedDashboard, tile: Tile) {
  const removeLabel = `${dash.messages.get('DASHBOARD_COMMON_REMOVE') || 'Remove'} ${dash.titleOf(tile)}`;
  return page.locator('.dashboard-grid-layout .react-grid-item').filter({
    has: page.getByRole('button', { name: removeLabel, exact: true }),
  });
}

const DASHBOARD_TAGS = ['@area:dashboard', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'];

test.describe('Employee dashboard (replaces the legacy PGR Dashboard)', () => {
  test('dashboard page loads with heading', {
    annotation: {
      type: 'description',
      description: `Smoke check that the employee dashboard (/<slug>/digit-ui/employee/dashboard) renders its H1. Replaces the legacy configurator /manage/pgr-dashboard check, which only runs on a rollback build.

Steps:
1. Sign ADMIN_USER into the employee app (BFF session + _select).
2. Open the dashboard; it must stay on the route (the access-control gate redirects callers without the analytics capability).
3. The H1 is the seeded DASHBOARD_HEADER_TITLE message (rainmaker-dashboard) when the tenant seeds one, else the code default ending in "Operations" (DashboardHeader.jsx).`,
    },
    tag: DASHBOARD_TAGS,
  }, async ({ page }) => {
    const dash = await openEmployeeDashboard(page);
    const seeded = dash.messages.get('DASHBOARD_HEADER_TITLE');
    const heading = page.locator('h1');
    await expect(heading).toHaveCount(1);
    if (seeded) await expect(heading).toHaveText(seeded);
    else await expect(heading).toHaveText(/\S.*Operations$/);
  });

  test('overview card shows 3 KPI metrics', {
    annotation: {
      type: 'description',
      description: `The legacy overview card had three fixed KPIs. The current dashboard's KPI row is the analytics pack's default layout, so this asserts every card-kind tile (number-tile*, scalar, sparkline-card) in /analytics/packs defaultLayout renders as a KPI widget under its title, and that there are at least three of them.`,
    },
    tag: DASHBOARD_TAGS,
  }, async ({ page }) => {
    const dash = await openEmployeeDashboard(page);
    const cards = dash.layoutTiles.filter((t) => CARD_KINDS.has(t.viz?.kind || ''));
    expect(cards.length, 'the default layout carries at least three KPI tiles').toBeGreaterThanOrEqual(3);
    await expect(page.locator('.dashboard-grid-layout .dashboard-kpi-widget')).toHaveCount(cards.length);
    for (const tile of cards) {
      const w = widget(page, dash, tile);
      await expect(w, `KPI tile ${tile.kpiId}`).toHaveCount(1);
      // The grid item itself carries the KPI-widget chrome (AdminDashboard.jsx).
      await expect(w, `${tile.kpiId} renders as a KPI card`).toHaveClass(/\bdashboard-kpi-widget\b/);
      await expect(w.locator('.dashboard-kpi-title').first()).toHaveText(dash.titleOf(tile), { ignoreCase: true });
    }
  });

  test('all chart canvases render', {
    annotation: {
      type: 'description',
      description: `Every non-KPI widget in the pack's default layout renders its body without an error tile, and the body agrees with the data /analytics/_query returned for it: a chart or table when the result has rows, the explicit "No data" placeholder only when it has none. Maps always mount their Leaflet container. Replaces the legacy Chart.js canvas count (the current charts are ApexCharts SVG, and an empty result renders a placeholder instead of an empty canvas).`,
    },
    tag: DASHBOARD_TAGS,
  }, async ({ page }) => {
    const dash = await openEmployeeDashboard(page);
    const charts = dash.layoutTiles.filter((t) => !CARD_KINDS.has(t.viz?.kind || ''));
    expect(charts.length, 'the default layout carries chart widgets').toBeGreaterThan(0);
    await expect(page.locator('.dashboard-grid-layout .kpi-tile--error')).toHaveCount(0);
    for (const tile of charts) {
      expect(dash.errors.get(tile.kpiId), `${tile.kpiId}: /analytics/_query error`).toBeUndefined();
      const w = widget(page, dash, tile);
      await expect(w, `chart widget ${tile.kpiId}`).toHaveCount(1);
      const kind = tile.viz?.kind || '';
      if (MAP_KINDS.has(kind)) {
        await expect(w.locator('.leaflet-container'), `${tile.kpiId} map`).toBeVisible();
        continue;
      }
      const rows = dash.results.get(tile.kpiId)?.rowCount ?? dash.results.get(tile.kpiId)?.rows?.length ?? 0;
      const placeholder = w.locator('.kpi-tile__placeholder');
      if (rows > 0) {
        await expect(placeholder, `${tile.kpiId} has ${rows} rows but shows a placeholder`).toHaveCount(0);
        const body = TABLE_KINDS.has(kind) ? w.locator('table') : w.locator('.apexcharts-canvas, svg:not(.dashboard-widget-remove-btn svg)');
        await expect(body.first(), `${tile.kpiId} renders its ${kind}`).toBeVisible();
      } else {
        await expect(placeholder, `${tile.kpiId} returned no rows`).toHaveText(dash.messages.get('DASHBOARD_COMMON_NO_DATA') || 'No data');
      }
    }
  });

  test('chart section titles are visible', {
    annotation: {
      type: 'description',
      description: `Every widget in the pack's default layout is on the grid exactly once and shows its title (the seeded titleKey message, else the catalog's English — textResolver.resolveTitle). Charts and tables carry an H2; maps carry their own header; KPI cards their title row. The grid holds nothing beyond the default layout in a fresh session.`,
    },
    tag: DASHBOARD_TAGS,
  }, async ({ page }) => {
    const dash = await openEmployeeDashboard(page);
    await expect(page.locator('.dashboard-grid-layout .react-grid-item')).toHaveCount(dash.layoutTiles.length);
    for (const tile of dash.layoutTiles) {
      const w = widget(page, dash, tile);
      await expect(w, `widget ${tile.kpiId}`).toHaveCount(1);
      const kind = tile.viz?.kind || '';
      if (MAP_KINDS.has(kind)) continue; // the map's own header names the zoom level, not the catalog title
      const title = dash.titleOf(tile);
      const shown = CARD_KINDS.has(kind) ? w.locator('.dashboard-kpi-title') : w.locator('h2');
      await expect(shown.first(), `${tile.kpiId} title`).toHaveText(title, { ignoreCase: true });
    }
  });

  test('sidebar has PGR Dashboard nav link', {
    annotation: {
      type: 'description',
      description: `The employee sidebar carries a Dashboard entry (from the access-control nav tree); clicking it from the employee home opens /employee/dashboard and marks the entry as the current page (aria-current="page").`,
    },
    tag: DASHBOARD_TAGS,
  }, async ({ page }) => {
    const loggedIn = await loginEmployeeBrowser(page, ADMIN_USER, ADMIN_PASS);
    expect(loggedIn).not.toBeNull();
    await page.goto(`${BASE_URL}/${tenantSlug()}/digit-ui/employee`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const nav = page.locator('.digit-sidebar-item[aria-label]').filter({ hasText: /dashboard/i });
    await expect(nav.first()).toBeVisible({ timeout: 30_000 });
    await expect(nav.first()).not.toHaveAttribute('aria-current', 'page');
    await nav.first().click();
    await expect(page).toHaveURL(/\/employee\/dashboard\/?$/, { timeout: 30_000 });
    await expect(page.locator('h1')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.digit-sidebar-item[aria-current="page"]')).toHaveAttribute('aria-label', /dashboard/i);
  });

  test('KPI values show numbers', {
    annotation: {
      type: 'description',
      description: `Each default-layout KPI tile shows a number-shaped value (digits, optionally with separators, % or /5), never an error tile or a "No data" card, and the analytics batch reported no error for it.`,
    },
    tag: DASHBOARD_TAGS,
  }, async ({ page }) => {
    const dash = await openEmployeeDashboard(page);
    const cards = dash.layoutTiles.filter((t) => CARD_KINDS.has(t.viz?.kind || ''));
    expect(cards.length).toBeGreaterThan(0);
    await expect(page.locator('.dashboard-grid-layout .kpi-tile--error, .dashboard-grid-layout .kpi-tile--empty')).toHaveCount(0);
    for (const tile of cards) {
      expect(dash.errors.get(tile.kpiId), `${tile.kpiId}: /analytics/_query error`).toBeUndefined();
      const value = widget(page, dash, tile).locator('.dashboard-kpi-value').first();
      await expect(value, `${tile.kpiId} value`).toHaveText(/\d/);
    }
  });

  test('breakdown table with 4 tabs', {
    annotation: {
      type: 'description',
      description: `The legacy "Status by Tenant" panel switched one table between Boundary / Department / Complaint Category / Channel tabs. The current dashboard shows the boundary breakdown as the default map and offers the others as widgets in the Add KPI picker. This asserts the picker lists every catalog breakdown not already on the grid (category table, department and channel charts, by the kpiIds the catalog publishes), then adds the complaint-category table and checks it lands on the grid with a table when /analytics/_query returns rows, else the "No data" placeholder.`,
    },
    tag: DASHBOARD_TAGS,
  }, async ({ page }) => {
    const dash = await openEmployeeDashboard(page);
    const onGrid = new Set(dash.layoutTiles.map((t) => t.kpiId));
    const byId = (id: string) => dash.catalog.find((t) => t.kpiId === id);
    const breakdowns = ['cl_table_complaint_type_details', 'cl_chart_departments_by_type', 'cl_chart_open_by_channel']
      .map(byId)
      .filter((t): t is Tile => Boolean(t) && !onGrid.has(t!.kpiId));
    test.skip(breakdowns.length === 0, 'the catalog publishes none of the category/department/channel breakdowns off the default grid');

    await page.locator('.dashboard-add-kpi-trigger').click();
    const picker = page.getByRole('list', { name: dash.messages.get('DASHBOARD_HEADER_AVAILABLE_KPIS') || 'Available KPIs' });
    await expect(picker).toBeVisible();
    const addLabel = (tile: Tile) => `${dash.messages.get('DASHBOARD_HEADER_ADD') || 'Add'} ${dash.titleOf(tile)}`;
    for (const tile of breakdowns) {
      await expect(picker.getByRole('button', { name: addLabel(tile), exact: true }), `${tile.kpiId} in Add KPI`).toBeVisible();
    }

    const table = breakdowns.find((t) => TABLE_KINDS.has(t.viz?.kind || ''));
    test.skip(!table, 'no category breakdown table in the catalog');
    await picker.getByRole('button', { name: addLabel(table!), exact: true }).click();
    const added = widget(page, dash, table!);
    await expect(added).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(() => dash.results.has(table!.kpiId) || dash.errors.has(table!.kpiId), { timeout: 30_000 }).toBe(true);
    expect(dash.errors.get(table!.kpiId), `${table!.kpiId}: /analytics/_query error`).toBeUndefined();
    await expect(added.locator('h2')).toHaveText(dash.titleOf(table!));
    const rows = dash.results.get(table!.kpiId)?.rowCount ?? 0;
    if (rows > 0) await expect(added.locator('table tbody tr')).not.toHaveCount(0);
    else await expect(added.getByText(dash.messages.get('DASHBOARD_COMMON_NO_DATA') || 'No data')).toBeVisible();
  });
});
