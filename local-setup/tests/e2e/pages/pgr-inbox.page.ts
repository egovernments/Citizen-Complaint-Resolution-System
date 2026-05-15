import { type Page } from '@playwright/test';

export class PgrInboxPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/digit-ui/employee/pgr/inbox', { timeout: 30_000 });
    // Wait for the inbox to render (header or content area)
    // Don't use networkidle — PGR search may poll continuously.
    await this.page.waitForTimeout(8000);
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

  async hasFilterPanel(): Promise<boolean> {
    const filterEl = this.page.locator('.filter, [class*="filter"], [class*="Filter"]');
    return (await filterEl.count()) > 0;
  }

  async hasSearchPanel(): Promise<boolean> {
    const searchEl = this.page.locator('.search-container, [class*="search"]');
    return (await searchEl.count()) > 0;
  }
}
