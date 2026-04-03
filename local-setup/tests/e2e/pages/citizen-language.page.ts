import { type Page, type Locator } from '@playwright/test';

export class CitizenLanguagePage {
  readonly page: Page;
  readonly continueButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.continueButton = page.getByText('Continue', { exact: false });
  }

  async goto() {
    await this.page.goto('/digit-ui/citizen');
  }

  async waitForReady() {
    await this.page.waitForLoadState('networkidle', { timeout: 30_000 });
  }

  async clickContinue() {
    await this.continueButton.click();
  }
}
