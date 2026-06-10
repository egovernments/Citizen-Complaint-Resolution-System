/**
 * Types for the two deployment-wide escalation MDMS records the
 * Escalation Settings page edits:
 *
 *   - CRS.EscalationPolicy       → {@link EscalationPolicy}
 *   - CRS.WorkflowStateMapping   → {@link WorkflowStateMapping}
 *
 * Both are single records keyed `uniqueIdentifier=default` and live at the
 * STATE-LEVEL tenant only (e.g. `ke`, never `ke.bomet`) — the scheduler
 * (EscalationScheduler) and the manual-escalate validator
 * (ServiceRequestValidator) read them at state level, so a city-tenant
 * copy would silently split-brain the config. slaService.toStateTenant
 * enforces this on every read/write.
 *
 * Mirrors the CRS.EscalationPolicy / CRS.WorkflowStateMapping MDMS
 * schemas 1:1, same as types.ts does for CRS.CategorySLA.
 */
import type { StateKey } from './types';

/**
 * PRD pre-breach warning knob. When enabled, the scheduler counts (and on
 * live scans emits) a warning once a complaint has consumed
 * `thresholdPercent` of its SLA without breaching it yet.
 */
export interface PreBreachWarning {
  enabled?: boolean;
  /** Percent of the SLA window (1–99) at which the warning fires. */
  thresholdPercent?: number;
}

/**
 * CRS.EscalationPolicy — deployment-wide escalation behaviour. Every field
 * is optional; an unset field means "use the previous setting" (v0
 * RAINMAKER-PGR.EscalationConfig, then static service config).
 */
export interface EscalationPolicy {
  /**
   * Fixed x-unique placeholder, always 'default' — see saveStateSla in
   * slaService.ts for why these records carry it.
   */
  singletonKey: 'default';
  /** Maximum escalation depth (1–10). */
  maxDepth?: number;
  /**
   * Deployment-wide per-level SLA hours; index = escalation level
   * ([L0, L1, …]). NO null holes — the MDMS schema types items as
   * `number`, so a null is rejected at save. Omit the whole field when
   * the operator hasn't set level defaults. Contrast with
   * CategorySlaRecord.slaHoursByLevel, where holes are allowed.
   */
  defaultSlaHoursByLevel?: number[];
  preBreachWarning?: PreBreachWarning;
  /** Whether staff must enter a comment when escalating manually. */
  escalateCommentRequired?: boolean;
}

/**
 * CRS.WorkflowStateMapping — workflow state name (e.g.
 * `PENDINGFORASSIGNMENT`) → canonical SLA-column key. Without it the
 * scheduler cannot translate a complaint's status into a matrix column,
 * so every per-state SLA source (matrix cells + the defaults row) is
 * skipped; per-level sources still apply.
 */
export interface WorkflowStateMapping {
  /** Fixed x-unique placeholder, always 'default'. */
  singletonKey: 'default';
  mappings: Record<string, StateKey>;
}
