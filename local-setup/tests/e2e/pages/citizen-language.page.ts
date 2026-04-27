import { type Page, type Locator } from '@playwright/test';

export class CitizenLanguagePage {
  readonly page: Page;
  readonly continueButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.continueButton = page.locator('button:has-text("Continue")').first();
  }

  async goto() {
    await this.page.goto('/digit-ui/citizen');
  }

  async waitForReady() {
    // Don't use networkidle — DIGIT UI makes continuous background requests.
    // Wait for the Continue button to appear instead.
    await this.continueButton.waitFor({ state: 'visible', timeout: 30_000 });
  }

  async clickContinue() {
    await this.continueButton.click();
  }
}
