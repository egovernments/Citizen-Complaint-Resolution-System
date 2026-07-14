/**
 * Shared helpers for the employee PGR UI specs (inbox filters + workflow
 * lifecycle through the real Take-Action modal).
 *
 * Everything here is tenant-agnostic: service/locality codes are resolved
 * against the live deployment's MDMS/boundary service, personas come from
 * env (EMPLOYEE_USER / GRO_USER / ADMIN_USER), and the login helper auths an
 * employee at whichever tenant (city OR root) actually accepts their
 * credentials — EMP001 on maputo authenticates at the CITY tenant
 * (mz.maputo), ADMIN at the ROOT tenant (mz).
 */
import type { Page } from '@playwright/test';
import { getDigitToken, loginViaApi, type TokenResponse } from './auth';
import { BASE_URL, TENANT, ROOT_TENANT } from './env';

export interface Principal {
  token: string;
  userInfo: Record<string, any>;
  roles: string[];
  /** The tenant the credentials actually authenticated against. */
  authTenant: string;
}

/**
 * Acquire a DIGIT token for an employee, trying the CITY tenant first and
 * falling back to the ROOT tenant. Returns null when neither accepts the
 * credentials (so callers can self-skip with a clear reason).
 */
export async function getPrincipal(username: string, password: string): Promise<Principal | null> {
  for (const authTenant of [TENANT, ROOT_TENANT]) {
    try {
      const resp = await getDigitToken({ tenant: authTenant, authTenant, username, password });
      const userInfo = (resp.UserRequest || {}) as Record<string, any>;
      const roles = (userInfo.roles || []).map((r: any) => r.code as string);
      if (resp.access_token) return { token: resp.access_token, userInfo, roles, authTenant };
    } catch {
      // try next tenant
    }
  }
  return null;
}

/** Log an employee into the browser (localStorage injection) at the tenant
 *  that accepts them. Returns the token response, or null if login failed. */
export async function loginEmployeeBrowser(
  page: Page,
  username: string,
  password: string,
): Promise<TokenResponse | null> {
  const p = await getPrincipal(username, password);
  if (!p) return null;
  return loginViaApi(page, { tenant: TENANT, authTenant: p.authTenant, username, password });
}

/** PGR _search → current applicationStatus for a complaint (or undefined). */
export async function apiStatus(principal: Principal, srid: string): Promise<string | undefined> {
  const j = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${srid}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${principal.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: principal.token, userInfo: principal.userInfo } }),
    },
  ).then((r) => r.json());
  return j?.ServiceWrappers?.[0]?.service?.applicationStatus;
}

/** PGR _search → serviceCode for a complaint (used to verify complaint-type filtering). */
export async function apiServiceCode(principal: Principal, srid: string): Promise<string | undefined> {
  const j = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${srid}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${principal.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: principal.token, userInfo: principal.userInfo } }),
    },
  ).then((r) => r.json());
  return j?.ServiceWrappers?.[0]?.service?.serviceCode;
}

/** Fetch the full service object (needed as the _update body for workflow transitions). */
export async function fetchService(principal: Principal, srid: string): Promise<Record<string, unknown>> {
  const j = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${srid}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${principal.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: principal.token, userInfo: principal.userInfo } }),
    },
  ).then((r) => r.json());
  const service = j?.ServiceWrappers?.[0]?.service;
  if (!service) throw new Error(`fetchService ${srid}: no service in response`);
  return service;
}

/** Drive an APPLYed complaint to REJECTED via API (GRO action). Used to seed
 *  a known-terminal fixture for the status filter + citizen-facing specs. */
export async function apiReject(gro: Principal, srid: string, comment = '[DUPLICATE] seed reject'): Promise<string> {
  const service = await fetchService(gro, srid);
  const r = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${gro.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: gro.token, userInfo: gro.userInfo },
      service,
      workflow: { action: 'REJECT', comments: comment },
    }),
  });
  if (!r.ok) throw new Error(`apiReject ${srid}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j: any = await r.json();
  return j?.ServiceWrappers?.[0]?.service?.applicationStatus;
}

/** Read the visible inbox rows as {srid, locality, status} objects (skips the header row). */
export async function readInboxRows(page: Page): Promise<{ srid: string; locality: string; status: string }[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[role="row"]'));
    const out: { srid: string; locality: string; status: string }[] = [];
    for (const r of rows) {
      const cells = Array.from(r.querySelectorAll('[role="cell"], [role="gridcell"]')) as HTMLElement[];
      if (cells.length < 3) continue; // header row has no data cells
      // Prefix-agnostic SRID: Maputo emits PG-PGR-…, Kenya emits NCCG-PGR-…, etc.
      const m = (cells[0].innerText || '').match(/[A-Z]+-PGR-\d{4}-\d{2}-\d{2}-\d+/);
      if (!m) continue;
      out.push({ srid: m[0], locality: (cells[1].innerText || '').trim(), status: (cells[2].innerText || '').trim() });
    }
    return out;
  });
}

/** Open the Take-Action menu and pick an action by its (localized OR raw-key)
 *  label. The action-bar button itself renders the raw i18n key
 *  ES_COMMON_TAKE_ACTION on mz.maputo, so it is located structurally. */
export async function takeAction(page: Page, actionLabel: RegExp): Promise<void> {
  const btn = page.locator('.digit-action-bar-wrap button, .action-bar-wrap button, footer button').first();
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await page.waitForTimeout(1_200);
  await page.getByText(actionLabel).first().click();
  await page.waitForTimeout(1_500);
}
