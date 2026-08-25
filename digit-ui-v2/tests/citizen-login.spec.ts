/**
 * Citizen UI end-to-end:
 *   1. Visit /citizen/ → redirected to /citizen/login.
 *   2. Enter a Kenya-format mobile + the fixed OTP `123456`.
 *   3. Land on /citizen/complaints. The legacy PGR dashboard and its API are
 *      not reachable from the default-off UI contract.
 *
 * The mobile is generated fresh per run so the citizen-create path runs
 * (idempotent: register endpoint returns the token directly).
 */
import { test, expect } from '@playwright/test';

// Kenya-format mobile: 9 digits starting with 1 or 7.
// `7XXXXXXXX` deterministically per-run-timestamp so concurrent runs don't
// collide on egov-user's userName uniqueness.
function freshMobile() {
  const tail = String(Date.now()).slice(-8); // 8 trailing digits
  return `7${tail}`;
}

test.describe('citizen ui', () => {
  test('login lands on complaints with the legacy dashboard hidden', async ({ page }) => {
    const mobile = freshMobile();

    // A default-off build must not fetch the legacy endpoint during login.
    const dashboardCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/pgr-services/v2/dashboard')) {
        dashboardCalls.push(req.url());
      }
    });

    // ── 1. Visit root, expect redirect to login ────────────────────
    await page.goto('/citizen/');
    await expect(page).toHaveURL(/\/citizen\/login$/);
    await expect(page.getByText('Nai Pepea — Citizen sign in')).toBeVisible();

    // ── 2. Mobile step ─────────────────────────────────────────────
    await page.getByLabel('Mobile number').fill(mobile);
    await page.getByRole('button', { name: /Send OTP/i }).click();

    // ── 3. OTP step ────────────────────────────────────────────────
    await expect(page.getByLabel('One-time code')).toBeVisible();
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: /^Sign in$/i }).click();

    // ── 4. Supported landing + hidden legacy entry ─────────────────
    await expect(page).toHaveURL(/\/citizen\/complaints$/, { timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Citizen Dashboard' })).toHaveCount(0);
    expect(dashboardCalls).toHaveLength(0);

    // A remembered/deep legacy URL cannot bypass the flag.
    await page.goto('/citizen/dashboard');
    await expect(page).toHaveURL(/\/citizen\/complaints$/);
    await expect(page.getByRole('heading', { name: 'PGR Dashboard' })).toHaveCount(0);
  });

  test('unauthenticated /dashboard redirects to /login', async ({ page }) => {
    // Fresh context — no token in localStorage.
    await page.goto('/citizen/dashboard');
    await expect(page).toHaveURL(/\/citizen\/login$/);
  });

  test('my complaints + raise + detail end-to-end', async ({ page }) => {
    const mobile = freshMobile();

    // ── Sign in ───────────────────────────────────────────────────
    await page.goto('/citizen/');
    await page.getByLabel('Mobile number').fill(mobile);
    await page.getByRole('button', { name: /Send OTP/i }).click();
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: /^Sign in$/i }).click();
    await expect(page).toHaveURL(/\/citizen\/complaints$/, { timeout: 15_000 });

    // ── Navigate to "My Complaints" via the sidebar ───────────────
    await page.getByRole('link', { name: 'My Complaints' }).click();
    await expect(page).toHaveURL(/\/citizen\/complaints$/);
    // Fresh citizen: empty state should be visible.
    await expect(page.getByText('No complaints yet')).toBeVisible({ timeout: 15_000 });

    // ── File a complaint (4-step wizard) ──────────────────────────
    await page.getByRole('link', { name: /File a complaint/i }).first().click();
    await expect(page).toHaveURL(/\/citizen\/complaints\/create$/);
    await expect(page.getByRole('heading', { name: 'File a complaint' })).toBeVisible();

    // Step 1: pick the first complaint type that's available.
    // Wait for service-defs to load (the dropdown becomes interactive).
    const firstType = page.locator('button').filter({ has: page.locator('div.font-medium.text-sm') }).first();
    await firstType.waitFor({ state: 'visible', timeout: 15_000 });
    await firstType.click();
    await page.getByRole('button', { name: /^Next$/i }).click();

    // Step 2: there might be a sub-type to pick. Click the first sub-type
    // tile if it exists, then fill description.
    const subTypeTile = page.locator('button').filter({ hasText: /^[A-Z]/ }).filter({
      hasNotText: /Next|Back|Submit|Cancel/,
    });
    const subTypeCount = await subTypeTile.count();
    if (subTypeCount > 0) {
      // Heuristic: pick the first one that looks like a sub-type (small tile).
      const candidates = await subTypeTile.all();
      for (const c of candidates) {
        const text = (await c.textContent()) ?? '';
        if (text.trim().length > 0 && text.trim().length < 60 && !text.match(/Next|Back|Submit|Cancel|File a complaint|My Complaints|Citizen Dashboard|Sign out/)) {
          await c.click();
          break;
        }
      }
    }
    await page.locator('textarea#description').fill('Playwright e2e: a broken something near the corner.');
    await page.getByRole('button', { name: /^Next$/i }).click();

    // Step 3: the map widget should mount.
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 });
    // Set lat/lng directly via the hidden form state by interacting with
    // "Use my GPS" — but headless playwright denies geolocation by default,
    // so we'll simulate a marker drag by dispatching dragend on the marker.
    // Easier: just fill the locality field (lat/lng remain at default).
    // The form requires lat/lng — set them via injected event:
    await page.evaluate(() => {
      // Find react-hook-form-controlled inputs and trigger via the map's
      // marker dragend. Simpler: directly call the form setter via DOM.
      // We can drag the leaflet marker programmatically.
      const marker = document.querySelector('.leaflet-marker-icon') as HTMLElement | null;
      if (marker) marker.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    // Fallback path: just fill locality and proceed. The dataProvider passes
    // lat/lng undefined if missing — DIGIT accepts that.
    await page.locator('input#locality').fill('Westlands');
    await page.getByRole('button', { name: /^Next$/i }).click();

    // Step 4: review + submit
    await expect(page.getByText('Westlands')).toBeVisible();
    await page.getByRole('button', { name: /Submit complaint/i }).click();

    // ── Land on detail page ───────────────────────────────────────
    await expect(page).toHaveURL(/\/citizen\/complaints\/[^/]+\/show$/, { timeout: 20_000 });
    await expect(page.locator('text=/NCCG-PGR-\\d+|^[A-Z0-9-]{8,}$/').first()).toBeVisible({ timeout: 10_000 });
    // Description and locality should be visible
    await expect(page.getByText('Playwright e2e: a broken something near the corner.')).toBeVisible();
    await expect(page.getByText('Westlands')).toBeVisible();
    // Timeline card present (CardTitle renders as a div, not an h*, so
    // assert via text rather than role).
    await expect(page.getByText('Timeline', { exact: true })).toBeVisible();
  });

  test('profile edit + persists across reload', async ({ page }) => {
    const mobile = freshMobile();

    // Sign in.
    await page.goto('/citizen/');
    await page.getByLabel('Mobile number').fill(mobile);
    await page.getByRole('button', { name: /Send OTP/i }).click();
    await page.getByLabel('One-time code').fill('123456');
    await page.getByRole('button', { name: /^Sign in$/i }).click();
    await expect(page).toHaveURL(/\/citizen\/complaints$/, { timeout: 15_000 });

    // Navigate via sidebar.
    await page.getByRole('link', { name: 'Profile' }).click();
    await expect(page).toHaveURL(/\/citizen\/profile$/);
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();

    // Mobile is shown read-only.
    const mobileField = page.getByLabel('Mobile number');
    await expect(mobileField).toBeDisabled();
    await expect(mobileField).toHaveValue(mobile);

    // Save with no edits is disabled.
    const saveBtn = page.getByRole('button', { name: 'Save changes' });
    await expect(saveBtn).toBeDisabled();

    // Edit name + email, pick gender.
    const newName = `Citizen ${mobile} edited`;
    const newEmail = `citizen-${mobile}@example.test`;
    await page.getByLabel('Full name').fill(newName);
    await page.getByLabel(/Email/).fill(newEmail);
    await page.getByRole('button', { name: 'Female' }).click();

    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(page.getByText('Profile saved.')).toBeVisible({ timeout: 10_000 });

    // Reload and confirm the values persisted (server round-trip).
    await page.reload();
    await expect(page.getByLabel('Full name')).toHaveValue(newName, { timeout: 10_000 });
    await expect(page.getByLabel(/Email/)).toHaveValue(newEmail);
    await expect(page.getByRole('button', { name: 'Female' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
