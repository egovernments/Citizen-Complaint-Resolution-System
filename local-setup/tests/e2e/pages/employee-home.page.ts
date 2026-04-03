import { type Page } from '@playwright/test';

export interface SessionData {
  employeeToken: string | null;
  employeeTenantId: string | null;
  token: string | null;
  employeeUserInfo: Record<string, unknown> | null;
}

export class EmployeeHomePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async waitForLoad() {
    // Wait for URL to settle on /employee (post-login redirect)
    await this.page.waitForURL(/\/employee/, { timeout: 30_000 });
  }

  async getSessionData(): Promise<SessionData> {
    return this.page.evaluate(() => {
      const parse = (v: string | null) => {
        if (!v) return null;
        try { return JSON.parse(v); } catch { return v; }
      };
      // Token is stored in localStorage by KeycloakAuthAdapter
      const employeeToken = localStorage.getItem('Employee.token');
      const employeeTenantId = localStorage.getItem('Employee.tenant-id');
      const employeeUserInfo = parse(localStorage.getItem('Employee.user-info')) as Record<string, unknown> | null;
      return {
        employeeToken,
        employeeTenantId,
        token: employeeToken,
        employeeUserInfo,
      };
    });
  }
}
