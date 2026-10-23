/**
 * Employee top-bar working-context box — jurisdiction names (CCRS#2643).
 *
 * The box ("<tenant> · N department · N role") opens a panel listing the
 * employee's jurisdictions. Each one must show the boundary's localized NAME,
 * read from the bare boundary code in `rainmaker-boundary-<hierarchy>` (the
 * #1002 standard), not the raw code and not an `ADMIN_<CODE>` key.
 *
 * The boundary pack used to be loaded only when the PGR module mounted, so the
 * names appeared on complaint pages and were raw codes everywhere else. The box
 * now loads the pack itself, so this spec deliberately opens it on the employee
 * HOME page, never a complaint page.
 */
import { test, expect } from '@playwright/test';

import { BASE_URL, TENANT, ROOT_TENANT } from '../utils/env';
import { loginViaApi } from '../utils/auth';
import { surfacePath } from '../utils/identity-bff';
import { getPersona } from '../utils/personas';
import { getProfile } from '../utils/profile';
import { requires } from '../utils/capabilities';

const employeeHome = () => surfacePath('employee');

/** The localized name of `code` in the hierarchy's boundary pack, from the deployment's own store. */
async function boundaryName(code: string, hierarchy: string, locale: string): Promise<string | undefined> {
  const r = await fetch(
    `${BASE_URL}/localization/messages/v1/_search` +
      `?tenantId=${encodeURIComponent(ROOT_TENANT)}` +
      `&locale=${encodeURIComponent(locale)}` +
      `&module=${encodeURIComponent(`rainmaker-boundary-${hierarchy.toLowerCase()}`)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', ver: '.01', ts: null, msgId: 'working-context-jurisdiction-spec' },
      }),
    },
  );
  const j = (await r.json()) as { messages?: { code?: string; message?: string }[] };
  return j?.messages?.find((m) => m?.code === code)?.message;
}

test.describe('employee working-context box — jurisdiction names #2643', () => {
  test('jurisdiction shows the boundary name, not its code, on the employee home page', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#2643: the working-context panel listed jurisdictions by raw boundary code (it looked up ADMIN_<CODE>, which nothing writes), and only showed names after the PGR module had loaded the boundary pack.

Steps:
1. Take the ward-scoped CSR persona (an onboarded employee holding a boundary jurisdiction in the PGR hierarchy) and read that boundary's localized name from rainmaker-boundary-<hierarchy> in the deployment's own store. The name must differ from the code, otherwise the assertion below could not tell them apart.
2. Sign in and land on the employee HOME page (not a complaint page), so the boundary pack has not been loaded by PGR.
3. Open the working-context box.
4. Assert a Jurisdiction chip contains the localized name and no chip is the bare code.`,
    },
    tag: ['@ccrs:2643', '@kind:regression', '@layer:ui', '@persona:employee'] }, async ({ page }) => {
    requires(test, 'personas.ward-scoped-csr');

    const hierarchy = getProfile().boundary.hierarchyType;
    expect(hierarchy, 'deployment profile must name the boundary hierarchy').toBeTruthy();
    const csr = await getPersona('ward-scoped-csr');
    expect(csr.jurisdictions.length, `persona ${csr.username} must hold a jurisdiction`).toBeGreaterThan(0);

    await loginViaApi(page, { tenant: TENANT, authTenant: csr.tenant, username: csr.username, password: csr.password });
    const locale = (await page.evaluate(() => localStorage.getItem('Employee.locale'))) || 'en_IN';

    // Pick the persona jurisdiction that has a distinct localized name.
    let code: string | undefined;
    let name: string | undefined;
    for (const c of csr.jurisdictions) {
      const n = await boundaryName(c, hierarchy!, locale);
      if (n && n !== c) {
        code = c;
        name = n;
        break;
      }
    }
    expect(
      name,
      `rainmaker-boundary-${hierarchy!.toLowerCase()} must hold a name different from the code for one of ${JSON.stringify(csr.jurisdictions)} (bare-code keys, #1002) — without it this spec cannot tell a name from a code`,
    ).toBeTruthy();

    // Home page, fresh load: the boundary pack is not there unless the box loads it.
    await page.goto(`${BASE_URL}${employeeHome()}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    expect(new URL(page.url()).pathname, 'must be on the employee home, not a PGR page').not.toMatch(/pgr|complaint/i);

    await page.locator('.digit-working-context-trigger').first().click({ timeout: 30_000 });
    const panel = page.locator('.digit-working-context-panel');
    await expect(panel, 'working-context panel must open').toBeVisible({ timeout: 10_000 });

    const chips = panel.locator('.digit-working-context-chip');
    await expect(
      chips.filter({ hasText: name! }),
      `CCRS#2643 — jurisdiction ${code} must render as its localized name "${name}"`,
    ).not.toHaveCount(0, { timeout: 15_000 });
    // The type suffix "(Ward)" may follow the name; a chip that is just the code is the bug.
    await expect(
      chips.filter({ hasText: new RegExp(`^\\s*${code!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*\\(.*\\))?\\s*$`) }),
      `CCRS#2643 — no jurisdiction chip may show the bare code ${code}`,
    ).toHaveCount(0);
  });
});
