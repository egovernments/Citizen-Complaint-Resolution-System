// One-click migration: existing 2-level complaint types (RAINMAKER-PGR.ServiceDefs
// grouped by `menuPath`) → the configurable N-level model
// (ComplaintHierarchyDefinition + ClassificationNode + leaf ServiceDefs).
//
// Why this is safe / additive (see docs/migration/complaint-type-2level-to-Nlevel.md):
//  - ServiceDefs required fields are identical on develop and this branch, so every
//    existing record already validates against the new schema — nothing is rewritten.
//  - The 2-level data already encodes the tree in `menuPath`. We create one CATEGORY
//    ClassificationNode per distinct `menuPath` with **code = menuPath**, so the existing
//    `ServiceDefs.menuPath` already links to it (the citizen/employee picker links a leaf
//    to its parent via `parentCode ?? sector ?? menuPath === <parent node code>`).
//  - Opt-in per tenant: creating the definition is exactly what flips a tenant from the
//    flat picker to the cascade. Deleting the definition + nodes reverts to flat.
import { mdmsService, localizationService } from '@/api';
import { digitClient } from '@/providers/bridge';

const HDEF_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchyDefinition';
const NODE_SCHEMA = 'RAINMAKER-PGR.ClassificationNode';
const SERVICEDEF_SCHEMA = 'RAINMAKER-PGR.ServiceDefs';

const AUTH_STORAGE_KEY = 'crs-auth-state';

export type MigrationStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface MigrationStep {
  key: string;
  label: string;
}

/** Fixed, human-readable plan shown in the popup before/while it runs. */
export const MIGRATION_STEPS: MigrationStep[] = [
  { key: 'read', label: 'Read existing complaint types (2-level data)' },
  { key: 'derive', label: 'Detect categories from menu paths' },
  { key: 'define', label: 'Create hierarchy definition (Category → Sub-Type)' },
  { key: 'nodes', label: 'Create category nodes' },
  { key: 'verify', label: 'Verify hierarchy is in place' },
  { key: 'refresh', label: 'Refresh caches' },
];

export type StepReporter = (
  key: string,
  status: MigrationStepStatus,
  detail?: string
) => void;

export interface MigrationResult {
  ok: boolean;
  serviceDefs: number;
  categories: number;
  tenants: string[];
  message?: string;
}

/**
 * The tenant(s) this migration targets:
 *  - `managing`: the tenant the configurator is logged into / managing — where the
 *    complaint-hierarchies list reads and the citizen/employee picker reads from.
 *  - `state`: the state-root tenant (derived). Written to as well so any state-level
 *    read also resolves; non-fatal if it fails.
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
  const state =
    digitClient.stateTenantId || (managing.includes('.') ? managing.split('.')[0] : managing);
  const targets = Array.from(new Set([managing, state].filter(Boolean)));
  return { managing, state, targets };
}

const buildDefinitionLevels = () => [
  { levelCode: 'CATEGORY', order: 1, parentLevel: null, isFreeText: false, isLeafServiceCode: false, label: 'Category' },
  { levelCode: 'SUB_TYPE', order: 2, parentLevel: 'CATEGORY', isFreeText: false, isLeafServiceCode: true, label: 'Sub-Type' },
];

// Tolerate "already exists" on re-run; real failures are caught by the verify step
// which reads back the end state.
async function tolerate(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch {
    /* duplicate / already-exists is expected on re-run */
  }
}

export interface RunMigrationOptions {
  hierarchyType?: string;
  onStep: StepReporter;
}

/**
 * Execute the 2-level → hierarchy migration. Idempotent: safe to re-run after a
 * partial failure. Returns a summary; never throws for the "nothing to migrate"
 * case (reports it via `message` + ok:false).
 */
export async function runComplaintHierarchyMigration({
  hierarchyType = 'PGR',
  onStep,
}: RunMigrationOptions): Promise<MigrationResult> {
  const { targets, managing } = resolveMigrationTenants();

  // 1) Read existing ServiceDefs across the target tenants, dedupe by serviceCode.
  onStep('read', 'running');
  const byCode = new Map<string, { serviceCode: string; menuPath: string; menuPathName?: string }>();
  for (const t of targets) {
    let rows: Record<string, unknown>[] = [];
    try {
      rows = await mdmsService.search<Record<string, unknown>>(t, SERVICEDEF_SCHEMA, { limit: 2000 });
    } catch {
      /* a target may not hold ServiceDefs; ignore and continue */
    }
    for (const r of rows) {
      const sc = String(r.serviceCode ?? '').trim();
      if (!sc) continue;
      const existing = byCode.get(sc);
      const menuPath = String(r.menuPath ?? '').trim();
      // Prefer a row that actually carries a menuPath / menuPathName.
      if (!existing || (!existing.menuPath && menuPath)) {
        byCode.set(sc, {
          serviceCode: sc,
          menuPath,
          menuPathName: r.menuPathName ? String(r.menuPathName) : undefined,
        });
      }
    }
  }
  const defs = Array.from(byCode.values());
  onStep('read', 'done', `${defs.length} complaint type${defs.length === 1 ? '' : 's'} across ${targets.join(', ')}`);

  if (defs.length === 0) {
    for (const s of ['derive', 'define', 'nodes', 'verify', 'refresh']) onStep(s, 'skipped');
    return {
      ok: false,
      serviceDefs: 0,
      categories: 0,
      tenants: targets,
      message: `No 2-level complaint types found on ${targets.join(' / ')}. Nothing to migrate — add complaint types first, or use the full hierarchy setup.`,
    };
  }

  // 2) Derive distinct categories from menuPath. Missing menuPath buckets under
  //    "Complaint" (the legacy default used by ComplaintTypeCreate).
  onStep('derive', 'running');
  const cats = new Map<string, string>(); // code (= menuPath) -> display name
  for (const d of defs) {
    const code = d.menuPath || 'Complaint';
    if (!cats.has(code)) cats.set(code, d.menuPathName || code);
  }
  const categories = Array.from(cats.entries()); // [code, name][]
  onStep('derive', 'done', `${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}: ${categories.map(([c]) => c).slice(0, 6).join(', ')}${categories.length > 6 ? '…' : ''}`);

  // 3) Create the hierarchy definition (2 levels) on each target tenant.
  onStep('define', 'running');
  for (const t of targets) {
    await tolerate(
      mdmsService.create(t, HDEF_SCHEMA, hierarchyType, {
        hierarchyType,
        active: true,
        levels: buildDefinitionLevels(),
      })
    );
  }
  onStep('define', 'done', `CATEGORY → SUB_TYPE on ${targets.join(', ')}`);

  // 4) Create one CATEGORY node per distinct menuPath (code = menuPath → existing
  //    ServiceDefs.menuPath already links; no ServiceDef rewrite).
  onStep('nodes', 'running', `0/${categories.length}`);
  let i = 0;
  for (const [code, name] of categories) {
    const order = ++i;
    for (const t of targets) {
      await tolerate(
        mdmsService.create(t, NODE_SCHEMA, code, {
          hierarchyType,
          levelCode: 'CATEGORY',
          code,
          parentCode: null,
          name,
          order,
          active: true,
          path: code,
        })
      );
    }
    onStep('nodes', 'running', `${order}/${categories.length}`);
  }
  onStep('nodes', 'done', `${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} created`);

  // 5) Verify the end state at the managing tenant (where the picker reads).
  onStep('verify', 'running');
  try {
    const defRows = await mdmsService.search<Record<string, unknown>>(managing, HDEF_SCHEMA, {
      uniqueIdentifiers: [hierarchyType],
    });
    const nodeRows = await mdmsService.search<Record<string, unknown>>(managing, NODE_SCHEMA, { limit: 2000 });
    const presentCats = nodeRows.filter(
      (n) => n.hierarchyType === hierarchyType && n.levelCode === 'CATEGORY'
    ).length;
    if (defRows.length === 0) {
      onStep('verify', 'error', 'Hierarchy definition not found after create');
      return { ok: false, serviceDefs: defs.length, categories: categories.length, tenants: targets, message: 'Verification failed: the hierarchy definition was not created. Check that the ComplaintHierarchyDefinition schema is installed on this tenant.' };
    }
    if (presentCats < categories.length) {
      onStep('verify', 'error', `Only ${presentCats}/${categories.length} category nodes present`);
      return { ok: false, serviceDefs: defs.length, categories: categories.length, tenants: targets, message: `Verification incomplete: ${presentCats}/${categories.length} category nodes are present. Some node codes may contain characters MDMS rejects — re-run, or check the menu-path values.` };
    }
    onStep('verify', 'done', `definition ok · ${presentCats}/${categories.length} nodes present`);
  } catch (e) {
    onStep('verify', 'error', e instanceof Error ? e.message : 'verification error');
    return { ok: false, serviceDefs: defs.length, categories: categories.length, tenants: targets, message: 'Verification call failed. The records may still have been created — refresh the list to check.' };
  }

  // 6) Refresh localization cache so labels resolve immediately (non-fatal).
  onStep('refresh', 'running');
  await tolerate(localizationService.cacheBust());
  onStep('refresh', 'done');

  return { ok: true, serviceDefs: defs.length, categories: categories.length, tenants: targets };
}
