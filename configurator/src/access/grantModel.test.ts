import { areaTree, covered, mayGrant, minimalPicks, peopleRows, withGrant, withoutGrant } from './grantModel';

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
