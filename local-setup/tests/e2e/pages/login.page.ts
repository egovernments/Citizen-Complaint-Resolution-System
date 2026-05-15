import { type Page, type Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly cityDropdownInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.locator('input[name="username"]');
    this.passwordInput = page.locator('input[name="password"]');
    this.submitButton = page.locator('button[type="submit"]').first();
    // DIGIT uses a custom div-based dropdown for city selection
    this.cityDropdownInput = page.locator('#user-login-core_common_city');
  }

  async goto() {
    await this.page.goto('/digit-ui/employee/user/login', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  }

  async waitForReady() {
    await this.usernameInput.waitFor({ state: 'visible', timeout: 45_000 });
    await this.page.waitForTimeout(2000);
  }

  async selectTenant(code: string) {
    // DIGIT's city picker is a custom dropdown (not <select>).
    // Click the input to open the options panel, then click the matching item.
    const dropdownVisible = await this.cityDropdownInput.isVisible({ timeout: 3000 }).catch(() => false);
    if (!dropdownVisible) return;

    await this.cityDropdownInput.click();
    await this.page.waitForTimeout(500);

    // The localization key for a tenant code like "uitest.city1" is
    // TENANT_TENANTS_UITEST_CITY1 (uppercase, dots→underscores).
    const locKey = 'TENANT_TENANTS_' + code.toUpperCase().replace(/\./g, '_');

    // Find the option whose .main-option span text matches exactly.
    // Using text-is() for exact match to avoid "UITEST" matching "UITEST_CITY1".
    const allOptions = this.page.locator('.digit-dropdown-item');
    const count = await allOptions.count();

    let clicked = false;
    let prefixMatch = -1;
    for (let i = 0; i < count; i++) {
      const optText = (await allOptions.nth(i).locator('.main-option').innerText()).trim();
      if (optText === locKey || optText === code) {
        await allOptions.nth(i).click();
        clicked = true;
        break;
      }
      // Track first prefix match (e.g. TENANT_TENANTS_UITEST matches TENANT_TENANTS_UITEST_CITYA)
      if (prefixMatch < 0 && optText.startsWith(locKey + '_')) {
        prefixMatch = i;
      }
    }
    if (!clicked && prefixMatch >= 0) {
      await allOptions.nth(prefixMatch).click();
      clicked = true;
    }
    if (!clicked && count > 0) {
      await allOptions.first().click();
    }

    await this.page.waitForTimeout(500);
  }

  async fillCredentials(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
  }

  async submit() {
    // DIGIT's privacy checkbox is a React-controlled component wrapped in
    // overlapping elements. Use dispatchEvent to trigger React's synthetic
    // click handler without actionability issues.
    const privacyCheckbox = this.page.locator('#privacy-component-check');
    if (await privacyCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await privacyCheckbox.dispatchEvent('click');
      await this.page.waitForTimeout(500);
    }

    await this.submitButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.page.waitForTimeout(500);
    // Use click() with force:true instead of dispatchEvent('click') because
    // non-trusted events don't trigger native form submission on <button type="submit">.
    await this.submitButton.click({ force: true });
  }

  async login(tenant: string, username: string, password: string) {
    await this.goto();
    await this.waitForReady();
    await this.selectTenant(tenant);
    await this.fillCredentials(username, password);
    await this.submit();
  }
}
