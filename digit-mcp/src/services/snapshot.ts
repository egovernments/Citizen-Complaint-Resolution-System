/**
 * System-state snapshot + diff core.
 *
 * Two responsibilities, deliberately kept apart so the diff is infra-free:
 *  - capture*  — talk to docker / DB / DIGIT API of the CURRENT environment and
 *                emit one self-contained, deterministic JSON artifact.
 *  - diff*     — PURE functions over two artifacts. No infra access, run anywhere.
 *
 * Used to explain why a fresh `./deploy.sh` clone deviates from a working box
 * (e.g. bomet): image/compose drift, config drift, and data/seed gaps —
 * including encryption-key drift, via a PII-free canary.
 *
 * Layers: images (docker + compose), config (container env + MDMS + workflow),
 * data (row-count + code-set fingerprints + enc-key canary). All fingerprints,
 * never raw rows — the artifact is safe to share in a ticket.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { dockerPs, dockerInspectImages, dockerInspectContainers } from './shell.js';
import { digitApi } from './digit-api.js';
import { digitDb } from './digit-db.js';

export const SNAPSHOT_SCHEMA = 'digit-mcp/snapshot/v1';
export const ENC_CANARY_PLAINTEXT = 'digit-mcp-snapshot-canary-v1';

export type SnapshotLayer = 'images' | 'config' | 'data';
export const ALL_LAYERS: SnapshotLayer[] = ['images', 'config', 'data'];

// Env-var names whose VALUES must never appear in an artifact — hashed instead.
const SECRET_KEY_RE =
  /PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|API[_-]?KEY|SALT|PASS$/i;

// Row-count fingerprint tables (config-ish + volume tables; never selects PII columns).
const COUNT_TABLES = [
  'eg_pgr_service_v2',
  'eg_pgr_address_v2',
  'eg_wf_processinstance_v2',
  'eg_wf_state_v2',
  'eg_hrms_employee',
  'eg_user',
  'eg_boundary',
  'eg_bs_businessservice',
  'message',
] as const;

// ── determinism helpers ─────────────────────────────────────────────

function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeysDeep(v));
}
export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
export function hashOf(v: unknown): string {
  return sha256(canonicalJson(v));
}
/** Strip volatile/instance fields so identical content hashes identically across boxes. */
function stripVolatile(record: Record<string, unknown>): unknown {
  return { data: record.data, isActive: record.isActive };
}
/** Sorted, de-duped string set — the stable form for a "set fingerprint". */
function toSet(values: (string | undefined | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))].sort();
}

// ── snapshot artifact types ─────────────────────────────────────────

export interface SnapshotMeta {
  label: string;
  capturedAt: string;
  mcpVersion: string;
  environment: { name: string; url: string; stateTenantId: string };
  tenantId: string;
  stateRoot: string;
  hostname: string;
  redacted: boolean;
  // Whether the API-driven probes (MDMS, roles, workflow) ran authenticated.
  // When false, those layers may show empty sets that are actually auth-gated,
  // not genuinely empty — diff consumers should treat such emptiness as low-confidence.
  authenticated: boolean;
  layers: SnapshotLayer[];
  reachability: Record<string, { ok: boolean; error?: string; partial?: string[] }>;
}

export interface Snapshot {
  $schema: string;
  meta: SnapshotMeta;
  images?: ImagesLayer;
  config?: ConfigLayer;
  data?: DataLayer;
}

// ── IMAGES layer ────────────────────────────────────────────────────

export interface RunningImage {
  imageRef: string;
  repoDigest: string | null;
  imageId: string | null;
  createdAt: string | null;
  state: string;
  composeService: string | null;
  composeProject: string | null;
}
export interface DeclaredImage {
  imageRef: string;
  sourceFile: string;
}
export interface ImagesLayer {
  running: Record<string, RunningImage>; // keyed by container name
  declared: Record<string, DeclaredImage>; // keyed by compose service name
  composeFiles: string[];
}

interface CaptureResult<T> {
  ok: boolean;
  error?: string;
  partial?: string[];
  layer?: T;
}

export function captureImagesLayer(): CaptureResult<ImagesLayer> {
  const partial: string[] = [];
  const ps = dockerPs();
  if (!ps.ok) return { ok: false, error: `docker ps failed: ${ps.error}` };

  // Parse the TSV from docker ps.
  interface PsRow {
    name: string;
    image: string;
    state: string;
    service: string;
    project: string;
    configFiles: string;
  }
  const rows: PsRow[] = ps.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, image, state, service, project, configFiles] = line.split('\t');
      return {
        name: name || '',
        image: image || '',
        state: state || '',
        service: service || '',
        project: project || '',
        configFiles: configFiles || '',
      };
    })
    .filter((r) => r.name);

  // Resolve RepoDigests / Id / Created per unique image ref.
  const uniqueRefs = toSet(rows.map((r) => r.image));
  const imageMeta = new Map<string, { repoDigest: string | null; imageId: string | null; createdAt: string | null }>();
  if (uniqueRefs.length > 0) {
    const inspect = dockerInspectImages(uniqueRefs);
    if (inspect.ok) {
      for (const line of inspect.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
        try {
          const img = JSON.parse(line) as {
            Id?: string;
            RepoDigests?: string[];
            RepoTags?: string[];
            Created?: string;
          };
          const digest = (img.RepoDigests || [])[0] || null;
          const repoDigest = digest && digest.includes('@') ? digest.split('@')[1] : digest;
          // Map back by every tag this image carries (docker ps may show any of them).
          const keys = [...(img.RepoTags || []), ...(img.RepoDigests || [])];
          for (const k of keys) {
            imageMeta.set(k, { repoDigest, imageId: img.Id || null, createdAt: img.Created || null });
          }
        } catch {
          partial.push('failed to parse a docker inspect image record');
        }
      }
    } else {
      partial.push(`docker inspect images failed: ${inspect.error}`);
    }
  }

  const running: Record<string, RunningImage> = {};
  for (const r of rows) {
    const meta = imageMeta.get(r.image);
    running[r.name] = {
      imageRef: r.image,
      repoDigest: meta?.repoDigest ?? null,
      imageId: meta?.imageId ?? null,
      createdAt: meta?.createdAt ?? null,
      state: r.state,
      composeService: r.service || null,
      composeProject: r.project || null,
    };
  }

  // Locate compose files: prefer the config_files label (exact files the stack
  // started with), then env override, then conventional paths.
  const composeFiles = locateComposeFiles(rows.map((r) => r.configFiles));
  const declared: Record<string, DeclaredImage> = {};
  for (const file of composeFiles) {
    try {
      const parsed = parseComposeImages(file);
      for (const [service, imageRef] of Object.entries(parsed)) {
        if (!(service in declared)) declared[service] = { imageRef, sourceFile: file };
      }
    } catch (err) {
      partial.push(`failed to parse compose ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return {
    ok: true,
    partial: partial.length ? partial : undefined,
    layer: { running, declared, composeFiles },
  };
}

function locateComposeFiles(labelValues: string[]): string[] {
  // 1. compose config_files label (comma-separated absolute paths).
  const fromLabel = new Set<string>();
  for (const v of labelValues) {
    for (const f of v.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (existsSync(f)) fromLabel.add(f);
    }
  }
  if (fromLabel.size > 0) return [...fromLabel].sort();

  // 2. explicit override.
  const envFile = process.env.DIGIT_COMPOSE_FILE;
  if (envFile && existsSync(envFile)) return [envFile];

  // 3. conventional locations.
  const candidates = [
    '/opt/digit/docker-compose.egov-digit.yaml',
    '/opt/digit/docker-compose.fast-path.yml',
    join(process.env.HOME || '', 'digit', 'docker-compose.egov-digit.yaml'),
  ];
  return candidates.filter((c) => existsSync(c));
}

/**
 * Minimal compose `image:` parser (no YAML dep). Returns { service -> imageRef }
 * with `${VAR}` / `${VAR:-default}` resolved against a sibling `.env` file.
 */
export function parseComposeImages(file: string, contentOverride?: string): Record<string, string> {
  const content = contentOverride ?? readFileSync(file, 'utf-8');
  const envMap = contentOverride ? {} : loadEnvFile(join(dirname(file), '.env'));
  const out: Record<string, string> = {};

  const lines = content.split('\n');
  let inServices = false;
  let serviceIndent = -1;
  let currentService: string | null = null;

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;

    // Top-level key (indent 0) toggles the services block.
    if (indent === 0) {
      inServices = /^services:\s*$/.test(raw);
      currentService = null;
      serviceIndent = -1;
      continue;
    }
    if (!inServices) continue;

    // First indented level under services: is the service-name level.
    if (serviceIndent === -1) serviceIndent = indent;

    const serviceMatch = raw.match(/^(\s+)([A-Za-z0-9._-]+):\s*$/);
    if (serviceMatch && serviceMatch[1].length === serviceIndent) {
      currentService = serviceMatch[2];
      continue;
    }

    const imageMatch = raw.match(/^\s+image:\s*["']?([^"'\s#]+)/);
    if (imageMatch && currentService) {
      out[currentService] = resolveEnvInterp(imageMatch[1], envMap);
    }
  }
  return out;
}

function loadEnvFile(path: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) {
      map[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return map;
}

function resolveEnvInterp(ref: string, env: Record<string, string>): string {
  return ref.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:?-([^}]*))?\}/g, (_m, name, _grp, def) => {
    if (env[name] !== undefined && env[name] !== '') return env[name];
    return def !== undefined ? def : '';
  });
}

// ── CONFIG layer ────────────────────────────────────────────────────

export interface EnvValue {
  value?: string;
  redacted?: boolean;
  sha256?: string;
}
export interface ConfigLayer {
  containerEnv: Record<string, Record<string, EnvValue>>;
  mdms: Record<string, Record<string, { hash: string; tenantId: string; data?: unknown }>>;
  workflow: Record<string, { hash: string; states: number; actions: number }>;
}

const DEFAULT_MDMS_SCHEMAS = ['common-masters.StateInfo', 'common-masters.UserValidation', 'tenant.tenants'];

function classifyEnv(key: string, value: string, redact: boolean): EnvValue {
  if (redact && SECRET_KEY_RE.test(key)) {
    return { redacted: true, sha256: sha256(value) };
  }
  return { value };
}

/** Container env from `docker inspect .Config.Env` — on-box only. */
export function captureContainerEnv(containerNames: string[], redact: boolean): CaptureResult<Record<string, Record<string, EnvValue>>> {
  if (containerNames.length === 0) return { ok: true, layer: {} };
  const inspect = dockerInspectContainers(containerNames);
  if (!inspect.ok) return { ok: false, error: `docker inspect failed: ${inspect.error}` };

  const out: Record<string, Record<string, EnvValue>> = {};
  const partial: string[] = [];
  for (const line of inspect.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
    try {
      const c = JSON.parse(line) as { Name?: string; Config?: { Env?: string[] } };
      const name = (c.Name || '').replace(/^\//, '');
      if (!name) continue;
      const env: Record<string, EnvValue> = {};
      for (const e of c.Config?.Env || []) {
        const eq = e.indexOf('=');
        if (eq < 0) continue;
        const key = e.slice(0, eq);
        const val = e.slice(eq + 1);
        env[key] = classifyEnv(key, val, redact);
      }
      // sort keys for determinism
      out[name] = Object.fromEntries(Object.keys(env).sort().map((k) => [k, env[k]]));
    } catch {
      partial.push('failed to parse a docker inspect container record');
    }
  }
  return { ok: true, partial: partial.length ? partial : undefined, layer: out };
}

export async function captureConfigApi(
  tenantId: string,
  stateRoot: string,
  schemas: string[] = DEFAULT_MDMS_SCHEMAS,
): Promise<CaptureResult<Pick<ConfigLayer, 'mdms' | 'workflow'>>> {
  const partial: string[] = [];
  const mdms: ConfigLayer['mdms'] = {};

  for (const schema of schemas) {
    // StateInfo/UserValidation are exact-tenant; capture at both root and city.
    const tenants = toSet([stateRoot, tenantId]);
    mdms[schema] = {};
    for (const t of tenants) {
      try {
        const records = await digitApi.mdmsV2SearchRaw(t, schema, { limit: 200 });
        for (const rec of records) {
          const r = rec as unknown as Record<string, unknown>;
          const uid = String(r.uniqueIdentifier ?? r.id ?? `${t}:${Object.keys(mdms[schema]).length}`);
          const key = `${t}:${uid}`;
          mdms[schema][key] = { hash: hashOf(stripVolatile(r)), tenantId: t, data: stripVolatile(r) };
        }
      } catch (err) {
        partial.push(`mdms ${schema}@${t}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  const workflow: ConfigLayer['workflow'] = {};
  try {
    const services = await digitApi.workflowBusinessServiceSearch(stateRoot);
    for (const svc of services) {
      const s = svc as Record<string, unknown>;
      const code = String(s.businessService ?? 'unknown');
      const states = Array.isArray(s.states) ? s.states : [];
      const actions = states.reduce(
        (n: number, st: unknown) => n + (Array.isArray((st as Record<string, unknown>).actions) ? ((st as Record<string, unknown>).actions as unknown[]).length : 0),
        0,
      );
      workflow[code] = { hash: hashOf(s.states ?? []), states: states.length, actions };
    }
  } catch (err) {
    partial.push(`workflow businessservices: ${err instanceof Error ? err.message : err}`);
  }

  return { ok: true, partial: partial.length ? partial : undefined, layer: { mdms, workflow } };
}

// ── DATA layer ──────────────────────────────────────────────────────

export interface SetFingerprint {
  count: number;
  hash: string;
  values?: string[]; // omitted above SET_VALUES_CAP to keep artifacts small
}
export interface DataLayer {
  rowCounts: Record<string, number | null>;
  sets: Record<string, SetFingerprint>;
  encCanary?: { plaintext: string; tenantId: string; ciphertext: string; keyIdHint: string | null };
}

const SET_VALUES_CAP = 500;

export function makeSet(values: (string | undefined | null)[]): SetFingerprint {
  const set = toSet(values);
  const fp: SetFingerprint = { count: set.length, hash: sha256(set.join('\n')) };
  if (set.length <= SET_VALUES_CAP) fp.values = set;
  return fp;
}

/** Row counts via the read-only digitDb pool — on-box / DB-reachable only. */
export async function captureRowCounts(): Promise<CaptureResult<Record<string, number | null>>> {
  try {
    await digitDb.initialize();
  } catch {
    /* fall through to health check */
  }
  if (!digitDb.isHealthy()) return { ok: false, error: 'DIGIT database not reachable' };

  const counts: Record<string, number | null> = {};
  const partial: string[] = [];
  for (const table of COUNT_TABLES) {
    try {
      const rows = await digitDb.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
      counts[table] = rows[0] ? parseInt(rows[0].n, 10) : null;
    } catch (err) {
      counts[table] = null;
      partial.push(`${table}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { ok: true, partial: partial.length ? partial : undefined, layer: counts };
}

/** Code-set fingerprints + enc-key canary — all via API, remote-capable. */
export async function captureDataApi(tenantId: string, stateRoot: string): Promise<CaptureResult<Pick<DataLayer, 'sets' | 'encCanary'>>> {
  const partial: string[] = [];
  const sets: Record<string, SetFingerprint> = {};

  try {
    const boundaries = await digitApi.boundarySearch(tenantId);
    sets.boundaryCodes = makeSet(boundaries.map((b) => (b as Record<string, unknown>).code as string));
  } catch (err) {
    partial.push(`boundaries: ${err instanceof Error ? err.message : err}`);
  }
  try {
    const roles = await digitApi.accessRolesSearch(stateRoot);
    sets.roleCodes = makeSet(roles.map((r) => (r as Record<string, unknown>).code as string));
  } catch (err) {
    partial.push(`roles: ${err instanceof Error ? err.message : err}`);
  }
  try {
    const services = await digitApi.workflowBusinessServiceSearch(stateRoot);
    sets.businessServices = makeSet(services.map((s) => (s as Record<string, unknown>).businessService as string));
  } catch (err) {
    partial.push(`businessServices: ${err instanceof Error ? err.message : err}`);
  }

  let encCanary: DataLayer['encCanary'];
  try {
    const out = await digitApi.encryptData(stateRoot, [ENC_CANARY_PLAINTEXT]);
    const ciphertext = out[0] || '';
    // DIGIT ciphertext embeds the key id as a leading segment before the first `|`.
    const keyIdHint = ciphertext.includes('|') ? ciphertext.split('|')[0] : null;
    encCanary = { plaintext: ENC_CANARY_PLAINTEXT, tenantId: stateRoot, ciphertext, keyIdHint };
  } catch (err) {
    partial.push(`enc canary: ${err instanceof Error ? err.message : err}`);
  }

  return { ok: true, partial: partial.length ? partial : undefined, layer: { sets, encCanary } };
}

// ── capture orchestrator ────────────────────────────────────────────

export interface CaptureOptions {
  layers: SnapshotLayer[];
  tenantId: string;
  label: string;
  redact: boolean;
  mcpVersion: string;
}

export async function captureSnapshot(opts: CaptureOptions): Promise<Snapshot> {
  const env = digitApi.getEnvironmentInfo();
  const tenantId = opts.tenantId || env.stateTenantId;
  const stateRoot = tenantId.split('.')[0];
  const authenticated = digitApi.isAuthenticated();
  const reachability: SnapshotMeta['reachability'] = {};
  const snapshot: Snapshot = {
    $schema: SNAPSHOT_SCHEMA,
    meta: {
      label: opts.label,
      capturedAt: new Date().toISOString(),
      mcpVersion: opts.mcpVersion,
      environment: { name: env.name, url: env.url, stateTenantId: env.stateTenantId },
      tenantId,
      stateRoot,
      hostname: hostname(),
      redacted: opts.redact,
      authenticated,
      layers: opts.layers,
      reachability,
    },
  };
  const authNote = authenticated ? undefined : 'unauthenticated — API-derived empty sets (MDMS/roles/workflow) may be auth-gated, not genuinely empty';

  if (opts.layers.includes('images')) {
    const res = captureImagesLayer();
    reachability.images = { ok: res.ok, error: res.error, partial: res.partial };
    if (res.ok && res.layer) snapshot.images = res.layer;
  }

  if (opts.layers.includes('config')) {
    const sub: string[] = [];
    const config: ConfigLayer = { containerEnv: {}, mdms: {}, workflow: {} };
    // container env needs the running container names from the images layer (or a fresh ps)
    let names: string[] = snapshot.images ? Object.keys(snapshot.images.running) : [];
    if (names.length === 0) {
      const img = captureImagesLayer();
      if (img.ok && img.layer) names = Object.keys(img.layer.running);
    }
    const envRes = captureContainerEnv(names, opts.redact);
    if (envRes.ok && envRes.layer) config.containerEnv = envRes.layer;
    else if (envRes.error) sub.push(`containerEnv: ${envRes.error}`);
    if (envRes.partial) sub.push(...envRes.partial);

    const apiRes = await captureConfigApi(tenantId, stateRoot);
    if (apiRes.ok && apiRes.layer) {
      config.mdms = apiRes.layer.mdms;
      config.workflow = apiRes.layer.workflow;
    }
    if (apiRes.partial) sub.push(...apiRes.partial);

    if (authNote) sub.push(authNote);
    const anyOk = Object.keys(config.containerEnv).length > 0 || Object.keys(config.mdms).length > 0;
    reachability.config = { ok: anyOk, partial: sub.length ? sub : undefined };
    snapshot.config = config;
  }

  if (opts.layers.includes('data')) {
    const sub: string[] = [];
    const data: DataLayer = { rowCounts: {}, sets: {} };
    const counts = await captureRowCounts();
    if (counts.ok && counts.layer) data.rowCounts = counts.layer;
    else if (counts.error) sub.push(`rowCounts: ${counts.error}`);
    if (counts.partial) sub.push(...counts.partial);

    const apiRes = await captureDataApi(tenantId, stateRoot);
    if (apiRes.ok && apiRes.layer) {
      data.sets = apiRes.layer.sets;
      data.encCanary = apiRes.layer.encCanary;
    }
    if (apiRes.partial) sub.push(...apiRes.partial);

    if (authNote) sub.push(authNote);
    const anyOk = Object.keys(data.rowCounts).length > 0 || Object.keys(data.sets).length > 0 || !!data.encCanary;
    reachability.data = { ok: anyOk, partial: sub.length ? sub : undefined };
    snapshot.data = data;
  }

  return snapshot;
}

// ── DIFF (pure) ─────────────────────────────────────────────────────

export type Severity = 'critical' | 'warn' | 'info';

export interface Finding {
  layer: SnapshotLayer;
  severity: Severity;
  kind: string;
  subject: string;
  a?: unknown;
  b?: unknown;
  message: string;
}

export interface DiffReport {
  success: true;
  schemaA: string;
  schemaB: string;
  a: { label: string; capturedAt: string };
  b: { label: string; capturedAt: string };
  layersCompared: SnapshotLayer[];
  layersSkipped: { layer: SnapshotLayer; reason: string }[];
  summary: { identical: boolean; findings: number; bySeverity: Record<Severity, number> };
  findings: Finding[];
}

function bump(by: Record<Severity, number>, s: Severity): void {
  by[s]++;
}

export function diffImages(a: ImagesLayer, b: ImagesLayer): Finding[] {
  const findings: Finding[] = [];
  const names = toSet([...Object.keys(a.running), ...Object.keys(b.running)]);

  for (const name of names) {
    const ra = a.running[name];
    const rb = b.running[name];
    if (ra && !rb) {
      findings.push({ layer: 'images', severity: 'info', kind: 'onlyInA', subject: name, a: ra.imageRef, message: `container ${name} runs only in A` });
      continue;
    }
    if (rb && !ra) {
      findings.push({ layer: 'images', severity: 'info', kind: 'onlyInB', subject: name, b: rb.imageRef, message: `container ${name} runs only in B` });
      continue;
    }
    if (!ra || !rb) continue;

    if (ra.repoDigest && rb.repoDigest) {
      if (ra.repoDigest !== rb.repoDigest) {
        const sameTag = ra.imageRef === rb.imageRef;
        findings.push({
          layer: 'images',
          severity: 'critical',
          kind: 'digestMismatch',
          subject: name,
          a: ra.repoDigest,
          b: rb.repoDigest,
          message: sameTag
            ? `${name} runs different image digests under the SAME ref (${ra.imageRef}) — tag rebuilt/repulled`
            : `${name} runs different images: A=${ra.imageRef} B=${rb.imageRef}`,
        });
      }
    } else if (ra.imageRef !== rb.imageRef) {
      findings.push({ layer: 'images', severity: 'critical', kind: 'refMismatch', subject: name, a: ra.imageRef, b: rb.imageRef, message: `${name} image ref differs (digest unavailable)` });
    } else if (ra.imageId && rb.imageId && ra.imageId !== rb.imageId) {
      findings.push({ layer: 'images', severity: 'warn', kind: 'imageIdMismatch', subject: name, a: ra.imageId, b: rb.imageId, message: `${name} same ref, different local image id (no repo digest to confirm)` });
    }
  }

  // Within-side declared-vs-running drift (compose says X, container runs Y),
  // reported per side because it's a replication hazard on its own.
  for (const [side, layer] of [['A', a] as const, ['B', b] as const]) {
    const runningByService: Record<string, RunningImage> = {};
    for (const r of Object.values(layer.running)) {
      if (r.composeService) runningByService[r.composeService] = r;
    }
    for (const [service, dec] of Object.entries(layer.declared)) {
      const run = runningByService[service];
      if (run && run.imageRef !== dec.imageRef) {
        findings.push({
          layer: 'images',
          severity: 'critical',
          kind: 'declaredVsRunning',
          subject: `${side}:${service}`,
          a: dec.imageRef,
          b: run.imageRef,
          message: `[${side}] compose declares ${service}=${dec.imageRef} but the container runs ${run.imageRef}`,
        });
      }
    }
  }
  return findings;
}

export function diffConfig(a: ConfigLayer, b: ConfigLayer): Finding[] {
  const findings: Finding[] = [];

  // container env, per container, per key
  const containers = toSet([...Object.keys(a.containerEnv), ...Object.keys(b.containerEnv)]);
  for (const c of containers) {
    const ea = a.containerEnv[c] || {};
    const eb = b.containerEnv[c] || {};
    if (Object.keys(ea).length === 0 || Object.keys(eb).length === 0) continue; // one side didn't capture env for c
    const keys = toSet([...Object.keys(ea), ...Object.keys(eb)]);
    for (const k of keys) {
      const va = ea[k];
      const vb = eb[k];
      if (va && !vb) { findings.push({ layer: 'config', severity: 'warn', kind: 'envRemoved', subject: `${c}.${k}`, message: `${c}: env ${k} present in A, absent in B` }); continue; }
      if (vb && !va) { findings.push({ layer: 'config', severity: 'warn', kind: 'envAdded', subject: `${c}.${k}`, message: `${c}: env ${k} present in B, absent in A` }); continue; }
      if (!va || !vb) continue;
      const secret = va.redacted || vb.redacted;
      const changed = secret ? va.sha256 !== vb.sha256 : va.value !== vb.value;
      if (changed) {
        findings.push({
          layer: 'config',
          severity: 'warn',
          kind: secret ? 'secretChanged' : 'envChanged',
          subject: `${c}.${k}`,
          a: secret ? '«redacted»' : va.value,
          b: secret ? '«redacted»' : vb.value,
          message: `${c}: env ${k} differs${secret ? ' (secret — value withheld)' : ''}`,
        });
      }
    }
  }

  // MDMS records by schema+key
  const schemas = toSet([...Object.keys(a.mdms), ...Object.keys(b.mdms)]);
  for (const schema of schemas) {
    const ma = a.mdms[schema] || {};
    const mb = b.mdms[schema] || {};
    const keys = toSet([...Object.keys(ma), ...Object.keys(mb)]);
    for (const key of keys) {
      const ra = ma[key];
      const rb = mb[key];
      if (ra && !rb) { findings.push({ layer: 'config', severity: 'warn', kind: 'mdmsMissing', subject: `${schema}/${key}`, message: `MDMS ${schema} record ${key} present in A, missing in B` }); continue; }
      if (rb && !ra) { findings.push({ layer: 'config', severity: 'warn', kind: 'mdmsExtra', subject: `${schema}/${key}`, message: `MDMS ${schema} record ${key} present in B, missing in A` }); continue; }
      if (ra && rb && ra.hash !== rb.hash) {
        findings.push({ layer: 'config', severity: 'warn', kind: 'mdmsChanged', subject: `${schema}/${key}`, a: ra.data, b: rb.data, message: `MDMS ${schema} record ${key} content differs` });
      }
    }
  }

  // workflow business services
  const wf = toSet([...Object.keys(a.workflow), ...Object.keys(b.workflow)]);
  for (const code of wf) {
    const wa = a.workflow[code];
    const wb = b.workflow[code];
    if (wa && !wb) { findings.push({ layer: 'config', severity: 'warn', kind: 'workflowMissing', subject: code, message: `business service ${code} present in A, missing in B` }); continue; }
    if (wb && !wa) { findings.push({ layer: 'config', severity: 'warn', kind: 'workflowExtra', subject: code, message: `business service ${code} present in B, missing in A` }); continue; }
    if (wa && wb && wa.hash !== wb.hash) {
      findings.push({ layer: 'config', severity: 'warn', kind: 'workflowChanged', subject: code, a: { states: wa.states, actions: wa.actions }, b: { states: wb.states, actions: wb.actions }, message: `business service ${code} state machine differs (A: ${wa.states}s/${wa.actions}a, B: ${wb.states}s/${wb.actions}a)` });
    }
  }

  return findings;
}

export function diffData(a: DataLayer, b: DataLayer): Finding[] {
  const findings: Finding[] = [];

  // row counts — info severity (counts legitimately drift)
  const tables = toSet([...Object.keys(a.rowCounts), ...Object.keys(b.rowCounts)]);
  for (const t of tables) {
    const ca = a.rowCounts[t];
    const cb = b.rowCounts[t];
    if (ca == null || cb == null) continue;
    if (ca !== cb) {
      findings.push({ layer: 'data', severity: 'info', kind: 'rowCountDelta', subject: t, a: ca, b: cb, message: `${t}: ${ca} vs ${cb} rows (Δ ${cb - ca})` });
    }
  }

  // code sets — set difference where values present, else hash compare
  const setKeys = toSet([...Object.keys(a.sets), ...Object.keys(b.sets)]);
  for (const key of setKeys) {
    const sa = a.sets[key];
    const sb = b.sets[key];
    if (!sa || !sb) continue;
    if (sa.hash === sb.hash) continue;
    if (sa.values && sb.values) {
      const setB = new Set(sb.values);
      const setA = new Set(sa.values);
      const onlyInA = sa.values.filter((v) => !setB.has(v));
      const onlyInB = sb.values.filter((v) => !setA.has(v));
      findings.push({
        layer: 'data',
        severity: 'warn',
        kind: 'setDiff',
        subject: key,
        a: onlyInA,
        b: onlyInB,
        message: `${key}: ${onlyInA.length} only in A, ${onlyInB.length} only in B`,
      });
    } else {
      findings.push({ layer: 'data', severity: 'warn', kind: 'setHashDiff', subject: key, a: sa.count, b: sb.count, message: `${key}: differs (A=${sa.count}, B=${sb.count}; values not captured)` });
    }
  }

  // encryption-key canary
  if (a.encCanary && b.encCanary) {
    const ea = a.encCanary;
    const eb = b.encCanary;
    if (ea.ciphertext && eb.ciphertext && ea.ciphertext === eb.ciphertext) {
      // identical ciphertext ⇒ same key (and deterministic encryption)
    } else if (ea.keyIdHint && eb.keyIdHint && ea.keyIdHint !== eb.keyIdHint) {
      findings.push({ layer: 'data', severity: 'critical', kind: 'encKeyMismatch', subject: 'encCanary', a: ea.keyIdHint, b: eb.keyIdHint, message: `encryption key id differs (A=${ea.keyIdHint}, B=${eb.keyIdHint}) — encrypted PII will not cross-decrypt` });
    } else if (ea.ciphertext !== eb.ciphertext) {
      findings.push({ layer: 'data', severity: 'warn', kind: 'encCanaryDiff', subject: 'encCanary', message: `canary ciphertext differs but key ids match/unknown — encryption may be salted; run decrypt cross-check to confirm` });
    }
  }

  return findings;
}

export function diffSnapshots(a: Snapshot, b: Snapshot, layers?: SnapshotLayer[]): DiffReport {
  const requested = layers && layers.length ? layers : ALL_LAYERS;
  const findings: Finding[] = [];
  const compared: SnapshotLayer[] = [];
  const skipped: { layer: SnapshotLayer; reason: string }[] = [];

  for (const layer of requested) {
    if (layer === 'images') {
      if (a.images && b.images) { findings.push(...diffImages(a.images, b.images)); compared.push('images'); }
      else skipped.push({ layer, reason: !a.images ? 'missing in A' : 'missing in B' });
    } else if (layer === 'config') {
      if (a.config && b.config) { findings.push(...diffConfig(a.config, b.config)); compared.push('config'); }
      else skipped.push({ layer, reason: !a.config ? 'missing in A' : 'missing in B' });
    } else if (layer === 'data') {
      if (a.data && b.data) { findings.push(...diffData(a.data, b.data)); compared.push('data'); }
      else skipped.push({ layer, reason: !a.data ? 'missing in A' : 'missing in B' });
    }
  }

  const bySeverity: Record<Severity, number> = { critical: 0, warn: 0, info: 0 };
  for (const f of findings) bump(bySeverity, f.severity);

  return {
    success: true,
    schemaA: a.$schema,
    schemaB: b.$schema,
    a: { label: a.meta?.label ?? 'A', capturedAt: a.meta?.capturedAt ?? '' },
    b: { label: b.meta?.label ?? 'B', capturedAt: b.meta?.capturedAt ?? '' },
    layersCompared: compared,
    layersSkipped: skipped,
    summary: { identical: findings.length === 0, findings: findings.length, bySeverity },
    findings,
  };
}
