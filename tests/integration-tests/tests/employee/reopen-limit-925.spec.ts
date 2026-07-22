import { test, expect, Page } from "@playwright/test";
import { loginViaApi } from "../utils/auth";
import { BASE_URL, TENANT, EMPLOYEE_TENANT, EMPLOYEE_USER, EMPLOYEE_PASS } from "../utils/env";

/**
 * Employee/CSR reopen window (#925).
 *
 * The window is NOT hardcoded here: it is whatever MDMS
 * RAINMAKER-PGR.UIConstants.REOPENSLA says. These tests stub that master and derive every
 * timestamp and expectation from the stubbed value, so they assert the real contract — "the UI
 * honours the configured window" — rather than a particular duration. Deliberately using a
 * window that is not one hour also pins the regression: the old build hardcoded 3600000ms and
 * would fail the in-window case below.
 */

const COMPLAINT_ID = "12345";

// Toast copy is localisation-driven; an env without the key seeded renders the raw key.
// Accept either so the test asserts behaviour, not localisation seeding.
const REOPEN_BLOCKED_MSG = /CS_CANNOT_REOPEN_COMPLAINT_PAST_DEADLINE|window for reopening/i;

/**
 * Stubs RAINMAKER-PGR.UIConstants so the page reads `reopenSlaMs` as its reopen window.
 * Any other MDMS lookup the page makes is passed through to the real stack untouched.
 */
async function stubReopenWindow(page: Page, reopenSlaMs: number) {
  await page.route("**/mdms-v2/v1/_search*", async (route) => {
    const body = route.request().postDataJSON?.();
    const wantsUiConstants = body?.MdmsCriteria?.moduleDetails?.some(
      (m: any) =>
        m?.moduleName === "RAINMAKER-PGR" &&
        m?.masterDetails?.some((d: any) => d?.name === "UIConstants")
    );

    if (!wantsUiConstants) {
      await route.continue();
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        MdmsRes: { "RAINMAKER-PGR": { UIConstants: [{ REOPENSLA: reopenSlaMs }] } },
      }),
    });
  });
}

/**
 * Stubs a RESOLVED complaint whose lastModifiedTime is `resolvedAgoMs` in the past, plus the
 * workflow calls the details page needs to offer REOPEN as a next action.
 */
async function stubResolvedComplaint(page: Page, resolvedAgoMs: number) {
  const lastModifiedTime = Date.now() - resolvedAgoMs;

  await page.route("**/pgr-services/v2/request/_search*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ServiceWrappers: [
          {
            service: {
              tenantId: TENANT,
              serviceRequestId: COMPLAINT_ID,
              serviceCode: "streetlights",
              description: "Streetlight not working",
              applicationStatus: "RESOLVED",
              source: "citizen",
              rating: null,
              address: {
                landmark: "Near school",
                locality: { code: "Locality1" },
                pincode: "123456",
              },
              auditDetails: {
                createdTime: lastModifiedTime - 3600 * 1000,
                lastModifiedTime,
              },
            },
            workflow: { action: "RESOLVE" },
          },
        ],
      }),
    });
  });

  const reopenAction = {
    action: "REOPEN",
    roles: ["GRO", "CSR", "EMPLOYEE", "PGR_LME", "LME", "SUPERUSER", "PGR-ADMIN", "ADMIN"],
    nextState: "PENDINGFORASSIGNMENT",
  };

  await page.route("**/egov-workflow-v2/egov-wf/businessservice/_search*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        BusinessServices: [
          {
            tenantId: TENANT,
            businessService: "PGR",
            states: [
              {
                uuid: "resolved-state-uuid",
                state: "RESOLVED",
                isStateUpdatable: false,
                actions: [reopenAction],
              },
            ],
          },
        ],
      }),
    });
  });

  await page.route("**/egov-workflow-v2/egov-wf/process/_search*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ProcessInstances: [
          {
            id: "wf-12345",
            tenantId: TENANT,
            businessId: COMPLAINT_ID,
            businessService: "PGR",
            action: "RESOLVE",
            state: {
              uuid: "resolved-state-uuid",
              state: "RESOLVED",
              isStateUpdatable: false,
              actions: [reopenAction],
            },
            nextActions: [reopenAction],
            timeline: [],
            auditDetails: {
              createdTime: lastModifiedTime - 3600 * 1000,
              lastModifiedTime,
            },
            assigner: { name: "Jane Doe", mobileNumber: "9800000001" },
          },
        ],
      }),
    });
  });
}

/** Opens the complaint details page as an employee and selects the Re-Open action. */
async function selectReopen(page: Page) {
  const tokenResponse = await loginViaApi(page, {
    tenant: TENANT,
    authTenant: EMPLOYEE_TENANT,
    username: EMPLOYEE_USER,
    password: EMPLOYEE_PASS,
    userType: "EMPLOYEE",
  });

  // loginViaApi only seeds localStorage, but Digit.UserService.getUser() reads the
  // "Digit.User" SessionStorage envelope ({value, ttl, expiry}) — and the details page gates
  // its action bar on those roles. Without this the Take Action button never renders.
  await page.evaluate(
    ({ info, token }) => {
      sessionStorage.setItem(
        "Digit.User",
        JSON.stringify({
          value: { info, access_token: token },
          ttl: 86400,
          expiry: Date.now() + 86400 * 1000,
        })
      );
    },
    { info: tokenResponse.UserRequest ?? {}, token: tokenResponse.access_token }
  );

  await page.goto(`${BASE_URL}/digit-ui/employee/pgr/complaint-details/${COMPLAINT_ID}`);
  await page.waitForLoadState("networkidle");

  // Label is localisation-driven; an env without the key seeded renders the raw key.
  const takeActionButton = page.getByRole("button", { name: /ES_COMMON_TAKE_ACTION|Take Action/i });
  await expect(takeActionButton).toBeVisible();
  await takeActionButton.click();

  const reopenOption = page.locator(".header-dropdown-option").filter({ hasText: /Re-Open/i }).first();
  await expect(reopenOption).toBeVisible();
  await reopenOption.click();
}

test.describe("Employee PGR reopen window is driven by MDMS REOPENSLA #925", () => {
  test("blocks reopen and shows a toast once the configured window has elapsed", {
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:employee'] }, async ({ page }) => {
    test.setTimeout(60_000);

    // 6h window, complaint resolved 9h ago -> outside the window.
    const reopenSlaMs = 6 * 3600 * 1000;
    await stubReopenWindow(page, reopenSlaMs);
    await stubResolvedComplaint(page, reopenSlaMs * 1.5);

    await selectReopen(page);

    const toast = page.locator(".digit-toast-success.digit-error");
    await expect(toast).toBeVisible();
    expect(await toast.innerText()).toMatch(REOPEN_BLOCKED_MSG);

    const closeBtn = toast.locator(".digit-toast-close-btn");
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(toast).not.toBeVisible();
  });

  test("allows reopen while still inside the configured window", {
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:employee'] }, async ({ page }) => {
    test.setTimeout(60_000);

    // 6h window, complaint resolved 2h ago -> inside the window, so reopen must proceed.
    // Under the previous hardcoded 3600000ms (1h) deadline this case was wrongly blocked.
    const reopenSlaMs = 6 * 3600 * 1000;
    await stubReopenWindow(page, reopenSlaMs);
    await stubResolvedComplaint(page, 2 * 3600 * 1000);

    await selectReopen(page);

    // Assert the reopen dialog actually opened. This has to be the positive assertion: the
    // blocked path returns early WITHOUT opening it, so a missing dialog is the real signal.
    // (Asserting "no toast" cannot work here — the page auto-dismisses toasts after 3s, so a
    // retrying toHaveCount(0) would simply wait out the toast and pass either way.)
    await expect(page.locator(".popup-module")).toBeVisible();
  });
});
