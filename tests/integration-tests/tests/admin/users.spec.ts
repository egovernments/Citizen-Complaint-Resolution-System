/**
 * User management — list / show / create / edit.
 *
 * UserList / UserCreate / UserEdit are a thin wrapper over egov-user:
 *   - GET list: POST /user/_search  (requires at least one filter; the
 *     configurator defaults to roleCodes=['CITIZEN'] when none is set)
 *   - CREATE : POST /user/users/_createnovalidate
 *   - UPDATE : POST /user/users/_updatenovalidate
 *   - GET ONE: /user/_search with uuid
 *
 * Teardown: egov-user has no delete, so we soft-deactivate by setting
 * `active=false` via _updatenovalidate. Done inline here — not added to
 * helpers/teardown.ts to keep the shared helper surface small and
 * MDMS-/PGR-focused.
 *
 * UserList has NO search/filter bar in the current source (UserList.tsx
 * defines no `filters` prop) — this spec asserts the columns + create form
 * shape only; it does NOT assert a search/narrow behavior that the UI
 * doesn't implement.
 */
import { test, expect } from '@playwright/test';
import { loadAuth, type AuthInfo } from '../utils/manage/api';
import { testCode } from '../utils/manage/codes';

const TENANT_CODE = process.env.TENANT_CODE || 'ke';
const LIST_PATH = '/configurator/manage/users';

const USER_SEARCH = '/user/_search';
const USER_UPDATE = '/user/users/_updatenovalidate';

const createdUsernames = new Set<string>();

test.describe.configure({ mode: 'serial' });

function requestInfo(auth: AuthInfo, action = '_search'): Record<string, unknown> {
  return {
    apiId: 'Rainmaker',
    ver: '1.0',
    ts: Date.now(),
    action,
    msgId: `${Date.now()}|en_IN`,
    authToken: auth.token,
    userInfo: auth.user || undefined,
  };
}

async function postJson(
  auth: AuthInfo,
  pathWithQuery: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${auth.baseUrl}${pathWithQuery}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try { parsed = (await res.json()) as Record<string, unknown>; } catch { /* empty */ }
  if (!res.ok || (Array.isArray(parsed.Errors) && (parsed.Errors as unknown[]).length)) {
    const errs = parsed.Errors as Array<{ code?: string; message?: string }> | undefined;
    const summary = errs?.map((e) => `${e.code || '??'}:${e.message || ''}`).join(', ')
      || `HTTP_${res.status}`;
    throw new Error(`POST ${pathWithQuery} failed (${res.status}): ${summary}`);
  }
  return parsed;
}

async function softDeleteUser(auth: AuthInfo, userName: string): Promise<void> {
  const res = await postJson(auth, USER_SEARCH, {
    RequestInfo: requestInfo(auth),
    tenantId: TENANT_CODE,
    userName,
    pageSize: 1,
  });
  const list = (res.user as Array<Record<string, unknown>> | undefined) || [];
  if (!list.length) return;
  const user = list[0];
  if (user.active === false) return;
  user.active = false;
  await postJson(auth, USER_UPDATE, {
    RequestInfo: requestInfo(auth, '_update'),
    user,
  });
}

test.afterAll(async () => {
  if (createdUsernames.size === 0) return;
  const auth = loadAuth();
  const failed: Array<{ userName: string; reason: string }> = [];
  for (const u of createdUsernames) {
    try { await softDeleteUser(auth, u); } catch (e) {
      failed.push({ userName: u, reason: (e as Error).message });
    }
  }
  if (failed.length) {
    // eslint-disable-next-line no-console
    console.warn(`[users] cleanup left ${failed.length} user(s) behind:`, failed);
  }
});

test.describe('manage/users', () => {
  test('1. list renders with profile columns + at least one citizen row', async ({
    page,
  }) => {
    await page.goto(LIST_PATH);

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    for (const header of ['Username', 'Name', 'Mobile', 'Type']) {
      await expect(
        page.getByRole('columnheader', { name: new RegExp(`^${header}$`, 'i') }),
      ).toBeVisible();
    }

    // Default filter is roleCodes=['CITIZEN']. Tenant has seeded citizens
    // (ADMIN / test citizens per curl probe) — expect at least 1 data row.
    const dataRows = page.getByRole('row');
    expect(await dataRows.count()).toBeGreaterThan(1);
  });

  test('2. create — citizen user lands and is retrievable via API', async ({
    page,
  }, testInfo) => {
    const uname = `pw${testCode(testInfo, 'USR').toLowerCase().replace(/_/g, '')}`
      .slice(0, 40); // usernames in egov-user cap around 64 chars; stay safe.
    const uniq = uname.replace(/[^0-9]/g, '').slice(-5).padStart(5, '0');
    const mobile = `07${uniq}00${uniq.slice(0, 1)}`.slice(0, 10);
    createdUsernames.add(uname);

    await page.goto(`${LIST_PATH}/create`);

    await page.getByLabel(/^Username/i).fill(uname);
    await page.getByLabel(/^Name/i).fill(`PW Probe User ${uniq}`);
    await page.getByLabel(/^Mobile Number/i).fill(mobile);
    await page.getByLabel(/^Email/i).fill(`${uname}@example.com`);

    await Promise.all([
      page.waitForURL(/\/configurator\/manage\/users/, { timeout: 45_000 }),
      page.getByRole('button', { name: /^Create$/ }).click(),
    ]);

    // API sanity — user exists and is active.
    const auth = loadAuth();
    const res = await postJson(auth, USER_SEARCH, {
      RequestInfo: requestInfo(auth),
      tenantId: TENANT_CODE,
      userName: uname,
      pageSize: 1,
    });
    const list = (res.user as Array<Record<string, unknown>> | undefined) || [];
    expect(list.length).toBe(1);
    expect(list[0].userName).toBe(uname);
    expect(list[0].mobileNumber).toBe(mobile);
    expect(list[0].active).toBe(true);
    expect(list[0].type).toBe('CITIZEN');
  });

  test('3. edit — username disabled, name updates round-trip', async ({
    page,
  }, testInfo) => {
    // Seed via API so we don't depend on test 2's UI state.
    const uname = `pw${testCode(testInfo, 'USREDIT').toLowerCase().replace(/_/g, '')}`
      .slice(0, 40);
    const uniq = uname.replace(/[^0-9]/g, '').slice(-5).padStart(5, '0');
    const mobile = `07${uniq}11${uniq.slice(0, 1)}`.slice(0, 10);
    createdUsernames.add(uname);

    const auth = loadAuth();
    await postJson(auth, '/user/users/_createnovalidate', {
      RequestInfo: requestInfo(auth, '_create'),
      user: {
        userName: uname,
        name: `PW Pre-Edit ${uniq}`,
        mobileNumber: mobile,
        type: 'CITIZEN',
        active: true,
        password: 'eGov@123',
        gender: 'MALE',
        tenantId: TENANT_CODE,
        roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: TENANT_CODE }],
      },
    });

    // Fetch uuid for the list row anchor.
    const searchRes = await postJson(auth, USER_SEARCH, {
      RequestInfo: requestInfo(auth),
      tenantId: TENANT_CODE,
      userName: uname,
      pageSize: 1,
    });
    const user = ((searchRes.user as Array<Record<string, unknown>>) || [])[0];
    expect(user, 'seeded user must be retrievable').toBeTruthy();

    // Navigate straight to the RA show route via uuid. RA routes the /:id
    // path to Show when the resource registers both Show and Edit; the
    // registry wires all four routes for `users`. Fallback to trying /edit
    // if the Edit button doesn't mount (some routing configs default the
    // id path to Edit).
    await page.goto(`${LIST_PATH}/${user.uuid}`);
    const editBtn = page.getByRole('button', { name: /^Edit$/i });
    if (await editBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await editBtn.click();
    }
    // Either way we should now see a disabled Username input.

    // Username field must be read-only per UserEdit source.
    const userNameInput = page.getByLabel(/^Username/i);
    await expect(userNameInput).toBeDisabled();
    // Type field must be read-only too.
    const typeField = page.getByLabel(/^Type$/i);
    // The Radix-style select is `disabled` via the trigger button attr.
    await expect(typeField).toBeDisabled();

    // Update Name and Save.
    const nameInput = page.getByLabel(/^Name/i);
    await nameInput.fill(`PW Edited ${uniq}`);
    await page.getByRole('button', { name: /^Save$/i }).click();

    await page.waitForTimeout(1500);

    // API sanity.
    const res2 = await postJson(auth, USER_SEARCH, {
      RequestInfo: requestInfo(auth),
      tenantId: TENANT_CODE,
      userName: uname,
      pageSize: 1,
    });
    const updated = ((res2.user as Array<Record<string, unknown>>) || [])[0];
    expect(updated.name).toMatch(/PW Edited/);
  });

  test('4. show — profile fields render for a freshly seeded user', async ({
    page,
  }, testInfo) => {
    const uname = `pw${testCode(testInfo, 'USRSHOW').toLowerCase().replace(/_/g, '')}`
      .slice(0, 40);
    const uniq = uname.replace(/[^0-9]/g, '').slice(-5).padStart(5, '0');
    const mobile = `07${uniq}22${uniq.slice(0, 1)}`.slice(0, 10);
    createdUsernames.add(uname);

    const auth = loadAuth();
    await postJson(auth, '/user/users/_createnovalidate', {
      RequestInfo: requestInfo(auth, '_create'),
      user: {
        userName: uname, name: `PW Show ${uniq}`, mobileNumber: mobile,
        type: 'CITIZEN', active: true, password: 'eGov@123', gender: 'FEMALE',
        tenantId: TENANT_CODE,
        roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: TENANT_CODE }],
      },
    });

    const searchRes = await postJson(auth, USER_SEARCH, {
      RequestInfo: requestInfo(auth),
      tenantId: TENANT_CODE,
      userName: uname,
      pageSize: 1,
    });
    const user = ((searchRes.user as Array<Record<string, unknown>>) || [])[0];
    await page.goto(`${LIST_PATH}/${user.uuid}`);

    // UserShow renders FieldRow labels. Each label shows as regular text.
    await expect(page.getByText(uname)).toBeVisible();
    await expect(page.getByText(`PW Show ${uniq}`)).toBeVisible();
    await expect(page.getByText(mobile)).toBeVisible();
  });
});
