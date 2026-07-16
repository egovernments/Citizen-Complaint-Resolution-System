/**
 * The DISCOVERED half of the deployment-independence pair.
 *
 * `deployment-profile.json` records what the live deployment IS — written once
 * per run by tests/fixtures/profile.setup.ts, before any spec loads. Its
 * counterpart, deploy/expectations/<name>.json, declares what the deployment
 * SHOULD be; capabilities.ts joins the two. Discovery alone can only decide HOW
 * to test, never whether a gap is acceptable — that is the expectations file's
 * job, and the reason discovery is allowed to be permissive here.
 *
 * Two rules hold this together:
 *  1. Discovery NEVER invents. A probe that returns nothing yields null/0 and
 *     the capability reads as absent; it does not fall back to a plausible
 *     literal, because a plausible literal is how a suite goes green against a
 *     deployment it never actually looked at.
 *  2. An explicit env var ALWAYS wins over a discovered value, but only after
 *     being checked against the deployment (a SERVICE_CODE nobody defines is
 *     not "an override", it is a stale .env line).
 *
 * Deliberately reads process.env directly instead of importing env.ts: Stage 1
 * inverts that dependency (env.ts will call tryGetProfile() at import time), and
 * a util that env.ts imports must not need env.ts's bindings to be initialised.
 * personas.ts does still import env.ts, so env.ts -> profile.ts -> personas.ts
 * -> env.ts is a cycle; it is safe only because nothing on that path reads an
 * env.ts binding at module scope. Keep it that way — a top-level
 * `const X = TENANT` anywhere in the loop would resolve to undefined.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fetchBoundaryTree,
  fetchGlobalConfigs,
  fetchLocalizationCount,
  fetchMdms,
  fetchTenantLabel,
  fetchWorkflowShape,
  type BoundaryNode,
} from './probes';
import { deriveMobileLengths } from './mdms-mobile';
import { getPgrIdPrefix } from './pgr-idgen';
import { getDigitToken } from './auth';
import { resolvePersonasForProfile, resolveSeedPlan } from './personas';

// ── shape ────────────────────────────────────────────────────────────────────

/** A persona as persisted: identity + provenance only. Never a secret. */
export interface PersonaSummary {
  username: string;
  tenant: string;
  uuid: string;
  roles: string[];
  departments: string[];
  jurisdictions: string[];
  /** Where the credential came from, e.g. 'env:GRO_USER'. Re-derived at use time. */
  source: string;
}

export interface BoundaryPathNode {
  code: string;
  boundaryType: string;
}

export interface ProfileService {
  serviceCode: string;
  /** '' when the deployment defines the type but no department for it. */
  department: string;
}

export interface DeploymentProfile {
  schemaVersion: number;
  generatedAt: string;
  baseUrl: string;
  tenant: {
    city: string;
    root: string;
    /** true when the deployment has no city sub-tenant (bomet's flat `ke`). */
    flat: boolean;
    label: string;
    labelSource: 'localization' | 'env' | 'derived-fallback';
  };
  globalConfigs: {
    stateTenantId: string | null;
    hierarchyType: string | null;
    localeRegion: string | null;
    pgrBoundaryHighestLevel: string | null;
    pgrBoundaryLowestLevel: string | null;
    boundaryType: string | null;
  };
  mobile: {
    countryCode: string | null;
    pattern: string | null;
    length: { min: number; max: number } | null;
    source: 'globalConfigs' | 'env' | 'none';
  };
  postal: {
    pattern: string | null;
    validSample: string | null;
    /** false when the deployment ships an empty corePostalConfigs (bomet). */
    configuredExplicitly: boolean;
  };
  boundary: {
    hierarchyType: string | null;
    levels: string[];
    depth: number;
    root: BoundaryPathNode | null;
    leafPath: BoundaryPathNode[];
    leafCode: string | null;
    nodeCount: number;
  };
  complaintTypes: {
    hierarchyDepth: number;
    serviceDefCount: number;
    services: ProfileService[];
  };
  workflow: {
    pgr: {
      found: boolean;
      actions: string[];
      actionRoles: Record<string, string[]>;
      states: string[];
      /**
       * Not in the original profile sketch, but resolveSeedPlan() cannot work
       * without it: egov-workflow-v2 rejects an assignee who holds no role able
       * to act on the state ASSIGN lands in, and those roles are only knowable
       * by following ASSIGN's nextState. Persisted so the seed plan stays a
       * pure function of the profile.
       */
      assign: { nextState: string; assigneeRoles: string[] } | null;
    };
  };
  pgr: {
    idPrefix: string | null;
    seedServiceCode: string | null;
    seedLocalityCode: string | null;
  };
  mdms: {
    rejectionReasonsCount: number;
  };
  locales: string[];
  personas: {
    adminRoles: string[];
    resolved: Record<string, PersonaSummary | null>;
    /** key -> why it could not be resolved, quoted verbatim in skip/fail text. */
    unresolvedDiagnostics: Record<string, string>;
  };
}

export const PROFILE_PATH = resolve('deployment-profile.json');

export const PROFILE_SCHEMA_VERSION = 1;

// ── read / write ─────────────────────────────────────────────────────────────

let cached: DeploymentProfile | null = null;

/**
 * Synchronous, non-throwing, cached. All three matter: Stage 1's env.ts calls
 * this at import time to back its exports, which happens before any async hook
 * can run and must not explode on the many entry points (a lone `--no-deps`
 * spec run, a lint pass) where profile-setup never ran.
 */
export function tryGetProfile(): DeploymentProfile | null {
  if (cached) return cached;
  if (!existsSync(PROFILE_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(PROFILE_PATH, 'utf8')) as DeploymentProfile;
    if (parsed?.schemaVersion !== PROFILE_SCHEMA_VERSION) return null;
    cached = parsed;
    return cached;
  } catch {
    return null;
  }
}

export function getProfile(): DeploymentProfile {
  const p = tryGetProfile();
  if (!p) {
    throw new Error(
      `No deployment profile at ${PROFILE_PATH}. It is written by the 'profile-setup' project, ` +
        'which every spec project depends on — so this means the run skipped the DAG. Either drop ' +
        "`--no-deps`, run `npx playwright test --project=profile-setup` once first, or set " +
        'PROFILE_INLINE=1 and await ensureProfile() to discover it in-process.',
    );
  }
  return p;
}

export function writeProfile(p: DeploymentProfile): string {
  writeFileSync(PROFILE_PATH, `${JSON.stringify(p, null, 2)}\n`, 'utf8');
  cached = p;
  return PROFILE_PATH;
}

/**
 * Async escape hatch for `--no-deps` single-spec runs, where profile-setup never
 * ran. getProfile() cannot do this itself: discovery is a dozen HTTP reads and
 * getProfile() is synchronous by contract (see tryGetProfile).
 */
export async function ensureProfile(): Promise<DeploymentProfile> {
  const existing = tryGetProfile();
  if (existing) return existing;
  if (process.env.PROFILE_INLINE !== '1') return getProfile(); // throws with the fix-it message
  const discovered = await discoverProfile();
  writeProfile(discovered);
  return discovered;
}

// ── deterministic regex sampling ─────────────────────────────────────────────

/**
 * Expand a validation regex into one string that satisfies it.
 *
 * Deterministic on purpose: the sample lands in the profile and in failure
 * messages, so a random-but-valid value would make two runs against the same
 * deployment produce different artefacts and make a real drift look like noise.
 * Optional groups are INCLUDED once rather than dropped — for MZ's
 * `^[0-9]{4}(-[0-9]{2})?$` the interesting sample is the sectored '0000-00',
 * and anything matching the longer branch matches the shorter concern too.
 */
export function sampleFromPattern(pattern: string): string {
  const src = pattern.replace(/^\^/, '').replace(/\$$/, '');
  let i = 0;

  const classSample = (body: string): string => {
    if (body.startsWith('^')) {
      const negated = body.slice(1);
      const pick = '0123456789abcdefghijklmnopqrstuvwxyz'
        .split('')
        .find((c) => !new RegExp(`[${negated}]`).test(c));
      return pick ?? 'x';
    }
    // First member of the class: a range contributes its low end.
    if (body[0] === '\\') return escapeSample(body[1]);
    if (body[1] === '-' && body.length >= 3) return body[0];
    return body[0] ?? '0';
  };

  const escapeSample = (ch: string): string => {
    if (ch === 'd') return '0';
    if (ch === 'w') return 'a';
    if (ch === 's') return ' ';
    return ch;
  };

  const parseAlternatives = (stop?: string): string => {
    const branches: string[] = [];
    let current = '';
    while (i < src.length) {
      if (stop && src[i] === stop) break;
      if (src[i] === '|') {
        i++;
        branches.push(current);
        current = '';
        continue;
      }
      current += parseAtom();
    }
    branches.push(current);
    return branches[0]; // alternation -> first branch, per the deterministic rule
  };

  const parseAtom = (): string => {
    let base: string;
    const ch = src[i];
    if (ch === '(') {
      i++;
      if (src.slice(i, i + 2) === '?:') i += 2;
      base = parseAlternatives(')');
      i++; // consume ')'
    } else if (ch === '[') {
      const end = findClassEnd(src, i);
      base = classSample(src.slice(i + 1, end));
      i = end + 1;
    } else if (ch === '\\') {
      base = escapeSample(src[i + 1]);
      i += 2;
    } else if (ch === '.') {
      base = 'x';
      i++;
    } else {
      base = ch;
      i++;
    }
    return base.repeat(parseQuantifier());
  };

  /** How many times to emit the preceding atom. `?`/`*`/`+` all mean once. */
  const parseQuantifier = (): number => {
    const ch = src[i];
    if (ch === '?' || ch === '*' || ch === '+') {
      i++;
      return 1;
    }
    if (ch === '{') {
      const end = src.indexOf('}', i);
      if (end === -1) return 1;
      const n = parseInt(src.slice(i + 1, end).split(',')[0], 10);
      i = end + 1;
      return Number.isFinite(n) ? n : 1;
    }
    return 1;
  };

  return parseAlternatives();
}

/** `]` immediately after `[` or `[^` is a literal, so it cannot end the class. */
function findClassEnd(src: string, start: number): number {
  let j = start + 1;
  if (src[j] === '^') j++;
  if (src[j] === ']') j++;
  while (j < src.length && src[j] !== ']') {
    if (src[j] === '\\') j++;
    j++;
  }
  return j;
}

// ── discovery ────────────────────────────────────────────────────────────────

/** Read an env var, treating blank as unset so an `export X=` cannot pin ''. */
function envOr(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Run a discoverer with one retry, degrading to `fallback` instead of failing
 * the whole run. profile-setup is a single point of failure for every project
 * downstream, so only the handful of hard asserts there may kill a run; a field
 * that cannot be read becomes null and its capability reads as absent, which the
 * expectations file then judges.
 */
async function attempt<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  for (let round = 1; round <= 2; round++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[profile] ${label} attempt ${round}/2 failed: ${msg.slice(0, 200)}`);
    }
  }
  console.log(`[profile] ${label} unavailable — recording as absent`);
  return fallback;
}

function countNodes(root: BoundaryNode | null): number {
  if (!root) return 0;
  return 1 + (root.children || []).reduce((sum, c) => sum + countNodes(c), 0);
}

function pathTo(root: BoundaryNode, code: string, acc: BoundaryNode[] = []): BoundaryNode[] | null {
  const here = [...acc, root];
  if (root.code === code) return here;
  for (const child of root.children || []) {
    const found = pathTo(child, code, here);
    if (found) return found;
  }
  return null;
}

function firstBranch(root: BoundaryNode): BoundaryNode[] {
  const path: BoundaryNode[] = [];
  for (let n: BoundaryNode | undefined = root; n; n = n.children?.[0]) path.push(n);
  return path;
}

/**
 * Complaint types, unioned across BOTH masters that can define them.
 *
 * The two shipped deployments disagree about which one is authoritative: the
 * local mz stack keeps its catalogue in ComplaintHierarchy (ServiceDefs is
 * empty) while bomet's ke carries 251 ServiceDefs. Reading only one of them
 * yields an empty service list on the other deployment, which the non-emptiness
 * gate would (correctly) treat as a broken run. Only ComplaintHierarchy has a
 * path, so it alone can answer the wizard's cascade depth.
 */
async function discoverComplaintTypes(
  tenants: string[],
  authToken: string,
): Promise<DeploymentProfile['complaintTypes']> {
  const byCode = new Map<string, string>();
  let hierarchyDepth = 0;

  for (const tenantId of tenants) {
    for (const row of await fetchMdms(tenantId, 'RAINMAKER-PGR.ComplaintHierarchy', authToken)) {
      const d = row?.data;
      // isActive is the MDMS row flag, data.active the master's own — the pg
      // demo's Garbage/StreetLights nodes are data.active but row-inactive here.
      if (!d?.code || row.isActive === false || d.active === false) continue;
      const depth = typeof d.path === 'string' ? d.path.split('.').length : 1;
      if (depth > hierarchyDepth) hierarchyDepth = depth;
      // A CATEGORY node is a cascade level, not something a citizen can file.
      const dept = d.department ?? d.departments?.[0];
      if (!dept) continue;
      byCode.set(d.code, String(dept));
    }
    for (const row of await fetchMdms(tenantId, 'RAINMAKER-PGR.ServiceDefs', authToken)) {
      const d = row?.data;
      const code = d?.serviceCode ?? row?.uniqueIdentifier;
      if (!code || row.isActive === false || d?.active === false) continue;
      if (!byCode.get(code)) byCode.set(code, String(d?.department ?? ''));
    }
    if (byCode.size) break; // exact tenant wins; only fall through to root when bare
  }

  const services = [...byCode.entries()]
    .map(([serviceCode, department]) => ({ serviceCode, department }))
    .sort((a, b) => a.serviceCode.localeCompare(b.serviceCode));
  return { hierarchyDepth, serviceDefCount: services.length, services };
}

/**
 * Locales that are actually usable, not merely listed.
 *
 * Candidates come from StateInfo plus globalConfigs' own default, then each is
 * weighed against the richest one: every deployment inherits 205-row stub
 * locales from the pg seed, and the local stack's ka_IN carries 2
 * rainmaker-common rows against en_IN's 5734. A relative threshold survives that
 * without pinning a magic row count that would rot the first time a real locale
 * is half-translated.
 */
async function discoverLocales(tenants: string[], authToken: string, localeDefault: string | null): Promise<string[]> {
  const candidates = new Set<string>();
  for (const tenantId of tenants) {
    for (const row of await fetchMdms(tenantId, 'common-masters.StateInfo', authToken)) {
      for (const lang of row?.data?.languages || []) {
        if (lang?.value) candidates.add(String(lang.value));
      }
    }
    if (candidates.size) break;
  }
  if (localeDefault) candidates.add(localeDefault);
  if (!candidates.size) return [];

  const counted: { locale: string; count: number }[] = [];
  for (const locale of [...candidates].sort()) {
    counted.push({ locale, count: await fetchLocalizationCount(tenants[0], locale, { module: 'rainmaker-common', authToken }) });
  }
  const richest = Math.max(...counted.map((c) => c.count));
  if (richest === 0) return [];
  return counted.filter((c) => c.count >= richest * 0.25).map((c) => c.locale).sort();
}

export async function discoverProfile(opts?: { baseUrl?: string }): Promise<DeploymentProfile> {
  const baseUrl = opts?.baseUrl ?? envOr('BASE_URL') ?? 'http://localhost';

  // globalConfigs must be read BEFORE anything else: it is the deployment's own
  // boot config, so it — not an env var — is what tells us which tenant we are
  // even looking at. Falling back to the legacy 'ke.nairobi' literal here makes
  // discovery a no-op on every other deployment: with DIGIT_TENANT unset the
  // whole probe chain aims at a tenant that doesn't exist, every read comes back
  // empty, and profile.setup's non-emptiness gate fails with "boundary hierarchy
  // is empty" — pointing at the tenant rather than at this line. Keep the literal
  // last, as a floor for a deployment that serves no globalConfigs at all.
  const gc = await attempt('globalConfigs', () => fetchGlobalConfigs(baseUrl), {});

  const city = envOr('DIGIT_TENANT') ?? gc.stateTenantId ?? 'ke.nairobi';
  const root = envOr('ROOT_TENANT') ?? (city.includes('.') ? city.split('.')[0] : city);
  const tenants = city === root ? [root] : [city, root];

  const adminUser = envOr('DIGIT_USERNAME') ?? envOr('ADMIN_USER') ?? 'ADMIN';
  const adminPass = envOr('DIGIT_PASSWORD') ?? envOr('ADMIN_PASSWORD') ?? 'eGov@123';
  const admin = await attempt(
    'admin login',
    () => getDigitToken({ baseURL: baseUrl, tenant: root, username: adminUser, password: adminPass }),
    null as Awaited<ReturnType<typeof getDigitToken>> | null,
  );
  const authToken = admin?.access_token ?? '';
  const adminRoles = (((admin?.UserRequest as any)?.roles || []) as any[]).map((r) => String(r.code)).sort();

  // ── tenant label ──────────────────────────────────────────────────────────
  // Localization outranks TENANT_LABEL here, inverting the usual env-wins rule:
  // the label is asserted against the login City combobox, and the combobox
  // renders exactly this key. An env var that disagrees is a stale .env, not an
  // override — and the smoke test warns whenever we fall back to one.
  const discoveredLabel = await attempt(
    'tenant label',
    () => fetchTenantLabel(city, { rootTenant: root, authToken, baseUrl }),
    undefined as string | undefined,
  );
  const envLabel = envOr('TENANT_LABEL');
  const label = discoveredLabel ?? envLabel ?? city.split('.').pop()!.replace(/^./, (c) => c.toUpperCase());
  const labelSource: DeploymentProfile['tenant']['labelSource'] = discoveredLabel
    ? 'localization'
    : envLabel
      ? 'env'
      : 'derived-fallback';

  // ── mobile / postal ───────────────────────────────────────────────────────
  const mobilePattern = gc.coreMobileConfigs?.mobileNumberRegex ?? null;
  const mobile: DeploymentProfile['mobile'] = {
    countryCode: gc.coreMobileConfigs?.countryCode ?? null,
    pattern: mobilePattern,
    length: mobilePattern ? deriveMobileLengths(mobilePattern) : null,
    source: mobilePattern ? 'globalConfigs' : 'none',
  };

  // bomet ships corePostalConfigs as {} and the SPA falls back to 5 digits, so
  // the fallback is the deployment's real behaviour — but flag that nobody chose
  // it, since a postal assertion against a default is worth less than one
  // against a declared rule.
  const postalPattern = gc.corePostalConfigs?.postalCodePattern ?? null;
  const configuredExplicitly = Boolean(postalPattern);
  const effectivePostal = postalPattern ?? '^[0-9]{5}$';
  const envSample = envOr('POSTAL_CODE_VALID');
  const envSampleUsable = envSample !== undefined && safeTest(effectivePostal, envSample);
  const postal: DeploymentProfile['postal'] = {
    pattern: effectivePostal,
    validSample: envSampleUsable ? envSample! : sampleFromPattern(effectivePostal),
    configuredExplicitly,
  };

  // ── boundary ──────────────────────────────────────────────────────────────
  const hierarchyType = gc.hierarchyType ?? null;
  const tree = hierarchyType
    ? await attempt('boundary tree', () => fetchBoundaryTree(city, hierarchyType, { authToken, baseUrl }), null)
    : null;
  // Prefer LOCALITY_CODE, but only once the tree proves it exists — an override
  // naming a boundary this deployment never heard of is stale, and honouring it
  // would push the failure into every seeded complaint instead of surfacing here.
  const preferredLocality = envOr('LOCALITY_CODE');
  const locatedPath = tree && preferredLocality ? pathTo(tree, preferredLocality) : null;
  if (tree && preferredLocality && !locatedPath) {
    console.log(`[profile] LOCALITY_CODE=${preferredLocality} is not in ${hierarchyType} — using a discovered leaf instead`);
  }
  const leafPath = tree ? (locatedPath ?? firstBranch(tree)) : [];
  const boundary: DeploymentProfile['boundary'] = {
    hierarchyType,
    levels: tree ? [...new Set(firstBranch(tree).map((n) => n.boundaryType))] : [],
    depth: 0,
    root: tree ? { code: tree.code, boundaryType: tree.boundaryType } : null,
    leafPath: leafPath.map((n) => ({ code: n.code, boundaryType: n.boundaryType })),
    leafCode: leafPath.length ? leafPath[leafPath.length - 1].code : null,
    nodeCount: countNodes(tree),
  };
  boundary.depth = boundary.levels.length;

  // ── workflow ──────────────────────────────────────────────────────────────
  const wf = await attempt('PGR workflow', () => fetchWorkflowShape(city, 'PGR', { authToken, baseUrl }), null);
  const assignNextState = wf?.nextStateByAction.get('ASSIGN') ?? null;
  const workflow: DeploymentProfile['workflow'] = {
    pgr: {
      found: Boolean(wf),
      actions: wf ? [...wf.actions].sort() : [],
      actionRoles: wf ? Object.fromEntries([...wf.rolesByAction].map(([a, r]) => [a, [...r].sort()])) : {},
      states: wf ? [...wf.rolesByState.keys()].sort() : [],
      assign: assignNextState
        ? { nextState: assignNextState, assigneeRoles: (wf!.rolesByState.get(assignNextState) ?? []).slice().sort() }
        : null,
    },
  };

  const complaintTypes = await attempt('complaint types', () => discoverComplaintTypes(tenants, authToken), {
    hierarchyDepth: 0,
    serviceDefCount: 0,
    services: [],
  });

  const rejectionReasonsCount = await attempt(
    'rejection reasons',
    async () => {
      for (const tenantId of tenants) {
        const rows = (await fetchMdms(tenantId, 'RAINMAKER-PGR.RejectionReasons', authToken)).filter(
          (r) => r?.isActive !== false && r?.data?.active !== false,
        );
        if (rows.length) return rows.length;
      }
      return 0;
    },
    0,
  );

  // The SPA boots in localeDefault+localeRegion ('en'+'IN'), so that locale is
  // real by construction even if StateInfo forgot to list it.
  const bootLocale = gc.localeDefault && gc.localeRegion ? `${gc.localeDefault}_${gc.localeRegion}` : null;
  const locales = await attempt('locales', () => discoverLocales(tenants, authToken, bootLocale), []);

  const idPrefix = await attempt('idgen PGR prefix', () => getPgrIdPrefix({ tenant: city }), null as string | null);

  const draft: DeploymentProfile = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    baseUrl,
    tenant: { city, root, flat: city === root, label, labelSource },
    globalConfigs: {
      stateTenantId: gc.stateTenantId ?? null,
      hierarchyType: gc.hierarchyType ?? null,
      localeRegion: gc.localeRegion ?? null,
      pgrBoundaryHighestLevel: gc.pgrBoundaryHighestLevel ?? null,
      pgrBoundaryLowestLevel: gc.pgrBoundaryLowestLevel ?? null,
      boundaryType: gc.boundaryType ?? null,
    },
    mobile,
    postal,
    boundary,
    complaintTypes,
    workflow,
    pgr: { idPrefix, seedServiceCode: null, seedLocalityCode: boundary.leafCode },
    mdms: { rejectionReasonsCount },
    locales,
    personas: { adminRoles, resolved: {}, unresolvedDiagnostics: {} },
  };

  const personas = await attempt('personas', () => resolvePersonasForProfile(draft), {
    resolved: {},
    unresolvedDiagnostics: { all: 'persona resolution threw twice — see the [personas] log lines above' },
  });
  draft.personas.resolved = personas.resolved;
  draft.personas.unresolvedDiagnostics = personas.unresolvedDiagnostics;

  const plan = await attempt('seed plan', () => resolveSeedPlan({ profile: draft }), {
    error: 'seed plan resolution threw twice — see the [seed] log lines above',
  } as Awaited<ReturnType<typeof resolveSeedPlan>>);
  if ('error' in plan) {
    draft.personas.unresolvedDiagnostics['pgr.seedPlan'] = plan.error;
  } else {
    draft.pgr.seedServiceCode = plan.serviceCode;
    draft.pgr.seedLocalityCode = plan.localityCode;
  }

  return draft;
}

/** A pattern from a deployment is untrusted input — a bad one must not throw. */
function safeTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}
