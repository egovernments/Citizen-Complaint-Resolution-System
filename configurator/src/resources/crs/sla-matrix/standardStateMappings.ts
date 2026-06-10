/**
 * The ONE canonical built-in workflow-state → SLA-column-key table.
 *
 * Provenance: the 10 entries from the backend's deleted hardcoded
 * mapWorkflowStateToKey switch (replaced by the CRS.WorkflowStateMapping
 * MDMS record) plus PENDING_AT_LME, exactly as TraceBackDialog's local
 * STATE_TO_KEY carried them. Consumers:
 *
 *   - TraceBackDialog: client-side preview fallback when the tenant has
 *     no CRS.WorkflowStateMapping record yet.
 *   - Escalation Settings page (Card 3): the "Add standard complaint
 *     statuses" button merges these into the tenant mapping
 *     non-destructively (existing entries win).
 *
 * NOTE: the backend scheduler does NOT fall back to this table — with no
 * tenant mapping it simply skips every per-state SLA source. This table
 * exists so operators can seed the mapping in one click and so the
 * trace preview can label statuses before the mapping is saved.
 */
import type { StateKey } from './types';

export const STANDARD_STATE_MAPPINGS: Record<string, StateKey> = {
  PENDINGFORASSIGNMENT: 'new',
  PENDINGATLME: 'forwarded',
  PENDING_AT_LME: 'forwarded',
  IN_TRIAGE: 'triage',
  TRIAGE: 'triage',
  FORWARDED: 'forwarded',
  UNDER_INVESTIGATION: 'investigation',
  INVESTIGATION: 'investigation',
  AWAITING_INFORMATION: 'awaiting',
  AWAITING: 'awaiting',
  RESOLVED: 'resolved',
};
