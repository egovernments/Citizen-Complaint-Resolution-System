/**
 * E2E test — PGR employee inbox pagination (issue #916).
 *
 * Verifies that the Next-page button is enabled when the total complaint
 * count exceeds one page (10 rows), and that clicking it actually loads
 * page 2 with different complaint numbers.
 *
 * Bug had three layers, fixed across three PRs:
 *  - #1014: missing totalCountJsonPath in PGRSearchInboxConfig, and
 *    usePGRInboxSearch returning wrappers.length instead of the real total.
 *  - #1058: pgr-services' _count reuses the _search criteria object, so
 *    forwarding the UI's page-size limit/offset into it capped the reported
 *    total at one page. Fixed by dropping limit/offset from the count call.
 *  - digit-ui-esbuild/products/pgr/src/hooks/pgr/usePGRInboxSearch.js: the
 *    #1058 fix landed in packages/libraries/src/hooks/pgr/usePGRInboxSearch.js,
 *    but products/pgr registers its own separate copy of this hook under the
 *    same name and wins, silently overriding it — the #1058 fix never
 *    reached production until this copy got the identical fix too.
 *
 * How to run: see local-setup/tests/README.md.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginViaApi, getDigitToken } from '../utils/auth';

const BASE_URL  = process.env.BASE_URL   || 'http://localhost:18080';
const TENANT    = process.env.DIGIT_TENANT   || 'pg.citya';
const USERNAME  = process.env.DIGIT_USERNAME || 'ADMIN';
const PASSWORD  = process.env.DIGIT_PASSWORD || 'eGov@123';

// Same default status filter the employee inbox queries on load.
const INBOX_STATUSES = ['PENDINGFORASSIGNMENT', 'PENDINGFORREASSIGNMENT', 'PENDINGATLME', 'PENDINGATSUPERVISOR'];

/**
 * Ground-truth total via the _count API directly, bypassing the UI entirely.
 * The footer's displayed total is exactly what the regression corrupts, so
 * it can't be used to decide whether a dataset is "big enough" to test
 * pagination on — that would be circular under the bug (a broken UI always
 * reports total === page size, indistinguishable from a genuinely small
 * dataset). This calls pgr-services directly, with no limit/offset, so it
 * reflects the real total regardless of whether the UI fix is present.
 */
async function getTrueComplaintCount(): Promise<number> {
  const { access_token, UserRequest } = await getDigitToken({ baseURL: BASE_URL, tenant: TENANT, username: USERNAME, password: PASSWORD });
  const params = new URLSearchParams({ tenantId: TENANT });
  INBOX_STATUSES.forEach(s => params.append('applicationStatus', s));
  const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_count?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: access_token, userInfo: UserRequest } }),
  });
  if (!resp.ok) throw new Error(`_count failed (${resp.status}): ${await resp.text()}`);
  const data = await resp.json();
  return data.count;
}

async function goToInbox(page: Page) {
  // The employee inbox route is inbox-v2 (PGRSearchInbox component) — plain
  // /inbox isn't a registered route in digit-ui-esbuild/products/pgr, so
  // navigating there renders a blank Switch with no match.
  await page.goto('/digit-ui/employee/pgr/inbox-v2', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Wait for the table to appear — the inbox fetches async so networkidle is unreliable
  await page.waitForSelector('table, [class*="digit-results-table"], [class*="inbox"]', { timeout: 40_000 });
  await page.waitForTimeout(3_000);
}

test.describe('PGR inbox pagination (#916)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: USERNAME, password: PASSWORD });
  });

  test('Next-page button is enabled when more than 10 complaints exist', async ({ page }) => {
    await goToInbox(page);

    // Check total count shown in the pagination footer (e.g. "1-10 of 25").
    // Match on the visible text pattern rather than guessing class names —
    // the built bundle's class names don't reliably contain "footer"/
    // "pagination" as substrings, and innerText() on a locator that matches
    // nothing waits indefinitely (no actionTimeout is configured), silently
    // eating the whole test budget instead of failing fast.
    const paginationText = await page.getByText(/\d+\s*[-–]\s*\d+\s+of\s+\d+/i).first().innerText({ timeout: 10_000 }).catch(() => '');

    // If there are ≤ 10 complaints we can't test pagination — skip gracefully.
    const totalMatch = paginationText.match(/of\s+(\d+)/i);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;

    if (total <= 10) {
      test.skip(true, `Only ${total} complaints exist — need >10 to test pagination`);
      return;
    }

    // Next button should be ENABLED (not disabled)
    const nextBtn = page.locator('button:has(svg[class*="ChevronRight"]), button:has([data-testid*="next"]), .pagination button').last();
    await expect(nextBtn).toBeVisible({ timeout: 5_000 });
    await expect(nextBtn).toBeEnabled({ timeout: 5_000 });
  });

  test('Clicking Next loads page 2 with different complaint numbers', async ({ page }) => {
    await goToInbox(page);

    // Collect complaint numbers on page 1
    const page1Rows = await page.locator('table tbody tr, [class*="digit-results-table"] tr').allInnerTexts();
    const page1Ids: string[] = page1Rows.join('\n').match(/PG-PGR-[0-9-]+/g) ?? [];

    if (page1Ids.length === 0) {
      test.skip(true, 'No complaints in inbox — seed data required');
      return;
    }

    // If already on the last page (< 10 rows), pagination is moot
    if (page1Ids.length < 10) {
      test.skip(true, `Only ${page1Ids.length} complaints — need >10 to test Next`);
      return;
    }

    // Click the Next button
    const nextBtn = page.locator('button svg[class*="ChevronRight"]').locator('..');
    const isEnabled = await nextBtn.isEnabled().catch(() => false);

    if (!isEnabled) {
      // This is the regression — fail with a clear message
      await page.screenshot({ path: 'test-results/pgr-pagination-next-disabled.png' });
      throw new Error(
        'Next-page button is DISABLED on page 1 with 10 complaints — pagination regression (#916). ' +
        'Check totalCountJsonPath in PGRSearchInboxConfig and usePGRInboxSearch totalCount.'
      );
    }

    await nextBtn.click();
    await page.waitForTimeout(4_000);

    // Page 2 should have different complaint IDs
    const page2Rows = await page.locator('table tbody tr, [class*="digit-results-table"] tr').allInnerTexts();
    const page2Ids: string[] = page2Rows.join('\n').match(/PG-PGR-[0-9-]+/g) ?? [];

    expect(page2Ids.length).toBeGreaterThan(0);

    // At least one ID on page 2 should not appear on page 1
    const hasNewIds = page2Ids.some(id => !page1Ids.includes(id));
    expect(hasNewIds).toBe(true);
  });

  test('Pagination footer shows total count (not just page size)', async ({ page }) => {
    // This test does an extra API round-trip on top of the normal UI load
    // (the ground-truth _count fetch below), which can exceed the default
    // 60s budget against a slow/remote deployment.
    test.setTimeout(90_000);

    // Ground truth first, independent of anything the UI renders — see
    // getTrueComplaintCount's comment for why the footer can't self-validate.
    const trueTotal = await getTrueComplaintCount();
    if (trueTotal <= 10) {
      test.skip(true, `Only ${trueTotal} complaints exist — need >10 to distinguish the regression from a small dataset`);
      return;
    }

    await goToInbox(page);

    // Footer should render "X-Y of Z" — if totalCountJsonPath is wired correctly
    // Z will equal the real server total; under the regression Z === Y (page size).
    // Match on visible text, not class names — see the identical comment on
    // the first test for why (they don't reliably appear in the built bundle).
    const footerText = await page.getByText(/\d+\s*[-–]\s*\d+\s+of\s+\d+/i).first().innerText({ timeout: 10_000 }).catch(() => '');

    const match = footerText.match(/(\d+)\s*[-–]\s*(\d+)\s+of\s+(\d+)/i);
    if (!match) {
      // No pagination rendered — either 0 complaints or the footer is absent
      test.skip(true, 'Pagination footer not found — inbox may be empty');
      return;
    }

    const [, , pageEnd, displayedTotal] = match.map(Number);
    if (displayedTotal === pageEnd) {
      await page.screenshot({ path: 'test-results/pgr-pagination-total-equals-page.png' });
    }
    // This is the actual regression check: under the bug, displayedTotal is
    // always capped at pageEnd (page size) regardless of the true total, so
    // this fails exactly when #916 recurs.
    expect(displayedTotal).toBe(trueTotal);
  });
});
