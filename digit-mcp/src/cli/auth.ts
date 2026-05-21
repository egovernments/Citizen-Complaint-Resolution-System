/**
 * CLI credential persistence.
 *
 * Saves credentials to ~/.config/digit-cli/credentials.json so users
 * don't need to pass --username/--password on every command.
 *
 * Before tool handlers run, loads stored credentials into the env vars
 * that digit-api.ts expects (CRS_ENVIRONMENT, CRS_USERNAME, CRS_PASSWORD, etc.).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.config', 'digit-cli');
const CREDS_FILE = join(CONFIG_DIR, 'credentials.json');

export interface StoredCredentials {
  environment?: string;
  username?: string;
  password?: string;
  tenant_id?: string;
  state_tenant?: string;
}

/** Load stored credentials from disk. Returns empty object if none. */
export function loadCredentials(): StoredCredentials {
  try {
    if (!existsSync(CREDS_FILE)) return {};
    const raw = readFileSync(CREDS_FILE, 'utf-8');
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return {};
  }
}

/** Save credentials to disk. Merges with existing. */
export function saveCredentials(creds: StoredCredentials): void {
  const existing = loadCredentials();
  const merged = { ...existing, ...creds };

  // Remove undefined/null entries
  for (const key of Object.keys(merged)) {
    if ((merged as Record<string, unknown>)[key] == null) {
      delete (merged as Record<string, unknown>)[key];
    }
  }

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CREDS_FILE, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
}

/** Delete stored credentials. */
export function clearCredentials(): void {
  try {
    if (existsSync(CREDS_FILE)) {
      writeFileSync(CREDS_FILE, '{}', { mode: 0o600 });
    }
  } catch {
    // Ignore
  }
}

/**
 * Apply stored credentials to environment variables.
 * Only sets env vars that aren't already set (explicit env vars take priority).
 */
export function applyCredentialsToEnv(): void {
  const creds = loadCredentials();

  const mapping: [keyof StoredCredentials, string][] = [
    ['environment', 'CRS_ENVIRONMENT'],
    ['username', 'CRS_USERNAME'],
    ['password', 'CRS_PASSWORD'],
    ['tenant_id', 'CRS_TENANT_ID'],
    ['state_tenant', 'CRS_STATE_TENANT'],
  ];

  for (const [credKey, envKey] of mapping) {
    if (creds[credKey] && !process.env[envKey]) {
      process.env[envKey] = creds[credKey];
    }
  }
}

/** Get the credentials file path (for display in help). */
export function getCredentialsPath(): string {
  return CREDS_FILE;
}
