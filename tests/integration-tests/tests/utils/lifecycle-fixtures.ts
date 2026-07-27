/**
 * Lifecycle fixtures — SRIDs produced by `fixtures/lifecycle.setup.ts`.
 *
 * The setup runs once per suite invocation, creates two complaints
 * (one left at PENDINGFORASSIGNMENT, one walked all the way to
 * CLOSEDAFTERRESOLUTION with a rating), and writes the resulting
 * SRIDs to `lifecycle-fixtures.json` next to `auth.json`.
 *
 * Downstream specs that need a "pinned" complaint id read from here
 * via `readLifecycleFixtures()` instead of pinning to a historical
 * naipepea SRID. The setup runs against whatever tenant is configured
 * via DIGIT_TENANT — so the fixtures match the deployment.
 *
 * Override via env var `LIFECYCLE_FIXTURES_FILE` to point at a
 * pre-built JSON (useful for CI matrix runs that share fixtures
 * across multiple test shards).
 */
import fs from 'fs';
import path from 'path';

export interface LifecycleFixtures {
  generated_at: string;
  tenant: string;
  /**
   * When the setup couldn't run end-to-end (e.g. the deployment has a
   * broken user-service), `status: 'skipped'` is written with a
   * reason. Consumers should fall through to their own env-var or
   * historical defaults instead of using `complaints` (which will be
   * absent in this case).
   */
  status?: 'ok' | 'skipped';
  skipped_reason?: string;
  complaints?: {
    /** Complaint left at PENDINGFORASSIGNMENT (Take Action visible). */
    non_terminal: string;
    /** Complaint walked through ASSIGN → RESOLVE → RATE → CLOSEDAFTERRESOLUTION. */
    terminal_rated: string;
    /**
     * Complaint driven to PENDINGATLME and left there — assigned but not yet
     * resolved. Optional: added after non_terminal/terminal_rated, so an
     * older fixture file (or one pointed at via LIFECYCLE_FIXTURES_FILE from
     * a prior run) may not carry it; readers must not assume its presence.
     */
    assigned_to_employee?: string;
  };
  citizen?: {
    phone: string;
    name: string;
  };
  /**
   * The employee `assigned_to_employee` (and `terminal_rated`, before it was
   * resolved) landed on — the seed plan's assignee: the one HRMS employee at
   * this tenant whose department matches the seeded service AND who holds a
   * role able to act on PENDINGATLME. Persisted so a spec can identify whose
   * inbox a complaint should show up in without re-deriving the seed plan.
   */
  assignee?: {
    uuid: string;
    code: string;
  };
}

/** Candidate paths the fixture file may live at. First hit wins. */
function candidates(): string[] {
  const cwd = process.cwd();
  return [
    process.env.LIFECYCLE_FIXTURES_FILE,
    path.join(cwd, 'lifecycle-fixtures.json'),
    path.join(cwd, 'tests/integration-tests/lifecycle-fixtures.json'),
    path.join(__dirname, '..', '..', 'lifecycle-fixtures.json'),
  ].filter(Boolean) as string[];
}

/** Read the lifecycle fixture file. Returns null when not present. */
export function readLifecycleFixtures(): LifecycleFixtures | null {
  for (const p of candidates()) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as LifecycleFixtures;
      }
    } catch {
      // Try the next candidate
    }
  }
  return null;
}

/** Write the lifecycle fixture file. Called only by the setup. */
export function writeLifecycleFixtures(data: LifecycleFixtures): string {
  const out = process.env.LIFECYCLE_FIXTURES_FILE
    || path.join(process.cwd(), 'lifecycle-fixtures.json');
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  return out;
}
