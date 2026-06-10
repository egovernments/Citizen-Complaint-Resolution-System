import { describe, it, expect } from 'vitest';
import { STANDARD_STATE_MAPPINGS } from './standardStateMappings';
import { STATE_KEYS } from './types';

// Shape guard for the ONE canonical built-in status table: the 10 entries
// from the deleted backend mapWorkflowStateToKey switch + PENDING_AT_LME,
// exactly as TraceBackDialog's local STATE_TO_KEY carried them.
describe('STANDARD_STATE_MAPPINGS', () => {
  it('has exactly the 11 canonical entries', () => {
    expect(Object.keys(STANDARD_STATE_MAPPINGS)).toHaveLength(11);
  });

  it('maps only to known SLA column keys', () => {
    for (const value of Object.values(STANDARD_STATE_MAPPINGS)) {
      expect(STATE_KEYS).toContain(value);
    }
  });

  it('keeps the live PGR scheduler statuses mapped', () => {
    expect(STANDARD_STATE_MAPPINGS.PENDINGFORASSIGNMENT).toBe('new');
    expect(STANDARD_STATE_MAPPINGS.PENDINGATLME).toBe('forwarded');
    expect(STANDARD_STATE_MAPPINGS.PENDING_AT_LME).toBe('forwarded');
    expect(STANDARD_STATE_MAPPINGS.RESOLVED).toBe('resolved');
  });
});
