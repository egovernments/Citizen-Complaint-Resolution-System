/**
 * Regression for CCRS #1835: Management boundary creation must derive the
 * hierarchy relationship from the authenticated tenant instead of posting a
 * hard-coded ADMIN relationship without a parent.
 */
import { test, expect, type Page } from '@playwright/test';
import { buildRequestInfo, loadAuth, type AuthInfo } from '../utils/manage/api';
import { testCode } from '../utils/manage/codes';

const CREATE_PATH = '/configurator/manage/boundaries/create';
const LIST_PATH = '/configurator/manage/boundaries';
const HIERARCHY_CREATE = '/boundary-service/boundary-hierarchy-definition/_create';
const RELATIONSHIP_CREATE = '/boundary-service/boundary-relationships/_create';

let cleanup:
  | { auth: AuthInfo; hierarchyType: string; rootCode: string; childCode: string }
  | undefined;

async function post(
  auth: AuthInfo,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${auth.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify(body),
  });
}

async function choose(page: Page, label: RegExp, option: string): Promise<void> {
  await page.getByLabel(label).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function createBoundaryThroughUi(
  page: Page,
  args: {
    tenantId: string;
    hierarchyType: string;
    boundaryType: string;
    code: string;
    parentType?: string;
    parentCode?: string;
  },
): Promise<Record<string, unknown>> {
  await page.goto(CREATE_PATH);
  await expect(page.getByText(`Creating this boundary for login tenant ${args.tenantId}.`)).toBeVisible();
  await page.getByLabel(/^Code/i).fill(args.code);
  await choose(page, /^Hierarchy/i, args.hierarchyType);
  await choose(page, /^Boundary Type/i, args.boundaryType);

  if (args.parentType && args.parentCode) {
    await choose(page, new RegExp(`^Parent Boundary \\(${args.parentType}\\)`, 'i'), args.parentCode);
  } else {
    await expect(page.getByLabel(/^Parent Boundary/i)).toHaveCount(0);
  }

  const relationshipRequest = page.waitForRequest(
    (request) => request.url().includes(RELATIONSHIP_CREATE) && request.method() === 'POST',
  );
  await page.getByRole('button', { name: /^Create$/ }).click();
  const request = await relationshipRequest;
  await page.waitForURL(LIST_PATH, { timeout: 30_000 });
  return request.postDataJSON() as Record<string, unknown>;
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  if (!cleanup) return;
  const { auth, hierarchyType, rootCode, childCode } = cleanup;

  // Best-effort API teardown: delete child before root. Boundary hierarchy
  // definitions have no delete endpoint, so the uniquely named PW_* hierarchy
  // remains and is safe from collisions on later runs.
  for (const code of [childCode, rootCode]) {
    await post(auth, '/boundary-service/boundary-relationships/_delete', {
      RequestInfo: buildRequestInfo(auth),
      BoundaryRelationship: { tenantId: auth.tenant, hierarchyType, code },
    }).catch(() => undefined);
  }
  await post(auth, '/boundary-service/boundary/_delete', {
    RequestInfo: buildRequestInfo(auth),
    Boundary: [childCode, rootCode].map((code) => ({ tenantId: auth.tenant, code })),
  }).catch(() => undefined);
});

test('creates a root and child with hierarchy-derived relationship fields', {
  annotation: {
    type: 'description',
    description: `Regression for #1835. Creates a unique two-level hierarchy on the authenticated login tenant, then drives Management > Boundaries > Create twice. The root request must omit parent; the child form must require and send the root as its direct parent. Both requests must use the login tenant and the selected custom hierarchy rather than a hard-coded ADMIN fallback.`,
  },
  tag: ['@area:manage-boundaries', '@kind:regression', '@layer:ui', '@persona:admin'],
}, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const auth = loadAuth();
  const hierarchyType = testCode(testInfo, 'BOUNDARYCREATEHIER');
  const rootCode = testCode(testInfo, 'BOUNDARYCREATEROOT');
  const childCode = testCode(testInfo, 'BOUNDARYCREATECHILD');
  const rootType = 'PW_ROOT_LEVEL';
  const childType = 'PW_CHILD_LEVEL';
  cleanup = { auth, hierarchyType, rootCode, childCode };

  const hierarchyResponse = await post(auth, HIERARCHY_CREATE, {
    RequestInfo: buildRequestInfo(auth),
    BoundaryHierarchy: {
      tenantId: auth.tenant,
      hierarchyType,
      boundaryHierarchy: [
        { boundaryType: rootType, parentBoundaryType: null, active: true },
        { boundaryType: childType, parentBoundaryType: rootType, active: true },
      ],
    },
  });
  expect([200, 201, 202]).toContain(hierarchyResponse.status);

  const rootPayload = await createBoundaryThroughUi(page, {
    tenantId: auth.tenant,
    hierarchyType,
    boundaryType: rootType,
    code: rootCode,
  });
  expect(rootPayload.BoundaryRelationship).toMatchObject({
    tenantId: auth.tenant,
    hierarchyType,
    boundaryType: rootType,
    code: rootCode,
  });
  expect(rootPayload.BoundaryRelationship).not.toHaveProperty('parent');

  const childPayload = await createBoundaryThroughUi(page, {
    tenantId: auth.tenant,
    hierarchyType,
    boundaryType: childType,
    code: childCode,
    parentType: rootType,
    parentCode: rootCode,
  });
  expect(childPayload.BoundaryRelationship).toMatchObject({
    tenantId: auth.tenant,
    hierarchyType,
    boundaryType: childType,
    code: childCode,
    parent: rootCode,
  });
});
