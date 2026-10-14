/**
 * Check access (design screen 3): the request to pgr-services' read-only explain API and the reading of its answer
 * (contract: docs/design/access-explain.md in ChakshuGautam/ccrs-digit3, "Agreed" + "Stable reason codes").
 * The API answers in codes, ids and MDMS row ids only (no personal data); the sentences are made here.
 */

export const EXPLAIN_PATH = '/pgr-services/v2/access/_explain';
export const SEARCH_URL = '/pgr-services/v2/request/_search';
export const UPDATE_URL = '/pgr-services/v2/request/_update';

export type ActionChoice = 'search' | 'view' | 'ASSIGN' | 'REASSIGN' | 'REJECT' | 'RESOLVE' | 'REOPEN' | 'RATE' | 'COMMENT';
export const ACTION_CHOICES: { id: ActionChoice; label: string }[] = [
  { id: 'search', label: 'Search complaints (counts)' },
  { id: 'view', label: 'See this complaint' },
  { id: 'ASSIGN', label: 'Assign' },
  { id: 'REASSIGN', label: 'Reassign' },
  { id: 'REJECT', label: 'Reject' },
  { id: 'RESOLVE', label: 'Resolve' },
  { id: 'REOPEN', label: 'Reopen' },
  { id: 'RATE', label: 'Rate' },
  { id: 'COMMENT', label: 'Comment' },
];

export interface ExplainForm { subjectUuid: string; action: ActionChoice; tenantId: string; serviceRequestId?: string }

export function buildExplainBody(f: ExplainForm, requestInfo: Record<string, unknown>): Record<string, unknown> {
  if (!f.subjectUuid) throw new Error('Pick a person first');
  if (!f.tenantId) throw new Error('Pick a tenant');
  const srid = f.serviceRequestId?.trim();
  if (f.action !== 'search' && !srid) throw new Error('This check needs a complaint number');
  const workflow = f.action !== 'search' && f.action !== 'view';
  return {
    RequestInfo: requestInfo,
    subject: { userUuid: f.subjectUuid },
    action: workflow
      ? { kind: 'workflow', url: UPDATE_URL, businessService: 'PGR', workflowAction: f.action }
      : { kind: f.action, url: SEARCH_URL },
    ...(srid ? { complaint: { serviceRequestId: srid, tenantId: f.tenantId } } : { tenantId: f.tenantId }),
  };
}

// ------------------------------------------------------------------------------------------------ the answer

export interface Src { schema: string; id: string; role?: string }
export interface Check { id: string; ok: boolean; rule?: string | null; detail?: { attribute?: string; op?: string; values?: unknown[]; value?: unknown }; src?: Src[] }
export interface ExplainAnswer {
  decision: 'allow' | 'deny';
  reason: string;
  checks?: Check[];
  layers?: {
    gateway?: { opa?: string; rbac?: string; reason?: string; matched_roles?: string[]; src?: Src[] };
    pgr?: { opa?: string; reason?: string; branch?: number | null; branches?: number; mode?: string; java?: string };
    workflow?: { status?: string; offered?: string[]; allowed?: string[]; action?: { code: string; offered: boolean; allowed: boolean }; gap?: string | null; error?: string };
    menus?: { visible?: boolean; items?: string[] };
  };
  subject?: { uuid: string; type?: string; roles?: { code: string; tenantId: string }[] };
  counts?: { inScope?: number; ownAssigned?: number; total?: number; error?: string };
  masks?: Record<string, unknown>;
  policyRevision?: string | null;
}

/** The stable reason codes (access-explain.md) in words. An unknown code is shown as itself. */
export const REASONS: Record<string, string> = {
  ALLOW: 'Every layer allows it',
  NOT_AN_ADMIN_HERE: 'You need ACCOUNT_ADMIN or MDMS_ADMIN at this tenant (and the person\'s) to check access here',
  NO_GRANT_REACHES_TENANT: 'None of the person\'s roles is granted at this tenant or above',
  TENANT_NOT_COVERED: 'The complaint\'s tenant is outside the tenants the person\'s roles reach',
  OUTSIDE_JURISDICTION: 'The complaint\'s area is outside the areas the person covers',
  DEPT_MISMATCH: 'The complaint\'s department is not one of the person\'s departments',
  NOT_OWN_COMPLAINT: 'A citizen sees only the complaints they filed',
  NOT_ASSIGNED: 'The complaint is not assigned to the person',
  OUT_OF_SCOPE: 'The complaint is outside what the person\'s roles may see',
  DENY_ROLE: 'None of the person\'s roles may call this',
  TENANT_NOT_GRANTED: 'The person holds no role at this tenant',
  TENANT_OUTSIDE_REALM: 'The tenant is in another state',
  NO_RESOURCE: 'This call is not configured for any role',
  NO_ROLES: 'The person has no roles',
  MASTERS_CONDITION: 'A settings condition refuses it',
  UNKNOWN_REALM: 'The tenant\'s state is not configured',
  BOUNDARY_OUTSIDE_JURISDICTION: 'The area is outside the person\'s areas',
  UNAUTHENTICATED: 'Not signed in',
  ALLOW_ROLE: 'A role of the person may call this',
  ROLE_ACTION: 'A role of the person may call this',
  WORKFLOW_OFFERS_WHAT_PGR_REFUSES: 'The workflow offers this action, but the complaint is outside what the person may see, so it would be refused',
};
export const reasonText = (code?: string | null) => (code ? REASONS[code] ?? code : '');

const CHECK_LABEL: Record<string, string> = {
  tenant: 'Tenant', 'scope.jurisdiction': 'Area', 'scope.department': 'Department', own_complaint: 'Filed by them', own_assignment: 'Assigned to them',
};
const RULE_TEXT: Record<string, string> = {
  R1: 'a grant reaches its tenant and the tenants below', R5: 'the area must be one the person covers, or below one',
  R6: 'the department must be one of theirs', R8: 'a citizen sees what they filed',
};

const list = (v: unknown) => (Array.isArray(v) ? (v.length > 6 ? `${v.slice(0, 6).join(', ')} and ${v.length - 6} more` : v.join(', ')) : String(v ?? ''));

/** One check in words: "Area does not match: BOMET_BOMET_EAST_LONGISA is not in BOMET_SOTIK, ..." */
export function checkSentence(c: Check): string {
  const label = CHECK_LABEL[c.id] ?? c.id;
  const d = c.detail ?? {};
  const value = d.value === undefined || d.value === null ? 'unknown' : String(d.value);
  const op = d.op === 'subtree' ? 'inside' : d.op === 'not_subtree' ? 'outside' : d.op === 'eq' ? '' : 'one of';
  const against = list(d.values);
  const body = d.values === undefined ? '' : c.ok ? `${value} is ${op} ${against}`.replace('  ', ' ') : `${value} is not ${op} ${against}`.replace('  ', ' ');
  return `${label} ${c.ok ? 'matches' : 'does not match'}${body ? `: ${body}` : ''}`;
}
export const ruleText = (r?: string | null) => (r ? `${r}: ${RULE_TEXT[r] ?? ''}`.replace(/: $/, '') : '');

export interface LayerRow { layer: string; answer: string; ok: boolean | null; detail: string }

export function layerRows(a: ExplainAnswer): LayerRow[] {
  const L = a.layers ?? {};
  const rows: LayerRow[] = [];
  if (L.menus) rows.push({ layer: 'Menus and buttons', answer: L.menus.visible ? 'Shown' : 'Hidden', ok: !!L.menus.visible, detail: (L.menus.items ?? []).join(', ') });
  if (L.gateway) {
    const ok = L.gateway.opa === 'allow' && L.gateway.rbac !== 'deny';
    rows.push({ layer: 'Gateway', answer: ok ? 'Allowed' : 'Denied', ok,
      detail: `${reasonText(L.gateway.reason)}${L.gateway.matched_roles?.length ? ` (${L.gateway.matched_roles.join(', ')})` : ''}; OPA ${L.gateway.opa ?? '?'}, role check ${L.gateway.rbac ?? '?'}` });
  }
  if (L.pgr) {
    const ok = L.pgr.opa === 'allow';
    const mode = L.pgr.mode === 'delegate' ? 'OPA decides' : L.pgr.mode === 'shadow' ? 'OPA compared, Java decides' : L.pgr.mode ?? '';
    rows.push({ layer: 'Complaint service', answer: ok ? 'Allowed' : 'Denied', ok,
      detail: `${reasonText(L.pgr.reason)}${mode ? ` (${mode}${L.pgr.java ? `; Java ${L.pgr.java}` : ''})` : ''}` });
  }
  if (L.workflow) {
    const w = L.workflow;
    if (w.error) rows.push({ layer: 'Workflow', answer: 'Unavailable', ok: null, detail: w.error });
    else {
      const act = w.action;
      const ok = act ? act.allowed : (w.allowed ?? []).length > 0;
      rows.push({ layer: 'Workflow', answer: act ? (act.allowed ? 'Offered' : act.offered ? 'Offered, refused' : 'Not offered') : `${(w.allowed ?? []).length} action(s)`, ok,
        detail: `${w.status ?? ''}: offers ${(w.offered ?? []).join(', ') || 'nothing'}${w.gap ? `. ${reasonText(w.gap)}` : ''}` });
    }
  }
  return rows;
}

/** The headline: "Denied: The complaint's area is outside the areas the person covers". */
export function headline(a: ExplainAnswer): { ok: boolean; text: string } {
  const ok = a.decision === 'allow';
  return { ok, text: ok ? 'Allowed' : reasonText(a.reason) || 'Denied' };
}
