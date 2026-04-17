import { type Page } from '@playwright/test';

export class HrmsInboxPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/digit-ui/employee/hrms/inbox', {
      timeout: 30_000,
    });
    // HRMS inbox loads employee list async
    await this.page.waitForTimeout(8000);
  }

  async getBodyText(): Promise<string> {
    return this.page.locator('body').innerText();
  }

  async searchByName(name: string) {
    const searchInput = this.page.locator('input[type="text"]').first();
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill(name);
      await this.page.waitForTimeout(500);
      // Click search button
      const searchBtn = this.page.locator('button:has-text("Search"), button[type="submit"]').first();
      if (await searchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await searchBtn.click();
      }
      await this.page.waitForTimeout(5000);
    }
  }

  async searchByPhone(phone: string) {
    // HRMS inbox may have multiple search fields — phone is typically 2nd
    const inputs = this.page.locator('input[type="text"]');
    const count = await inputs.count();
    if (count > 1) {
      await inputs.nth(1).fill(phone);
    } else if (count > 0) {
      await inputs.first().fill(phone);
    }
    await this.page.waitForTimeout(500);
    const searchBtn = this.page.locator('button:has-text("Search"), button[type="submit"]').first();
    if (await searchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchBtn.click();
    }
    await this.page.waitForTimeout(5000);
  }

  async hasEmployee(nameOrCode: string): Promise<boolean> {
    const bodyText = await this.getBodyText();
    return bodyText.includes(nameOrCode);
  }
}
