import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from '../client/DigitApiClient.js';
import { loadMastersCapability, ACTIONS_TEST_SCHEMA, ROLEACTIONS_SCHEMA } from './accessPolicy.js';

const SEARCH_ACTION = {
  id: '2513-record',
  tenantId: 'pg',
  schemaCode: ACTIONS_TEST_SCHEMA,
  uniqueIdentifier: '2513',
  isActive: true,
  data: {
    id: 2513,
    url: '/mdms-v2/v2/_search',
    resource: {
      masters: {
        'ACCESSCONTROL-ROLES.roles': {
          condition: { in: ['MDMS_ADMIN', { var: 'user.roles' }] },
        },
        'common-masters.Department': {
          condition: { or: [
            { in: ['MDMS_ADMIN', { var: 'user.roles' }] },
            { in: ['SUPERVISOR', { var: 'user.roles' }] },
          ] },
        },
      },
    },
  },
};

const CREATE_ACTION = {
  id: '2583-record', tenantId: 'pg', schemaCode: ACTIONS_TEST_SCHEMA, uniqueIdentifier: '2583', isActive: true,
  data: { id: 2583, url: '/mdms-v2/v2/_create/common-masters.Department' },
};
const UPDATE_ACTION = {
  id: '2614-record', tenantId: 'pg', schemaCode: ACTIONS_TEST_SCHEMA, uniqueIdentifier: '2614', isActive: true,
  data: { id: 2614, url: '/mdms-v2/v2/_update/common-masters.Department' },
};

const MDMS_ADMIN_ROLEACTION = {
  id: '1', tenantId: 'pg', schemaCode: ROLEACTIONS_SCHEMA, uniqueIdentifier: '1', isActive: true,
  data: { rolecode: 'MDMS_ADMIN', actionid: 2614 },
};

function stubClient(mdmsBySchema: Record<string, unknown[]>): DigitApiClient {
  const client = new DigitApiClient({ url: 'https://test.example.com' });
  (client as unknown as { request: (...args: unknown[]) => Promise<unknown> }).request =
    async (_path: unknown, body: { MdmsCriteria?: { schemaCode?: string } }) => ({
      mdms: mdmsBySchema[body.MdmsCriteria?.schemaCode ?? ''] ?? [],
    });
  return client;
}

describe('loadMastersCapability', () => {
  it('fails closed when the caller has no roles or no tenant to evaluate a policy against', async () => {
    // No identity to evaluate against at all — distinct from "no policy configured for
    // this tenant", which stays open per-schema via mastersConditions' empty fallback
    // (see the next test). Deny-by-default here matches useMastersCapability's posture
    // for every other incomplete-identity path (#1441 review).
    const client = stubClient({});
    const noRoles = await loadMastersCapability(client, 'pg', []);
    assert.equal(noRoles.canView('anything'), false);
    assert.equal(noRoles.canEdit('anything'), false);

    const noTenant = await loadMastersCapability(client, '', ['MDMS_ADMIN']);
    assert.equal(noTenant.canView('anything'), false);
    assert.equal(noTenant.canEdit('anything'), false);
  });

  it('canView is true when a master has no resource.masters entry (today\'s behavior)', async () => {
    const client = stubClient({
      [ACTIONS_TEST_SCHEMA]: [SEARCH_ACTION],
      [ROLEACTIONS_SCHEMA]: [],
    });
    const cap = await loadMastersCapability(client, 'pg', ['SUPERVISOR']);
    assert.equal(cap.canView('common-masters.Designation'), true);
  });

  it('canView respects the JsonLogic condition for a restricted master', async () => {
    const client = stubClient({
      [ACTIONS_TEST_SCHEMA]: [SEARCH_ACTION],
      [ROLEACTIONS_SCHEMA]: [],
    });
    const supervisor = await loadMastersCapability(client, 'pg', ['SUPERVISOR']);
    assert.equal(supervisor.canView('ACCESSCONTROL-ROLES.roles'), false);
    assert.equal(supervisor.canView('common-masters.Department'), true);

    const admin = await loadMastersCapability(client, 'pg', ['MDMS_ADMIN']);
    assert.equal(admin.canView('ACCESSCONTROL-ROLES.roles'), true);
  });

  it('canEdit is true only when the role has the schema\'s create/update action mapped', async () => {
    const client = stubClient({
      [ACTIONS_TEST_SCHEMA]: [SEARCH_ACTION, CREATE_ACTION, UPDATE_ACTION],
      [ROLEACTIONS_SCHEMA]: [MDMS_ADMIN_ROLEACTION],
    });
    const admin = await loadMastersCapability(client, 'pg', ['MDMS_ADMIN']);
    assert.equal(admin.canEdit('common-masters.Department'), true);

    const supervisor = await loadMastersCapability(client, 'pg', ['SUPERVISOR']);
    assert.equal(supervisor.canEdit('common-masters.Department'), false);
  });

  it('canEdit is false for a schema with no dedicated write action', async () => {
    const client = stubClient({
      [ACTIONS_TEST_SCHEMA]: [SEARCH_ACTION],
      [ROLEACTIONS_SCHEMA]: [MDMS_ADMIN_ROLEACTION],
    });
    const admin = await loadMastersCapability(client, 'pg', ['MDMS_ADMIN']);
    assert.equal(admin.canEdit('some-schema.WithNoAction'), false);
  });

  it('fails closed on a malformed authored condition rather than exposing the master', async () => {
    // An entry IS present — an operator authored a restriction — so a condition that fails to
    // evaluate is policy corruption, not an absent policy; must deny, not read as open (#1441 review).
    const malformed = {
      ...SEARCH_ACTION,
      data: { ...SEARCH_ACTION.data, resource: { masters: { 'common-masters.Broken': { condition: { '???': [] } } } } },
    };
    const client = stubClient({ [ACTIONS_TEST_SCHEMA]: [malformed], [ROLEACTIONS_SCHEMA]: [] });
    const cap = await loadMastersCapability(client, 'pg', ['SUPERVISOR']);
    assert.equal(cap.canView('common-masters.Broken'), false);
  });

  it('propagates a fetch failure rather than resolving as an open policy', async () => {
    const client = new DigitApiClient({ url: 'https://test.example.com' });
    (client as unknown as { request: (...args: unknown[]) => Promise<unknown> }).request =
      async () => { throw new Error('network down'); };
    await assert.rejects(() => loadMastersCapability(client, 'pg', ['SUPERVISOR']));
  });

  it('paginates past a single page instead of truncating', async () => {
    const PAGE_SIZE = 500;
    // 501 write actions for distinct schemas — one page's worth plus one more, so the LAST
    // one only becomes visible if the fetch actually pages past the first PAGE_SIZE.
    const manyWriteActions = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => ({
      id: `w${i}`, tenantId: 'pg', schemaCode: ACTIONS_TEST_SCHEMA, uniqueIdentifier: `w${i}`, isActive: true,
      data: { id: 9000 + i, url: `/mdms-v2/v2/_create/some-schema.Extra${i}` },
    }));
    const lastActionId = 9000 + PAGE_SIZE;
    const roleAction = {
      id: 'ra1', tenantId: 'pg', schemaCode: ROLEACTIONS_SCHEMA, uniqueIdentifier: 'ra1', isActive: true,
      data: { rolecode: 'MDMS_ADMIN', actionid: lastActionId },
    };

    const client = new DigitApiClient({ url: 'https://test.example.com' });
    (client as unknown as { request: (...args: unknown[]) => Promise<unknown> }).request =
      async (_path: unknown, body: { MdmsCriteria?: { schemaCode?: string; limit?: number; offset?: number } }) => {
        const { schemaCode, limit = PAGE_SIZE, offset = 0 } = body.MdmsCriteria ?? {};
        if (schemaCode === ROLEACTIONS_SCHEMA) return { mdms: offset === 0 ? [roleAction] : [] };
        if (schemaCode === ACTIONS_TEST_SCHEMA) return { mdms: manyWriteActions.slice(offset, offset + limit) };
        return { mdms: [] };
      };

    const cap = await loadMastersCapability(client, 'pg', ['MDMS_ADMIN']);
    assert.equal(cap.canEdit(`some-schema.Extra${PAGE_SIZE}`), true);
  });
});
