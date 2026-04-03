import { type Page } from '@playwright/test';

export class PgrInboxPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/digit-ui/employee/pgr/inbox-v2');
    // Wait for the page to have meaningful content (async MDMS load)
    await this.page.waitForLoadState('networkidle', { timeout: 30_000 });
  }

  async getBodyText(): Promise<string> {
    return this.page.locator('body').innerText();
  }

  async hasComplaintNumbers(): Promise<boolean> {
    const text = await this.getBodyText();
    return /PG-PGR-/.test(text);
  }

  async hasStatusBadges(): Promise<boolean> {
    const text = await this.getBodyText();
    return /PENDING|ASSIGNED|REJECTED|RESOLVED|CLOSED/i.test(text);
  }

  async getComplaintLinks(): Promise<string[]> {
    const links = this.page.locator('a[href*="pgr/complaint"]');
    const hrefs: string[] = [];
    for (const link of await links.all()) {
      const href = await link.getAttribute('href');
      if (href) hrefs.push(href);
    }
    return hrefs;
  }
}
