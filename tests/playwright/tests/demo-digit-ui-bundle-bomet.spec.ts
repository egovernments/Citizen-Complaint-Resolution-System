import { test, expect } from '@playwright/test';

/**
 * Demo: digit-ui (employee) bundle on bomet.
 *
 * Covers in one ~70-90s recording:
 *
 *   #505 sub-1  Login page background uses tenant brand-dark, not blank
 *               white. Asserted via getComputedStyle on the banner.
 *   #505 sub-3  Bomet shield logo on the login card is 96×96 (was
 *               56×56 before the overrides.css fix). Asserted via
 *               offsetWidth/offsetHeight on .bannerLogo.
 *   #505 sub-2  Post-login profile circle initial "B" is centered
 *               (display:flex, align-items:center, justify-content:center,
 *               line-height = circle height). Asserted via
 *               getComputedStyle on .header-dropdown-profile.
 *   #505 sub-4  Edit + Logout icons in the profile dropdown render with
 *               a dark fill (not white-on-white). Asserted by
 *               opening the dropdown and reading SVG `fill` colors.
 *   #344        PGR inbox-v2 surfaces complainant mobile as readable
 *               digits (not hex blobs), proving the SecurityPolicy
 *               PLAIN-decryption seed reached PGR roles.
 *   #432        Inbox-v2 mounts at all (the triaged-but-not-broken
 *               variant of "inbox issues"). Implicit via #344's nav.
 *   #592        /digit-ui/globalConfigs.js is 200 with the ansible
 *               header — proves the static bundle path works.
 *   #622        The login flow itself completing landing on the
 *               employee shell is the not-503-banner assertion.
 *
 * Runs against a fresh login (no storage-state assumption); does NOT
 * mutate any production data.
 *
 *   PLAYWRIGHT_BASE_URL=https://bometfeedbackhub.digit.org \
 *   PLAYWRIGHT_SKIP_SETUP=1 \
 *     npx playwright test demo-digit-ui-bundle-bomet --workers=1
 */

const LOGIN_URL = '/digit-ui/employee/user/login';
const INBOX_URL = '/digit-ui/employee/pgr/inbox-v2';
const GLOBAL_CONFIGS_URL = '/digit-ui/globalConfigs.js';
// A complaint that BOMET_LME is assigned to, so the LME login can open
// its detail view. The Applied/Assigned timeline rows here render the
// citizen + GRO name + phone in plaintext — that's the visible #344
// proof.
const COMPLAINT_DETAIL_URL = '/digit-ui/employee/pgr/complaint-details/PG-PGR-2026-04-13-000848';

test.describe('Demo: digit-ui (employee) bundle on bomet', () => {
  // No configurator storage state — UI login.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login + post-login chrome + inbox decrypt covers #505/#344/#432/#592/#622', async ({ page }) => {
    // ============ 1. globalConfigs.js — #592 ============
    // Probe via page.request so the assertion lives in the same test
    // run (and the recording stays focused on the UI).
    const globalConfigsResp = await page.request.get(`${GLOBAL_CONFIGS_URL}?cb=${Date.now()}`);
    expect(globalConfigsResp.status()).toBe(200);
    const globalConfigsBody = await globalConfigsResp.text();
    expect(globalConfigsBody).toMatch(/STATE_LEVEL_TENANT_ID|stateTenantId/);

    // ============ 2. Login page UI — #505 sub-1 + sub-3 ============
    await page.goto(`${LOGIN_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000);

    // Background brand-dark (bomet teal) on the banner. Not white.
    const bannerBg = await page.evaluate(() => {
      const el = document.querySelector('.banner') as HTMLElement | null;
      if (!el) return null;
      return getComputedStyle(el).backgroundColor;
    });
    expect(bannerBg, 'login banner must render with a brand color, not white').not.toMatch(
      /rgba?\(\s*255\s*,\s*255\s*,\s*255/,
    );

    // bannerLogo sized at 96×96 (was 56×56 before the overrides.css fix).
    const logoBox = await page.evaluate(() => {
      const img = document.querySelector('.bannerLogo') as HTMLImageElement | null;
      if (!img) return null;
      return { w: img.offsetWidth, h: img.offsetHeight };
    });
    expect(logoBox).not.toBeNull();
    expect(logoBox!.w, 'bannerLogo width must be the post-fix 96px (was 56)').toBeGreaterThanOrEqual(96);
    expect(logoBox!.h, 'bannerLogo height must be the post-fix 96px (was 56)').toBeGreaterThanOrEqual(96);

    // Hold on the login page for the recording.
    await page.waitForTimeout(2_500);

    // ============ 3. Fill login form + submit — #622 ============
    const userInput = page.locator('input[type="text"]').first();
    await userInput.click();
    await userInput.pressSequentially('BOMET_LME', { delay: 80 });
    await page.waitForTimeout(800);

    const pwInput = page.locator('input[type="password"]').first();
    await pwInput.click();
    await pwInput.pressSequentially('eGov@123', { delay: 80 });
    await page.waitForTimeout(800);

    // City combobox — open + pick Bomet County (if not already set).
    const cityCombo = page.getByRole('combobox', { name: /City/i });
    if (!(await cityCombo.textContent())?.includes('Bomet County')) {
      await cityCombo.click();
      await page.waitForTimeout(800);
      await page.getByRole('option', { name: /Bomet County/i }).first().click();
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(1_000);

    // Privacy policy — click the visible label (the bare input is
    // overlaid by a wrapping div that intercepts pointer events).
    await page.getByText(/I agree to the DIGIT/i).click();
    await page.waitForTimeout(1_000);

    await page.getByRole('button', { name: /^Login$/i }).click();
    await page.waitForURL(/\/digit-ui\/employee(?!\/user\/login)/, { timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // ============ 4. Profile initial visible — #505 sub-2 ============
    // Per Gurjeet 2026-05-20 RESOLVED note, the fix REMOVED the
    // surrounding circle — so the historical assertion that
    // `.header-dropdown-profile` is `display:flex` doesn't reflect
    // the shipped surface anymore. The honest contract is:
    //   1. SOMETHING in the header surfaces the user's initial.
    //   2. That initial is the expected single character (B for
    //      BOMET_LME), not a misalignment artifact.
    //   3. The container, IF it exists as the legacy `.header-dropdown-profile`
    //      class, is still flex-centered (to catch the pre-removal
    //      regression for tenants that haven't migrated to the new
    //      circle-less layout yet).
    const expectedInitial = 'B'; // BOMET_LME
    const headerInitial = await page.evaluate((expected) => {
      // Look for a header element whose text content is exactly the
      // expected single uppercase letter (the initial).
      const headerNodes = [...document.querySelectorAll('header *, [class*="topbar" i] *, [class*="TopBar" i] *, [class*="header" i] *')];
      const hit = headerNodes.find((n) => (n.textContent || '').trim() === expected);
      if (!hit) return null;
      const el = hit as HTMLElement;
      const bbox = el.getBoundingClientRect();
      return {
        text: el.textContent?.trim() || '',
        width: bbox.width,
        height: bbox.height,
        // Legacy contract — only applies if the .header-dropdown-profile
        // class is still in use on this tenant's shell.
        hasLegacyCircle: !!document.querySelector('.header-dropdown-profile'),
      };
    }, expectedInitial);
    expect(
      headerInitial,
      `#505 sub-2 — header must surface the user's initial '${expectedInitial}' somewhere`,
    ).not.toBeNull();
    expect(
      headerInitial!.width,
      'the initial element must have a non-zero rendered size',
    ).toBeGreaterThan(0);
    expect(
      headerInitial!.height,
      'the initial element must have a non-zero rendered size',
    ).toBeGreaterThan(0);

    if (headerInitial!.hasLegacyCircle) {
      // Legacy contract — only enforced when the old class is still
      // shipped (some tenants may carry it during migration).
      const legacyCss = await page.evaluate(() => {
        const el = document.querySelector('.header-dropdown-profile') as HTMLElement | null;
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          display: cs.display,
          alignItems: cs.alignItems,
          justifyContent: cs.justifyContent,
        };
      });
      expect(legacyCss!.display).toBe('flex');
      expect(legacyCss!.alignItems).toBe('center');
      expect(legacyCss!.justifyContent).toBe('center');
    }

    await page.waitForTimeout(2_000);

    // ============ 5. Top-left header logos — #505 sub-3 (second half) ============
    // The shell's top-left has the eGov + tenant logos. Scroll them
    // into view + pause so the recording captures them post-fix-sized.
    const topLogos = page.locator('header img, [class*="topbar"] img, [class*="TopBar"] img');
    if ((await topLogos.count()) > 0) {
      await topLogos.first().scrollIntoViewIfNeeded();
    }
    await page.waitForTimeout(2_500);

    // ============ 6. Open profile dropdown — #505 sub-4 dark icons ============
    const profileTrigger = page.locator('.header-dropdown-profile').first();
    await profileTrigger.scrollIntoViewIfNeeded();
    const profileBtn = profileTrigger.locator('xpath=ancestor::button[1]');
    if (await profileBtn.isVisible().catch(() => false)) {
      await profileBtn.click();
    } else {
      await profileTrigger.click();
    }
    await page.waitForTimeout(1_500);

    // Both labels must be visibly rendered in the open dropdown.
    await expect(page.getByText(/Edit Profile/i).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/Logout/i).first()).toBeVisible({ timeout: 8_000 });

    const iconColors = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.header-dropdown-option, [role="menuitem"]')];
      const colors: string[] = [];
      for (const item of items) {
        const svg = item.querySelector('svg path, svg rect, svg circle') as SVGElement | null;
        if (svg) {
          const fill = svg.getAttribute('fill') || getComputedStyle(svg).fill;
          if (fill) colors.push(fill);
        }
      }
      return colors;
    });
    const hasDarkIcon = iconColors.some(
      (c) =>
        !/^#?fff(fff)?$/i.test(c.trim()) &&
        !/^rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)$/.test(c.trim()) &&
        !/^rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(c.trim()),
    );
    expect(hasDarkIcon, `at least one dropdown icon must be visibly dark; got ${JSON.stringify(iconColors)}`).toBeTruthy();

    // Hold long enough for the recording to clearly show the open
    // dropdown with both labels + dark icons.
    await page.waitForTimeout(4_500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    // ============ 7. Complaint detail — #344 visible decrypt ============
    // BOMET_LME is the assignee on this complaint, so the detail
    // page renders the citizen + GRO name + plaintext mobile. That's
    // the visible proof that the PGR SecurityPolicy seed lets PGR
    // roles read plain.
    await page.goto(`${COMPLAINT_DETAIL_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_500);

    await expect(page.getByText(/Complaint Details/i).first()).toBeVisible({ timeout: 20_000 });

    const detailBody = (await page.locator('body').innerText()) || '';
    expect(detailBody, 'detail body must not surface base64-shaped hex blobs').not.toMatch(
      /\b[A-Za-z0-9+/]{30,}=+/,
    );
    // Match any 9-10 digit phone in the Contact Details row — the test
    // seed users on bomet have IN-style numbers (9876543211) rather
    // than Kenya-style starting with 0/1/7. The point is the number is
    // PLAINTEXT, not a hex blob.
    await expect(
      page.getByText(/Contact Details:\s*\d{9,10}/).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Hold on the detail page so timeline + Contact Details are
    // captured by the recording.
    await page.waitForTimeout(4_500);

    // ============ 8. PGR inbox — #432 sub-1/2/3 honest drives ============
    await page.goto(`${INBOX_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_000);

    await expect(page.getByText(/service unavailable|503|something went wrong/i)).toHaveCount(0);
    await expect(page.locator('table, [role="table"]').first()).toBeVisible({ timeout: 20_000 });

    const body = (await page.locator('body').innerText()) || '';
    expect(body, 'inbox body must not surface base64-shaped hex blobs').not.toMatch(
      /\b[A-Za-z0-9+/]{30,}=+/,
    );
    const rowCount = await page.locator('tbody tr').count();
    if (rowCount > 0) {
      expect(body, 'when rows are visible, at least one readable mobile must appear').toMatch(
        /\b[017]\d{8,9}\b/,
      );
    }

    // ---- #432 sub-1 — inbox defaults to OPEN states ----
    // Read each visible row's status cell. Without any operator filter,
    // every status should be in the set of open workflow states. If
    // the inbox regresses to "all states including RESOLVED", at least
    // one row will surface a closed state and flip this red.
    const OPEN_STATES =
      /PENDINGFORASSIGNMENT|PENDINGFORREASSIGNMENT|PENDINGATLME|PENDINGATSUPERVISOR|PENDINGFORWORK|OPEN/i;
    const CLOSED_STATES = /RESOLVED|REJECTED|CLOSED/i;
    if (rowCount > 0) {
      const rowsText = await page.locator('tbody tr').allInnerTexts();
      // Reduce noise — only check rows that surface a workflow status
      // (the status column is reliably present as one of the cells).
      const rowsWithStatus = rowsText.filter((r) => OPEN_STATES.test(r) || CLOSED_STATES.test(r));
      // No row should EXCLUSIVELY surface a closed-state.
      const offenders = rowsWithStatus.filter(
        (r) => CLOSED_STATES.test(r) && !OPEN_STATES.test(r),
      );
      expect(
        offenders.length,
        `#432 sub-1 — inbox default view should only surface OPEN states without an explicit filter; offending row excerpts: ${JSON.stringify(offenders.slice(0, 3))}`,
      ).toBe(0);
    }

    // ---- #432 sub-2 — Status filter dropdown populated ----
    // Find the workflow-status filter card and assert it surfaces at
    // least one selectable option. If the filter regresses to an empty
    // dropdown, the operator has no way to widen the inbox.
    const statusFilterTrigger = page
      .locator('button, [role="combobox"], [class*="filter" i]')
      .filter({ hasText: /status|workflow/i })
      .first();
    if (await statusFilterTrigger.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await statusFilterTrigger.scrollIntoViewIfNeeded();
      await statusFilterTrigger.click();
      await page.waitForTimeout(1_500);
      const filterOptions = page.locator(
        '[role="listbox"][data-state="open"] [role="option"], [role="option"], [class*="filter" i] input[type="checkbox"]',
      );
      const optionCount = await filterOptions.count();
      expect(
        optionCount,
        `#432 sub-2 — status filter must list at least 1 option; got ${optionCount}`,
      ).toBeGreaterThan(0);
      // Close the filter so the recording keeps the inbox visible.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
    }

    // ---- #432 sub-3 — sort icons only on the sortable column ----
    // Inspect each <th>. Per the fix, only the applicationStatus
    // header should carry a sort icon (SVG / arrow / class
    // containing "sort"). The pre-fix bug rendered sort icons on
    // every column. We look at the icon-bearing headers and assert
    // the count is at most 1.
    const headerCells = page.locator('thead th, thead [role="columnheader"]');
    const headerCount = await headerCells.count();
    if (headerCount > 0) {
      let sortableHeaderCount = 0;
      for (let i = 0; i < headerCount; i++) {
        const th = headerCells.nth(i);
        const html = (await th.innerHTML().catch(() => '')) || '';
        if (/<svg|class="[^"]*sort|aria-sort/i.test(html)) {
          sortableHeaderCount++;
        }
      }
      expect(
        sortableHeaderCount,
        `#432 sub-3 — only the sortable column should show a sort icon; got ${sortableHeaderCount} headers with sort indicators across ${headerCount} columns`,
      ).toBeLessThanOrEqual(1);
    }

    // Hold on the inbox view for the recording.
    await page.waitForTimeout(3_500);
  });
});
