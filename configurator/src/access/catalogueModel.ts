/**
 * Attributes (design screen 5): what access can be judged on. The complaint attributes are the
 * ACCESSCONTROL-RESOURCE.attributes rows (#1398; the picker fields label / valueSource / conditionVar / personMatch
 * since #1450); the person attributes are what the policy document carries about the caller.
 * Only the picker fields are edited here: field / operators / columns drive pgr's SQL and OPA's filter.
 */

export const RESOURCE_ATTRS = 'ACCESSCONTROL-RESOURCE.attributes';
export const VALUE_SOURCES = ['boundary-tree', 'departments', 'tenant-tree', 'workflow-states', 'employees', 'citizens', 'service-defs'] as const;
export type ValueSource = typeof VALUE_SOURCES[number];

export const SOURCE_TEXT: Record<string, string> = {
  'boundary-tree': 'Area tree of the county', departments: 'Departments list', 'tenant-tree': 'Tenant tree', 'workflow-states': 'Workflow states',
  employees: 'Employees', citizens: 'Citizens', 'service-defs': 'Complaint types',
};
export const OPERATOR_TEXT: Record<string, string> = { subtree: 'is inside', not_subtree: 'is outside', in: 'is one of', eq: 'is' };

export interface AttrRow {
  resource: string; attribute: string; field: string; operators: string[]; columns: Record<string, string>;
  description?: string; label?: string; valueSource?: string; conditionVar?: string; personMatch?: string;
}

/** Person attributes: what the policy document carries about whoever asks (PolicyInputBuilder + #1424). */
export const PERSON_ATTRS: { var: string; label: string; example: string }[] = [
  { var: 'user.roles', label: 'Roles, at the complaint\'s tenant', example: 'Sub-county GRO at Bomet' },
  { var: 'user.attributes.jurisdictions', label: 'Areas covered', example: 'Sotik sub-county and its wards' },
  { var: 'user.attributes.departments', label: 'Departments', example: 'All, or Health' },
  { var: 'user.attributes.tenantWide', label: 'Covers the whole tenant', example: 'yes / no' },
  { var: 'user.uuid', label: 'The person', example: 'the person asking' },
  { var: 'user.type', label: 'Type', example: 'Employee / Citizen' },
];

/** Which scope axis an attribute is: the complaint-search scope's OWN levels filter by it. */
const AXIS_OF: Record<string, string> = { locality: 'jurisdiction', department: 'department' };

/** The roles whose complaint scope uses an attribute (design "Used by"). */
export function usedBy(attr: string, scope: { roleScopes?: Record<string, Record<string, string>>; default?: Record<string, string> } | null | undefined): { roles: string[]; note: string } {
  if (attr === 'tenant') return { roles: [], note: 'every role (a grant reaches its tenant and below)' };
  if (attr === 'account') return { roles: ['CITIZEN'], note: 'citizens (their own complaints)' };
  const axis = AXIS_OF[attr];
  if (!axis) return { roles: [], note: 'not used yet' };
  const roles = Object.entries(scope?.roleScopes ?? {}).filter(([, l]) => l?.[axis] === 'OWN').map(([r]) => r).sort();
  const def = scope?.default?.[axis] === 'OWN';
  return { roles, note: `${roles.length} role(s) with "only their own" ${axis === 'jurisdiction' ? 'areas' : 'departments'}${def ? ', and every role the scope does not name' : ''}` };
}

/** Validate the picker fields an admin may change; returns the row to write (only those keys changed). */
export function withPickerFields(row: AttrRow, edit: Partial<Pick<AttrRow, 'label' | 'valueSource' | 'conditionVar' | 'personMatch' | 'description'>>): AttrRow {
  const out: AttrRow = JSON.parse(JSON.stringify(row));
  for (const [k, raw] of Object.entries(edit)) {
    const v = typeof raw === 'string' ? raw.trim() : raw;
    if (v === '' || v === undefined) { delete (out as any)[k]; continue; }
    if (k === 'valueSource' && !(VALUE_SOURCES as readonly string[]).includes(v as string)) throw new Error(`valueSource must be one of ${VALUE_SOURCES.join(', ')}`);
    if (k === 'conditionVar' && !/^(resource|user)\.[A-Za-z0-9_.]+$/.test(v as string)) throw new Error('conditionVar: resource.… or user.…');
    if (k === 'personMatch' && !/^user\.[A-Za-z0-9_.]+$/.test(v as string)) throw new Error('personMatch: user.…');
    (out as any)[k] = v;
  }
  return out;
}

/** The fields the engines read must be byte-identical before and after an edit here. */
export const engineFieldsUnchanged = (a: AttrRow, b: AttrRow) =>
  JSON.stringify([a.resource, a.attribute, a.field, a.operators, a.columns]) === JSON.stringify([b.resource, b.attribute, b.field, b.operators, b.columns]);
