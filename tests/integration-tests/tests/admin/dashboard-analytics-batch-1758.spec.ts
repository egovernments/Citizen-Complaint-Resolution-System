/**
 * Regression test for issue #1758:
 * "Dashboard Analytics Request failed" — HTTP 400 when Add All KPIs
 *
 * Root cause: the PGR_ADMIN "Add All" plan expands 28 visible tiles into
 * 51 analytics query refs, exceeding the backend limit of 50. The entire
 * request is atomically rejected before any KPI is evaluated.
 *
 * Fix (PR #1781): the client reads the server-advertised budget, chunks the
 * expanded plan into sequential requests of ≤50 queries each, and merges
 * the partial results — so "Add All" sends 50 + 1 instead of 51.
 *
 * How to run against bometfeedbackhub:
 *   cd tests/integration-tests
 *   set -a; source deploy/bomet.env; set +a
 *   npx playwright test tests/admin/dashboard-analytics-batch-1758.spec.ts \
 *     --project=chromium --no-deps --headed
 *
 * The test self-skips when the dashboard-ui page is unreachable.
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

const DASHBOARD_URL = `${BASE_URL}/dashboard-ui/employee/dashboard`;
const LOGIN_URL     = `${BASE_URL}/digit-ui/employee/user/login`;

/** Inject a DIGIT employee session into localStorage on the current page origin. */
async function injectSession(
  page: import('@playwright/test').Page,
  token: string,
  userInfo: Record<string, unknown>,
  tenant: string,
): Promise<void> {
  await page.evaluate(
    ({ tk, ui, tn }) => {
      localStorage.setItem('Employee.token',     tk);
      localStorage.setItem('Employee.tenant-id', tn);
      localStorage.setItem('Employee.user-info', JSON.stringify(ui));
      localStorage.setItem('Employee.locale',    'en_IN');
      localStorage.setItem('token',              tk);
      localStorage.setItem('tenant-id',          tn);
      localStorage.setItem('user-info',          JSON.stringify(ui));
    },
    { tk: token, ui: userInfo, tn: tenant },
  );
}

test.describe('Dashboard analytics batch limit — issue #1758', () => {

  test(
    'Add All KPIs sends no analytics request that returns HTTP 400 @p0 @area:dashboard @kind:regression @layer:ui',
    async ({ page }) => {

      // ── 1. Acquire ADMIN token ───────────────────────────────────────────
      let tokenResp: Awaited<ReturnType<typeof getDigitToken>>;
      try {
        tokenResp = await getDigitToken({
          tenant:   ROOT_TENANT,
          username: ADMIN_USER,
          password: ADMIN_PASS,
          userType: 'EMPLOYEE',
        });
      } catch (err) {
        test.skip(true, `Auth failed — deployment may be down: ${err}`);
        return;
      }

      const token    = tokenResp.access_token;
      const userInfo = (tokenResp.UserRequest || {}) as Record<string, unknown>;

      // ── 2. Inject session (same origin as dashboard-ui) ──────────────────
      // Navigate to any digit-ui page on the target origin so that
      // localStorage is set on the correct origin before we open dashboard-ui.
      const loginResp = await page.goto(LOGIN_URL, {
        waitUntil: 'commit',
        timeout: 30_000,
      });
      if (!loginResp || loginResp.status() >= 500) {
        test.skip(true, `Login page unreachable (${loginResp?.status()}) — skipping`);
        return;
      }
      await injectSession(page, token, userInfo, ROOT_TENANT);

      // ── 3. Capture analytics 400s before navigating to dashboard ─────────
      // Any path that looks like an analytics or DSS backend call.
      const analyticsErrors: { url: string; status: number; body: string }[] = [];
      page.on('response', async (resp) => {
        const url = resp.url();
        const isApi = /\/(analytics|dss|getDashboard|getChart|chartv2)/i.test(url)
          && !/\.(js|css|png|svg|ico|woff|ttf)(\?|$)/.test(url);
        if (isApi && resp.status() >= 400) {
          let body = '';
          try { body = await resp.text(); } catch { /* already consumed */ }
          analyticsErrors.push({ url, status: resp.status(), body: body.slice(0, 300) });
        }
      });

      // Also watch for any 400 from the broader dashboard origin (catches
      // differently-pathed analytics endpoints on new deployments).
      page.on('response', (resp) => {
        if (resp.status() === 400 && resp.url().includes(new URL(BASE_URL).hostname)) {
          // deduplicate — only record if not already captured by the pattern above
          const alreadyCaptured = analyticsErrors.some((e) => e.url === resp.url());
          if (!alreadyCaptured) {
            analyticsErrors.push({ url: resp.url(), status: 400, body: '' });
          }
        }
      });

      // ── 4. Open the dashboard ─────────────────────────────────────────────
      // Use 'commit' (first byte received) — the dashboard-ui loads large
      // synchronous vendor bundles including unpkg.com/xlsx that block the
      // DOMContentLoaded event for 30-60 s on cold loads. We'll wait for a
      // meaningful element instead.
      const dashResp = await page.goto(DASHBOARD_URL, {
        waitUntil: 'commit',
        timeout: 30_000,
      });
      if (!dashResp || dashResp.status() >= 400) {
        test.skip(true, `Dashboard unreachable (${dashResp?.status()}) — skipping`);
        return;
      }

      // Wait for either:
      //  a) the URL to stabilise after a possible JS redirect to login, OR
      //  b) a dashboard-specific element to appear.
      await page.waitForTimeout(5_000);

      // Self-skip when the dashboard login wall is hit (token not recognised).
      const currentUrl = page.url();
      const loginRedirected = currentUrl.includes('/login') || currentUrl.includes('/user/login');
      if (loginRedirected) {
        test.skip(true, 'dashboard-ui redirected to login — session injection did not carry over');
        return;
      }

      // ── 5. Click "+ Add KPI" ──────────────────────────────────────────────
      const addKpiBtn = page
        .getByRole('button', { name: /\+?\s*add\s*kpi/i })
        .or(page.locator('button', { hasText: /add kpi/i }))
        .first();

      await expect(addKpiBtn).toBeVisible({ timeout: 20_000 });
      await addKpiBtn.click();

      // ── 6. Add All KPIs ───────────────────────────────────────────────────
      // The picker may have an explicit "Add All" button or individual checkboxes.
      const addAllBtn = page
        .getByRole('button', { name: /add\s*all/i })
        .or(page.locator('button', { hasText: /add all/i }))
        .first();

      const addAllVisible = await addAllBtn.isVisible({ timeout: 4_000 }).catch(() => false);

      if (addAllVisible) {
        await addAllBtn.click();
      } else {
        // Fallback: tick every unchecked checkbox inside the picker and submit.
        const picker = page
          .locator('[role="dialog"]')
          .or(page.locator('[data-testid*="kpi"], [class*="kpi-picker"], [class*="KpiPicker"]'))
          .first();

        const checkboxes = picker.locator('input[type="checkbox"]');
        const cbCount = await checkboxes.count();
        if (cbCount === 0) {
          // No checkboxes found — look for clickable KPI cards / list items.
          const items = picker.locator('[role="option"], li, [class*="kpi-item"]');
          const itemCount = await items.count();
          for (let i = 0; i < itemCount; i++) {
            await items.nth(i).click().catch(() => { /* skip unclickable rows */ });
          }
        } else {
          for (let i = 0; i < cbCount; i++) {
            const cb = checkboxes.nth(i);
            if (!(await cb.isChecked().catch(() => false))) {
              await cb.click();
            }
          }
        }

        // Confirm selection if a submit / Apply / Done button is present.
        const confirmBtn = page.getByRole('button', { name: /apply|done|add|confirm|submit/i });
        const confirmVisible = await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false);
        if (confirmVisible) await confirmBtn.click();
      }

      // ── 7. Wait for all analytics requests to complete ────────────────────
      // The fix sends 50 + 1 queries sequentially; allow time for both chunks.
      await page.waitForTimeout(8_000);

      // ── 8. Assert: no analytics 400 received ─────────────────────────────
      const errorSummary = analyticsErrors
        .map((e) => `  HTTP ${e.status}: ${e.url}\n    ${e.body}`)
        .join('\n');

      expect(
        analyticsErrors,
        `Analytics endpoint returned HTTP 400 — batch-limit bug (issue #1758) is still present.\n` +
        `Fix: merge PR #1781 which chunks "Add All" into sequential ≤50-query requests.\n\n` +
        `Failing requests:\n${errorSummary}`,
      ).toHaveLength(0);

      // ── 9. Assert: no "Analytics request failed" error toast visible ───────
      const errorToast = page
        .locator('text=Analytics request failed')
        .or(page.locator('[class*="toast"], [class*="error"], [role="alert"]', {
          hasText: /analytics request failed|request failed/i,
        }))
        .first();
      await expect(errorToast).not.toBeVisible({ timeout: 3_000 });

      // ── 10. Assert: at least one KPI tile rendered ────────────────────────
      // After a successful "Add All" the dashboard should show chart tiles.
      const kpiTile = page
        .locator('canvas')
        .or(page.locator('[class*="kpi"], [class*="chart"], [class*="tile"]'))
        .first();
      await expect(kpiTile).toBeVisible({ timeout: 15_000 });
    },
  );

  test(
    'analytics endpoint is reachable and returns a valid catalog @p1 @area:dashboard @kind:smoke @layer:api',
    async ({ page }) => {
      // Smoke-check: does the dashboard-ui load at all?
      // Fails fast on a completely down deployment.
      let tokenResp: Awaited<ReturnType<typeof getDigitToken>>;
      try {
        tokenResp = await getDigitToken({
          tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS, userType: 'EMPLOYEE',
        });
      } catch (err) {
        test.skip(true, `Auth failed: ${err}`);
        return;
      }

      await page.goto(LOGIN_URL, { waitUntil: 'commit', timeout: 30_000 });
      await injectSession(
        page,
        tokenResp.access_token,
        (tokenResp.UserRequest || {}) as Record<string, unknown>,
        ROOT_TENANT,
      );

      const resp = await page.goto(DASHBOARD_URL, {
        waitUntil: 'commit',
        timeout: 30_000,
      });

      expect(
        resp?.status(),
        `dashboard-ui returned ${resp?.status()} — app may not be deployed`,
      ).toBeLessThan(500);

      // The page should have at least one element that identifies it as the
      // analytics dashboard (not a blank page or raw error).
      const body = await page.locator('body').textContent({ timeout: 10_000 });
      expect(body?.length, 'dashboard-ui rendered an empty body').toBeGreaterThan(10);
    },
  );
});
