import { buildExplainBody, checkSentence, headline, layerRows, reasonText, REASONS, UPDATE_URL, SEARCH_URL, type ExplainAnswer } from './explainModel';

const RI = { apiId: 'Rainmaker' };

// the shape cms.explain + AccessExplainService answer (docs/design/access-explain.md "Agreed"): a ward GRO, outside
const OUTSIDE: ExplainAnswer = {
  decision: 'deny', reason: 'OUTSIDE_JURISDICTION',
  checks: [
    { id: 'tenant', ok: true, rule: 'R1', detail: { attribute: 'tenant', op: 'subtree', values: ['ke.bomet'], value: 'ke.bomet' }, src: [{ schema: 'ACCESSCONTROL-RESOURCE.attributes', id: 'complaint.tenant' }] },
    { id: 'scope.jurisdiction', ok: false, rule: 'R5', detail: { attribute: 'locality', op: 'in', values: ['BOMET_SOTIK', 'BOMET_SOTIK_KIPSONOI'], value: 'BOMET_BOMET_EAST_LONGISA' }, src: [{ schema: 'ACCESSCONTROL-RESOURCE.attributes', id: 'complaint.locality' }] },
  ],
  layers: {
    gateway: { opa: 'allow', rbac: 'allow', reason: 'ALLOW_ROLE', matched_roles: ['SUBCOUNTY_GRO'], src: [{ schema: 'ACCESSCONTROL-ROLEACTIONS.roleactions', id: 'SUBCOUNTY_GRO.2031', role: 'SUBCOUNTY_GRO' }] },
    pgr: { opa: 'deny', reason: 'OUTSIDE_JURISDICTION', branch: 0, branches: 2, mode: 'delegate' },
    workflow: { status: 'PENDINGFORASSIGNMENT', offered: ['ASSIGN', 'REJECT'], allowed: [], action: { code: 'ASSIGN', offered: true, allowed: false }, gap: 'WORKFLOW_OFFERS_WHAT_PGR_REFUSES' },
  },
  counts: { inScope: 214, ownAssigned: 3, total: 1210 },
};

describe('the request', () => {
  it('a workflow action on a complaint', () => {
    expect(buildExplainBody({ subjectUuid: 'u1', action: 'ASSIGN', tenantId: 'ke.bomet', serviceRequestId: ' KE-PGR-1 ' }, RI)).toEqual({
      RequestInfo: RI, subject: { userUuid: 'u1' },
      action: { kind: 'workflow', url: UPDATE_URL, businessService: 'PGR', workflowAction: 'ASSIGN' },
      complaint: { serviceRequestId: 'KE-PGR-1', tenantId: 'ke.bomet' },
    });
  });
  it('a search at a tenant (no complaint) carries tenantId at the top', () => {
    expect(buildExplainBody({ subjectUuid: 'u1', action: 'search', tenantId: 'ke.bomet' }, RI)).toEqual({
      RequestInfo: RI, subject: { userUuid: 'u1' }, action: { kind: 'search', url: SEARCH_URL }, tenantId: 'ke.bomet',
    });
  });
  it('refuses incomplete questions', () => {
    expect(() => buildExplainBody({ subjectUuid: '', action: 'search', tenantId: 'ke' }, RI)).toThrow(/person/);
    expect(() => buildExplainBody({ subjectUuid: 'u', action: 'view', tenantId: 'ke' }, RI)).toThrow(/complaint number/);
  });
});

describe('the answer in words', () => {
  it('headline from the reason code', () => {
    expect(headline(OUTSIDE)).toEqual({ ok: false, text: "The complaint's area is outside the areas the person covers" });
    expect(headline({ decision: 'allow', reason: 'ALLOW' }).text).toBe('Allowed');
  });
  it('each check names the value and what it was compared with', () => {
    expect(checkSentence(OUTSIDE.checks![0])).toBe('Tenant matches: ke.bomet is inside ke.bomet');
    expect(checkSentence(OUTSIDE.checks![1])).toBe('Area does not match: BOMET_BOMET_EAST_LONGISA is not one of BOMET_SOTIK, BOMET_SOTIK_KIPSONOI');
  });
  it('layers: gateway allows, the complaint service refuses (OPA decides), the workflow offers what pgr refuses', () => {
    expect(layerRows(OUTSIDE).map((r) => [r.layer, r.answer, r.ok])).toEqual([
      ['Gateway', 'Allowed', true], ['Complaint service', 'Denied', false], ['Workflow', 'Offered, refused', false],
    ]);
    expect(layerRows(OUTSIDE)[1].detail).toContain('OPA decides');
    expect(layerRows(OUTSIDE)[2].detail).toContain('would be refused');
  });
  it('every stable code from the contract has words; an unknown one is shown as itself', () => {
    for (const c of ['ALLOW', 'NOT_AN_ADMIN_HERE', 'NO_GRANT_REACHES_TENANT', 'TENANT_NOT_COVERED', 'OUTSIDE_JURISDICTION', 'DEPT_MISMATCH',
      'NOT_OWN_COMPLAINT', 'NOT_ASSIGNED', 'OUT_OF_SCOPE', 'DENY_ROLE', 'TENANT_NOT_GRANTED', 'TENANT_OUTSIDE_REALM', 'NO_RESOURCE', 'NO_ROLES',
      'MASTERS_CONDITION', 'UNKNOWN_REALM', 'BOUNDARY_OUTSIDE_JURISDICTION', 'UNAUTHENTICATED', 'WORKFLOW_OFFERS_WHAT_PGR_REFUSES']) expect(REASONS[c]).toBeTruthy();
    expect(reasonText('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
