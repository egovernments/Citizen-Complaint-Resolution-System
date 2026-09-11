/**
 * Employee shell chrome — what the sidebar/landing surface must and must NOT
 * expose.
 *
 * Two guards live here:
 *
 *  1. CCRS#561 / #560 — HRMS and Workbench are deliberately NOT part of the
 *     employee shell. digit-ui-esbuild/src/App.js pins
 *     `enabledModules = ["Utilities", "PGR", "Dashboard"]` with the comment
 *     "HRMS + Workbench intentionally omitted — employees/admins manage HRMS
 *     and workbench configs via the configurator app". The previous version of
 *     this file asserted the OPPOSITE (an HRMS tile must be visible) and then
 *     skipped itself when it wasn't, blaming an onboarding gap. That diagnosis
 *     was wrong: HRMS is onboarded at every data layer on this deployment
 *     (action 1779 `rainmaker-common-hrms`, roleaction -> SUPERUSER which ADMIN
 *     holds, tenant.citymodule {"code":"HRMS","active":true}, localization
 *     ACTION_TEST_HRMS). It cannot render because the product removed it — and
 *     because the HRMS actions carry `enabled:false`, so accesscontrol filters
 *     them out of the ACL response the shell builds its chrome from. So the
 *     test is inverted into a regression guard for that decision.
 *
 *  2. CCRS#446 — the employee sidebar used to render every module the user had
 *     access to, including IM (Incident Management) ticketing entries, which
 *     are noise on a PGR-focused deployment. PR #29 (500b4fa) + globalConfig
 *     `EMPLOYEE_MODULE_DENYLIST=["IM"]` filters sidebar options through the
 *     denylist in EmployeeSideBar.js before rendering.
 *
 * Both guards are written to actually be able to fail — see the long comments
 * on the drawer and on the #446 injection below.
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS, LOCALES } from '../utils/env';
import { loginViaApi } from '../utils/auth';

const EMPLOYEE_HOME = '/digit-ui/employee';

/*
 * App-level DOM hooks, all emitted by digit-ui-components / core — none of them
 * carries a tenant, locale or label, so they are safe to pin.
 *   .digit-employeeSidebar   core's EmployeeSideBar wrapper
 *   .digit-sidebar           the SideNav drawer itself (gains `.hovered`)
 *   .item-label              a drawer entry's text (only mounts while hovered)
 *   .digit-landing-page-card an employee-home module card
 */
const SIDEBAR = '.digit-employeeSidebar .digit-sidebar';
const SIDEBAR_ITEM_LABEL = '.digit-employeeSidebar .digit-sidebar-item .item-label';
const MODULE_CARD = '.digit-landing-page-card';

/**
 * Resolve a UI label from the deployment's OWN localization store, so no
 * English literal is baked into an assertion. react-i18next echoes the key back
 * when a deployment has no translation registered, so the key is the correct
 * expectation in that case too.
 */
async function localizedLabel(code: string, module: string): Promise<string> {
  try {
    const r = await fetch(
      `${BASE_URL}/localization/messages/v1/_search` +
        `?tenantId=${encodeURIComponent(ROOT_TENANT)}` +
        `&locale=${encodeURIComponent(LOCALES[0])}` +
        `&module=${encodeURIComponent(module)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: { apiId: 'Rainmaker', ver: '.01', ts: null, msgId: 'employee-sidebar-spec' },
        }),
      },
    );
    const j = (await r.json()) as { messages?: { code?: string; message?: string }[] };
    return j?.messages?.find((m) => m?.code === code)?.message || code;
  } catch {
    return code;
  }
}

/**
 * The employee sidebar lives in the digit-ui EMPLOYEE shell, which reads its own
 * `Employee.token` from localStorage. The suite-wide auth.json only carries the
 * *configurator* session, so a bare navigation lands on the digit-ui login gate
 * and no shell mounts. Inject an employee session (ADMIN — always present after
 * bootstrap, and holds SUPERUSER so it sees every module the deployment
 * enables, which is what makes the "HRMS is absent" assertion meaningful rather
 * than a permissions artefact).
 */
async function openEmployeeShell(page: Page): Promise<void> {
  await loginViaApi(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
  await page.goto(`${BASE_URL}${EMPLOYEE_HOME}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Module cards + sidebar render client-side after a tenant/ACL fetch.
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  const bodyText = await page.locator('body').innerText();
  expect(bodyText, 'employee shell must mount').not.toMatch(/Something went wrong/i);
}

/**
 * Open the collapsible drawer.
 *
 * This matters for correctness, not for realism: SideNav renders as an
 * icons-only rail and mounts `.item-label` nodes ONLY while `hovered` is set
 * (atoms/SideNav.js: `{hovered && <span className="item-label">…}`). The
 * previous version of this test never opened it and only read
 * `/digit-ui/employee` body text — so its "IM entries are gone" assertion never
 * touched the EmployeeSideBar denylist code it claimed to exercise. Hovering the
 * rail is what makes the drawer's contents observable at all.
 */
async function openSidebarDrawer(page: Page): Promise<void> {
  const drawer = page.locator(SIDEBAR).first();
  await drawer.waitFor({ state: 'attached', timeout: 20_000 });
  await drawer.hover({ timeout: 10_000 });
  await expect(drawer, 'sidebar drawer must expand on hover').toHaveClass(/hovered/, {
    timeout: 10_000,
  });
  await expect(
    page.locator(SIDEBAR_ITEM_LABEL).first(),
    'expanded drawer must render at least one entry — otherwise every "X is absent" assertion below is vacuous',
  ).toBeVisible({ timeout: 10_000 });
}

test.describe('employee shell chrome', () => {
  test('HRMS + Workbench are absent from the employee shell', {
    annotation: {
      type: 'description',
      description: `Regression guard for egovernments/CCRS#561 (HRMS) and #560 (Workbench). digit-ui-esbuild/src/App.js deliberately pins enabledModules = ["Utilities","PGR","Dashboard"] because employees/admins manage HRMS and workbench configs from the separate configurator app; the HRMS accesscontrol actions are correspondingly shipped with enabled:false, so the SPA's ACL call (which sends enabled:true) never receives them. This test asserts that observable outcome.

Steps:
1. Inject an ADMIN employee session (SUPERUSER — sees every enabled module) and open /digit-ui/employee.
2. Positive control: at least one module card renders, and the PGR card is among them (matched on the deployment's own localized ES_PGR_HEADER_COMPLAINT, not an English literal). Without this the negatives below could pass on a blank page.
3. Expand the collapsible sidebar (SideNav only mounts entry labels while hovered) and assert it lists at least one entry.
4. Negative: nothing anywhere in the mounted shell — cards or drawer — matches /HRMS/i or /workbench/i.

Honest limitation: this fails if HRMS is re-exposed at the data layer (the ACL actions flipped back to enabled:true) or if an HRMS module/card is re-registered in the shell. It does NOT independently fail if only the App.js enabledModules line is reverted while the HRMS actions stay disabled, because nothing would render in that case either.`,
    },
    tag: ['@ccrs:561', '@ccrs:560', '@kind:regression', '@layer:ui', '@persona:employee'] }, async ({ page }) => {
    await openEmployeeShell(page);

    // ---- positive control: the shell really did render its module grid ----
    // Without this, "HRMS is absent" would also be true of a blank page.
    await expect(
      page.locator(MODULE_CARD).first(),
      'employee home must render its module cards',
    ).toBeVisible({ timeout: 20_000 });

    // The PGR card specifically must survive. Scoped to the CARD element, not
    // to body text: the card's own module name is "Citizen Complaint Resolution
    // System" here, so a loose page-wide /complaint/i match would be satisfied
    // by that heading even if no tile existed — the exact vacuous check this
    // file used to carry. The label is resolved from the deployment's
    // localization store so no English string is pinned.
    const pgrCardLabel = await localizedLabel('ES_PGR_HEADER_COMPLAINT', 'rainmaker-pgr');
    await expect(
      page.locator(MODULE_CARD).filter({ hasText: pgrCardLabel }).first(),
      `PGR module card ("${pgrCardLabel}") must still render on the employee home`,
    ).toBeVisible({ timeout: 20_000 });

    await openSidebarDrawer(page);

    // ---- the #561 / #560 guard ----
    // Deliberately page-wide (not scoped): with the drawer expanded, every
    // surface the employee shell exposes is mounted, and a narrower scope would
    // let a re-added HRMS entry hide just outside it.
    await expect(
      page.getByText(/HRMS/i),
      'CCRS#561 — HRMS must not be exposed in the employee shell (it is managed from the configurator app)',
    ).toHaveCount(0);
    await expect(
      page.getByText(/workbench/i),
      'CCRS#560 — Workbench must not be exposed in the employee shell (it is managed from the configurator app)',
    ).toHaveCount(0);
  });

  test('sidebar drops modules listed in EMPLOYEE_MODULE_DENYLIST', {
    annotation: {
      type: 'description',
      description: `Regression guard for egovernments/CCRS#446: EmployeeSideBar.js filters accesscontrol actions through globalConfigs EMPLOYEE_MODULE_DENYLIST (matching on the first dot-segment of each action's path) before building the drawer.

Why this test injects instead of observing: the deployment's ACCESSCONTROL-ACTIONS-TEST.actions-test master contains ZERO IM/ticket actions, and "IM" is not in the SPA's enabledModules either. A plain "no IM entry is visible" assertion is therefore true for the boring reason and stays green with the #446 fix fully reverted — it measures nothing. So the ACL response is intercepted and two synthetic sidebar actions are added: one whose path root is the deployment's OWN first denylisted module, and one control under a root that is not denylisted.

Steps:
1. Inject an ADMIN employee session and read EMPLOYEE_MODULE_DENYLIST off the live globalConfigs (the fix's deployment half — an empty/missing list fails here).
2. Route-intercept POST /access/v1/actions/mdms/_get and append the two synthetic url:"url" actions.
3. Reload /digit-ui/employee (Digit.RequestCache is in-memory, so a full load re-issues the ACL call) and expand the drawer.
4. Assert the control entry rendered (proves the injection reached the component) and the denylisted entry did not.

Revert the isDeniedModule filter and step 4's first half still passes while the second half goes red — which is what a non-vacuous guard looks like.`,
    },
    tag: ['@area:pgr', '@ccrs:446', '@kind:regression', '@layer:ui', '@persona:employee'] }, async ({ page }) => {
    await loginViaApi(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });

    // The denylist is deployment config, so read it from the deployment rather
    // than assuming ["IM"]. It is also half of the #446 fix: with no list
    // configured the filter is a no-op and there is nothing to assert.
    const denyList = await page.evaluate(
      () => (window as any)?.globalConfigs?.getConfig?.('EMPLOYEE_MODULE_DENYLIST'),
    );
    expect(
      Array.isArray(denyList) && denyList.length > 0,
      `CCRS#446 — globalConfigs.EMPLOYEE_MODULE_DENYLIST must be configured on this deployment; got ${JSON.stringify(denyList)}`,
    ).toBeTruthy();

    const deniedRoot = String((denyList as string[])[0]);
    const controlRoot = 'PWNOTDENIED';
    expect(denyList as string[], 'control root must not itself be denylisted').not.toContain(controlRoot);

    const DENIED_LABEL = `PW Denied ${deniedRoot} Entry`;
    const CONTROL_LABEL = 'PW Control Entry';

    // EmployeeSideBar only builds entries from actions whose `url` is the
    // literal string "url"; the path's first dot-segment is what isDeniedModule
    // matches on. Single-segment paths keep both entries top-level, so they are
    // visible in the expanded drawer without opening a submenu.
    const synthetic = (id: number, path: string, displayName: string) => ({
      id,
      name: displayName,
      url: 'url',
      displayName,
      orderNumber: 900 + id,
      queryParams: '',
      parentModule: '',
      enabled: true,
      serviceCode: '',
      tenantId: ROOT_TENANT,
      path,
      navigationURL: EMPLOYEE_HOME,
      leftIcon: 'action:home',
      rightIcon: '',
    });

    await page.route('**/access/v1/actions/mdms/_get*', async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as { actions?: unknown[] };
      json.actions = [
        ...(json.actions || []),
        synthetic(1, deniedRoot, DENIED_LABEL),
        synthetic(2, controlRoot, CONTROL_LABEL),
      ];
      await route.fulfill({ response, json });
    });

    await page.goto(`${BASE_URL}${EMPLOYEE_HOME}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await openSidebarDrawer(page);

    const labels = page.locator(SIDEBAR_ITEM_LABEL);

    // Control first: if this fails the injection never reached the component
    // and the denylist assertion below would be meaningless.
    await expect(
      labels.filter({ hasText: CONTROL_LABEL }),
      `injection control — an action under a non-denylisted root ("${controlRoot}") must render in the drawer`,
    ).toHaveCount(1);

    await expect(
      labels.filter({ hasText: DENIED_LABEL }),
      `CCRS#446 — an action under denylisted root "${deniedRoot}" must be filtered out of the employee sidebar`,
    ).toHaveCount(0);
  });
});
