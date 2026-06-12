/**
 * Tests for the snapshot/diff feature — phased to match the build.
 * Pure unit tests over fixture artifacts (no infra needed) + registry surface.
 *
 * Usage: npx tsx test-snapshot.ts
 */
import { ToolRegistry } from './src/tools/registry.js';
import { registerAllTools } from './src/tools/index.js';
import {
  parseComposeImages,
  diffImages,
  diffConfig,
  diffData,
  diffSnapshots,
  makeSet,
  SNAPSHOT_SCHEMA,
  type Snapshot,
  type ImagesLayer,
  type ConfigLayer,
  type DataLayer,
} from './src/services/snapshot.js';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
}
function eq(a: unknown, b: unknown, msg: string): void {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);
}

function wrap(layer: Partial<Snapshot>, label: string): Snapshot {
  return {
    $schema: SNAPSHOT_SCHEMA,
    meta: {
      label, capturedAt: '2026-06-10T00:00:00.000Z', mcpVersion: '1.0.0',
      environment: { name: 'test', url: 'http://x', stateTenantId: 'ke' },
      tenantId: 'ke.bomet', stateRoot: 'ke', hostname: 'test', redacted: true, authenticated: true,
      layers: ['images', 'config', 'data'], reachability: {},
    },
    ...layer,
  };
}

// ── Phase 0/registry surface ────────────────────────────────────────
console.log('\n=== registry surface ===');
{
  const reg = new ToolRegistry();
  registerAllTools(reg);
  const all = reg.getAllTools();
  ok(!!all.find((t) => t.name === 'snapshot_capture'), 'snapshot_capture registered');
  ok(!!all.find((t) => t.name === 'snapshot_diff'), 'snapshot_diff registered');

  // not visible until the group is enabled (progressive disclosure)
  const enabledBefore = reg.getEnabledTools().map((t) => t.name);
  ok(!enabledBefore.includes('snapshot_capture'), 'snapshot tools hidden before enable');
  reg.enableGroups(['snapshot']);
  const enabledAfter = reg.getEnabledTools().map((t) => t.name);
  ok(enabledAfter.includes('snapshot_capture'), 'snapshot_capture visible after enable');
  ok(enabledAfter.includes('snapshot_diff'), 'snapshot_diff visible after enable');

  const diff = reg.getTool('snapshot_diff')!;
  ok((diff.inputSchema as { required?: string[] }).required?.includes('a') === true, 'snapshot_diff requires a/b');
  ok(diff.risk === 'read' && reg.getTool('snapshot_capture')!.risk === 'read', 'both tools are read-risk');
}

// ── Phase 1: compose parser ─────────────────────────────────────────
console.log('\n=== Phase 1: compose parser ===');
{
  const compose = [
    'version: "3"',
    'services:',
    '  egov-user:',
    '    image: egovio/egov-user:1044-preview',
    '    ports:',
    '      - 8080',
    '  pgr-services:',
    '    image: ${PGR_IMAGE:-pgr-services-dev:latest}',
    '  redis:',
    '    image: redis:7.2.4',
    'volumes:',
    '  pgdata:',
    '    image: should-be-ignored-outside-services',
  ].join('\n');
  const parsed = parseComposeImages('inline.yml', compose);
  eq(parsed['egov-user'], 'egovio/egov-user:1044-preview', 'parses a plain image ref');
  eq(parsed['pgr-services'], 'pgr-services-dev:latest', 'resolves ${VAR:-default} interpolation');
  eq(parsed['redis'], 'redis:7.2.4', 'parses image with version tag');
  ok(!('pgdata' in parsed), 'ignores keys outside the services block');
}

// ── Phase 1: image diff ─────────────────────────────────────────────
console.log('\n=== Phase 1: image diff ===');
{
  const base: ImagesLayer = {
    running: {
      'egov-user': { imageRef: 'egovio/egov-user:t1', repoDigest: 'sha256:AAA', imageId: 'sha256:id1', createdAt: null, state: 'running', composeService: 'egov-user', composeProject: 'digit' },
      'pgr-services': { imageRef: 'pgr:live', repoDigest: 'sha256:PPP', imageId: 'sha256:idp', createdAt: null, state: 'running', composeService: 'pgr-services', composeProject: 'digit' },
    },
    declared: { 'pgr-services': { imageRef: 'pgr:latest', sourceFile: 'c.yml' } },
    composeFiles: ['c.yml'],
  };

  // identical → 0 findings (declared-vs-running drift still fires within-side, so compare like-for-like)
  eq(diffImages(base, base).filter((f) => f.kind !== 'declaredVsRunning').length, 0, 'identical snapshots → 0 cross-side findings');

  // declared != running surfaces on each side
  ok(diffImages(base, base).some((f) => f.kind === 'declaredVsRunning' && f.severity === 'critical'), 'declared!=running drift flagged critical');

  // digest mismatch under same ref
  const b2: ImagesLayer = JSON.parse(JSON.stringify(base));
  b2.running['egov-user'].repoDigest = 'sha256:BBB';
  const dm = diffImages(base, b2).find((f) => f.kind === 'digestMismatch');
  ok(!!dm && dm.severity === 'critical', 'same ref, different digest → critical digestMismatch');

  // only-in-one
  const b3: ImagesLayer = JSON.parse(JSON.stringify(base));
  delete b3.running['pgr-services'];
  ok(diffImages(base, b3).some((f) => f.kind === 'onlyInA' && f.subject === 'pgr-services'), 'container only in A flagged');

  // null repoDigest fallback to imageId
  const a4: ImagesLayer = JSON.parse(JSON.stringify(base));
  const b4: ImagesLayer = JSON.parse(JSON.stringify(base));
  a4.running['egov-user'].repoDigest = null;
  b4.running['egov-user'].repoDigest = null;
  b4.running['egov-user'].imageId = 'sha256:DIFFERENT';
  ok(diffImages(a4, b4).some((f) => f.kind === 'imageIdMismatch'), 'null repoDigest falls back to imageId compare');
}

// ── Phase 2: config diff ────────────────────────────────────────────
console.log('\n=== Phase 2: config diff ===');
{
  const a: ConfigLayer = {
    containerEnv: {
      'egov-user': {
        EGOV_HOST: { value: 'http://mdms:8080' },
        DB_PASSWORD: { redacted: true, sha256: 'hashA' },
        STATIC_OTP: { value: 'true' },
      },
    },
    mdms: { 'common-masters.StateInfo': { 'ke:ke': { hash: 'h1', tenantId: 'ke', data: {} } } },
    workflow: { PGR: { hash: 'w1', states: 7, actions: 14 } },
  };
  const b: ConfigLayer = JSON.parse(JSON.stringify(a));
  b.containerEnv['egov-user'].EGOV_HOST = { value: 'http://other:8080' };
  b.containerEnv['egov-user'].DB_PASSWORD = { redacted: true, sha256: 'hashB' };
  delete b.containerEnv['egov-user'].STATIC_OTP;
  b.mdms['common-masters.StateInfo']['ke:ke'].hash = 'h2';
  b.workflow.PGR.hash = 'w2';

  const f = diffConfig(a, b);
  ok(f.some((x) => x.kind === 'envChanged' && x.subject === 'egov-user.EGOV_HOST'), 'plain env change flagged with value');
  const secret = f.find((x) => x.kind === 'secretChanged');
  ok(!!secret && secret.a === '«redacted»' && secret.b === '«redacted»', 'secret change flagged WITHOUT leaking value');
  ok(f.some((x) => x.kind === 'envRemoved' && x.subject === 'egov-user.STATIC_OTP'), 'removed env flagged');
  ok(f.some((x) => x.kind === 'mdmsChanged'), 'MDMS content change flagged');
  ok(f.some((x) => x.kind === 'workflowChanged'), 'workflow state-machine change flagged');
  eq(diffConfig(a, a).length, 0, 'identical config → 0 findings');
}

// ── Phase 3: data diff ──────────────────────────────────────────────
console.log('\n=== Phase 3: data diff ===');
{
  ok(makeSet(['B', 'A', 'A', '', undefined]).hash === makeSet(['A', 'B']).hash, 'makeSet is order/dup/empty-stable');

  const a: DataLayer = {
    rowCounts: { eg_user: 100, eg_boundary: 134 },
    sets: {
      boundaryCodes: makeSet(['BOMET', 'CHESOEN', 'CENTRAL']),
      roleCodes: makeSet(['GRO', 'PGR_LME', 'CITIZEN']),
    },
    encCanary: { plaintext: 'x', tenantId: 'ke', ciphertext: '74493|abc', keyIdHint: '74493' },
  };
  const b: DataLayer = {
    rowCounts: { eg_user: 90, eg_boundary: 134 },
    sets: {
      boundaryCodes: makeSet(['BOMET', 'CENTRAL']), // missing CHESOEN
      roleCodes: makeSet(['GRO', 'PGR_LME', 'CITIZEN']),
    },
    encCanary: { plaintext: 'x', tenantId: 'ke', ciphertext: '177813|xyz', keyIdHint: '177813' },
  };
  const f = diffData(a, b);

  const rc = f.find((x) => x.kind === 'rowCountDelta' && x.subject === 'eg_user');
  ok(!!rc && rc.severity === 'info', 'row-count delta is info severity');

  const sd = f.find((x) => x.kind === 'setDiff' && x.subject === 'boundaryCodes');
  ok(!!sd, 'boundary set diff flagged');
  eq((sd!.a as string[]), ['CHESOEN'], 'set diff reports the exact missing code (only in A)');

  const enc = f.find((x) => x.kind === 'encKeyMismatch');
  ok(!!enc && enc.severity === 'critical', 'enc-key id mismatch flagged critical');
  ok(enc!.a === '74493' && enc!.b === '177813', 'enc-key mismatch reports both key ids');

  eq(diffData(a, a).length, 0, 'identical data → 0 findings');
}

// ── full diffSnapshots + skipped layers ─────────────────────────────
console.log('\n=== diffSnapshots orchestration ===');
{
  const imgs: ImagesLayer = { running: {}, declared: {}, composeFiles: [] };
  const a = wrap({ images: imgs }, 'A'); // only images layer present
  const b = wrap({ images: imgs }, 'B');
  const report = diffSnapshots(a, b);
  ok(report.layersCompared.includes('images'), 'images compared when present in both');
  ok(report.layersSkipped.some((s) => s.layer === 'config' && /missing/.test(s.reason)), 'config skipped (missing), not crashed');
  ok(report.layersSkipped.some((s) => s.layer === 'data'), 'data skipped (missing)');
  ok(report.summary.identical === true, 'empty identical images → identical report');

  // schema-version surfaced for compatibility checks
  ok(report.schemaA === SNAPSHOT_SCHEMA && report.schemaB === SNAPSHOT_SCHEMA, 'schema versions echoed');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} snapshot tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
