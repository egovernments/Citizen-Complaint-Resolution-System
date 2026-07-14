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
  it('returns the open-by-default capability when the caller has no roles', async () => {
    const client = stubClient({});
    const cap = await loadMastersCapability(client, 'pg', []);
    assert.equal(cap.canView('anything'), true);
    assert.equal(cap.canEdit('anything'), false);
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

  it('fails open on a malformed condition rather than hiding the master', async () => {
    const malformed = {
      ...SEARCH_ACTION,
      data: { ...SEARCH_ACTION.data, resource: { masters: { 'common-masters.Broken': { condition: { '???': [] } } } } },
    };
    const client = stubClient({ [ACTIONS_TEST_SCHEMA]: [malformed], [ROLEACTIONS_SCHEMA]: [] });
    const cap = await loadMastersCapability(client, 'pg', ['SUPERVISOR']);
    assert.equal(cap.canView('common-masters.Broken'), true);
  });
});
