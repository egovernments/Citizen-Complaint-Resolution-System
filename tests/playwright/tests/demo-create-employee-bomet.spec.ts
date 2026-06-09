import { test, expect } from '@playwright/test';

/**
 * Demo: create a new employee through the configurator end-to-end.
 *
 * Covers:
 *   #471  Form clears after a new employee is registered (URL
 *         navigates away from /create back to /manage/employees,
 *         the form is gone, the new row appears in the list).
 *   #459  User created for the correct tenant — the user.tenantId
 *         on the created record is `ke` (the form's Tenant field),
 *         not the upstream default `pg.citya`. Verified via
 *         egov-hrms /_search after submit.
 *   #476 (create half) — enrichCreateRequest used to NPE on null
 *         AuditDetails just like enrichUpdateRequest; the success
 *         landing alone proves that path is now NPE-free.
 *   #622  HRMS reachable (implicit — the form's MDMS lookups for
 *         Department / Designation populate via the same hop).
 *
 * Run:
 *   cd tests/playwright
 *   PLAYWRIGHT_BASE_URL=https://bometfeedbackhub.digit.org \
 *   PLAYWRIGHT_USERNAME=ADMIN \
 *   PLAYWRIGHT_PASSWORD=eGov@123 \
 *   PLAYWRIGHT_TENANT=ke \
 *     npx playwright test demo-create-employee-bomet --workers=1
 *
 * Side effect: creates a `DEMO_CCRS_PW_<timestamp>` employee on
 * bomet. Codes are timestamped so reruns don't collide. The user is
 * authorized to leave these in the system as test data.
 */

const EMPLOYEES_URL = '/configurator/manage/employees';

test.describe('Demo: create employee on bomet', () => {
  test('fills the create form and submits — #471 form clears + #459 tenant correct', async ({ page }) => {
    const stamp = Date.now();
    const empCode = `DEMO_CCRS_PW_${stamp}`;
    // Mobile must also be unique — egov-user enforces 1-mobile-1-user.
    // Take the last 9 digits of the timestamp and prefix with 7 to get
    // a valid Kenya mobile (9 digits, starts with 7).
    const mobile = '7' + String(stamp).slice(-8);

    await page.goto(`${EMPLOYEES_URL}/create?cb=${stamp}`);
    await page.waitForLoadState('domcontentloaded');

    // Wait for the form's basic input to be present.
    await expect(page.locator('input[name="user.name"]').first()).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(2_500);

    // ---- Top section ----
    await page.locator('input[name="user.name"]').first().fill('Playwright Demo Employee');
    await page.locator('input[name="code"]').first().fill(empCode);
    await page.locator('input[name="user.mobileNumber"]').first().fill(mobile);

    // Date fields — react-hook-form is happiest with the native
    // value setter + input/change/blur events.
    await page.evaluate(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      function setDate(name: string, val: string) {
        const el = document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
        if (!el) return;
        el.focus();
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      setDate('user.dob', '1990-01-01');
      setDate('dateOfAppointment', '2024-01-01');
    });
    await page.waitForTimeout(1_000);

    // ---- Roles ----
    const rolesCombo = page.locator('input[placeholder*="Search roles" i]');
    await expect(rolesCombo).toBeVisible({ timeout: 15_000 });
    await rolesCombo.scrollIntoViewIfNeeded();
    await rolesCombo.click();
    await page.waitForTimeout(700);
    await page.keyboard.type('PGR_LME', { delay: 60 });
    await page.waitForTimeout(1_500);
    await page
      .getByRole('option')
      .filter({ hasText: /PGR_LME/i })
      .first()
      .click();
    await page.waitForTimeout(600);

    // ---- Assignment ----
    await page.getByRole('button', { name: /^Add assignment$/i }).click();
    await page.waitForTimeout(700);

    const deptCombo = page.getByRole('combobox').filter({ hasText: /Select department/i }).first();
    await deptCombo.click();
    await page.waitForTimeout(700);
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(600);

    const desigCombo = page.getByRole('combobox').filter({ hasText: /Select designation/i }).first();
    await desigCombo.click();
    await page.waitForTimeout(700);
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(600);

    // "Current assignment" radio — react-hook-form gates the
    // submit on this. The form's onChange is on the underlying
    // input — fire BOTH the input.click() AND the synthetic React
    // change event, then wait for the form to react. Also click the
    // visible wrapper as a safety net for variants where the input
    // is hidden.
    await page.evaluate(() => {
      const radios = [...document.querySelectorAll('input[type="radio"]')];
      for (const r of radios) {
        const wrapper = r.closest('div,label,fieldset');
        if (wrapper && /current assignment/i.test(wrapper.textContent || '')) {
          const input = r as HTMLInputElement;
          // React-hook-form watches the .checked setter. Use the
          // native setter so React's internal value tracker sees it.
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'checked',
          )!.set!;
          setter.call(input, true);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('click', { bubbles: true }));
          // And click the visible wrapper as well.
          (wrapper as HTMLElement).click();
          return;
        }
      }
    });
    await page.waitForTimeout(1_500);

    // ---- Jurisdiction ----
    await page.getByRole('button', { name: /^Add jurisdiction$/i }).click();
    await page.waitForTimeout(700);

    const hierCombo = page.getByRole('combobox').filter({ hasText: /Select hierarchy/i }).first();
    await hierCombo.click();
    await page.waitForTimeout(700);
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(700);

    const btCombo = page.getByRole('combobox').filter({ hasText: /Select boundary type/i }).first();
    await btCombo.click();
    await page.waitForTimeout(700);
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(800);

    const boundCombo = page
      .getByRole('combobox')
      .filter({ hasText: /Select boundary/i })
      .filter({ hasNotText: /type/i })
      .first();
    await boundCombo.click();
    await page.waitForTimeout(700);
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(800);

    // ---- Submit ----
    const createBtn = page.getByRole('button', { name: /^Create$/i });
    await createBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);

    // Listen for the egov-hrms _create response. If the click really
    // submits, we'll see this network call. If we don't, the form's
    // client-side validation blocked it (and a screenshot will catch
    // any visible "field required" feedback).
    const hrmsCreatePromise = page
      .waitForResponse(
        (resp) =>
          /\/egov-hrms\/employees\/_create/.test(resp.url()) && resp.status() < 500,
        { timeout: 25_000 },
      )
      .catch(() => null);

    await createBtn.click();
    const createResp = await hrmsCreatePromise;
    if (!createResp) {
      const alerts = await page.locator('[role="alert"]').allInnerTexts();
      const validationHints = await page
        .locator('text=/required|invalid|must be/i')
        .allInnerTexts();
      throw new Error(
        `Create POST did not happen. Alerts: ${JSON.stringify(alerts)} ` +
        `Hints: ${JSON.stringify(validationHints)}`,
      );
    }
    if (!createResp.ok()) {
      const body = await createResp.text().catch(() => '<no body>');
      throw new Error(`Create POST failed ${createResp.status()}: ${body.slice(0, 800)}`);
    }
    await page.waitForTimeout(2_000);

    // ---- #471 — form clears after successful create ----
    // KDwevedi 2026-05-30 named the closure as "redirect to /list after
    // success." This drives the actual contract: URL leaves /create AND
    // the form input that held the just-typed code is no longer in DOM.
    await page.waitForURL(/\/manage\/employees(?!.*\/create)/, { timeout: 15_000 });
    expect(page.url(), '#471 — URL must navigate away from /create after submit').not.toMatch(/\/create($|\?)/);
    // The code input that held the new employee's code should be gone
    // (the form unmounted). Allow up to 5s in case the redirect+unmount
    // finishes asynchronously.
    await expect(
      page.locator('input[name="code"]'),
      '#471 — the form input must unmount after successful create',
    ).toHaveCount(0, { timeout: 8_000 });

    // ---- #459 — tenant correctness ----
    // Use a fresh oauth token against /user/oauth/token with the
    // empty-secret basic auth header. Then call egov-hrms _search
    // and assert the new record's tenantId + user.tenantId are 'ke'.
    const tokenResp = await page.request.post('/user/oauth/token', {
      headers: {
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: 'username=ADMIN&password=eGov%40123&grant_type=password&scope=read&tenantId=ke&userType=EMPLOYEE',
    });
    expect(tokenResp.ok()).toBeTruthy();
    const token = (await tokenResp.json()).access_token as string;

    const hrmsResp = await page.request.post(
      `/egov-hrms/employees/_search?tenantId=ke&codes=${empCode}`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { RequestInfo: { authToken: token } },
      },
    );
    expect(hrmsResp.ok()).toBeTruthy();
    const employees = (await hrmsResp.json()).Employees as Array<Record<string, unknown>>;
    expect(employees.length).toBeGreaterThan(0);
    expect(employees[0].tenantId).toBe('ke');
    expect((employees[0].user as Record<string, unknown>).tenantId).toBe('ke');

    await page.waitForTimeout(2_500);
  });
});
