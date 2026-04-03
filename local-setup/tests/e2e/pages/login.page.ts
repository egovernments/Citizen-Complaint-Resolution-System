import { type Page, type Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly tenantSelect: Locator;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.tenantSelect = page.locator('select').first();
    this.usernameInput = page.getByPlaceholder(/username or email/i);
    this.passwordInput = page.getByPlaceholder(/password/i);
    this.submitButton = page.getByRole('button', { name: /login/i });
  }

  async goto() {
    await this.page.goto('/digit-ui/employee/user/login', { waitUntil: 'networkidle', timeout: 30_000 });
  }

  async waitForReady() {
    await this.passwordInput.waitFor({ state: 'visible', timeout: 45_000 });
    await this.page.waitForTimeout(2000);
  }

  async selectTenant(code: string) {
    if (await this.tenantSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      try {
        await this.tenantSelect.selectOption({ value: code });
      } catch {
        const labelMap: Record<string, string> = {
          'pg.citya': 'City A',
          'pg.cityb': 'City B',
          'pg': 'My Tenant',
        };
        await this.tenantSelect.selectOption({ label: labelMap[code] || code });
      }
    }
  }

  async fillCredentials(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
  }

  async submit() {
    await this.submitButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.page.waitForTimeout(500);
    await this.submitButton.click();
  }

  /** Form-based login with ADMIN/eGov@123 */
  async login(tenant: string, username: string, password: string) {
    await this.goto();
    await this.waitForReady();
    await this.selectTenant(tenant);
    await this.fillCredentials(username, password);
    await this.submit();
  }
}
