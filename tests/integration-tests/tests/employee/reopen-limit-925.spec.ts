import { test, expect } from "@playwright/test";
import { loginViaApi } from "../utils/auth";
import { BASE_URL } from "../utils/env";

test.describe("Employee PGR Reopen Time Window Validation #925", () => {
  test("Reopening complaint past 1 hour limit displays validation toast", async ({ page }) => {
    test.setTimeout(60_000);

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', exception => console.log('PAGE ERROR:', exception.message));
    page.on('request', request => console.log('REQ:', request.method(), request.url()));
    page.on('response', response => console.log('RESP:', response.status(), response.url()));

    // Mock complaint details to return a RESOLVED complaint from 2 hours ago
    await page.route("**/pgr-services/v2/request/_search*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ServiceWrappers: [
            {
              service: {
                tenantId: "mz.maputo",
                serviceRequestId: "12345",
                serviceCode: "streetlights",
                description: "Streetlight not working",
                applicationStatus: "RESOLVED",
                source: "citizen",
                rating: null,
                address: {
                  landmark: "Near school",
                  locality: {
                    code: "Locality1"
                  },
                  pincode: "123456"
                },
                auditDetails: {
                  createdTime: Date.now() - 3 * 3600 * 1000,
                  lastModifiedTime: Date.now() - 2 * 3600 * 1000 // 2 hours ago
                }
              },
              workflow: {
                action: "RESOLVE"
              }
            }
          ]
        })
      });
    });

    // Mock Workflow Service initialization (BusinessServices)
    await page.route("**/egov-workflow-v2/egov-wf/businessservice/_search*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          BusinessServices: [
            {
              tenantId: "mz.maputo",
              businessService: "PGR",
              states: [
                {
                  uuid: "resolved-state-uuid",
                  state: "RESOLVED",
                  isStateUpdatable: false,
                  actions: [
                    {
                      action: "REOPEN",
                      roles: ["GRO", "CSR", "EMPLOYEE", "PGR_LME", "LME", "SUPERUSER", "PGR-ADMIN", "ADMIN"],
                      nextState: "PENDINGFORASSIGNMENT"
                    }
                  ]
                }
              ]
            }
          ]
        })
      });
    });

    // Mock Workflow Process Instance search (Timeline & Actions)
    await page.route("**/egov-workflow-v2/egov-wf/process/_search*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ProcessInstances: [
            {
              id: "wf-12345",
              tenantId: "mz.maputo",
              businessId: "12345",
              businessService: "PGR",
              action: "RESOLVE",
              state: {
                uuid: "resolved-state-uuid",
                state: "RESOLVED",
                isStateUpdatable: false,
                actions: [
                  {
                    action: "REOPEN",
                    roles: ["GRO", "CSR", "EMPLOYEE", "PGR_LME", "LME", "SUPERUSER", "PGR-ADMIN", "ADMIN"],
                    nextState: "PENDINGFORASSIGNMENT"
                  }
                ]
              },
              nextActions: [
                {
                  action: "REOPEN",
                  roles: ["GRO", "CSR", "EMPLOYEE", "PGR_LME", "LME", "SUPERUSER", "PGR-ADMIN", "ADMIN"],
                  nextState: "PENDINGFORASSIGNMENT"
                }
              ],
              timeline: [],
              auditDetails: {
                createdTime: Date.now() - 3 * 3600 * 1000,
                lastModifiedTime: Date.now() - 2 * 3600 * 1000
              },
              assigner: {
                name: "Jane Doe",
                mobileNumber: "9800000001"
              }
            }
          ]
        })
      });
    });

    // Perform API Login as employee (EMP001) for Maputo tenant
    await loginViaApi(page, {
      tenant: "mz.maputo",
      authTenant: "mz.maputo",
      username: "EMP001",
      password: "eGov@123",
      userType: "EMPLOYEE"
    });

    // Navigate to complaint details page
    console.log("Navigating to complaint details page...");
    await page.goto(`${BASE_URL}/digit-ui/employee/pgr/complaint-details/12345`);
    await page.waitForLoadState("networkidle");

    await page.screenshot({ path: "reopen-details-loaded.png" });

    // Find and click the 'Take Action' button
    const takeActionButton = page.getByRole("button", { name: /Take Action/i });
    await expect(takeActionButton).toBeVisible();
    console.log("Clicking Take Action...");
    await takeActionButton.click();

    // Click Reopen action from the menu
    const options = page.locator(".header-dropdown-option");
    const count = await options.count();
    console.log("Found option count:", count);
    for (let i = 0; i < count; i++) {
      console.log(`Option ${i}:`, await options.nth(i).innerText());
    }

    const reopenOption = options.filter({ hasText: /Re-Open/i }).first();
    await expect(reopenOption).toBeVisible();
    console.log("Selecting Reopen option...");
    await reopenOption.click();

    // Verify the validation toast is shown
    console.log("Verifying validation toast...");
    const toast = page.locator(".digit-toast-success.digit-error");
    await expect(toast).toBeVisible();
    
    const toastText = await toast.innerText();
    console.log("Toast text:", toastText);
    expect(toastText).toContain("cannot be reopened after 1 hour");

    await page.screenshot({ path: "reopen-validation-toast.png" });

    // Verify close button is present and functional
    const closeBtn = toast.locator(".digit-toast-close-btn");
    await expect(closeBtn).toBeVisible();
    console.log("Clicking toast close button...");
    await closeBtn.click();
    await expect(toast).not.toBeVisible();
    console.log("Toast successfully dismissed!");
  });
});
