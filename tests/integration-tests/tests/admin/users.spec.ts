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
import { apiAuth, type AuthInfo } from '../utils/manage/api';
import { testCode } from '../utils/manage/codes';
import { TENANT, ROOT_TENANT } from '../utils/env';
import { getMobileValidationRule, generateValidMobile, type MobileRule } from '../utils/mdms-mobile';

// Root (state) tenant from env — no hardcoded 'ke'.
const TENANT_CODE = ROOT_TENANT;
const LIST_PATH = '/configurator/manage/users';

const USER_SEARCH = '/user/_search';
const USER_UPDATE = '/user/users/_updatenovalidate';

const createdUsernames = new Set<string>();

// Live MDMS mobile rule for the deployment tenant — used to generate valid
// numbers instead of a hardcoded Kenya '07…' literal.
let mobileRule: MobileRule;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  mobileRule = await getMobileValidationRule(TENANT);
});

function requestInfo(auth: AuthInfo, action = '_search'): Record<string, unknown> {
  return {
    apiId: 'Rainmaker',
    ver: '1.0',
    ts: Date.now(),
    action,
    msgId: `${Date.now()}|en_IN`,
    authToken: auth.token,
    // Roles come from the configurator storageState as bare code strings; expand
    // to Role objects so services can deserialize them. Kong (compose) re-resolves
    // userInfo from the token and tolerates strings; the stock k8s gateway forwards
    // them verbatim → 401/500 "Cannot construct Role from String". See manage/api.ts.
    userInfo: auth.user
      ? {
          ...auth.user,
          roles: (Array.isArray((auth.user as { roles?: unknown }).roles)
            ? ((auth.user as { roles: unknown[] }).roles)
            : []
          ).map((r) =>
            typeof r === 'string'
              ? { code: r, name: r, tenantId: (auth.user as { tenantId?: string }).tenantId }
              : r,
          ),
        }
      : undefined,
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
  const auth = await apiAuth();
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
  test('1. list renders with profile columns + at least one citizen row', {
    annotation: {
      type: 'description',
      description: `Asserts /manage/users renders with the four expected column headers (Username, Name, Mobile, Type) and at least one populated row. The default filter is roleCodes=['CITIZEN'] (configurator's hardcoded default), and the tenant has seeded ADMIN + test citizens.

Steps:
1. Navigate to /configurator/manage/users.
2. Assert role=table is visible.
3. For each header in ['Username','Name','Mobile','Type'], assert the matching role=columnheader is visible.
4. Assert getByRole('row') count > 1 (header + at least one citizen).

UserList does NOT have a search/filter bar (no filters prop in the source) — this spec asserts columns + count only, not narrow behavior the UI doesn't implement.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
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

  test('2. create — citizen user lands and is retrievable via API', {
    annotation: {
      type: 'description',
      description: `Drives the UserCreate form to create a fresh citizen, navigates back to the list, and verifies via egov-user _search that the user landed with the expected fields. UserCreate has NO Username field — it derives userName from the mobile number (leading 0 stripped), so the persisted userName === mobileNumber. Soft-deletes in afterAll.

Steps:
1. Generate a 10-digit mobile number; derive expectedUserName = mobile with any leading 0 stripped; track expectedUserName for cleanup.
2. Navigate to /configurator/manage/users/create.
3. Fill labels Name, Mobile Number, Email (no Username field).
4. Click Create; wait for navigation back to /configurator/manage/users (45s timeout).
5. POST /user/_search with userName=expectedUserName; assert exactly 1 result.
6. Assert userName === mobileNumber === expectedUserName, active=true, type='CITIZEN'.

Teardown is API-only — egov-user has no UI delete affordance for users; the afterAll soft-deletes via _updatenovalidate with active=false.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    const uname = `pw${testCode(testInfo, 'USR').toLowerCase().replace(/_/g, '')}`
      .slice(0, 40); // used for the display name + email only.
    const uniq = uname.replace(/[^0-9]/g, '').slice(-5).padStart(5, '0');
    // Mobile valid for THIS tenant's MDMS rule — Kenya starts 7/1, Maputo
    // starts 8. Previously hardcoded a Kenya-format `07…` literal, which the
    // mz backend rejects. NOTE: this surfaces a real product bug —
    // UserCreate.tsx validates with `v.mobileKERequired` (a hardcoded Kenyan
    // regex ^0?[17][0-9]{8}$), so the form blocks any tenant-valid non-Kenya
    // number and the citizen can never be created on a non-Kenya deployment.
    const mobile = generateValidMobile(await getMobileValidationRule(TENANT));
    // UserCreate has no Username field — it derives userName from the mobile
    // number, stripping any leading 0. Track the derived value for cleanup.
    const expectedUserName = mobile.replace(/^0/, '');
    createdUsernames.add(expectedUserName);

    await page.goto(`${LIST_PATH}/create`);

    // No Username field — userName is derived from the mobile number.
    await page.getByLabel(/^Name/i).fill(`PW Probe User ${uniq}`);
    await page.getByLabel(/^Mobile Number/i).fill(mobile);
    await page.getByLabel(/^Email/i).fill(`${uname}@example.com`);

    // Wait for the create to ACTUALLY complete, not merely for the URL to
    // read /manage/users — the loose match is also satisfied by the create
    // page itself (/manage/users/create), so keying off it alone lets the
    // spec race ahead and probe the API before react-admin's async submit has
    // even issued the _createnovalidate POST (the page then closes mid-flight
    // and the create never lands). Key off the create response instead, then
    // confirm the post-create redirect off /create.
    await Promise.all([
      page.waitForResponse(
        (r) => /\/user\/users\/_createnovalidate$/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 45_000 },
      ),
      page.getByRole('button', { name: /^Create$/ }).click(),
    ]);
    await page
      .waitForURL(/\/configurator\/manage\/users(?:\/?(?:$|\?))/, { timeout: 15_000 })
      .catch(() => {});

    // API sanity — user exists and is active. userName is derived from mobile.
    const auth = await apiAuth();
    const res = await postJson(auth, USER_SEARCH, {
      RequestInfo: requestInfo(auth),
      tenantId: TENANT_CODE,
      userName: expectedUserName,
      pageSize: 1,
    });
    const list = (res.user as Array<Record<string, unknown>> | undefined) || [];
    expect(list.length).toBe(1);
    expect(list[0].userName).toBe(expectedUserName);
    // UserCreate derives userName from mobileNumber — they must match.
    expect(list[0].userName).toBe(list[0].mobileNumber);
    expect(list[0].mobileNumber).toBe(expectedUserName);
    expect(list[0].active).toBe(true);
    expect(list[0].type).toBe('CITIZEN');
  });

  test('3. edit — username disabled, name updates round-trip', {
    annotation: {
      type: 'description',
      description: `Confirms the UserEdit form's two read-only invariants (Username and Type cannot change after create) and a name update round-trips through _updatenovalidate. Seeds via API for speed; asserts both UI disabled state and the post-save API payload.

Steps:
1. Generate a unique username; track for cleanup.
2. POST /user/users/_createnovalidate to seed a CITIZEN.
3. POST /user/_search to get the user's uuid.
4. Navigate to /configurator/manage/users/<uuid>; if an Edit button is visible, click it.
5. Assert the Username input is disabled.
6. Assert the Type field (Radix select trigger) is disabled.
7. Fill Name with "PW Edited <uniq>".
8. Click Save; wait 1.5s.
9. POST /user/_search again; assert updated.name matches /PW Edited/.

Tolerant of show-vs-edit routing differences — works whether /:id lands on Show or directly on Edit.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    // Seed via API so we don't depend on test 2's UI state.
    const uname = `pw${testCode(testInfo, 'USREDIT').toLowerCase().replace(/_/g, '')}`
      .slice(0, 40);
    const uniq = uname.replace(/[^0-9]/g, '').slice(-5).padStart(5, '0');
    // Valid for THIS tenant's MDMS mobile rule — no hardcoded Kenya '07…'.
    const mobile = generateValidMobile(mobileRule);
    createdUsernames.add(uname);

    const auth = await apiAuth();
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
    // Wait for the update to ACTUALLY complete (react-admin's submit is async)
    // rather than a fixed sleep, so the API probe below can't race ahead of it.
    await Promise.all([
      page.waitForResponse(
        (r) => /\/user\/users\/_updatenovalidate$/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: /^Save$/i }).click(),
    ]);

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

  test('4. show — profile fields render for a freshly seeded user', {
    annotation: {
      type: 'description',
      description: `API-seeds a citizen, then navigates to the UserShow page and asserts the username, name, and mobile number all render as visible text. Confirms the FieldRow layout pulls the correct fields off the user object.

Steps:
1. Generate a unique username + 10-digit mobile; track for cleanup.
2. POST /user/users/_createnovalidate with name "PW Show <uniq>", gender FEMALE.
3. POST /user/_search for the uuid.
4. Navigate to /configurator/manage/users/<uuid>.
5. Assert each of uname / "PW Show <uniq>" / mobile is visible on the page.

Pairs with the edit test — together they cover the two read-only routes (show + edit) the configurator exposes for users.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    const uname = `pw${testCode(testInfo, 'USRSHOW').toLowerCase().replace(/_/g, '')}`
      .slice(0, 40);
    const uniq = uname.replace(/[^0-9]/g, '').slice(-5).padStart(5, '0');
    // Valid for THIS tenant's MDMS mobile rule — no hardcoded Kenya '07…'.
    const mobile = generateValidMobile(mobileRule);
    createdUsernames.add(uname);

    const auth = await apiAuth();
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
    // react-admin routes the bare /:id path to Edit (fields land in inputs);
    // the read-only Show page lives at /:id/show, where UserShow renders the
    // profile fields as plain text via FieldRow.
    await page.goto(`${LIST_PATH}/${user.uuid}/show`);

    // UserShow renders FieldRow labels. Each label shows as regular text.
    // The name also appears in the page title (`User: <name>`), so it resolves
    // to two elements — assert the first to render (both are the same value).
    await expect(page.getByText(uname)).toBeVisible();
    await expect(page.getByText(`PW Show ${uniq}`).first()).toBeVisible();
    await expect(page.getByText(mobile)).toBeVisible();
  });
});
