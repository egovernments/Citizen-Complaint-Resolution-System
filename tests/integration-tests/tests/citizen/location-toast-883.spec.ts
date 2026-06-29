/**
 * Issue #883 — Location error toast has no close button and never auto-dismisses
 *
 * Scenario:
 *  1. Login as a citizen.
 *  2. Navigate to the map step of the create-complaint wizard.
 *     - Mock the MDMS ComplaintHierarchy call to inject a fake complaint type
 *       so Step 0 has an option to select (Maputo has no types configured yet).
 *  3. Deny geolocation in the browser context.
 *  4. Click the "Locate Me" button → error toast appears.
 *  5. Pre-fix: toast has no close button and sticks forever.
 *     Post-fix: toast shows a close (×) button AND auto-dismisses within 6 s.
 */

import { test, expect } from "@playwright/test";
import { citizenOtpLogin } from "../utils/citizen-login";
import { BASE_URL, generateCitizenPhone } from "../utils/env";

test.describe("citizen complaint location toast #883", () => {
  test("Location error toast has close button and auto-dismisses #883", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);

    // Deny geolocation so "Locate Me" always triggers the error toast
    await context.grantPermissions([]);

    // Mock MDMS ComplaintHierarchy to inject a leaf complaint type
    // so the dropdown in Step 0 has at least one option on any tenant.
    // The serviceDefs are derived from ComplaintHierarchy rows with
    // `department != null || slaHours != null` (isLeaf check).
    await page.route("**/mdms-v2/v1/_search*", async (route) => {
      const resp = await route.fetch();
      let json: any;
      try {
        json = await resp.json();
      } catch {
        await route.continue();
        return;
      }

      const pgrData = json?.MdmsRes?.["RAINMAKER-PGR"] ?? json?.MdmsRes?.["RAINMAKER_PGR"];
      const hasHierarchy =
        Array.isArray(pgrData?.ComplaintHierarchy) && pgrData.ComplaintHierarchy.length > 0;

      if (!hasHierarchy) {
        // Inject minimal hierarchy: one definition + one leaf node
        const pgrKey = json?.MdmsRes?.["RAINMAKER-PGR"] !== undefined
          ? "RAINMAKER-PGR"
          : "RAINMAKER_PGR";

        json.MdmsRes = {
          ...json.MdmsRes,
          [pgrKey]: {
            ...(json.MdmsRes?.[pgrKey] ?? {}),
            ComplaintHierarchyDefinition: [
              { hierarchyType: "TestHier", active: true },
            ],
            ComplaintHierarchy: [
              {
                code: "TestComplaint",
                parentCode: "TestPath",
                active: true,
                hierarchyType: "TestHier",
                // leaf indicator: has department
                department: "TestDept",
                slaHours: 48,
              },
            ],
          },
        };
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(json),
      });
    });

    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    // Navigate to the create-complaint flow
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint/complaint-type`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    // ── Step 0: Complaint Type ──────────────────────────────────────────────
    const clickNext = async () => {
      const btn = page.locator('button:visible').filter({ hasText: /^NEXT$/ }).first();
      await btn.waitFor({ state: "visible", timeout: 10_000 });
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await page.waitForTimeout(2500);
    };

    // Try to pick a complaint type from the dropdown
    const comboboxes = page.locator('button[role="combobox"]');
    const firstCombo = comboboxes.first();
    const comboVisible = await firstCombo.isVisible({ timeout: 5000 }).catch(() => false);

    if (comboVisible) {
      await firstCombo.click();
      await page.waitForTimeout(1000);

      // Check if there are real options
      const optionCount = await page.locator('[role="option"]').count();
      console.log("DROPDOWN_OPTION_COUNT:", optionCount);

      if (optionCount > 0) {
        await page.locator('[role="option"]').first().click();
        await page.waitForTimeout(1000);

        // Check if sub-type appeared
        const subVisible = await comboboxes.nth(1).isVisible({ timeout: 2000 }).catch(() => false);
        if (subVisible) {
          await comboboxes.nth(1).click();
          await page.waitForTimeout(800);
          const subOptions = page.locator('[role="option"]');
          if (await subOptions.count() > 0) {
            await subOptions.first().click();
            await page.waitForTimeout(800);
          }
        }

        // NEXT should now be enabled
        const nextEnabled = await page
          .locator('button').filter({ hasText: /^NEXT$/ }).first()
          .isEnabled().catch(() => false);
        console.log("NEXT_ENABLED:", nextEnabled);

        if (nextEnabled) {
          await clickNext();
        }
      } else {
        // No options — escape and advance via React fiber
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
    }

    // ── Advance to map step if still on step 0 ─────────────────────────────
    // Use __reactFiber approach: find the NEXT button's fiber and walk up to
    // find the CreatePGRFlowV2 component with setStepIndex
    const advanced = await page.evaluate(() => {
      // Find all buttons with text "NEXT"
      const buttons = [...document.querySelectorAll("button")];
      const nextBtn = buttons.find((b) => b.textContent?.trim() === "NEXT");
      if (!nextBtn) return "NO_NEXT_BTN";

      // Get the React fiber key (React 18 uses __reactFiber$xxx)
      const fiberKey = Object.keys(nextBtn).find(
        (k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternals")
      );
      if (!fiberKey) return "NO_FIBER_KEY";

      let fiber = (nextBtn as any)[fiberKey];

      // Walk UP the fiber tree to find the component with stepIndex state
      // that equals 0 (still on first step)
      let attempts = 0;
      while (fiber && attempts < 100) {
        // Check memoizedState chain for a useState(0) that looks like stepIndex
        let hookNode = fiber.memoizedState;
        let hookIdx = 0;
        while (hookNode) {
          // stepIndex is a plain number state (0, 1, 2, 3, 4)
          if (
            typeof hookNode.memoizedState === "number" &&
            hookNode.memoizedState === 0 &&
            hookNode.queue?.dispatch
          ) {
            // Dispatch step change to 1 (map step)
            hookNode.queue.dispatch(1);
            return `DISPATCHED_STEP_1_hookIdx=${hookIdx}`;
          }
          hookNode = hookNode.next;
          hookIdx++;
        }
        fiber = fiber.return; // Walk up
        attempts++;
      }

      return "NOT_FOUND";
    });

    console.log("ADVANCE_RESULT:", advanced);
    await page.waitForTimeout(2000);

    // ── Step 1: Map — find and trigger the "Locate Me" button ────────────
    const locateMeBtn = page.locator('[title="CS_LOCATE_ME"], [title="Locate Me"]').first();

    try {
      await locateMeBtn.waitFor({ state: "visible", timeout: 15_000 });
    } catch {
      await page.screenshot({ path: "debug-map-step.png" });
      const bodyText = await page.locator("body").innerText().catch(() => "?");
      console.log("PAGE_TEXT_SNIPPET:", bodyText.slice(0, 400));
      throw new Error(
        `Could not reach the map step. advance_result=${advanced} URL=${page.url()}`
      );
    }

    console.log("LOCATE_ME_BUTTON_VISIBLE: true");

    // Click it — geolocation is denied, so handleLocateMe's error callback fires
    await locateMeBtn.click();

    // ── Assert: toast appears ─────────────────────────────────────────────
    const toastEl = page.locator(".toast-success.error").first();
    await toastEl.waitFor({ state: "visible", timeout: 10_000 });
    console.log("TOAST_VISIBLE: true");
    console.log("TOAST_TEXT:", await toastEl.innerText().catch(() => "?"));

    // Screenshot of the post-fix state
    await page.screenshot({ path: "pre-fix-bug-screenshot.png", fullPage: false });

    // ── Assert: close button is present ───────────────────────────────────
    // After fix: isDleteBtn={true} → DeleteBtn renders as .toast-close-btn
    const closeBtn = toastEl.locator(".toast-close-btn");
    const hasCloseBtn = await closeBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    console.log("HAS_CLOSE_BUTTON:", hasCloseBtn);

    // ── Assert: toast auto-dismisses within 7 s ───────────────────────────
    let autoDismissed = false;
    try {
      await toastEl.waitFor({ state: "hidden", timeout: 7_000 });
      autoDismissed = true;
    } catch {
      autoDismissed = false;
    }
    console.log("AUTO_DISMISSED_IN_7S:", autoDismissed);

    // Assertions — fail before fix, pass after
    expect(hasCloseBtn, "Error toast should render a close (×) button").toBe(true);
    expect(autoDismissed, "Toast should auto-dismiss within 7 seconds").toBe(true);
  });
});
