/**
 * Read-only access to the previous SLA settings record
 * (RAINMAKER-PGR.EscalationConfig — edited on the Legacy SLA page, not
 * here). The Escalation Settings page only reads it for two things:
 *
 *   - Card 1's final cascade row ("Previous SLA settings") — the terminal
 *     fallback, never rendered as a miss.
 *   - Card 2's "Not set — using the previous setting (N levels)" helper
 *     under an unset max depth.
 */
import { digitClient } from '@/providers/bridge';

export const LEGACY_ESCALATION_SCHEMA = 'RAINMAKER-PGR.EscalationConfig';

/**
 * Depth the scheduler falls back to when neither the policy nor the
 * legacy record sets one (the service's static default).
 */
export const LEGACY_FALLBACK_MAX_DEPTH = 3;

export interface LegacyEscalationConfig {
  maxDepth?: number;
  /** Per-level SLAs in MILLISECONDS — the previous settings' unit. */
  defaultSlaByLevel?: number[];
  overrides?: Record<string, number[]>;
}

/**
 * Best-effort read at the state tenant (the record only lives at root).
 * Any failure — including the schema not existing on this deployment —
 * is treated the same as "no record": the page must keep working.
 */
export async function loadLegacyEscalationConfig(
  stateTenant: string,
): Promise<LegacyEscalationConfig | null> {
  try {
    const records = await digitClient.mdmsSearch(stateTenant, LEGACY_ESCALATION_SCHEMA, { limit: 5 });
    const active = records.filter((r) => r.isActive !== false);
    if (active.length === 0) return null;
    return active[0].data as unknown as LegacyEscalationConfig;
  } catch {
    return null;
  }
}

/**
 * Compact hours rendering of the legacy ms-per-level array:
 * "L0 1h · L1 4h · L2 24h". Null when the record carries no levels.
 */
export function formatLegacyLevels(msByLevel: number[] | undefined): string | null {
  if (!msByLevel || msByLevel.length === 0) return null;
  return msByLevel.map((ms, i) => `L${i} ${formatHours(ms / 3_600_000)}h`).join(' · ');
}

function formatHours(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}
