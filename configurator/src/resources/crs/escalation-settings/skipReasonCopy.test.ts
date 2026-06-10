import { describe, it, expect } from 'vitest';
import { ADVISORY_LABEL, SKIP_REASON_COPY, UNKNOWN_SKIP_REASON } from './skipReasonCopy';

describe('SKIP_REASON_COPY', () => {
  it('covers the role-escalation skip reasons', () => {
    expect(SKIP_REASON_COPY.ROLE_NOT_MAPPED).toBeDefined();
    expect(SKIP_REASON_COPY.ROLE_SUPERVISOR_AMBIGUOUS).toBeDefined();
    expect(SKIP_REASON_COPY.NO_ROLE_SUPERVISOR).toBeDefined();
    // Hard skips, not advisory — these stop the complaint from escalating.
    expect(SKIP_REASON_COPY.ROLE_NOT_MAPPED.advisory).toBeUndefined();
    expect(SKIP_REASON_COPY.ROLE_SUPERVISOR_AMBIGUOUS.advisory).toBeUndefined();
    expect(SKIP_REASON_COPY.NO_ROLE_SUPERVISOR.advisory).toBeUndefined();
  });

  it('points NO_ASSIGNEES at the role-escalation opt-in', () => {
    expect(SKIP_REASON_COPY.NO_ASSIGNEES.explanation).toContain(
      'Escalate complaints nobody has picked up',
    );
  });

  it('obeys the jargon ban in every rendered string', () => {
    // Resolver internals (R1/R2/R3), schema codes and the singleton
    // implementation detail must never reach operator-facing copy.
    const banned = /\bR[123]\b|singleton|CRS\./;
    const all = [
      ...Object.values(SKIP_REASON_COPY).map((c) => c.explanation),
      UNKNOWN_SKIP_REASON.explanation,
      ADVISORY_LABEL,
    ];
    for (const text of all) {
      expect(text).not.toMatch(banned);
    }
  });
});
