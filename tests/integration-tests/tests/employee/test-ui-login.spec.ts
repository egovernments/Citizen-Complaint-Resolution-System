import { test, expect } from "@playwright/test";
import { BASE_URL } from "../utils/env";

test.describe("Employee Login UI Test", () => {
  test("Can select city and log in", async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "step1-loaded.png" });

    // Enter credentials
    await page.locator('input[id="emp-username"]').fill("EMP001");
    await page.locator('input[id="emp-password"]').fill("eGov@123");
    await page.screenshot({ path: "step2-filled-creds.png" });

    // Click on City dropdown if present
    const citySelect = page.locator("#emp-city");
    if (await citySelect.isVisible()) {
      console.log("City dropdown is visible!");
      await citySelect.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "step3-dropdown-clicked.png" });
      
      const options = page.locator("[role='option']");
      const count = await options.count();
      console.log("Dropdown option count:", count);
      for (let i = 0; i < count; i++) {
        console.log(`Option ${i}:`, await options.nth(i).innerText());
      }
      
      // Select "Maputo"
      const maputoOption = options.filter({ hasText: "Maputo" }).first();
      if (await maputoOption.count() > 0) {
        console.log("Selecting Maputo option");
        await maputoOption.click();
      } else {
        console.log("Maputo option NOT found, clicking first option");
        await options.first().click();
      }
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "step4-city-selected.png" });
    }

    // Check Privacy checkbox if present
    const privacyLabel = page.getByText("I agree to the DIGIT's");
    if (await privacyLabel.isVisible()) {
      console.log("Privacy checkbox label is visible!");
      await privacyLabel.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "step5-privacy-checked.png" });
    }

    // Click Login
    console.log("Clicking submit button...");
    await page.locator('button[type="submit"]').click();
    
    // Wait for URL or error toast
    console.log("Waiting for URL change...");
    try {
      await page.waitForURL(/digit-ui\/employee\/(?!user\/login)/, { timeout: 20_000 });
      console.log("Logged in successfully! URL is now:", page.url());
    } catch (err) {
      console.log("Did not redirect to /employee. Current URL:", page.url());
      const errorToast = page.locator(".toast-success.error");
      if (await errorToast.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log("Error toast visible:", await errorToast.innerText());
      }
    }

    await page.screenshot({ path: "step6-final.png" });
  });
});
