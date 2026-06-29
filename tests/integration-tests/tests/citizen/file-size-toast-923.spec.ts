/**
 * Issue #923 — File size validation error toast has no close button and never auto-dismisses
 *
 * Scenario:
 *  1. Login as a citizen.
 *  2. Navigate to the photo upload step of the create-complaint wizard.
 *  3. Upload an image exceeding the 2MB size limit.
 *  4. Assert the error toast appears.
 *  5. Assert the toast has a close button (×) and auto-dismisses within 7 seconds.
 */

import { test, expect } from "@playwright/test";
import { citizenOtpLogin } from "../utils/citizen-login";
import { BASE_URL, generateCitizenPhone } from "../utils/env";

test.describe("citizen complaint file upload toast #923", () => {
  test("File too large toast has close button and auto-dismisses #923", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);

    // Force no-cache for overrides.css and other CSS files so we don't get cached styling
    await page.route("**/*.css", async (route) => {
      const response = await route.fetch();
      const headers = {
        ...response.headers(),
        "cache-control": "no-cache, no-store, must-revalidate",
        "pragma": "no-cache",
        "expires": "0",
      };
      await route.fulfill({
        response,
        headers,
      });
    });

    // Mock MDMS ComplaintHierarchy to inject a leaf complaint type so Step 0 has options
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

    const phone = "8888888888";
    await citizenOtpLogin(page, phone);

    // Navigate directly to the create-complaint flow
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint/complaint-type`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    // Force navigation to step 4 (Images step) using React fiber state
    const advanced = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      const nextBtn = buttons.find((b) => b.textContent?.trim() === "NEXT");
      if (!nextBtn) return "NO_NEXT_BTN";

      const fiberKey = Object.keys(nextBtn).find(
        (k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternals")
      );
      if (!fiberKey) return "NO_FIBER_KEY";

      let fiber = (nextBtn as any)[fiberKey];
      let attempts = 0;
      while (fiber && attempts < 100) {
        let hookNode = fiber.memoizedState;
        while (hookNode) {
          if (
            typeof hookNode.memoizedState === "number" &&
            hookNode.memoizedState === 0 &&
            hookNode.queue?.dispatch
          ) {
            // Set stepIndex to 4 (Upload Photos step)
            hookNode.queue.dispatch(4);
            return "DISPATCHED_STEP_4";
          }
          hookNode = hookNode.next;
        }
        fiber = fiber.return;
        attempts++;
      }
      return "NOT_FOUND";
    });

    console.log("ADVANCE_RESULT:", advanced);
    await page.waitForTimeout(3000);

    // Verify we are on the images upload step
    const fileInput = page.locator('input[type="file"]').first();
    try {
      await fileInput.waitFor({ state: "attached", timeout: 15_000 });
    } catch {
      await page.screenshot({ path: "debug-images-step.png" });
      const bodyText = await page.locator("body").innerText().catch(() => "?");
      console.log("PAGE_TEXT_SNIPPET:", bodyText.slice(0, 400));
      throw new Error(`Could not reach the images upload step. advance_result=${advanced}`);
    }

    console.log("IMAGES_STEP_REACHED: true");

    // Upload a 3MB dummy image to trigger file size validation error (> 2MB)
    await fileInput.setInputFiles({
      name: "too-large-photo.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(3 * 1024 * 1024), // 3 MB
    });

    // ── Assert: toast appears ─────────────────────────────────────────────
    const toastEl = page.locator(".toast-success.error").first();
    await toastEl.waitFor({ state: "visible", timeout: 10_000 });
    console.log("TOAST_VISIBLE: true");
    console.log("TOAST_TEXT:", await toastEl.innerText().catch(() => "?"));

    // Take screenshot of the bug/pre-fix state
    await page.screenshot({ path: "pre-fix-bug-screenshot.png", fullPage: false });

    // ── Assert: close button is present ───────────────────────────────────
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

    // Assertions
    expect(hasCloseBtn, "Error toast should render a close (×) button").toBe(true);
    expect(autoDismissed, "Toast should auto-dismiss within 7 seconds").toBe(true);
  });
});
