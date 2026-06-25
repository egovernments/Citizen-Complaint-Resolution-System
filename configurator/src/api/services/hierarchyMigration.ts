// Masters migration: existing complaint masters → the TWO-master model from the PR #861 review
// (docs/design/complaint-hierarchy-2master-rework-plan.md).
//
//   OLD (either shape):
//     - FLAT:        RAINMAKER-PGR.ServiceDefs grouped by menuPath
//     - HIERARCHICAL: RAINMAKER-PGR.ComplaintHierarchyDefinition + ClassificationNode (interior) + ServiceDefs (leaf)
//   NEW: RAINMAKER-PGR.ComplaintHierarchyDefinition (levels) + RAINMAKER-PGR.ComplaintHierarchy
//        (ONE adjacency list: interior nodes AND leaf complaint types together)
//
// DUAL-MODE (Q2b): if the tenant already has a Definition + ClassificationNode tree we PRESERVE it
// (copy the interior nodes 1:1, keep the existing levels, link leaves by their existing
// parentCode/sector); otherwise we DERIVE a flat 2-level CATEGORY→SUB_TYPE tree from menuPath.
//
// Leaf rows keep `code` = serviceCode VERBATIM (Q8), carry the PRIMARY `department` plus the full
// `departments[]` list (Q1, re-expressing the removed ComplaintTypeDepartments), and slaHours/keywords.
// `menuPath` is read ONLY here (migration time) to derive the parent link; it is not written.
// Localization keys for the leaves are seeded so labels resolve (Q9).
//
// BREAKING + one-way: after this runs and the backend is cut over, the ServiceDefs master is retired.
import { mdmsService, localizationService } from '@/api';
import { digitClient } from '@/providers/bridge';

const HDEF_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchyDefinition';
const HIER_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchy';
const SERVICEDEF_SCHEMA = 'RAINMAKER-PGR.ServiceDefs';
const NODE_SCHEMA = 'RAINMAKER-PGR.ClassificationNode';
const DEPTS_SCHEMA = 'RAINMAKER-PGR.ComplaintTypeDepartments';

const CATEGORY_LEVEL = 'CATEGORY';
const LEAF_LEVEL = 'SUB_TYPE';
const AUTH_STORAGE_KEY = 'crs-auth-state';

export type MigrationStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface MigrationStep {
  key: string;
  label: string;
}

/** Fixed, human-readable plan shown in the popup before/while it runs. */
export const MIGRATION_STEPS: MigrationStep[] = [
  { key: 'read', label: 'Read existing masters (ServiceDefs / ClassificationNode / Definition / Departments)' },
  { key: 'derive', label: 'Determine hierarchy shape (preserve existing, or derive 2-level)' },
  { key: 'define', label: 'Create / keep the hierarchy definition' },
  { key: 'nodes', label: 'Create interior nodes in ComplaintHierarchy' },
  { key: 'leaves', label: 'Create leaf complaint types in ComplaintHierarchy' },
  { key: 'localize', label: 'Seed localization keys' },
  { key: 'verify', label: 'Verify the merged hierarchy is in place' },
  { key: 'refresh', label: 'Refresh caches' },
];

export type StepReporter = (key: string, status: MigrationStepStatus, detail?: string) => void;

export interface MigrationResult {
  ok: boolean;
  serviceDefs: number;
  categories: number; // interior nodes created
  leaves: number;
  tenants: string[];
  mode?: 'preserve' | 'derive';
  message?: string;
}

interface LeafDef {
  serviceCode: string;
  name: string;
  menuPath: string;
  menuPathName?: string;
  department?: string;
  departments?: string[];
  slaHours?: number;
  keywords?: string;
  order?: number;
  parentCode?: string;
  sector?: string;
}

interface InteriorNode {
  levelCode: string;
  code: string;
  parentCode: string | null;
  name: string;
  order?: number;
  path?: string;
}

/**
 * Target tenant(s). `managing` = the tenant being managed (where the picker reads); `state` = the
 * state-root tenant (pgr-services validates there). Both are written so every read resolves.
 */
export function resolveMigrationTenants(): { managing: string; state: string; targets: string[] } {
  let managing = digitClient.stateTenantId || '';
  try {
    const saved = localStorage.getItem(AUTH_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { tenant?: string };
      if (parsed?.tenant) managing = parsed.tenant;
    }
  } catch {
    /* fall back to digitClient.stateTenantId */
  }
  const state = digitClient.stateTenantId || (managing.includes('.') ? managing.split('.')[0] : managing);
  const targets = Array.from(new Set([managing, state].filter(Boolean)));
  return { managing, state, targets };
}

const flatLevels = () => [
  { levelCode: CATEGORY_LEVEL, order: 1, parentLevel: null, isFreeText: false, isLeafServiceCode: false, label: 'Category' },
  { levelCode: LEAF_LEVEL, order: 2, parentLevel: CATEGORY_LEVEL, isFreeText: false, isLeafServiceCode: true, label: 'Sub-Type' },
];

// Tolerate "already exists" on re-run; the verify step reads back the real end state.
async function tolerate(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch {
    /* duplicate / already-exists is expected on re-run */
  }
}

async function searchAcross<T = Record<string, unknown>>(targets: string[], schema: string): Promise<T[]> {
  const out: T[] = [];
  for (const t of targets) {
    try {
      out.push(...(await mdmsService.search<T>(t, schema, { limit: 5000 })));
    } catch {
      /* a target may not hold this schema; ignore */
    }
  }
  return out;
}

export interface RunMigrationOptions {
  hierarchyType?: string;
  onStep: StepReporter;
}

/**
 * Execute the masters migration into the merged ComplaintHierarchy. Idempotent (creates keyed on the
 * same code), dual-mode, and defensive — every step is independently try/caught and reported, so a
 * single MDMS hiccup degrades to a clear error rather than a silent partial state.
 */
export async function runComplaintHierarchyMigration({
  hierarchyType = 'PGR',
  onStep,
}: RunMigrationOptions): Promise<MigrationResult> {
  const { targets, managing } = resolveMigrationTenants();
  const fail = (msg: string, extra: Partial<MigrationResult> = {}): MigrationResult => ({
    ok: false, serviceDefs: 0, categories: 0, leaves: 0, tenants: targets, message: msg, ...extra,
  });

  // ── 1) READ all source masters ────────────────────────────────────────────
  onStep('read', 'running');
  let sdRows: Record<string, unknown>[], nodeRows: Record<string, unknown>[],
    defRows: Record<string, unknown>[], deptRows: Record<string, unknown>[];
  try {
    [sdRows, nodeRows, defRows, deptRows] = await Promise.all([
      searchAcross(targets, SERVICEDEF_SCHEMA),
      searchAcross(targets, NODE_SCHEMA),
      searchAcross(targets, HDEF_SCHEMA),
      searchAcross(targets, DEPTS_SCHEMA),
    ]);
  } catch (e) {
    onStep('read', 'error', e instanceof Error ? e.message : 'read failed');
    return fail('Failed to read the existing masters. Check connectivity / permissions and retry.');
  }

  // Multi-department list per serviceCode (Q1), from the old ComplaintTypeDepartments master.
  const deptByCode = new Map<string, { departments: string[]; primary?: string }>();
  for (const r of deptRows) {
    const sc = String(r.serviceCode ?? '').trim();
    if (!sc) continue;
    const departments = Array.isArray(r.departments) ? (r.departments as unknown[]).map(String) : [];
    deptByCode.set(sc, { departments, primary: r.primaryDepartment ? String(r.primaryDepartment) : undefined });
  }

  // Leaves (source), dedupe by serviceCode.
  const byCode = new Map<string, LeafDef>();
  for (const r of sdRows) {
    const sc = String(r.serviceCode ?? '').trim();
    if (!sc) continue;
    const menuPath = String(r.menuPath ?? '').trim();
    const existing = byCode.get(sc);
    if (!existing || (!existing.menuPath && menuPath)) {
      const dep = deptByCode.get(sc);
      const primaryDept = dep?.primary || (r.department ? String(r.department) : undefined);
      const allDepts = dep?.departments?.length ? dep.departments : primaryDept ? [primaryDept] : [];
      byCode.set(sc, {
        serviceCode: sc,
        name: String(r.name ?? sc),
        menuPath,
        menuPathName: r.menuPathName ? String(r.menuPathName) : undefined,
        department: primaryDept,
        departments: allDepts,
        slaHours: typeof r.slaHours === 'number' ? r.slaHours : Number(r.slaHours) || undefined,
        keywords: r.keywords ? String(r.keywords) : undefined,
        order: typeof r.order === 'number' ? r.order : undefined,
        parentCode: r.parentCode ? String(r.parentCode) : undefined,
        sector: r.sector ? String(r.sector) : undefined,
      });
    }
  }
  const defs = Array.from(byCode.values());

  // Existing interior nodes (old ClassificationNode), dedupe by code, scoped to this hierarchyType.
  const interiorByCode = new Map<string, InteriorNode>();
  for (const n of nodeRows) {
    if (n.hierarchyType && n.hierarchyType !== hierarchyType) continue;
    const code = String(n.code ?? '').trim();
    if (!code || interiorByCode.has(code)) continue;
    interiorByCode.set(code, {
      levelCode: String(n.levelCode ?? CATEGORY_LEVEL),
      code,
      parentCode: n.parentCode != null ? String(n.parentCode) : null,
      name: String(n.name ?? code),
      order: typeof n.order === 'number' ? n.order : undefined,
      path: n.path ? String(n.path) : undefined,
    });
  }
  const existingDef = defRows.find((d) => d.hierarchyType === hierarchyType) || defRows[0];

  onStep('read', 'done', `${defs.length} sub-types · ${interiorByCode.size} existing nodes · def:${existingDef ? 'yes' : 'no'} · depts:${deptByCode.size}`);

  if (defs.length === 0) {
    for (const s of ['derive', 'define', 'nodes', 'leaves', 'localize', 'verify', 'refresh']) onStep(s, 'skipped');
    return fail(`No complaint types (ServiceDefs) found on ${targets.join(' / ')}. Nothing to migrate.`);
  }

  // ── 2) DETERMINE SHAPE (Q2b dual-mode) ─────────────────────────────────────
  onStep('derive', 'running');
  const preserve = !!(existingDef && Array.isArray(existingDef.levels) && (existingDef.levels as unknown[]).length && interiorByCode.size > 0);
  const mode: 'preserve' | 'derive' = preserve ? 'preserve' : 'derive';

  let levels: Array<Record<string, unknown>>;
  let leafLevelCode: string;
  let interior: InteriorNode[];
  const linkOf = (l: LeafDef) => l.parentCode || l.sector || l.menuPath || 'Complaint';

  if (preserve) {
    // Keep the existing definition + interior nodes verbatim.
    levels = [...(existingDef!.levels as Array<Record<string, unknown>>)].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    leafLevelCode = String((levels.find((l) => l.isLeafServiceCode) || levels[levels.length - 1])?.levelCode ?? LEAF_LEVEL);
    interior = Array.from(interiorByCode.values());
  } else {
    // Derive a flat 2-level CATEGORY→SUB_TYPE tree from menuPath.
    levels = flatLevels();
    leafLevelCode = LEAF_LEVEL;
    const cats = new Map<string, string>();
    for (const d of defs) {
      const code = d.menuPath || 'Complaint';
      if (!cats.has(code)) cats.set(code, d.menuPathName || code);
    }
    let i = 0;
    interior = Array.from(cats.entries()).map(([code, name]) => ({ levelCode: CATEGORY_LEVEL, code, parentCode: null, name, order: ++i, path: code }));
    interior.forEach((n) => interiorByCode.set(n.code, n));
  }

  // Collision guard: merged x-unique is (hierarchyType, code).
  const interiorCodes = new Set(interior.map((n) => n.code));
  const collisions = defs.filter((d) => interiorCodes.has(d.serviceCode)).map((d) => d.serviceCode);
  if (collisions.length) {
    onStep('derive', 'error', `${collisions.length} serviceCode(s) collide with node codes`);
    return fail(`Cannot migrate: ${collisions.length} serviceCode(s) collide with an interior node code (${collisions.slice(0, 5).join(', ')}${collisions.length > 5 ? '…' : ''}). Codes must be globally unique in the merged master.`, { mode });
  }
  onStep('derive', 'done', `${mode === 'preserve' ? 'preserve existing' : 'derive flat 2-level'} · ${levels.length} levels · ${interior.length} nodes`);

  // ── 3) DEFINITION ──────────────────────────────────────────────────────────
  onStep('define', 'running');
  for (const t of targets) {
    await tolerate(mdmsService.create(t, HDEF_SCHEMA, hierarchyType, { hierarchyType, active: true, levels }));
  }
  onStep('define', 'done', `${levels.map((l) => l.levelCode).join(' → ')} on ${targets.join(', ')}`);

  // ── 4) INTERIOR NODES → ComplaintHierarchy ─────────────────────────────────
  onStep('nodes', 'running', `0/${interior.length}`);
  let ni = 0;
  for (const n of interior) {
    ni++;
    for (const t of targets) {
      await tolerate(
        mdmsService.create(t, HIER_SCHEMA, n.code, {
          hierarchyType, levelCode: n.levelCode, code: n.code, parentCode: n.parentCode ?? null,
          name: n.name, order: n.order ?? ni, active: true, path: n.path || n.code,
        })
      );
    }
    onStep('nodes', 'running', `${ni}/${interior.length}`);
  }
  onStep('nodes', 'done', `${interior.length} interior node${interior.length === 1 ? '' : 's'} created`);

  // ── 5) LEAF ROWS → ComplaintHierarchy (code=serviceCode verbatim, departments[]) ───
  onStep('leaves', 'running', `0/${defs.length}`);
  let li = 0;
  for (const d of defs) {
    const parentCode = linkOf(d);
    const parentPath = interiorByCode.get(parentCode)?.path || parentCode;
    li++;
    for (const t of targets) {
      await tolerate(
        mdmsService.create(t, HIER_SCHEMA, d.serviceCode, {
          hierarchyType,
          levelCode: leafLevelCode,
          code: d.serviceCode,
          parentCode,
          name: d.name,
          order: d.order ?? li,
          active: true,
          path: `${parentPath}.${d.serviceCode}`,
          ...(d.department ? { department: d.department } : {}),
          ...(d.departments && d.departments.length ? { departments: d.departments } : {}),
          ...(d.slaHours != null ? { slaHours: d.slaHours } : {}),
          ...(d.keywords ? { keywords: d.keywords } : {}),
        })
      );
    }
    onStep('leaves', 'running', `${li}/${defs.length}`);
  }
  onStep('leaves', 'done', `${defs.length} leaf complaint type${defs.length === 1 ? '' : 's'} created`);

  // ── 6) LOCALIZATION (Q9) — seed SERVICEDEFS.<code> keys for EVERY node ──────
  onStep('localize', 'running');
  try {
    // Seed leaves AND interior nodes (category/sector). The inbox + complaint
    // lists label a complaint by its PARENT group key (SERVICEDEFS.<parentCode>),
    // and a leaf-less branch is filed against an interior node directly, so both
    // must be localized or they render the raw key.
    const leafPayload = defs.map((d) => ({ serviceCode: d.serviceCode, name: d.name, department: d.department, menuPath: linkOf(d) }));
    const nodePayload = interior.map((n) => ({ serviceCode: n.code, name: n.name }));
    const payload = [...nodePayload, ...leafPayload];
    for (const t of targets) {
      await tolerate(localizationService.uploadComplaintTypeLocalizations(t, payload, 'en_IN'));
    }
    onStep('localize', 'done', `${payload.length} label key${payload.length === 1 ? '' : 's'} seeded (en_IN)`);
  } catch (e) {
    // Non-fatal: labels can be added later via the bulk localization import.
    onStep('localize', 'error', e instanceof Error ? e.message : 'localization seed failed (non-fatal)');
  }

  // ── 7) VERIFY at the managing tenant ───────────────────────────────────────
  onStep('verify', 'running');
  try {
    const vDef = await mdmsService.search<Record<string, unknown>>(managing, HDEF_SCHEMA, { uniqueIdentifiers: [hierarchyType] });
    const vHier = await mdmsService.search<Record<string, unknown>>(managing, HIER_SCHEMA, { limit: 5000 });
    const scoped = vHier.filter((n) => n.hierarchyType === hierarchyType);
    const presentInterior = scoped.filter((n) => n.department == null && n.slaHours == null).length;
    const presentLeaves = scoped.filter((n) => n.department != null || n.slaHours != null).length;
    if (vDef.length === 0) {
      onStep('verify', 'error', 'Definition not found after create');
      return fail('Verification failed: the hierarchy definition was not created. Check the ComplaintHierarchyDefinition schema is installed.', { mode, serviceDefs: defs.length });
    }
    if (presentInterior < interior.length || presentLeaves < defs.length) {
      onStep('verify', 'error', `${presentInterior}/${interior.length} nodes · ${presentLeaves}/${defs.length} leaves present`);
      return fail(`Verification incomplete: ${presentInterior}/${interior.length} interior nodes and ${presentLeaves}/${defs.length} leaves present in ComplaintHierarchy. Re-run, or check for code collisions / unsafe codes.`, { mode, serviceDefs: defs.length, categories: presentInterior, leaves: presentLeaves });
    }
    onStep('verify', 'done', `def ok · ${presentInterior} nodes · ${presentLeaves} leaves`);
  } catch (e) {
    onStep('verify', 'error', e instanceof Error ? e.message : 'verification error');
    return fail('Verification call failed. The records may still have been created — refresh and check.', { mode, serviceDefs: defs.length });
  }

  // ── 8) REFRESH caches ──────────────────────────────────────────────────────
  onStep('refresh', 'running');
  await tolerate(localizationService.cacheBust());
  onStep('refresh', 'done');

  return { ok: true, serviceDefs: defs.length, categories: interior.length, leaves: defs.length, tenants: targets, mode };
}
