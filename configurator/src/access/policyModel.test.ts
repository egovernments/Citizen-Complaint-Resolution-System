import jsonLogic from 'json-logic-js';
import {
  BASE_VARS, PRESETS, actionsOf, buildFieldRule, capabilityState, changedPaths, effectiveScope, fromJsonLogic,
  maskPreview, parseFieldRule, plainWords, toJsonLogic, unavailableVars, vocabulary, withRoleFieldRule, withRoleScope,
  type Clause,
} from './policyModel';

// action 2008 as seeded (default-data-handler ACCESSCONTROL-ACTIONS-TEST), trimmed
const SEEDED_MASK = {
  condition: { or: [{ '==': [{ var: 'user.attributes.tenantWide' }, true] }, { '==': [{ var: 'resource.complaint.accountId' }, { var: 'user.uuid' }] }] },
  onDeny: { strategy: 'REDACT' },
};
const a2008 = () => ({
  id: 2008, url: '/pgr-services/v2/request/_search',
  resource: { complaint: {
    scope: { axes: ['department', 'jurisdiction'], roleScopes: { GRO: { department: 'OWN', jurisdiction: 'OWN' }, SUPERVISOR: { department: 'OWN', jurisdiction: 'ALL' } }, default: { department: 'OWN', jurisdiction: 'OWN' } },
    attributes: { 'citizen.mobileNumber': SEEDED_MASK, 'citizen.name': SEEDED_MASK },
  } },
});

describe('scope (which complaints)', () => {
  it('a role the block does not state gets the default (R4)', () => {
    expect(effectiveScope(a2008().resource.complaint.scope as any, 'SUBCOUNTY_GRO')).toEqual({ levels: { jurisdiction: 'OWN', department: 'OWN' }, stated: null });
  });
  it('sets ONLY this role\'s entry; other roles, axes and default are byte-identical', () => {
    const before = a2008();
    const after = withRoleScope(before, 'SUBCOUNTY_GRO', { jurisdiction: 'OWN', department: 'ALL' }) as any;
    expect(after.resource.complaint.scope.roleScopes.SUBCOUNTY_GRO).toEqual({ department: 'ALL', jurisdiction: 'OWN' });
    expect(changedPaths(before, after)).toEqual([{ path: 'resource.complaint.scope.roleScopes.SUBCOUNTY_GRO', before: undefined, after: { jurisdiction: 'OWN', department: 'ALL' } }]);
    expect(before.resource.complaint.scope.roleScopes).not.toHaveProperty('SUBCOUNTY_GRO'); // input untouched
  });
  it('removing the entry falls back to the default', () => {
    const after = withRoleScope(a2008(), 'GRO', null) as any;
    expect(after.resource.complaint.scope.roleScopes).not.toHaveProperty('GRO');
    expect(after.resource.complaint.scope.roleScopes.SUPERVISOR).toBeDefined();
  });
  it('refuses an action without a scope block (creating one would change every role, R10)', () => {
    expect(() => withRoleScope({ id: 1, resource: {} }, 'X', { jurisdiction: 'ALL' })).toThrow(/NO_SCOPE_BLOCK/);
  });
  it('writes only the axes the block declares', () => {
    const d = a2008(); d.resource.complaint.scope.axes = ['jurisdiction'];
    expect((withRoleScope(d, 'R', { jurisdiction: 'OWN', department: 'ALL' }) as any).resource.complaint.scope.roleScopes.R).toEqual({ jurisdiction: 'OWN' });
  });
});

describe('conditions: pickers <-> JsonLogic', () => {
  const clauses: Clause[] = [
    ...PRESETS.map((p) => p.clause),
    { kind: 'oneOf', var: 'resource.complaint.status', values: ['PENDINGFORASSIGNMENT'] },
    { kind: 'not', clause: { kind: 'flag', var: 'user.attributes.tenantWide' } },
    { kind: 'all', clauses: [PRESETS[2].clause, { kind: 'oneOf', var: 'resource.complaint.department', values: ['HEALTH', 'WATER'] }] },
  ];
  it.each(clauses.map((c) => [JSON.stringify(c), c]))('round-trips %s', (_s, c) => {
    expect(fromJsonLogic(toJsonLogic(c as Clause))).toEqual(c);
  });
  it('parses the seeded condition exactly', () => {
    expect(fromJsonLogic(SEEDED_MASK.condition)).toEqual({ kind: 'any', clauses: [PRESETS.find((p) => p.id === 'tenantWide')!.clause, PRESETS.find((p) => p.id === 'filed')!.clause] });
  });
  it('emits only operators both engines translate (jsonlogic-rego.mjs: var == in and or ! )', () => {
    const ops = new Set<string>();
    const walk = (j: any) => { if (j && typeof j === 'object') { if (!Array.isArray(j)) Object.keys(j).forEach((k) => ops.add(k)); Object.values(j).forEach(walk); } };
    clauses.forEach((c) => walk(toJsonLogic(c)));
    for (const op of ops) expect(['var', '==', 'in', 'and', 'or', '!']).toContain(op);
  });
  it('rejects what it cannot show as pickers (free JsonLogic stays custom)', () => {
    expect(fromJsonLogic({ '>': [{ var: 'x' }, 3] })).toBeNull();
    expect(fromJsonLogic({ in: ['MDMS_ADMIN', { var: 'user.roles' }] })).toBeNull();
    expect(fromJsonLogic({ if: [true, 1, 2] })).toBeNull();
  });
  it('the JsonLogic means what the label says (json-logic-js, the reference evaluator)', () => {
    const inArea = toJsonLogic(PRESETS.find((p) => p.id === 'inArea')!.clause) as any;
    const doc = (boundary: string) => ({ user: { attributes: { jurisdictions: ['BOMET_SOTIK', 'BOMET_SOTIK_KIPSONOI'] } }, resource: { complaint: { boundary } } });
    expect(jsonLogic.apply(inArea, doc('BOMET_SOTIK_KIPSONOI'))).toBe(true);
    expect(jsonLogic.apply(inArea, doc('BOMET_BOMET_EAST_LONGISA'))).toBe(false);
  });
  it('flags vars an engine does not provide yet; the catalogue overlays labels', () => {
    const vocab = vocabulary([{ resource: 'complaint', attribute: 'locality', field: 'address.locality.code', conditionVar: 'resource.complaint.boundary', label: 'Ward or sub-county' }]);
    expect(vocab.find((x) => x.var === 'resource.complaint.boundary')!.label).toBe('Ward or sub-county');
    expect(unavailableVars(PRESETS.find((p) => p.id === 'assigned')!.clause, vocab)).toEqual(['resource.complaint.assignedToCaller']);
    expect(unavailableVars(PRESETS.find((p) => p.id === 'assigned')!.clause, vocabulary([], new Set(['resource.complaint.assignedToCaller'])))).toEqual([]);
    expect(unavailableVars({ kind: 'flag', var: 'resource.complaint.nonsense' }, BASE_VARS)).toEqual(['resource.complaint.nonsense']);
  });
});

describe('field rules (masking)', () => {
  const assigned = PRESETS.find((p) => p.id === 'assigned')!.clause;
  it('the seeded rule parses as two shared branches, no role branch', () => {
    const p = parseFieldRule(SEEDED_MASK as any);
    expect(p.custom).toBe(false);
    expect(p.shared).toHaveLength(2);
    expect(p.perRole).toEqual({});
  });
  it('adds a role branch in the normal form, keeps the shared branches and other roles', () => {
    const after = withRoleFieldRule(a2008(), 'citizen.mobileNumber', 'SUBCOUNTY_GRO', assigned, { strategy: 'MASK_SHOW_LAST_N', n: 3, maskChar: 'X' }) as any;
    const rule = after.resource.complaint.attributes['citizen.mobileNumber'];
    expect(rule.condition.or).toEqual([
      ...SEEDED_MASK.condition.or,
      { and: [{ in: ['SUBCOUNTY_GRO', { var: 'user.roles' }] }, { '==': [{ var: 'resource.complaint.assignedToCaller' }, true] }] },
    ]);
    expect(rule.onDeny).toEqual({ strategy: 'MASK_SHOW_LAST_N', n: 3, maskChar: 'X' });
    expect(after.resource.complaint.attributes['citizen.name']).toEqual(SEEDED_MASK); // other field untouched
    expect(parseFieldRule(rule).perRole).toEqual({ SUBCOUNTY_GRO: assigned });
  });
  it('the role branch holds only for that role and only when assigned (json-logic-js)', () => {
    const rule = (withRoleFieldRule(a2008(), 'citizen.mobileNumber', 'SUBCOUNTY_GRO', assigned) as any).resource.complaint.attributes['citizen.mobileNumber'];
    const doc = (roles: string[], assignedToCaller: boolean) => ({ user: { uuid: 'u1', roles, attributes: { tenantWide: false } }, resource: { complaint: { accountId: 'c1', assignedToCaller } } });
    expect(jsonLogic.apply(rule.condition, doc(['SUBCOUNTY_GRO'], true))).toBe(true);
    expect(jsonLogic.apply(rule.condition, doc(['SUBCOUNTY_GRO'], false))).toBe(false);
    expect(jsonLogic.apply(rule.condition, doc(['GRO'], true))).toBe(false);
    // before the engines carry user.roles the branch never holds: the field stays masked (fails closed)
    expect(jsonLogic.apply(rule.condition, { user: { uuid: 'u1', attributes: { tenantWide: false } }, resource: { complaint: { accountId: 'c1', assignedToCaller: true } } })).toBe(false);
  });
  it('removing the role branch restores the rule exactly', () => {
    const on = withRoleFieldRule(a2008(), 'citizen.mobileNumber', 'SUBCOUNTY_GRO', assigned);
    const off = withRoleFieldRule(on, 'citizen.mobileNumber', 'SUBCOUNTY_GRO', null) as any;
    expect(off.resource.complaint.attributes['citizen.mobileNumber']).toEqual(SEEDED_MASK);
  });
  it('a new field rule starts with the owner branch (the citizen always sees their own data)', () => {
    const after = withRoleFieldRule(a2008(), 'address.street', 'SUBCOUNTY_GRO', { kind: 'always' }) as any;
    expect(after.resource.complaint.attributes['address.street'].condition).toEqual({ or: [
      { '==': [{ var: 'resource.complaint.accountId' }, { var: 'user.uuid' }] },
      { and: [{ in: ['SUBCOUNTY_GRO', { var: 'user.roles' }] }, true] },
    ] });
  });
  it('never rewrites a custom condition', () => {
    const d = a2008() as any; d.resource.complaint.attributes['citizen.mobileNumber'] = { condition: { '>': [{ var: 'x' }, 1] }, onDeny: { strategy: 'REDACT' } };
    expect(parseFieldRule(d.resource.complaint.attributes['citizen.mobileNumber']).custom).toBe(true);
    expect(() => withRoleFieldRule(d, 'citizen.mobileNumber', 'R', assigned)).toThrow(/CUSTOM_CONDITION/);
  });
  it('an empty rule is never-shown (false), not always-shown', () => {
    expect(buildFieldRule({ shared: [], perRole: {}, onDeny: { strategy: 'REDACT' } }).condition).toBe(false);
  });
  it('preview = MaskingStrategy.java', () => {
    expect(maskPreview('0712345678', { strategy: 'MASK_SHOW_LAST_N', n: 3, maskChar: 'X' })).toBe('XXXXXXX678');
    expect(maskPreview('0712345678', { strategy: 'MASK_SHOW_LAST_N', n: 30 })).toBe('0712345678');
    expect(maskPreview('0712345678', { strategy: 'MASK_SHOW_LAST_N', n: 0, maskChar: '*' })).toBe('**********');
    expect(maskPreview('Jane', { strategy: 'REDACT' })).toBeNull();
    expect(maskPreview(null, { strategy: 'MASK_SHOW_LAST_N', n: 3 })).toBeNull();
  });
});

describe('capabilities and plain words', () => {
  const actions = [
    { id: 2008, url: '/pgr-services/v2/request/_search' }, { id: 2009, url: '/pgr-services/v2/request/_count' },
    { id: 2031, url: '/pgr-services/v2/request/_update' }, { id: 77, url: '/egov-hrms/employees/_create' },
  ];
  it('groups actions and reports partial grants', () => {
    expect(actionsOf('search', actions).map((a) => a.id)).toEqual([2008, 2009]);
    expect(capabilityState('search', actions, new Set([2008]))).toBe('partial');
    expect(capabilityState('search', actions, new Set([2008, 2009]))).toBe('on');
    expect(capabilityState('dashboard', actions, new Set())).toBe('none');
  });
  it('describes the role', () => {
    expect(plainWords({ caps: ['search', 'update'], levels: { jurisdiction: 'OWN', department: 'ALL' }, fields: [{ label: 'Citizen mobile', when: 'the complaint is assigned to them', onDeny: { strategy: 'MASK_SHOW_LAST_N', n: 3 } }] }))
      .toBe('Can search and view complaints, act on complaints (workflow actions). Sees complaints in the areas they cover, in every department, plus anything assigned to them. Citizen mobile is shown in full when the complaint is assigned to them, otherwise masked to the last 3 characters.');
  });
});
