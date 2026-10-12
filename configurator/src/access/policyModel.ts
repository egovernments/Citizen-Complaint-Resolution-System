/**
 * The Role editor's model of the access policy, over the EXISTING MDMS shapes only (no new policy store):
 *
 *   ACCESSCONTROL-ROLES.roles                         the role (code, name, description)
 *   ACCESSCONTROL-ROLEACTIONS.roleactions             what it may call (one row per action; uid `<ROLE>.<actionid>`)
 *   ACCESSCONTROL-ACTIONS-TEST.actions-test 2008      resource.complaint.scope   (which complaints: roleScopes[ROLE])
 *                                                     resource.complaint.attributes.<path> {condition, onDeny}
 *                                                                                (which fields: masking)
 *
 * Conditions are JsonLogic, built from pickers and limited to what BOTH engines evaluate the same way
 * (pgr-services' PolicyEvaluator and utility/rbac-opa/src/jsonlogic-rego.mjs): var, ==, !=, in, and, or, !, !!.
 * Every function here is pure; the screen reads, edits a copy, shows the diff and writes it back.
 *
 * Field rules are shared by every role using the action (one condition + one onDeny per field). A role's own
 * "shown in full when" is one branch of the condition, in a normal form this module writes and parses back:
 *   {"or": [ <shared clause>..., {"and": [{"in": ["<ROLE>", {"var": "user.roles"}]}, <the role's clause>]}, ... ]}
 * A condition not in that form is reported as `custom` and never rewritten.
 */

export type Level = 'OWN' | 'ALL';
export type Axis = 'jurisdiction' | 'department';
export type RoleScope = Partial<Record<Axis, Level>>;

export interface ScopeBlock {
  axes?: string[];
  roleScopes?: Record<string, RoleScope>;
  default?: RoleScope;
}

export type Strategy = 'REDACT' | 'MASK_SHOW_LAST_N';
export interface OnDeny { strategy: Strategy; n?: number; maskChar?: string }
export interface FieldRule { condition?: unknown; onDeny?: OnDeny }

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------- scope (which complaints)

export const AXES: Axis[] = ['jurisdiction', 'department'];

export function scopeBlockOf(actionData: Record<string, unknown> | undefined): ScopeBlock | null {
  const s = (actionData as any)?.resource?.complaint?.scope;
  return isObj(s) ? (s as ScopeBlock) : null;
}

/** The role's levels as the engines resolve them for this role alone (R4): stated level, else the block's default. */
export function effectiveScope(block: ScopeBlock | null, role: string): { levels: Record<Axis, Level>; stated: RoleScope | null } {
  const stated = block?.roleScopes?.[role] ?? null;
  const levels = {} as Record<Axis, Level>;
  for (const a of AXES) levels[a] = (stated?.[a] ?? block?.default?.[a] ?? 'OWN') as Level;
  return { levels, stated };
}

/**
 * A copy of the action's data with ONLY roleScopes[role] changed (null removes the role's entry: it falls back to
 * the default). Refuses a row without a scope block: creating one changes every role's access (R10), which is not
 * a role edit.
 */
export function withRoleScope(actionData: Record<string, unknown>, role: string, scope: RoleScope | null): Record<string, unknown> {
  const out = clone(actionData) as any;
  const block = out?.resource?.complaint?.scope;
  if (!isObj(block)) throw new Error('NO_SCOPE_BLOCK: this action has no resource.complaint.scope; ask a policy admin to add one');
  const axes = Array.isArray(block.axes) ? block.axes : AXES;
  if (scope) {
    const entry: RoleScope = {};
    for (const a of AXES) if (axes.includes(a) && scope[a]) entry[a] = scope[a];
    block.roleScopes = { ...(block.roleScopes ?? {}), [role]: entry };
  } else if (isObj(block.roleScopes)) {
    delete block.roleScopes[role];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- condition vocabulary

/**
 * A variable a condition may name. `complaint` vars describe the record, `person` vars the caller. `requires` marks a
 * var an engine does not provide yet: the picker shows it disabled with that note (never writes it).
 */
export interface VarDef {
  var: string;
  label: string;
  side: 'complaint' | 'person';
  type: 'string' | 'boolean' | 'list';
  /** for a complaint var: the person var it is matched against ("is one of the person's ...") */
  personMatch?: string;
  /** where values come from, for an "is one of" picker */
  valueSource?: string;
  requires?: string;
}

/** What PolicyInputBuilder (Java) and the OPA input carry today, plus the agreed additions (cms-access, 2026-10-12). */
export const BASE_VARS: VarDef[] = [
  { var: 'resource.complaint.boundary', label: 'Area', side: 'complaint', type: 'string', personMatch: 'user.attributes.jurisdictions', valueSource: 'boundary-tree' },
  { var: 'resource.complaint.department', label: 'Department', side: 'complaint', type: 'string', personMatch: 'user.attributes.departments', valueSource: 'departments' },
  { var: 'resource.complaint.accountId', label: 'Filed by', side: 'complaint', type: 'string', personMatch: 'user.uuid', valueSource: 'citizens' },
  { var: 'resource.complaint.status', label: 'Status', side: 'complaint', type: 'string', valueSource: 'workflow-states', requires: 'resource.complaint.status (cms-access)' },
  { var: 'resource.complaint.assignedToCaller', label: 'Assigned to them', side: 'complaint', type: 'boolean', requires: 'resource.complaint.assignedToCaller (cms-access)' },
  { var: 'user.attributes.tenantWide', label: 'Covers the whole tenant', side: 'person', type: 'boolean' },
  { var: 'user.attributes.jurisdictions', label: 'Areas covered', side: 'person', type: 'list' },
  { var: 'user.attributes.departments', label: 'Departments', side: 'person', type: 'list' },
  { var: 'user.uuid', label: 'The person', side: 'person', type: 'string' },
  { var: 'user.roles', label: 'Roles', side: 'person', type: 'list', requires: 'user.roles in the complaint document (cms-access)' },
];

/** A catalogue row (ACCESSCONTROL-RESOURCE.attributes) with the optional picker fields. */
export interface CatalogueRow { resource: string; attribute: string; field: string; label?: string; valueSource?: string; conditionVar?: string; personMatch?: string }

/** The vocabulary: base vars, overlaid by catalogue rows that name a conditionVar (label / source / match from MDMS). */
export function vocabulary(catalogue: CatalogueRow[], available: Set<string> = new Set()): VarDef[] {
  const out: VarDef[] = BASE_VARS.map((v) => ({ ...v, requires: available.has(v.var) ? undefined : v.requires }));
  for (const row of catalogue) {
    if (row.resource !== 'complaint' || !row.conditionVar) continue;
    const at = out.findIndex((v) => v.var === row.conditionVar);
    const def: VarDef = { ...(at >= 0 ? out[at] : { var: row.conditionVar, side: 'complaint', type: 'string' }), label: row.label || (at >= 0 ? out[at].label : row.attribute) };
    if (row.personMatch) def.personMatch = row.personMatch;
    if (row.valueSource) def.valueSource = row.valueSource;
    if (at >= 0) out[at] = def; else out.push(def);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- clauses <-> JsonLogic

export type Clause =
  | { kind: 'always' }
  | { kind: 'flag'; var: string }                         // {"==": [{"var": v}, true]}
  | { kind: 'matchPerson'; var: string; personVar: string } // list person var: {"in": [...]}, else {"==": [...]}
  | { kind: 'oneOf'; var: string; values: string[] }
  | { kind: 'not'; clause: Clause }
  | { kind: 'all'; clauses: Clause[] }
  | { kind: 'any'; clauses: Clause[] };

const v = (name: string) => ({ var: name });
const varName = (n: unknown): string | null => (isObj(n) && Object.keys(n).length === 1 && typeof n.var === 'string' ? n.var : null);

export function toJsonLogic(c: Clause, vocab: VarDef[] = BASE_VARS): Json {
  switch (c.kind) {
    case 'always': return true;
    case 'flag': return { '==': [v(c.var), true] };
    case 'matchPerson': {
      const pv = vocab.find((x) => x.var === c.personVar);
      return pv?.type === 'list' ? { in: [v(c.var), v(c.personVar)] } : { '==': [v(c.var), v(c.personVar)] };
    }
    case 'oneOf': return { in: [v(c.var), [...c.values]] };
    case 'not': return { '!': [toJsonLogic(c.clause, vocab)] };
    case 'all': return { and: c.clauses.map((x) => toJsonLogic(x, vocab)) };
    case 'any': return { or: c.clauses.map((x) => toJsonLogic(x, vocab)) };
  }
}

/** The exact inverse of toJsonLogic; null for anything else (shown as a custom condition, never rewritten). */
export function fromJsonLogic(j: unknown): Clause | null {
  if (j === true) return { kind: 'always' };
  if (!isObj(j) || Object.keys(j).length !== 1) return null;
  const op = Object.keys(j)[0];
  const args = Array.isArray(j[op]) ? (j[op] as unknown[]) : [j[op]];
  if (op === '==' && args.length === 2) {
    const a = varName(args[0]);
    if (a && args[1] === true) return { kind: 'flag', var: a };
    const b = varName(args[1]);
    if (a && b) return { kind: 'matchPerson', var: a, personVar: b };
    return null;
  }
  if (op === 'in' && args.length === 2) {
    const a = varName(args[0]);
    if (!a) return null;
    const b = varName(args[1]);
    if (b) return { kind: 'matchPerson', var: a, personVar: b };
    if (Array.isArray(args[1]) && args[1].every((x) => typeof x === 'string')) return { kind: 'oneOf', var: a, values: args[1] as string[] };
    return null;
  }
  if (op === '!' && args.length === 1) { const c = fromJsonLogic(args[0]); return c && { kind: 'not', clause: c }; }
  if (op === 'and' || op === 'or') {
    const cs = args.map(fromJsonLogic);
    if (!cs.length || cs.some((c) => !c)) return null;
    return { kind: op === 'and' ? 'all' : 'any', clauses: cs as Clause[] };
  }
  return null;
}

/** Variables a clause names (to check them against the vocabulary before saving). */
export function varsOf(c: Clause): string[] {
  switch (c.kind) {
    case 'always': return [];
    case 'flag': case 'oneOf': return [c.var];
    case 'matchPerson': return [c.var, c.personVar];
    case 'not': return varsOf(c.clause);
    default: return c.clauses.flatMap(varsOf);
  }
}

/** Vars a clause uses that an engine does not evaluate yet (or that are not in the vocabulary at all). */
export function unavailableVars(c: Clause, vocab: VarDef[]): string[] {
  return [...new Set(varsOf(c))].filter((name) => { const d = vocab.find((x) => x.var === name); return !d || !!d.requires; });
}

/** The ready-made choices of the "Shown in full when" picker (design screen 1). */
export const PRESETS: { id: string; label: string; clause: Clause }[] = [
  { id: 'always', label: 'always', clause: { kind: 'always' } },
  { id: 'assigned', label: 'the complaint is assigned to them', clause: { kind: 'flag', var: 'resource.complaint.assignedToCaller' } },
  { id: 'filed', label: 'they filed it', clause: { kind: 'matchPerson', var: 'resource.complaint.accountId', personVar: 'user.uuid' } },
  { id: 'tenantWide', label: 'they cover the whole tenant', clause: { kind: 'flag', var: 'user.attributes.tenantWide' } },
  { id: 'inArea', label: 'the complaint is in their areas', clause: { kind: 'matchPerson', var: 'resource.complaint.boundary', personVar: 'user.attributes.jurisdictions' } },
  { id: 'inDept', label: 'the complaint is in their departments', clause: { kind: 'matchPerson', var: 'resource.complaint.department', personVar: 'user.attributes.departments' } },
];

export function describeClause(c: Clause, vocab: VarDef[] = BASE_VARS): string {
  const preset = PRESETS.find((p) => JSON.stringify(p.clause) === JSON.stringify(c));
  if (preset) return preset.label;
  const label = (name: string) => vocab.find((x) => x.var === name)?.label ?? name;
  switch (c.kind) {
    case 'always': return 'always';
    case 'flag': return `${label(c.var).toLowerCase()}`;
    case 'matchPerson': return `${label(c.var).toLowerCase()} matches the person's ${label(c.personVar).toLowerCase()}`;
    case 'oneOf': return `${label(c.var).toLowerCase()} is one of ${c.values.join(', ')}`;
    case 'not': return `not (${describeClause(c.clause, vocab)})`;
    case 'all': return c.clauses.map((x) => describeClause(x, vocab)).join(' and ');
    case 'any': return c.clauses.map((x) => describeClause(x, vocab)).join(' or ');
  }
}

// ---------------------------------------------------------------------------------------------- field rules (masking)

const roleGuard = (role: string) => ({ in: [role, v('user.roles')] });
const isRoleGuard = (j: unknown): string | null => {
  if (!isObj(j) || !Array.isArray(j.in) || j.in.length !== 2) return null;
  return typeof j.in[0] === 'string' && varName(j.in[1]) === 'user.roles' ? j.in[0] : null;
};

export interface ParsedRule {
  shared: Clause[];                       // branches that hold for every role
  perRole: Record<string, Clause>;        // branches that hold only for one role
  onDeny: OnDeny;
  custom: boolean;                        // not in the normal form: read-only here
}

export function parseFieldRule(rule: FieldRule | undefined): ParsedRule {
  const onDeny = normaliseOnDeny(rule?.onDeny);
  const empty: ParsedRule = { shared: [], perRole: {}, onDeny, custom: false };
  if (!rule || rule.condition === undefined) return empty;
  const top = rule.condition;
  const branches = isObj(top) && Object.keys(top).length === 1 && Array.isArray(top.or) ? (top.or as unknown[]) : [top];
  const out: ParsedRule = { ...empty, shared: [], perRole: {} };
  for (const b of branches) {
    if (isObj(b) && Array.isArray(b.and) && b.and.length === 2 && isRoleGuard(b.and[0])) {
      const role = isRoleGuard(b.and[0]) as string;
      const c = fromJsonLogic(b.and[1]);
      if (!c || out.perRole[role]) return { ...out, custom: true };
      out.perRole[role] = c;
      continue;
    }
    const c = fromJsonLogic(b);
    if (!c) return { ...out, custom: true };
    out.shared.push(c);
  }
  return out;
}

export function buildFieldRule(p: Omit<ParsedRule, 'custom'>, vocab: VarDef[] = BASE_VARS): FieldRule {
  const branches: Json[] = [
    ...p.shared.map((c) => toJsonLogic(c, vocab)),
    // keep the row's own branch order (a new role goes last): a re-save never reorders a shared condition
    ...Object.keys(p.perRole).map((r) => ({ and: [roleGuard(r), toJsonLogic(p.perRole[r], vocab)] }) as Json),
  ];
  // no branch at all = never shown in full (the engines fail closed on a false condition)
  const condition: Json = branches.length === 0 ? false : branches.length === 1 ? branches[0] : { or: branches };
  return { condition, onDeny: normaliseOnDeny(p.onDeny) };
}

export function normaliseOnDeny(o: Partial<OnDeny> | undefined): OnDeny {
  if (o?.strategy === 'MASK_SHOW_LAST_N') {
    const n = Math.max(0, Math.min(20, Math.floor(Number(o.n ?? 0)) || 0));
    const maskChar = typeof o.maskChar === 'string' && o.maskChar.length === 1 ? o.maskChar : 'X';
    return { strategy: 'MASK_SHOW_LAST_N', n, maskChar };
  }
  return { strategy: 'REDACT' };
}

/** What the person sees when the field is masked: MaskingStrategy.java, same rules (null stays null). */
export function maskPreview(value: string | null | undefined, onDeny: OnDeny): string | null {
  if (value === null || value === undefined) return null;
  const d = normaliseOnDeny(onDeny);
  if (d.strategy === 'REDACT') return null;
  const keep = Math.max(0, Math.min(d.n ?? 0, value.length));
  return (d.maskChar ?? 'X').repeat(value.length - keep) + value.slice(value.length - keep);
}

/**
 * A copy of the action's data with the role's branch of one field rule set (clause) or removed (null), and the
 * field's onDeny set when given. Refuses a custom (unparseable) condition.
 */
export function withRoleFieldRule(actionData: Record<string, unknown>, path: string, role: string, clause: Clause | null, onDeny?: OnDeny, vocab: VarDef[] = BASE_VARS): Record<string, unknown> {
  const out = clone(actionData) as any;
  out.resource = isObj(out.resource) ? out.resource : {};
  out.resource.complaint = isObj(out.resource.complaint) ? out.resource.complaint : {};
  const attrs = (out.resource.complaint.attributes = isObj(out.resource.complaint.attributes) ? out.resource.complaint.attributes : {});
  const existing = attrs[path] as FieldRule | undefined;
  const parsed = parseFieldRule(existing);
  if (parsed.custom) throw new Error(`CUSTOM_CONDITION: ${path} has a condition this editor cannot rewrite; change it in Policy rows`);
  if (!existing && !clause) return out;
  if (clause) parsed.perRole[role] = clause; else delete parsed.perRole[role];
  if (onDeny) parsed.onDeny = onDeny;
  // a new rule starts from the one shared branch every rule has had so far: the owner of the complaint sees it
  if (!existing) parsed.shared = [PRESETS.find((p) => p.id === 'filed')!.clause];
  attrs[path] = buildFieldRule(parsed, vocab);
  return out;
}

/** The fields the design lists; any other path present on the action is shown too. */
export const KNOWN_FIELDS: { path: string; label: string; sample: string }[] = [
  { path: 'citizen.mobileNumber', label: 'Citizen mobile', sample: '0712345678' },
  { path: 'citizen.name', label: 'Citizen name', sample: 'Jane Test' },
  { path: 'citizen.userName', label: 'Citizen user name', sample: '0712345678' },
  { path: 'citizen.emailId', label: 'Citizen email', sample: 'jane@example.org' },
  { path: 'address.street', label: 'Address: street', sample: 'Market Road' },
  { path: 'address.landmark', label: 'Address: landmark', sample: 'near the market' },
];

// ---------------------------------------------------------------------------------------------- capabilities (role-actions)

export interface ActionRow { id: number; url: string; displayName?: string }

/** Capabilities a complaints role is described in; each opens every action whose url matches. */
export const CAPABILITIES: { id: string; label: string; urls: RegExp }[] = [
  { id: 'search', label: 'Search and view complaints', urls: /^\/pgr-services\/v2\/request\/_(search|count)$|^\/inbox\/v2\/_search$|^\/egov-workflow-v2\/egov-wf\/process\/_search$|^\/pgr-services\/v2\/employee\/_context$/ },
  { id: 'update', label: 'Act on complaints (workflow actions)', urls: /^\/pgr-services\/v2\/request\/_update$/ },
  { id: 'create', label: 'File a complaint for a citizen', urls: /^\/pgr-services\/v2\/request\/_create$/ },
  { id: 'dashboard', label: 'See the complaints dashboard', urls: /^\/pgr-services\/v2\/analytics\// },
  { id: 'employees', label: 'Look up employees (assign picker)', urls: /^\/egov-hrms\/employees\/_search$/ },
  { id: 'manageEmployees', label: 'Manage employees', urls: /^\/egov-hrms\/employees\/_(create|update)$/ },
];

/** Capabilities the workflow's actions need: switched off, the role's workflow actions go too (same save). */
export const WORKFLOW_CAPABILITIES = ['update'];

export function actionsOf(capability: string, actions: ActionRow[]): ActionRow[] {
  const cap = CAPABILITIES.find((c) => c.id === capability);
  return cap ? actions.filter((a) => cap.urls.test(a.url)) : [];
}

/** A capability is on when the role holds an ACTIVE grant for every action it opens (and it opens at least one). */
export function capabilityState(capability: string, actions: ActionRow[], held: Set<number>): 'on' | 'partial' | 'off' | 'none' {
  const ids = actionsOf(capability, actions).map((a) => a.id);
  if (!ids.length) return 'none';
  const n = ids.filter((i) => held.has(i)).length;
  return n === ids.length ? 'on' : n === 0 ? 'off' : 'partial';
}

export const roleActionUid = (role: string, actionId: number) => `${role}.${actionId}`;

// ---------------------------------------------------------------------------------------------- plain words + diff

export function plainWords(p: { caps: string[]; levels: Record<Axis, Level>; fields: { label: string; when: string | null; onDeny: OnDeny }[] }): string {
  const parts: string[] = [];
  const can = CAPABILITIES.filter((c) => p.caps.includes(c.id)).map((c) => c.label.toLowerCase());
  parts.push(can.length ? `Can ${can.join(', ')}.` : 'Cannot do anything yet.');
  const area = p.levels.jurisdiction === 'ALL' ? 'in every area of the tenant' : 'in the areas they cover';
  const dept = p.levels.department === 'ALL' ? 'in every department' : 'in their own departments';
  parts.push(`Sees complaints ${area}, ${dept}, plus anything assigned to them.`);
  for (const f of p.fields) {
    const mask = f.onDeny.strategy === 'REDACT' ? 'hidden' : `masked to the last ${f.onDeny.n} characters`;
    parts.push(f.when ? `${f.label} is shown in full when ${f.when}, otherwise ${mask}.` : `${f.label} is always ${mask}.`);
  }
  return parts.join(' ');
}

/** Changed leaf paths between two JSON values (for the "you are about to change" panel). */
export function changedPaths(a: unknown, b: unknown, at = ''): { path: string; before: unknown; after: unknown }[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (isObj(a) && isObj(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((k) => changedPaths(a[k], b[k], at ? `${at}.${k}` : k));
  }
  return [{ path: at || '(root)', before: a, after: b }];
}
