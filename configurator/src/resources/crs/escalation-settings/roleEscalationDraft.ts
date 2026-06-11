/**
 * Pure draft logic for the PolicyCard's role-escalation opt-in block
 * (the `roleEscalation` object on CRS.EscalationPolicy) and the
 * CRS.RoleSupervisors pin table. Kept free of React/UI imports so it
 * stays trivially unit-testable, same as levelSlaValues.ts.
 *
 * Backward compatibility is the hard invariant here: a tenant that never
 * touched the feature must keep saving a policy WITHOUT the
 * `roleEscalation` key — see {@link buildRoleEscalation}.
 */
import type { RoleEscalation } from '../sla-matrix/escalationTypes';

/**
 * The two workflow states the escalation scan currently watches. They
 * render as fixed acting-role rows (the operator fills in the role);
 * other states are free add-rows.
 */
export const WATCHED_STATES: readonly string[] = ['PENDINGFORASSIGNMENT', 'PENDINGATLME'];

/** One acting-role draft row: complaint status → role that owes action. */
export interface ActingRoleDraft {
  state: string;
  role: string;
  /** True for the watched-state rows — name not editable, never removable. */
  fixed: boolean;
}

/** One role-ladder draft row: acting role → the role it escalates to. */
export interface LadderDraft {
  role: string;
  supervisorRole: string;
}

/** Inline error for an out-of-range / non-integer max-per-scan input. */
export const MAX_PER_SCAN_ERROR = 'must be a whole number between 1 and 100';

/** Seed acting-role rows: watched states first (fixed), then the rest. */
export function seedActingRows(map: Record<string, string> | undefined): ActingRoleDraft[] {
  const fixed = WATCHED_STATES.map((state) => ({ state, role: map?.[state] ?? '', fixed: true }));
  const rest = Object.entries(map ?? {})
    .filter(([state]) => !WATCHED_STATES.includes(state))
    .map(([state, role]) => ({ state, role, fixed: false }));
  return [...fixed, ...rest];
}

/** Seed role-ladder rows from the stored supervisorRoleByRole map. */
export function seedLadderRows(map: Record<string, string> | undefined): LadderDraft[] {
  return Object.entries(map ?? {}).map(([role, supervisorRole]) => ({ role, supervisorRole }));
}

function duplicateKeys(keys: string[]): Set<string> {
  const counts = new Map<string, number>();
  keys.forEach((k) => {
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  return new Set(Array.from(counts.entries()).filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * Per-row inline errors for the acting-role rows (null = valid). Fixed
 * rows never error — a blank role there just means "not mapped".
 * Half-filled free rows only flag after a save attempt (`triedSave`),
 * same staging as StateMappingCard; duplicates flag live.
 */
export function validateActingRows(rows: ActingRoleDraft[], triedSave: boolean): (string | null)[] {
  const dups = duplicateKeys(rows.map((r) => r.state.trim()));
  return rows.map((row) => {
    if (row.fixed) return null;
    const state = row.state.trim();
    const role = row.role.trim();
    if (state && dups.has(state)) return 'duplicate — each status can be mapped only once';
    if (!triedSave) return null;
    if (!state && role) return 'enter a complaint status';
    if (state && !role) return 'enter a role, or remove this row';
    return null;
  });
}

/** Per-row inline errors for the role-ladder rows (null = valid). */
export function validateLadderRows(rows: LadderDraft[], triedSave: boolean): (string | null)[] {
  const dups = duplicateKeys(rows.map((r) => r.role.trim()));
  return rows.map((row) => {
    const role = row.role.trim();
    const sup = row.supervisorRole.trim();
    if (role && dups.has(role)) return 'duplicate — each role can have only one ladder step';
    if (!triedSave) return null;
    if (!role && sup) return 'enter a role';
    if (role && !sup) return 'enter the role it escalates to, or remove this row';
    return null;
  });
}

/** Rows → actingRoleByState map; blank/half-filled rows are dropped. */
export function buildActingMap(rows: ActingRoleDraft[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    const state = row.state.trim();
    const role = row.role.trim();
    if (state && role) map[state] = role;
  }
  return map;
}

/** Rows → supervisorRoleByRole map; blank/half-filled rows are dropped. */
export function buildLadderMap(rows: LadderDraft[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    const role = row.role.trim();
    const sup = row.supervisorRole.trim();
    if (role && sup) map[role] = sup;
  }
  return map;
}

/** Parse the max-per-scan input. '' → unset; an integer in [1, 100] → value. */
export function parseMaxPerScan(raw: string): { value?: number; error?: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return {};
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 100) return { error: MAX_PER_SCAN_ERROR };
  return { value: n };
}

/**
 * Assemble the `roleEscalation` object for the policy save, or undefined
 * when the key must be omitted entirely. The omission rule is the
 * backward-compat invariant: a tenant whose loaded policy had no
 * roleEscalation and whose draft is untouched (disabled, no mappings, no
 * cap) keeps saving a byte-identical policy. Once the record carries the
 * object, disabling persists an explicit `enabled: false`.
 */
export function buildRoleEscalation(args: {
  enabled: boolean;
  actingMap: Record<string, string>;
  ladderMap: Record<string, string>;
  maxPerScan?: number;
  /** True when the loaded policy already carried a roleEscalation object. */
  hadExisting: boolean;
}): RoleEscalation | undefined {
  const { enabled, actingMap, ladderMap, maxPerScan, hadExisting } = args;
  const untouched =
    !enabled &&
    Object.keys(actingMap).length === 0 &&
    Object.keys(ladderMap).length === 0 &&
    maxPerScan === undefined;
  if (untouched && !hadExisting) return undefined;
  const next: RoleEscalation = { enabled };
  if (Object.keys(actingMap).length > 0) next.actingRoleByState = actingMap;
  if (Object.keys(ladderMap).length > 0) next.supervisorRoleByRole = ladderMap;
  if (maxPerScan !== undefined) next.maxPerScan = maxPerScan;
  return next;
}

/** Loose RFC-4122 shape check (8-4-4-4-12 hex) for employee-ID inputs. */
export function isUuidFormat(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}
