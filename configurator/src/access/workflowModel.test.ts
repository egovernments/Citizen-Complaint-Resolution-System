import { roleGrid, sameDefinition, withRoleActions, type BusinessService } from './workflowModel';

// the seeded PGR definition (default-data-handler PgrWorkflowConfig.json), trimmed to what the grid reads
const PGR = (): BusinessService => ({
  businessService: 'PGR', tenantId: 'ke', businessServiceSla: 432000000,
  states: [
    { state: null, applicationStatus: null, actions: [{ action: 'APPLY', roles: ['CITIZEN', 'CSR'], nextState: 'PENDINGFORASSIGNMENT' }] },
    { state: 'PENDINGFORASSIGNMENT', applicationStatus: 'PENDINGFORASSIGNMENT', actions: [
      { action: 'COMMENT', roles: ['CITIZEN'], nextState: 'PENDINGFORASSIGNMENT' },
      { action: 'ASSIGN', roles: ['GRO', 'PGR_VIEWER'], nextState: 'PENDINGATLME' },
      { action: 'REJECT', roles: ['GRO', 'PGR_VIEWER'], nextState: 'REJECTED' }] },
    { state: 'PENDINGATLME', applicationStatus: 'PENDINGATLME', actions: [
      { action: 'REASSIGN', roles: ['PGR_LME', 'PGR_VIEWER'], nextState: 'PENDINGFORREASSIGNMENT' },
      { action: 'RESOLVE', roles: ['PGR_LME', 'PGR_VIEWER'], nextState: 'RESOLVED' }] },
    { state: 'RESOLVED', applicationStatus: 'RESOLVED', actions: [
      { action: 'RATE', roles: ['CFC', 'CITIZEN'], nextState: 'CLOSEDAFTERRESOLUTION' },
      { action: 'REOPEN', roles: ['CFC', 'CITIZEN', 'CSR', 'PGR_VIEWER'], nextState: 'PENDINGFORASSIGNMENT' }] },
    { state: 'CLOSEDAFTERRESOLUTION', applicationStatus: 'CLOSEDAFTERRESOLUTION', actions: [] },
  ],
});

describe('workflow actions by status', () => {
  it('a grid of the statuses where staff act, the staff actions, and the role\'s membership', () => {
    const g = roleGrid(PGR(), 'GRO');
    expect(g.statuses).toEqual(['PENDINGFORASSIGNMENT', 'PENDINGATLME', 'RESOLVED']);
    expect(g.actions).toEqual(['ASSIGN', 'REJECT', 'REASSIGN', 'RESOLVE', 'REOPEN']);
    expect(g.cell('PENDINGFORASSIGNMENT', 'ASSIGN')).toBe('on');
    expect(g.cell('PENDINGATLME', 'RESOLVE')).toBe('off');
    expect(g.cell('PENDINGFORASSIGNMENT', 'RESOLVE')).toBeNull(); // not an action there
  });
  it('an edit changes only this role in those actions; everything else is identical', () => {
    const before = PGR();
    const r = withRoleActions(before, 'SUBCOUNTY_GRO', { 'PENDINGFORASSIGNMENT|ASSIGN': true, 'PENDINGFORASSIGNMENT|REJECT': true, 'PENDINGATLME|RESOLVE': false })!;
    expect(r.changes).toEqual([{ status: 'PENDINGFORASSIGNMENT', action: 'ASSIGN', on: true }, { status: 'PENDINGFORASSIGNMENT', action: 'REJECT', on: true }]);
    const strip = (bs: BusinessService) => JSON.stringify(bs).replace(/,"SUBCOUNTY_GRO"/g, '');
    expect(strip(r.next)).toBe(strip(before));
    expect(r.next.states[1].actions![1].roles).toEqual(['GRO', 'PGR_VIEWER', 'SUBCOUNTY_GRO']);
    expect(before.states[1].actions![1].roles).toEqual(['GRO', 'PGR_VIEWER']); // input untouched
  });
  it('removing restores exactly; no-op edits change nothing', () => {
    const on = withRoleActions(PGR(), 'X', { 'PENDINGATLME|RESOLVE': true })!.next;
    const off = withRoleActions(on, 'X', { 'PENDINGATLME|RESOLVE': false })!.next;
    expect(off).toEqual(PGR());
    expect(withRoleActions(PGR(), 'GRO', { 'PENDINGFORASSIGNMENT|ASSIGN': true })).toBeNull();
  });
  it('refuses an action the status does not have (no new transitions from this screen)', () => {
    expect(() => withRoleActions(PGR(), 'X', { 'PENDINGFORASSIGNMENT|RESOLVE': true })).toThrow(/WORKFLOW_NO_SUCH_ACTION/);
  });
  it('concurrency compares the definition, not audit fields or role order', () => {
    const a = PGR(); const b = PGR();
    (b as any).auditDetails = { lastModifiedTime: 9 };
    b.states[1].actions![1].roles = ['PGR_VIEWER', 'GRO'];
    expect(sameDefinition(a, b)).toBe(true);
    b.states[1].actions![1].roles = ['PGR_VIEWER'];
    expect(sameDefinition(a, b)).toBe(false);
  });
});
