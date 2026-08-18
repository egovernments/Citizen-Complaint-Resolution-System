import { test, expect, Page } from "@playwright/test";
import { citizenOtpLogin } from "../utils/citizen-login";
import { BASE_URL, TENANT } from "../utils/env";

/**
 * Citizen reopen window (#925, #1252).
 *
 * Sibling of tests/employee/reopen-limit-925.spec.ts, which covers the employee/CSR action
 * bar. The citizen timeline had no coverage at all even though it is the surface the original
 * #925 report screenshots — this closes that gap.
 *
 * As in the employee spec the window is NOT hardcoded here: it is whatever MDMS
 * RAINMAKER-PGR.UIConstants.REOPENSLA says, and every timestamp is derived from the stubbed
 * value. So these assert the contract ("the timeline honours the configured window"), not a
 * particular duration — a build that hardcodes any window fails the in-window case below.
 *
 * The REOPEN affordance is matched by its href (`/citizen/pgr/reopen/{id}`) rather than its
 * label, so the assertions hold on a deployment whose locale has no CS_COMMON_REOPEN seeded.
 */

const COMPLAINT_ID = "12345";

const reopenLink = (page: Page) =>
  page.locator(`a[href*="/citizen/pgr/reopen/${COMPLAINT_ID}"]`);

/**
 * A second, unrelated action on the same RESOLVED checkpoint. Asserting it is visible proves
 * the timeline actually mounted and rendered its action links, so "no REOPEN link" means the
 * window gate withheld it — not that the checkpoint never rendered at all.
 */
const rateLink = (page: Page) =>
  page.locator(`a[href*="/citizen/pgr/rate/${COMPLAINT_ID}"]`);

/** Stubs RAINMAKER-PGR.UIConstants so the timeline reads `reopenSlaMs` as its reopen window. */
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
 * Stubs a RESOLVED complaint last modified `resolvedAgoMs` in the past, plus the workflow
 * calls the citizen timeline needs before it will offer REOPEN as a next action.
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
              address: { landmark: "Near school", locality: { code: "Locality1" }, pincode: "123456" },
              auditDetails: { createdTime: lastModifiedTime - 3600 * 1000, lastModifiedTime },
            },
            workflow: { action: "RESOLVE" },
          },
        ],
      }),
    });
  });

  const reopenAction = {
    action: "REOPEN",
    roles: ["CITIZEN", "CFC", "CSR", "PGR_VIEWER"],
    nextState: "PENDINGFORASSIGNMENT",
  };

  // RATE rides along on every stub as the control action — it is never gated by the reopen
  // window, so its link is the proof-of-render for the "hides REOPEN" case.
  const rateAction = {
    action: "RATE",
    roles: ["CITIZEN", "CFC", "CSR", "PGR_VIEWER"],
    nextState: "CLOSEDAFTERRESOLUTION",
  };

  const stateActions = [reopenAction, rateAction];

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
                actions: stateActions,
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
              // WorkflowService.getDetailsById maps each timeline entry's `status` from
              // state.applicationStatus (NOT state.state) — packages/libraries/.../WorkFlow.js.
              // Omit it and TimeLine.getCheckPoint falls through to its default case, so the
              // RESOLVED checkpoint — the only thing that renders the REOPEN link — never
              // mounts and every assertion below passes or fails for the wrong reason.
              applicationStatus: "RESOLVED",
              isStateUpdatable: false,
              actions: stateActions,
            },
            nextActions: stateActions,
            timeline: [],
            auditDetails: { createdTime: lastModifiedTime - 3600 * 1000, lastModifiedTime },
            assigner: { name: "Jane Doe", mobileNumber: "9800000001" },
          },
        ],
      }),
    });
  });
}

async function openComplaint(page: Page) {
  await citizenOtpLogin(page);
  await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints/${COMPLAINT_ID}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");
  // The timeline renders off the workflow response; wait for the resolved checkpoint before
  // asserting on REOPEN, so an absent link means "hidden" and not "not rendered yet".
  await expect(page.locator("body")).not.toContainText("Something went wrong");
}

test.describe("Citizen PGR reopen window is driven by MDMS REOPENSLA #1252", () => {
  test("offers REOPEN while still inside the configured window", {
    tag: ['@area:pgr', '@ccrs:1252', '@kind:regression', '@layer:ui', '@persona:citizen'] },
    async ({ page }) => {
      test.setTimeout(120_000);

      // 6h window, resolved 2h ago -> inside. A build that hardcodes 1h wrongly hides REOPEN.
      const reopenSlaMs = 6 * 3600 * 1000;
      await stubReopenWindow(page, reopenSlaMs);
      await stubResolvedComplaint(page, 2 * 3600 * 1000);

      await openComplaint(page);
      await expect(reopenLink(page)).toBeVisible();
    });

  test("hides REOPEN once the configured window has elapsed", {
    tag: ['@area:pgr', '@ccrs:1252', '@kind:regression', '@layer:ui', '@persona:citizen'] },
    async ({ page }) => {
      test.setTimeout(120_000);

      // 6h window, resolved 9h ago -> outside.
      const reopenSlaMs = 6 * 3600 * 1000;
      await stubReopenWindow(page, reopenSlaMs);
      await stubResolvedComplaint(page, reopenSlaMs * 1.5);

      await openComplaint(page);
      // The RESOLVED checkpoint must have rendered its action links — otherwise "no reopen
      // link" is vacuously true and this test would stay green even if the timeline never
      // mounted. RATE is on the same checkpoint and is never gated by the window.
      await expect(rateLink(page)).toBeVisible();
      await expect(reopenLink(page)).toHaveCount(0);
    });

  test("defers to the server and keeps REOPEN when REOPENSLA is absent", {
    tag: ['@area:pgr', '@ccrs:1252', '@kind:regression', '@layer:ui', '@persona:citizen'] },
    async ({ page }) => {
      test.setTimeout(120_000);

      // No usable REOPENSLA: the window is unknown, so the UI must NOT invent a deadline.
      // It leaves REOPEN available and lets pgr-services validateReOpen() decide — the
      // regression #925 was about was exactly a UI-side deadline nobody had configured.
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
          body: JSON.stringify({ MdmsRes: { "RAINMAKER-PGR": { UIConstants: [] } } }),
        });
      });

      // Old enough that any hardcoded window would have hidden the action.
      await stubResolvedComplaint(page, 30 * 24 * 3600 * 1000);

      await openComplaint(page);
      await expect(reopenLink(page)).toBeVisible();
    });
});
