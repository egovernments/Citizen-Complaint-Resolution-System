/**
 * seed-deployment.ts — make a FROM-SCRATCH deployment testable, reproducibly.
 *
 * This is ENV-DATA-PLAN P0 option (B): seed from version-controlled JSON instead of
 * relying on a binary DB dump. A teardown-with-volumes + fresh deploy leaves the
 * stack unable to run the suite at all (`full-dump.sql` carries 108 localization
 * rows and no ComplaintHierarchy schema). Everything this script seeds was
 * restored by hand on 2026-07-27; this encodes that runbook so it never has to be
 * done by hand again.
 *
 * Deployment-agnostic by construction:
 *   - tenants come from env (ROOT_TENANT / DIGIT_TENANT), never hardcoded
 *   - the mobile rule is derived from the deployment's OWN globalConfigs, so a
 *     Kenya box gets +254 and a Mozambique box gets +258 (copying the shipped
 *     Kenya seed onto Maputo is exactly the bug this avoids)
 *   - every step is idempotent: re-running reports "exists" rather than failing
 *
 * Usage:
 *   cd tests/integration-tests
 *   set -a; source .env; set +a
 *   npx tsx scripts/seed-deployment.ts            # seed everything missing
 *   npx tsx scripts/seed-deployment.ts --check    # report only, change nothing
 *
 * NOTE the two traps this script exists to encode:
 *   1. Localization must be seeded at BOTH the root AND the city tenant — the city
 *      does not inherit, and the citizen/employee UIs read at the city.
 *   2. The localization service caches _search per (tenant, locale, module). After
 *      writing you MUST flush, or every verification reads the stale count.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { BASE_URL, ROOT_TENANT, TENANT, ADMIN_USER, ADMIN_PASS } from '../tests/utils/env';

const CHECK_ONLY = process.argv.includes('--check');
/** Where the version-controlled seed lives (a git submodule in this repo). */
const SEED_ROOT = resolve(__dirname, '../../../local-setup/ansible/nairobi-mdms');
const LOC_DIR = join(SEED_ROOT, 'localization');
const MDMS_DIR = join(SEED_ROOT, 'mdms');
/** Root first: schemas/masters live at the root and the city inherits them. */
const TENANTS = Array.from(new Set([ROOT_TENANT, TENANT]));

let token = '';
const log = (s: string) => console.log(s);

async function post<T = any>(path: string, body: unknown): Promise<{ ok: boolean; data?: T; err?: string }> {
  try {
    const r = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, err: `${r.status} ${text.slice(0, 160)}` };
    return { ok: true, data: text ? (JSON.parse(text) as T) : undefined };
  } catch (e) {
    return { ok: false, err: (e as Error).message.slice(0, 160) };
  }
}

const requestInfo = () => ({ apiId: 'Rainmaker', ver: '1.0', msgId: `seed|en_IN`, authToken: token });

async function auth(): Promise<void> {
  const body = new URLSearchParams({
    grant_type: 'password', username: ADMIN_USER, password: ADMIN_PASS,
    tenantId: ROOT_TENANT, scope: 'read', userType: 'EMPLOYEE',
  });
  const r = await fetch(`${BASE_URL}/user/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=' },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`admin login failed (${r.status}) — is the stack up?`);
  token = ((await r.json()) as { access_token: string }).access_token;
}

// ── localization ────────────────────────────────────────────────────────────

async function locCount(tenant: string, module: string): Promise<number> {
  const r = await post<{ messages?: unknown[] }>(
    `/localization/messages/v1/_search?tenantId=${tenant}&locale=en_IN&module=${module}`,
    { RequestInfo: requestInfo() },
  );
  return r.data?.messages?.length ?? 0;
}

async function seedLocalization(): Promise<void> {
  const files = ['rainmaker-common.json', 'rainmaker-pgr.json', 'rainmaker-hr.json'];
  for (const tenant of TENANTS) {
    for (const f of files) {
      const p = join(LOC_DIR, f);
      if (!existsSync(p)) { log(`  ! missing seed file ${f} — is the nairobi-mdms submodule initialised?`); continue; }
      const msgs = JSON.parse(readFileSync(p, 'utf8')) as Array<{ code: string; message: string; module: string; locale: string }>;
      const module = msgs[0]?.module ?? f.replace('.json', '');
      const before = await locCount(tenant, module);
      if (before >= msgs.length) { log(`  = ${module} @ ${tenant}: ${before} (already seeded)`); continue; }
      if (CHECK_ONLY) { log(`  ~ ${module} @ ${tenant}: ${before} → would seed ${msgs.length}`); continue; }
      for (let i = 0; i < msgs.length; i += 300) {
        const chunk = msgs.slice(i, i + 300).map((m) => ({ code: m.code, message: m.message, module, locale: m.locale || 'en_IN' }));
        const r = await post(`/localization/messages/v1/_upsert?tenantId=${tenant}&locale=en_IN`,
          { RequestInfo: requestInfo(), tenantId: tenant, messages: chunk });
        if (!r.ok) log(`    ! chunk ${i} failed: ${r.err}`);
      }
      log(`  + ${module} @ ${tenant}: ${before} → ${msgs.length}`);
    }
  }
}

/**
 * The city must be at least as complete as the root — `admin/localization` asserts
 * exactly that, and the bootstrap writes a handful of root-only rows.
 */
async function mirrorRootToCity(): Promise<void> {
  if (ROOT_TENANT === TENANT) return;
  for (const module of ['rainmaker-common', 'rainmaker-pgr', 'rainmaker-hr']) {
    const [rootRes, cityRes] = await Promise.all([
      post<{ messages?: Array<{ code: string; message: string }> }>(`/localization/messages/v1/_search?tenantId=${ROOT_TENANT}&locale=en_IN&module=${module}`, { RequestInfo: requestInfo() }),
      post<{ messages?: Array<{ code: string; message: string }> }>(`/localization/messages/v1/_search?tenantId=${TENANT}&locale=en_IN&module=${module}`, { RequestInfo: requestInfo() }),
    ]);
    const cityCodes = new Set((cityRes.data?.messages ?? []).map((m) => m.code));
    const missing = (rootRes.data?.messages ?? []).filter((m) => !cityCodes.has(m.code));
    if (!missing.length) { log(`  = ${module}: root/city in parity`); continue; }
    if (CHECK_ONLY) { log(`  ~ ${module}: ${missing.length} root-only rows would be mirrored to city`); continue; }
    for (let i = 0; i < missing.length; i += 300) {
      const chunk = missing.slice(i, i + 300).map((m) => ({ code: m.code, message: m.message, module, locale: 'en_IN' }));
      await post(`/localization/messages/v1/_upsert?tenantId=${TENANT}&locale=en_IN`,
        { RequestInfo: requestInfo(), tenantId: TENANT, messages: chunk });
    }
    log(`  + ${module}: mirrored ${missing.length} rows to ${TENANT}`);
  }
}

// ── MDMS schemas + masters ──────────────────────────────────────────────────

async function ensureSchema(tenant: string, code: string, definition: unknown): Promise<void> {
  if (CHECK_ONLY) { log(`  ~ schema ${code} @ ${tenant}: would ensure`); return; }
  const r = await post('/mdms-v2/schema/v1/_create',
    { RequestInfo: requestInfo(), SchemaDefinition: { tenantId: tenant, code, description: code, definition, isActive: true } });
  log(r.ok ? `  + schema ${code} @ ${tenant}` : `  = schema ${code} @ ${tenant} (${/DUPLICATE/.test(r.err ?? '') ? 'exists' : r.err})`);
}

async function ensureData(tenant: string, schemaCode: string, uid: string, data: unknown): Promise<void> {
  if (CHECK_ONLY) { log(`  ~ ${schemaCode}/${uid} @ ${tenant}: would ensure`); return; }
  const r = await post(`/mdms-v2/v2/_create/${schemaCode}`,
    { RequestInfo: requestInfo(), Mdms: { tenantId: tenant, schemaCode, uniqueIdentifier: uid, data, isActive: true } });
  log(r.ok ? `  + ${schemaCode}/${uid} @ ${tenant}` : `  = ${schemaCode}/${uid} @ ${tenant} (exists/err)`);
}

/** ComplaintHierarchy: written by the onboarding wizard, absent from the dump. */
async function seedComplaintHierarchySchemas(): Promise<void> {
  const hier = {
    type: 'object', title: 'RAINMAKER-PGR.ComplaintHierarchy', $schema: 'http://json-schema.org/draft-07/schema#',
    required: ['code', 'name', 'hierarchyType', 'levelCode', 'active'], 'x-unique': ['code'],
    properties: {
      hierarchyType: { type: 'string' }, levelCode: { type: 'string' }, code: { type: 'string' },
      parentCode: { type: ['string', 'null'] }, name: { type: 'string' }, order: { type: 'number' },
      active: { type: 'boolean' }, path: { type: 'string' }, department: { type: 'string' },
      departments: { type: 'array', items: { type: 'string' } },
      slaHours: { type: 'number' }, keywords: { type: 'string' },
    },
    'x-ref-schema': [], additionalProperties: false,
  };
  const hdef = {
    type: 'object', title: 'RAINMAKER-PGR.ComplaintHierarchyDefinition', $schema: 'http://json-schema.org/draft-07/schema#',
    required: ['hierarchyType', 'levels', 'active'], 'x-unique': ['hierarchyType'],
    properties: {
      hierarchyType: { type: 'string' }, active: { type: 'boolean' },
      levels: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
    'x-ref-schema': [], additionalProperties: false,
  };
  await ensureSchema(ROOT_TENANT, 'RAINMAKER-PGR.ComplaintHierarchy', hier);
  await ensureSchema(ROOT_TENANT, 'RAINMAKER-PGR.ComplaintHierarchyDefinition', hdef);
}

async function seedRejectionReasons(): Promise<void> {
  const sp = join(MDMS_DIR, 'schemas/RAINMAKER-PGR/RejectionReasons.json');
  const dp = join(MDMS_DIR, 'data/ke/RAINMAKER-PGR/RejectionReasons.json');
  if (existsSync(sp)) {
    const sd = JSON.parse(readFileSync(sp, 'utf8'));
    await ensureSchema(ROOT_TENANT, 'RAINMAKER-PGR.RejectionReasons', sd.definition ?? sd);
  }
  if (!existsSync(dp)) return;
  for (const row of JSON.parse(readFileSync(dp, 'utf8')) as Array<Record<string, any>>) {
    const data = row.data ?? row;
    await ensureData(ROOT_TENANT, 'RAINMAKER-PGR.RejectionReasons', row.uniqueIdentifier ?? data.code, data);
  }
}

/**
 * The mobile rule MUST reflect this deployment, not the shipped Kenya seed.
 * Read it from the SPA's own globalConfigs (the rule the UI actually enforces) so
 * MDMS and the UI can never disagree — the exact mismatch that broke
 * verify-mobile-validation. Two masters exist; the app/tests read
 * `common-masters.MobileNumberValidation`.
 */
async function seedMobileValidation(): Promise<void> {
  let pattern = '', countryCode = '';
  try {
    const js = await (await fetch(`${BASE_URL}/digit-ui/globalConfigs.js`)).text();
    pattern = /mobileNumberPattern["']?\s*[:=]\s*["']([^"']+)/.exec(js)?.[1]
      ?? /mobileNumberRegex["']?\s*[:=]\s*["']([^"']+)/.exec(js)?.[1] ?? '';
    countryCode = /countryCode["']?\s*[:=]\s*["']([^"']+)/.exec(js)?.[1] ?? '';
  } catch { /* fall through to the profile below */ }
  if (!pattern) {
    const pf = resolve('deployment-profile.json');
    if (existsSync(pf)) {
      const p = JSON.parse(readFileSync(pf, 'utf8'));
      pattern = p?.mobile?.pattern ?? ''; countryCode = countryCode || (p?.mobile?.countryCode ?? '');
    }
  }
  if (!pattern) { log('  ! could not resolve this deployment\'s mobile pattern — skipping (set it by hand)'); return; }
  const digits = /\{(\d+)\}/.exec(pattern)?.[1];
  const len = digits ? Number(digits) + 1 : 10; // leading class + {n}
  const defn = {
    type: 'object', title: 'common-masters.MobileNumberValidation', $schema: 'http://json-schema.org/draft-07/schema#',
    required: ['countryCode', 'mobileNumberRegex'], 'x-unique': ['countryCode'],
    properties: { countryCode: { type: 'string' }, mobileNumberRegex: { type: 'string' }, default: { type: 'boolean' }, errorMessage: { type: 'string' } },
    'x-ref-schema': [], additionalProperties: false,
  };
  const data = { countryCode: countryCode || '+000', mobileNumberRegex: pattern, default: true,
    errorMessage: `Please enter a valid mobile number (${len} digits)` };
  await ensureSchema(ROOT_TENANT, 'common-masters.MobileNumberValidation', defn);
  for (const t of TENANTS) await ensureData(t, 'common-masters.MobileNumberValidation', data.countryCode, data);
  log(`  → mobile rule: ${data.countryCode} ${pattern} (derived from this deployment)`);
}

// ── cache ───────────────────────────────────────────────────────────────────

/**
 * Without this every verification reads stale counts and you conclude the seeding
 * failed when it didn't. Best-effort: falls back to the localization cache-bust
 * endpoint when the redis container isn't reachable from here.
 */
async function bustCaches(): Promise<void> {
  if (CHECK_ONLY) return;
  const { execSync } = await import('node:child_process');
  try {
    execSync('docker exec digit-redis redis-cli FLUSHALL', { stdio: 'ignore' });
    log('  + flushed redis (localization + validationRules)');
    return;
  } catch { /* not a local docker stack */ }
  await post('/localization/messages/v1/_cache-bust', { RequestInfo: requestInfo() });
  log('  + requested localization cache-bust');
}

async function main(): Promise<void> {
  log(`seed-deployment: ${BASE_URL}  root=${ROOT_TENANT} city=${TENANT}${CHECK_ONLY ? '  [CHECK ONLY]' : ''}`);
  await auth();
  log('\n── MDMS schemas ──');
  await seedComplaintHierarchySchemas();
  log('\n── RejectionReasons ──');
  await seedRejectionReasons();
  log('\n── mobile validation ──');
  await seedMobileValidation();
  log('\n── localization ──');
  await seedLocalization();
  await mirrorRootToCity();
  log('\n── caches ──');
  await bustCaches();
  log('\nDone. Re-run any time — every step is idempotent.');
  log('Onboarding data (boundaries / complaint types / employees) is NOT handled here:');
  log('  seed it with the XLSX onboarding (see docs/TEST-PREREQUISITES.md §1b row A).');
}

main().catch((e) => { console.error(e); process.exit(1); });
