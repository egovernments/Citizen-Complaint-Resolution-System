/**
 * The DECLARED half — and the join that makes skips honest.
 *
 * Discovery on its own is skip-washing waiting to happen: a deployment that was
 * never seeded has no complaint types, no personas and no rejection reasons, so
 * a purely discovery-driven suite would skip everything and report green. The
 * expectations file is the counterweight. It says what SHOULD be here, so an
 * absent capability is either a legitimate N/A (declared 'absent' -> SKIP) or a
 * seed/app gap (declared 'required' -> FAIL). Nothing absent is ever silently
 * fine.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getProfile, type DeploymentProfile } from './profile';

/**
 * Every capability a deployment must take a position on.
 *
 * A runtime array, not just a union, because the union alone is a compile-time
 * fiction over a JSON file nobody type-checks: loadExpectations() validates
 * against THIS list, and the type below is derived from it so the two cannot
 * drift. Adding a key here deliberately breaks every expectations file until it
 * declares one — which is the point. A capability no deployment has an opinion
 * about is a capability whose absence nobody will notice.
 */
export const CAPABILITY_KEYS = [
  'workflow.pgr.actions.ESCALATE',
  'mdms.rejectionReasons',
  'pgr.citizenCreate',
  'ui.citizen.attachmentDetailRender',
  'personas.gro-with-department',
  'personas.ward-scoped-csr',
  'locales.multi',
  'tenant.citySubTenant',
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export const EXPECTATION_VALUES = ['required', 'optional', 'absent'] as const;

export type Expectation = (typeof EXPECTATION_VALUES)[number];

export interface Expectations {
  name: string;
  expectations: Record<CapabilityKey, Expectation>;
}

const DEFAULT_EXPECTATIONS_FILE = resolve('deploy/expectations/default.json');

let expectationsCache: Expectations | null = null;

export function expectationsPath(): string {
  const explicit = process.env.EXPECTATIONS_FILE?.trim();
  return explicit ? resolve(explicit) : DEFAULT_EXPECTATIONS_FILE;
}

/**
 * Check a manifest against the capability list before anyone trusts it.
 *
 * The type assertion this replaces was the whole safety story for a hand-edited
 * JSON file, and it bought nothing at runtime. Both ways it can rot are silent
 * and both fail OPEN — toward green:
 *
 *   - a missing or misspelled KEY reads back as `undefined`, which requires()
 *     treats as undeclared and SKIPS. A 'required' capability quietly stops
 *     being required, and the regression this suite exists to catch is reported
 *     as an N/A.
 *   - a missing key for a DECLARATIVE capability is worse than a skip:
 *     ui.citizen.attachmentDetailRender has no probe, so isPresent() answers
 *     `declared(key) !== 'absent'` — and `undefined !== 'absent'` is true. Omit
 *     the key and the capability reports PRESENT, on no evidence at all.
 *   - a misspelled VALUE ('require', 'REQUIRED') is not an Expectation, so it is
 *     neither 'required' nor 'absent' and lands in the same skip.
 *
 * So: every key present, every value legal, or the run dies here. A typo in an
 * expectations file must cost a loud failure, never a quiet downgrade.
 */
function validateExpectations(path: string, raw: unknown): Expectations {
  const fail = (why: string): never => {
    throw new Error(
      `Malformed expectations file ${path}: ${why}\n` +
        `Every capability must be declared exactly once with one of: ${EXPECTATION_VALUES.join(' | ')}.\n` +
        `Capabilities: ${CAPABILITY_KEYS.join(', ')}\n` +
        'Refusing to run: an unvalidated manifest silently downgrades a required capability into a skip, ' +
        'which is exactly the regression this file exists to catch.',
    );
  };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('not a JSON object');
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string' || !obj.name.trim()) fail("'name' must be a non-empty string");
  if (!obj.expectations || typeof obj.expectations !== 'object' || Array.isArray(obj.expectations)) {
    fail("'expectations' must be a JSON object");
  }
  const declared = obj.expectations as Record<string, unknown>;

  const missing = CAPABILITY_KEYS.filter((k) => !(k in declared));
  if (missing.length) fail(`missing capability keys: ${missing.join(', ')}`);

  const unknown = Object.keys(declared).filter((k) => !(CAPABILITY_KEYS as readonly string[]).includes(k));
  if (unknown.length) {
    fail(`unknown capability keys (typo, or a capability that no longer exists?): ${unknown.join(', ')}`);
  }

  for (const key of CAPABILITY_KEYS) {
    const v = declared[key];
    if (typeof v !== 'string' || !(EXPECTATION_VALUES as readonly string[]).includes(v)) {
      fail(`'${key}' is ${JSON.stringify(v)}, which is not one of ${EXPECTATION_VALUES.join(' | ')}`);
    }
  }

  return { name: obj.name as string, expectations: declared as Record<CapabilityKey, Expectation> };
}

export function loadExpectations(): Expectations {
  if (expectationsCache) return expectationsCache;
  const path = expectationsPath();
  if (!existsSync(path)) {
    throw new Error(
      `No expectations file at ${path}. Every deployment must declare what it should have — ` +
        'without it an unseeded deployment would skip its way to green. Point EXPECTATIONS_FILE at ' +
        'deploy/expectations/<name>.json (the deploy/<name>.env should export it).',
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(
      `Expectations file ${path} is not readable JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  expectationsCache = validateExpectations(path, raw);
  return expectationsCache;
}

/**
 * Does this deployment have the capability?
 *
 * Pure function of the profile, deliberately: presence must be decided once, by
 * the run that actually interrogated the deployment, not re-probed per spec.
 */
export function isPresent(key: CapabilityKey, profile?: DeploymentProfile): boolean {
  const p = profile ?? getProfile();
  switch (key) {
    case 'workflow.pgr.actions.ESCALATE':
      return p.workflow.pgr.actions.includes('ESCALATE');
    case 'mdms.rejectionReasons':
      return p.mdms.rejectionReasonsCount > 0;
    case 'pgr.citizenCreate':
      // APPLY is [CITIZEN, CSR] on both deployments; if a tenant ever drops
      // CITIZEN, a citizen genuinely cannot file and the wizard is untestable.
      return p.workflow.pgr.found && (p.workflow.pgr.actionRoles.APPLY ?? []).includes('CITIZEN');
    case 'ui.citizen.attachmentDetailRender':
      // No read-only probe can observe whether the detail page renders an <img>,
      // so the declaration is the only signal available. This preserves the old
      // ATTACHMENT_DETAIL_UNSUPPORTED escape hatch but moves it out of a stray
      // env var and into a reviewed, per-deployment file with a rationale.
      return declared(key) !== 'absent';
    case 'personas.gro-with-department':
      return p.personas.resolved['gro-with-department'] != null;
    case 'personas.ward-scoped-csr':
      return p.personas.resolved['ward-scoped-csr'] != null;
    case 'locales.multi':
      return p.locales.length > 1;
    case 'tenant.citySubTenant':
      return !p.tenant.flat;
  }
}

/**
 * Total, by construction: loadExpectations() has already proved every key is
 * declared with a legal value. It deliberately does NOT catch — the previous
 * try/catch here turned an unreadable manifest into `undefined`, which
 * isPresent('ui.citizen.attachmentDetailRender') then read as PRESENT. A
 * capability whose evidence is a declaration must never be able to answer
 * "present" because the declaration failed to load.
 */
function declared(key: CapabilityKey): Expectation {
  return loadExpectations().expectations[key];
}

/** Why the capability reads the way it does, in the deployment's own terms. */
function evidence(key: CapabilityKey, p: DeploymentProfile): string {
  switch (key) {
    case 'workflow.pgr.actions.ESCALATE':
      return `PGR actions: ${p.workflow.pgr.actions.join(', ') || 'none — the businessService search returned nothing'}`;
    case 'mdms.rejectionReasons':
      return `RAINMAKER-PGR.RejectionReasons rows: ${p.mdms.rejectionReasonsCount}`;
    case 'pgr.citizenCreate':
      return `PGR APPLY roles: ${(p.workflow.pgr.actionRoles.APPLY ?? []).join(', ') || 'none'}`;
    case 'ui.citizen.attachmentDetailRender':
      return 'not probeable — presence follows the declaration in the expectations file';
    case 'personas.gro-with-department':
    case 'personas.ward-scoped-csr': {
      const personaKey = key.slice('personas.'.length);
      const hit = p.personas.resolved[personaKey];
      return hit ? `resolved to ${hit.username} (${hit.source})` : p.personas.unresolvedDiagnostics[personaKey] || 'unresolved';
    }
    case 'locales.multi':
      return `seeded locales: ${p.locales.join(', ') || 'none'}`;
    case 'tenant.citySubTenant':
      return p.tenant.flat ? `flat tenant — city and root are both '${p.tenant.root}'` : `city ${p.tenant.city} under root ${p.tenant.root}`;
  }
}

export interface AuditRow {
  key: CapabilityKey;
  expected: Expectation;
  present: boolean;
  verdict: 'ok' | 'fail' | 'skip-ok';
  reason: string;
}

export function auditExpectations(p: DeploymentProfile): AuditRow[] {
  const { name, expectations } = loadExpectations();
  // Driven by CAPABILITY_KEYS, not the file's own keys: the audit must report on
  // every capability that exists, not merely on the ones the file remembered to
  // mention. (Validation already guarantees they are the same set — this keeps
  // that true by construction rather than by trust.)
  return [...CAPABILITY_KEYS].sort().map((key) => {
    const expected = expectations[key];
    const present = isPresent(key, p);
    const why = `${evidence(key, p)}; declared '${expected}' in ${name}`;
    if (present) {
      return expected === 'absent'
        ? { key, expected, present, verdict: 'ok' as const, reason: `present but declared absent — update ${name}: ${why}` }
        : { key, expected, present, verdict: 'ok' as const, reason: why };
    }
    return expected === 'required'
      ? {
          key,
          expected,
          present,
          verdict: 'fail' as const,
          reason:
            `Capability '${key}' is REQUIRED on ${p.tenant.city} but absent (${evidence(key, p)}). ` +
            `${name} declares it 'required', so this is a real seed/app gap — fix the deployment, ` +
            'not the expectation.',
        }
      : { key, expected, present, verdict: 'skip-ok' as const, reason: why };
  });
}

/**
 * Gate a spec on a capability. The decision is the whole point of the two-file
 * design: absent+required FAILS (a gap must not hide behind a skip), while
 * absent+absent skips with a reason that names the real cause.
 */
export function requires(
  t: { skip: (condition: boolean, description: string) => void },
  key: CapabilityKey,
  ctx?: string,
): void {
  const p = getProfile();
  const { name } = loadExpectations();
  const expected = declared(key);
  const present = isPresent(key, p);
  const suffix = ctx ? ` (${ctx})` : '';

  if (present) {
    if (expected === 'absent') {
      console.warn(
        `[capabilities] '${key}' is present on ${p.tenant.city} (${evidence(key, p)}) but ${name} declares it ` +
          "'absent' — running anyway; update the expectations file.",
      );
    }
    return;
  }

  if (expected === 'required') {
    throw new Error(
      `Capability '${key}' is REQUIRED on ${p.tenant.city} but absent (${evidence(key, p)}) per ` +
        `${name}${suffix}. Failing rather than skipping: a required capability that vanished is exactly ` +
        'the regression this suite exists to catch.',
    );
  }

  t.skip(
    true,
    `Capability '${key}' absent on ${p.tenant.city} (${evidence(key, p)}) and declared ` +
      `'${expected}' in ${name}${suffix} — N/A here by design.`,
  );
}
