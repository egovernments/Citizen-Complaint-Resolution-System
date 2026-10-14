import { areaTree, covered, grantPreview, mayGrant, minimalPicks, peopleRows, withGrant, withoutGrant } from './grantModel';
import type { Loaded } from './roleEditorData';

describe('grant preview (before Save)', () => {
  const rec = (schemaCode: string, uid: string, data: Record<string, unknown>) => ({ id: uid, tenantId: 'ke', schemaCode, uniqueIdentifier: uid, data, isActive: true });
  const mask = { condition: { or: [{ '==': [{ var: 'user.attributes.tenantWide' }, true] }, { '==': [{ var: 'resource.complaint.accountId' }, { var: 'user.uuid' }] }] }, onDeny: { strategy: 'MASK_SHOW_LAST_N', n: 3, maskChar: 'X' } };
  const loaded = (levels: Record<string, string>): Loaded => ({
    root: 'ke', role: rec('ACCESSCONTROL-ROLES.roles', 'R', { code: 'R', name: 'R' }),
    actions: [{ id: 2008, url: '/pgr-services/v2/request/_search' }, { id: 2009, url: '/pgr-services/v2/request/_count' }, { id: 2031, url: '/pgr-services/v2/request/_update' }],
    grants: [2008, 2009, 2031].map((id) => rec('ACCESSCONTROL-ROLEACTIONS.roleactions', `R.${id}`, { rolecode: 'R', actionid: id })),
    searchAction: rec('ACCESSCONTROL-ACTIONS-TEST.actions-test', '2008', { url: '/pgr-services/v2/request/_search', resource: { complaint: {
      scope: { axes: ['department', 'jurisdiction'], roleScopes: { R: levels }, default: { department: 'OWN', jurisdiction: 'OWN' } },
      attributes: { 'citizen.mobileNumber': mask, 'citizen.name': { ...mask, onDeny: { strategy: 'REDACT' } } } } } }),
    catalogue: [], mastersActions: [],
    workflow: { businessService: 'PGR', tenantId: 'ke', states: [{ state: 'PENDINGFORASSIGNMENT', actions: [{ action: 'ASSIGN', roles: ['R'] }, { action: 'REJECT', roles: ['R'] }] }] },
  });
  it('names the complaints, what the role can do, its workflow actions and what is masked', () => {
    const p = grantPreview(loaded({ jurisdiction: 'OWN', department: 'ALL' }), 'R', 'ke', ['BOMET_SOTIK'], 214);
    expect(p.complaints).toBe('About 214 complaints in BOMET_SOTIK (every department), plus anything assigned to them.');
    expect(p.can).toBe('Can search and view complaints, act on complaints (workflow actions).');
    expect(p.workflow).toBe('In the workflow: Assign (pending for assignment), Reject (pending for assignment).');
    expect(p.masked).toBe('Masked for them: Citizen mobile (last 3), Citizen name (hidden).');
  });
  it('a tenant-wide role is shown the fields the shared rule gives tenant-wide staff; no area = nothing yet', () => {
    expect(grantPreview(loaded({ jurisdiction: 'ALL', department: 'ALL' }), 'R', 'ke', [], null).masked).toBe('No fields masked for them.');
    expect(grantPreview(loaded({ jurisdiction: 'OWN', department: 'OWN' }), 'R', 'ke.bomet', [], null).complaints)
      .toBe("Complaints in no area yet: nothing until areas are picked (only the person's departments), plus anything assigned to them.");
  });
});

const TB = [{ hierarchyType: 'ADMIN', boundary: [{ code: 'BOMET', boundaryType: 'County', children: [
  { code: 'BOMET_SOTIK', boundaryType: 'SubCounty', children: [{ code: 'BOMET_SOTIK_KIPSONOI', boundaryType: 'Ward', children: [] }, { code: 'BOMET_SOTIK_RONGENA_MANARET', boundaryType: 'Ward', children: [] }] },
  { code: 'BOMET_BOMET_EAST', boundaryType: 'SubCounty', children: [{ code: 'BOMET_BOMET_EAST_LONGISA', boundaryType: 'Ward', children: [] }] },
] }] }];
const tree = areaTree(TB, 'ADMIN');

describe('link-role rule (mirrors identity-bff link-role-rule.ts)', () => {
  const admin = [{ code: 'ACCOUNT_ADMIN', tenantId: 'ke.bomet' }, { code: 'GRO', tenantId: 'ke' }];
  it('an account admin grants an operational role in its subtree', () => {
    expect(mayGrant(admin, 'SUBCOUNTY_GRO', 'ke.bomet')).toEqual({ ok: true });
    expect(mayGrant(admin, 'SUBCOUNTY_GRO', 'ke.bomet.health')).toEqual({ ok: true });
  });
  it('not above its node, not in another state, not an admin role it lacks', () => {
    expect(mayGrant(admin, 'GRO', 'ke')).toEqual({ ok: false, reason: 'NOT_MEMBER_ADMIN' });
    expect(mayGrant(admin, 'GRO', 'pg.citya')).toEqual({ ok: false, reason: 'CROSS_STATE' });
    expect(mayGrant(admin, 'MDMS_ADMIN', 'ke.bomet')).toEqual({ ok: false, reason: 'ROLE_NOT_HELD' });
    expect(mayGrant([{ code: 'TENANT_ADMIN', tenantId: 'ke' }], 'GRO', 'ke.bomet')).toEqual({ ok: true }); // alias
  });
});

describe('areas', () => {
  it('a picked sub-county covers its wards; a ward under it adds nothing', () => {
    expect([...covered(tree, new Set(['BOMET_SOTIK']))].sort()).toEqual(['BOMET_SOTIK', 'BOMET_SOTIK_KIPSONOI', 'BOMET_SOTIK_RONGENA_MANARET']);
    expect(minimalPicks(tree, new Set(['BOMET_SOTIK', 'BOMET_SOTIK_KIPSONOI', 'BOMET_BOMET_EAST_LONGISA']))).toEqual(['BOMET_SOTIK', 'BOMET_BOMET_EAST_LONGISA']);
  });
});

describe('the HRMS write', () => {
  const emp = () => ({ code: 'E1', user: { uuid: 'u1', name: 'Test', roles: [{ code: 'EMPLOYEE', tenantId: 'ke' }] },
    jurisdictions: [{ boundary: 'BOMET_BOMET_EAST', tenantId: 'ke', isActive: true, hierarchy: 'ADMIN', boundaryType: 'SubCounty' }, { boundary: 'NAIROBI_X', tenantId: 'ke.nairobi', isActive: true }],
    assignments: [{ department: 'DEPT_3', isCurrentAssignment: true }] });
  it('adds the role at the node and sets the active areas at that tenant; other tenants untouched', () => {
    const { next, changes } = withGrant(emp(), { role: 'SUBCOUNTY_GRO', tenantId: 'ke', areas: ['BOMET_SOTIK', 'BOMET_SOTIK_KIPSONOI'], hierarchyType: 'ADMIN' }, tree);
    expect(changes).toEqual(['+ role SUBCOUNTY_GRO at ke', '- area BOMET_BOMET_EAST', '+ area BOMET_SOTIK']);
    expect(next.user.roles).toContainEqual({ code: 'SUBCOUNTY_GRO', name: 'SUBCOUNTY_GRO', tenantId: 'ke' });
    expect(next.jurisdictions).toEqual([
      { boundary: 'BOMET_BOMET_EAST', tenantId: 'ke', isActive: false, hierarchy: 'ADMIN', boundaryType: 'SubCounty' },
      { boundary: 'NAIROBI_X', tenantId: 'ke.nairobi', isActive: true },
      { hierarchy: 'ADMIN', hierarchyType: 'ADMIN', boundaryType: 'SubCounty', boundary: 'BOMET_SOTIK', tenantId: 'ke', isActive: true },
    ]);
  });
  it('re-granting is a no-op; a deactivated area comes back rather than a duplicate', () => {
    const once = withGrant(emp(), { role: 'R', tenantId: 'ke', areas: ['BOMET_SOTIK'], hierarchyType: 'ADMIN' }, tree).next;
    expect(withGrant(once, { role: 'R', tenantId: 'ke', areas: ['BOMET_SOTIK'], hierarchyType: 'ADMIN' }, tree).changes).toEqual([]);
    const back = withGrant(once, { role: 'R', tenantId: 'ke', areas: ['BOMET_BOMET_EAST'], hierarchyType: 'ADMIN' }, tree);
    expect(back.next.jurisdictions.filter((j: any) => j.boundary === 'BOMET_BOMET_EAST')).toHaveLength(1);
    expect(back.next.jurisdictions.find((j: any) => j.boundary === 'BOMET_BOMET_EAST').isActive).toBe(true);
  });
  it('revoking removes only that grant', () => {
    const g = withGrant(emp(), { role: 'R', tenantId: 'ke', areas: [], hierarchyType: 'ADMIN' }, tree).next;
    expect(withoutGrant(g, 'R', 'ke').user.roles).toEqual([{ code: 'EMPLOYEE', tenantId: 'ke' }]);
  });
  it('who can do what at a tenant: grants reaching it, areas, departments; EMPLOYEE-only people left out', () => {
    const g = withGrant(emp(), { role: 'R', tenantId: 'ke', areas: ['BOMET_SOTIK'], hierarchyType: 'ADMIN' }, tree).next;
    expect(peopleRows([{ ...g, code: 'GONE', isActive: false }], 'ke.bomet')).toEqual([]);
    expect(peopleRows([g, emp()], 'ke.bomet')).toEqual([{ uuid: 'u1', code: 'E1', name: 'Test', grants: [{ code: 'R', name: 'R', tenantId: 'ke' }], areas: ['BOMET_SOTIK'], departments: ['DEPT_3'] }]);
  });
});
