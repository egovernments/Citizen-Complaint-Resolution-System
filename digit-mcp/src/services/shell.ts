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

function run(file: string, args: string[], extraEnv?: Record<string, string>): ShellResult {
  try {
    const stdout = execFileSync(file, args, {
      encoding: 'utf-8',
      timeout: TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Credentials are passed to the one child that needs them, not written
      // into this process's environment. See the note on psqlEnv below.
      ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
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
//
// Connection details come from the DIGIT_DB_* vars shared with digit-db.ts,
// falling back to the local compose defaults. Previously these were hardcoded
// and the password was assigned to `process.env.PGPASSWORD` at module import,
// which leaked it into every child process this server spawns (and into any
// `pg` client that reads PGPASSWORD) merely because the module was imported.
// It is now passed only to the psql child that needs it.
const dbHost = () => process.env.DIGIT_DB_HOST || 'localhost';
const dbPort = () => process.env.DIGIT_DB_PORT || '15432';
const dbUser = () => process.env.DIGIT_DB_USER || 'egov';
const dbName = () => process.env.DIGIT_DB_NAME || 'egov';
const psqlEnv = (): Record<string, string> => ({
  PGPASSWORD: process.env.DIGIT_DB_PASSWORD || 'egov123',
});

function psqlArgs(extra: string[]): string[] {
  return ['-h', dbHost(), '-p', dbPort(), '-U', dbUser(), '-d', dbName(), ...extra];
}

export function psqlCountAll(tables: readonly string[]): ShellResult {
  const query = tables
    .map(t => `SELECT '${t}' AS tbl, COUNT(*) AS cnt FROM ${t}`)
    .join(' UNION ALL ');

  return run('psql', psqlArgs(['-t', '-A', '-F|', '-c', query]), psqlEnv());
}

export function psqlCountOne(table: string): ShellResult {
  return run('psql', psqlArgs(['-t', '-c', `SELECT COUNT(*) FROM ${table}`]), psqlEnv());
}
