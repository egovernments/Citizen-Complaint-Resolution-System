/**
 * Tenants, people and areas (design screen 2): grant a role at a tenant node, with the areas the person covers.
 * Writes the EXISTING HRMS employee: user.roles gets {code, tenantId = the node}; jurisdictions get the areas.
 * Departments come from the person's assignments and are shown, not edited here.
 *
 * The link-role rule (CAP-06 #955) is mirrored from identity-bff's membership/link-role-rule.ts so the screen can
 * explain a refusal before sending; the server still decides (user-compat answers 403 ROLE_ESCALATION_FORBIDDEN).
 */

export interface Grant { code: string; tenantId: string }
export type GrantDenial = 'CROSS_STATE' | 'NOT_MEMBER_ADMIN' | 'ROLE_NOT_HELD';
export const MEMBER_ADMIN_ROLE = 'ACCOUNT_ADMIN';
const ALIASES: Record<string, string> = { TENANT_ADMIN: MEMBER_ADMIN_ROLE };
const EXTRA_ADMINISTRATIVE = new Set(['SUPERUSER']);
const MEMBERSHIP_ROLES = new Set([MEMBER_ADMIN_ROLE, 'SUPERUSER']);
const canonical = (c: string) => ALIASES[c] ?? c;
const isAdministrative = (c: string) => EXTRA_ADMINISTRATIVE.has(canonical(c)) || /_ADMIN$/.test(canonical(c));
const rootOf = (t: string) => t.split('.')[0];
export const isWithin = (t: string, n: string) => t === n || t.startsWith(`${n}.`);

export function heldAt(grants: Grant[], node: string): Set<string> {
  const held = new Set<string>();
  for (const g of grants) if (rootOf(g.tenantId) === rootOf(node) && isWithin(node, g.tenantId)) held.add(canonical(g.code));
  return held;
}

export function mayGrant(grants: Grant[], role: string, node: string): { ok: true } | { ok: false; reason: GrantDenial } {
  if (!grants.some((g) => rootOf(g.tenantId) === rootOf(node))) return { ok: false, reason: 'CROSS_STATE' };
  const held = heldAt(grants, node);
  if (!held.has(MEMBER_ADMIN_ROLE)) return { ok: false, reason: 'NOT_MEMBER_ADMIN' };
  if (isAdministrative(role) && !held.has(canonical(role))) return { ok: false, reason: 'ROLE_NOT_HELD' };
  if (MEMBERSHIP_ROLES.has(canonical(role)) && !held.has(MEMBER_ADMIN_ROLE)) return { ok: false, reason: 'NOT_MEMBER_ADMIN' };
  return { ok: true };
}

export const DENIAL_TEXT: Record<GrantDenial, string> = {
  CROSS_STATE: 'You hold no role in this state.',
  NOT_MEMBER_ADMIN: 'Granting roles here needs ACCOUNT_ADMIN at this tenant or above.',
  ROLE_NOT_HELD: 'You can grant an administrative role only if you hold it here or above.',
};

// ------------------------------------------------------------------------------------------------ area tree

export interface AreaNode { code: string; boundaryType: string; children: AreaNode[] }

/** The TenantBoundary answer (boundary-relationships/_search?includeChildren) as a tree. */
export function areaTree(tenantBoundaries: any[], hierarchyType: string): AreaNode[] {
  const tb = (tenantBoundaries ?? []).find((t) => t?.hierarchyType === hierarchyType) ?? tenantBoundaries?.[0];
  const walk = (n: any): AreaNode => ({ code: String(n.code), boundaryType: String(n.boundaryType ?? ''), children: (n.children ?? []).map(walk) });
  return (tb?.boundary ?? []).map(walk);
}

/** Codes covered by a set of picked areas (a picked node covers everything below it). */
export function covered(tree: AreaNode[], picked: Set<string>): Set<string> {
  const out = new Set<string>();
  const walk = (n: AreaNode, inherited: boolean) => {
    const on = inherited || picked.has(n.code);
    if (on) out.add(n.code);
    n.children.forEach((c) => walk(c, on));
  };
  tree.forEach((n) => walk(n, false));
  return out;
}

/** The smallest set of picks: a pick under another pick adds nothing (the engines cover subtrees). */
export function minimalPicks(tree: AreaNode[], picked: Set<string>): string[] {
  const out: string[] = [];
  const walk = (n: AreaNode, covered: boolean) => {
    if (!covered && picked.has(n.code)) { out.push(n.code); covered = true; }
    n.children.forEach((c) => walk(c, covered));
  };
  tree.forEach((n) => walk(n, false));
  return out;
}

const typeOf = (tree: AreaNode[], code: string): string | null => {
  for (const n of tree) { if (n.code === code) return n.boundaryType; const t = typeOf(n.children, code); if (t) return t; }
  return null;
};

// ------------------------------------------------------------------------------------------------ the HRMS write

export interface GrantRequest { role: string; tenantId: string; areas: string[]; hierarchyType: string }

/**
 * A copy of the HRMS employee with the role at the node added (once) and its ACTIVE jurisdictions at that tenant set
 * to exactly `areas` (others deactivated, never deleted: HRMS keeps history). Other tenants' jurisdictions and every
 * other field stay as they are.
 */
export function withGrant(employee: any, req: GrantRequest, tree: AreaNode[]): { next: any; changes: string[] } {
  const next = JSON.parse(JSON.stringify(employee));
  const changes: string[] = [];
  const roles: Grant[] = next.user?.roles ?? [];
  if (!roles.some((r) => r.code === req.role && r.tenantId === req.tenantId)) {
    next.user.roles = [...roles, { code: req.role, name: req.role, tenantId: req.tenantId }];
    changes.push(`+ role ${req.role} at ${req.tenantId}`);
  }
  const want = new Set(minimalPicks(tree, new Set(req.areas)));
  const jur: any[] = next.jurisdictions ?? [];
  for (const j of jur) {
    if (j.tenantId !== req.tenantId || j.isActive === false) continue;
    if (!want.has(j.boundary)) { j.isActive = false; changes.push(`- area ${j.boundary}`); }
    else want.delete(j.boundary);
  }
  for (const code of want) {
    const back = jur.find((j) => j.tenantId === req.tenantId && j.boundary === code && j.isActive === false);
    if (back) back.isActive = true;
    else jur.push({ hierarchy: req.hierarchyType, hierarchyType: req.hierarchyType, boundaryType: typeOf(tree, code) ?? '', boundary: code, tenantId: req.tenantId, isActive: true });
    changes.push(`+ area ${code}`);
  }
  next.jurisdictions = jur;
  return { next, changes };
}

/** The role taken away at the node (the person keeps their areas: other roles may use them). */
export function withoutGrant(employee: any, role: string, tenantId: string): any {
  const next = JSON.parse(JSON.stringify(employee));
  next.user.roles = (next.user?.roles ?? []).filter((r: Grant) => !(r.code === role && r.tenantId === tenantId));
  return next;
}

/** One row of "who can do what" at a tenant: grants at the tenant or above it, areas and departments there. */
export function peopleRows(employees: any[], tenantId: string) {
  // HRMS search returns deactivated employees too: they hold nothing
  return employees.filter((e) => e.isActive !== false && e.user?.active !== false).map((e) => ({
    uuid: e.user?.uuid ?? e.uuid,
    code: e.code as string,
    name: (e.user?.name ?? e.code) as string,
    grants: ((e.user?.roles ?? []) as Grant[]).filter((r) => isWithin(tenantId, r.tenantId) || isWithin(r.tenantId, tenantId)).filter((r) => r.code !== 'EMPLOYEE'),
    // HRMS areas belong to the person (every role uses them), at the tenants related to this one
    areas: ((e.jurisdictions ?? []) as any[]).filter((j) => j.isActive !== false && (isWithin(tenantId, j.tenantId) || isWithin(j.tenantId, tenantId))).map((j) => j.boundary as string),
    departments: [...new Set(((e.assignments ?? []) as any[]).filter((a) => a.isCurrentAssignment !== false).map((a) => a.department as string))],
  })).filter((p) => p.grants.length > 0);
}
