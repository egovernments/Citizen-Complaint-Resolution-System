import { policyRows } from './policyRowsModel';
import type { Loaded } from './roleEditorData';

const rec = (schemaCode: string, uniqueIdentifier: string, data: Record<string, unknown>, isActive = true) =>
  ({ id: uniqueIdentifier, tenantId: 'ke', schemaCode, uniqueIdentifier, data, isActive });

const L: Loaded = {
  root: 'ke',
  role: rec('ACCESSCONTROL-ROLES.roles', 'SUBCOUNTY_GRO', { code: 'SUBCOUNTY_GRO', name: 'Sub-county GRO' }),
  actions: [{ id: 2008, url: '/pgr-services/v2/request/_search' }, { id: 2031, url: '/pgr-services/v2/request/_update' }],
  grants: [rec('ACCESSCONTROL-ROLEACTIONS.roleactions', 'SUBCOUNTY_GRO.2008', { rolecode: 'SUBCOUNTY_GRO', actionid: 2008 }),
    rec('ACCESSCONTROL-ROLEACTIONS.roleactions', 'SUBCOUNTY_GRO.2031', { rolecode: 'SUBCOUNTY_GRO', actionid: 2031 }, false)],
  searchAction: rec('ACCESSCONTROL-ACTIONS-TEST.actions-test', '2008', { id: 2008, url: '/pgr-services/v2/request/_search', resource: { complaint: {
    scope: { axes: ['department', 'jurisdiction'], roleScopes: { GRO: { department: 'OWN', jurisdiction: 'OWN' }, SUBCOUNTY_GRO: { department: 'ALL', jurisdiction: 'OWN' } }, default: { department: 'OWN', jurisdiction: 'OWN' } },
    attributes: { 'citizen.mobileNumber': { condition: true, onDeny: { strategy: 'REDACT' } } } } } }),
  mastersActions: [rec('ACCESSCONTROL-ACTIONS-TEST.actions-test', '2513', { resource: { masters: {
    'common-masters.Department': { condition: { in: ['SUBCOUNTY_GRO', { var: 'user.roles' }] } }, 'ACCESSCONTROL-ROLES.roles': { condition: { in: ['MDMS_ADMIN', { var: 'user.roles' }] } } } } })],
  catalogue: [{ resource: 'complaint', attribute: 'locality' }],
  workflow: { businessService: 'PGR', tenantId: 'ke', states: [{ state: 'PENDINGFORASSIGNMENT', actions: [{ action: 'ASSIGN', roles: ['GRO', 'SUBCOUNTY_GRO'], nextState: 'PENDINGATLME' }, { action: 'REJECT', roles: ['GRO'] }] }] },
};

describe('policy rows', () => {
  const s = policyRows(L, 'SUBCOUNTY_GRO');
  const by = (t: string) => s.find((x) => x.title.includes(t))!;
  it('the role row and its ACTIVE grants, each with its URL for reading', () => {
    expect(by('The role').json).toEqual({ code: 'SUBCOUNTY_GRO', name: 'Sub-county GRO' });
    expect(by('may call').json).toEqual([{ rolecode: 'SUBCOUNTY_GRO', actionid: 2008, '//': '/pgr-services/v2/request/_search' }]);
  });
  it('only this role\'s entry of the shared scope block, with axes and default', () => {
    expect(by('which complaints').json).toEqual({ axes: ['department', 'jurisdiction'], roleScopes: { SUBCOUNTY_GRO: { department: 'ALL', jurisdiction: 'OWN' } }, default: { department: 'OWN', jurisdiction: 'OWN' } });
    expect(policyRows(L, 'NEWROLE').find((x) => x.title.includes('which complaints'))!.json).toMatchObject({ roleScopes: { NEWROLE: '(not stated: the default applies)' } });
  });
  it('only the masters conditions that name the role; the workflow steps it takes', () => {
    expect(Object.keys((by('masters').json as any).masters)).toEqual(['common-masters.Department']);
    expect(by('Workflow').json).toEqual([{ state: 'PENDINGFORASSIGNMENT', action: 'ASSIGN', nextState: 'PENDINGATLME' }]);
  });
});
