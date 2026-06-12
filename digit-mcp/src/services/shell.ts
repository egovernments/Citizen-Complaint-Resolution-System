import { execFileSync } from 'node:child_process';

// ──────────────────────────────────────────
// Fixed command registry — no arbitrary shell execution.
// Each command is a known-safe argv array. User input
// is never interpolated into command strings.
// ──────────────────────────────────────────

export interface ShellResult {
  stdout: string;
  ok: boolean;
  error?: string;
}

const TIMEOUT_MS = 15000;

function run(file: string, args: string[]): ShellResult {
  try {
    const stdout = execFileSync(file, args, {
      encoding: 'utf-8',
      timeout: TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stdout.trim(), ok: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    const execErr = err as { stdout?: string | Buffer };
    const partialOut = execErr.stdout ? String(execErr.stdout).trim() : '';
    return { stdout: partialOut, ok: false, error };
  }
}

// ── Kafka lag via rpk inside Redpanda container ──

export function rpkDescribeGroup(): ShellResult {
  return run('docker', [
    'exec', 'digit-redpanda',
    'rpk', 'group', 'describe', 'egov-persister', '--format', 'json',
  ]);
}

// ── Docker introspection (snapshot images/config layers) ──
// Container names are sourced from `docker ps` output, never user input,
// but validated anyway as defense in depth.

const VALID_CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

// Tab-separated: name, image ref, state, compose service, compose project, compose config files.
const DOCKER_PS_FORMAT =
  '{{.Names}}\t{{.Image}}\t{{.State}}\t' +
  '{{.Label "com.docker.compose.service"}}\t' +
  '{{.Label "com.docker.compose.project"}}\t' +
  '{{.Label "com.docker.compose.project.config_files"}}';

export function dockerPs(): ShellResult {
  return run('docker', ['ps', '-a', '--no-trunc', '--format', DOCKER_PS_FORMAT]);
}

/** Batched `docker inspect` of containers — one JSON object per line. */
export function dockerInspectContainers(names: string[]): ShellResult {
  if (names.length === 0) return { stdout: '', ok: true };
  const bad = names.find((n) => !VALID_CONTAINER_NAME.test(n));
  if (bad) return { stdout: '', ok: false, error: `Invalid container name: "${bad}"` };
  return run('docker', ['inspect', '--type', 'container', '--format', '{{json .}}', ...names]);
}

// Image refs carry registry host, port, path, tag and/or digest, so they need
// the extra chars `/ : @`. execFileSync uses no shell, so we only guard against
// whitespace, control chars and leading dashes (option injection).
const VALID_IMAGE_REF = /^[a-zA-Z0-9][a-zA-Z0-9_.\-/:@]*$/;

/** Batched `docker inspect` of images — one JSON object per line. Refs from docker ps. */
export function dockerInspectImages(refs: string[]): ShellResult {
  if (refs.length === 0) return { stdout: '', ok: true };
  const bad = refs.find((r) => !VALID_IMAGE_REF.test(r));
  if (bad) return { stdout: '', ok: false, error: `Invalid image ref: "${bad}"` };
  return run('docker', ['inspect', '--type', 'image', '--format', '{{json .}}', ...refs]);
}

// ── Persister container logs ──

const VALID_SINCE = /^[0-9]+[smh]$/;

export function persisterLogs(since: string): ShellResult {
  if (!VALID_SINCE.test(since)) {
    return { stdout: '', ok: false, error: `Invalid since value: "${since}". Must match /^[0-9]+[smh]$/ (e.g. "5m", "1h", "30s").` };
  }
  return run('docker', ['logs', 'egov-persister', '--since', since]);
}

// ── PostgreSQL row counts ──
// Tables are hardcoded — never from user input.

const DB_HOST = 'localhost';
const DB_PORT = '15432';
const DB_USER = 'egov';
const DB_NAME = 'egov';
const DB_PASS = 'egov123';

export function psqlCountAll(tables: readonly string[]): ShellResult {
  const query = tables
    .map(t => `SELECT '${t}' AS tbl, COUNT(*) AS cnt FROM ${t}`)
    .join(' UNION ALL ');

  return run('psql', ['-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME, '-t', '-A', '-F|', '-c', query], );
}

export function psqlCountOne(table: string): ShellResult {
  return run('psql', ['-h', DB_HOST, '-p', DB_PORT, '-U', DB_USER, '-d', DB_NAME, '-t', '-c', `SELECT COUNT(*) FROM ${table}`]);
}

// Override env for psql password (applied at module level)
process.env.PGPASSWORD = DB_PASS;
