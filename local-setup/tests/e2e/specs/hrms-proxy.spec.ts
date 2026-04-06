import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';

/**
 * HRMS proxy integration tests.
 *
 * Verify that the token-exchange-svc correctly rewrites HRMS URLs
 * (adds offset/limit/tenantId) when proxying requests to Kong/egov-hrms.
 * These tests use a real JWT obtained via the BFF /auth/login endpoint.
 */
test.describe('HRMS Proxy', () => {
  let token: string;

  test.beforeAll(async () => {
    // Acquire an ADMIN JWT via the BFF login endpoint
    const resp = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ADMIN',
        password: 'eGov@123',
        tenantId: 'pg.citya',
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`BFF login failed (${resp.status}): ${text}`);
    }

    const data = await resp.json();
    token = data.access_token;
    expect(token).toBeTruthy();
  });

  test('HRMS _count returns employee count without offset/limit in URL', async () => {
    // The proxy should inject offset=0&limit=100&tenantId=pg.citya automatically
    const resp = await fetch(`${BASE_URL}/egov-hrms/employees/_count`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker' },
        criteria: { tenantId: 'pg.citya' },
      }),
    });

    expect(resp.status).toBeLessThan(500);

    const body = await resp.text();
    // HRMS _count responds with EmployeCount containing totalEmployee
    expect(body).toContain('totalEmployee');
  });

  test('HRMS _search returns employee data without offset/limit in URL', async () => {
    const resp = await fetch(`${BASE_URL}/egov-hrms/employees/_search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker' },
        criteria: { tenantId: 'pg.citya' },
      }),
    });

    expect(resp.status).toBeLessThan(500);

    const data = await resp.json();
    // HRMS _search returns Employees array
    expect(data).toHaveProperty('Employees');
    expect(Array.isArray(data.Employees)).toBe(true);
  });

  test('HRMS _search response contains employee records', async () => {
    const resp = await fetch(`${BASE_URL}/egov-hrms/employees/_search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker' },
        criteria: { tenantId: 'pg.citya' },
      }),
    });

    expect(resp.status).toBeLessThan(500);

    const data = await resp.json();
    expect(data.Employees.length).toBeGreaterThan(0);

    // Verify structure of the first employee record
    const emp = data.Employees[0];
    expect(emp).toHaveProperty('user');
    expect(emp.user).toHaveProperty('userName');
    expect(emp.user).toHaveProperty('tenantId');
  });

  test('HRMS _search with explicit offset/limit preserves them', async () => {
    const resp = await fetch(
      `${BASE_URL}/egov-hrms/employees/_search?offset=0&limit=1&tenantId=pg.citya`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          RequestInfo: { apiId: 'Rainmaker' },
          criteria: { tenantId: 'pg.citya' },
        }),
      },
    );

    expect(resp.status).toBeLessThan(500);

    const data = await resp.json();
    expect(data).toHaveProperty('Employees');
    // With limit=1, should get at most 1 employee
    expect(data.Employees.length).toBeLessThanOrEqual(1);
  });
});
