/**
 * Operator-facing copy for the scheduler's skip reasons, keyed by the
 * backend's EscalationSkipReason enum names. The UI renders the enum name
 * only as a muted code badge — these strings carry the plain-language
 * explanation next to it.
 *
 * `advisory` marks the reasons that do NOT stop a complaint from being
 * processed: the scheduler still resolves an SLA from the remaining
 * sources, the warning just tells the operator the configuration has a
 * gap worth closing.
 */
export interface SkipReasonCopy {
  explanation: string;
  advisory?: boolean;
}

export const SKIP_REASON_COPY: Record<string, SkipReasonCopy> = {
  MAX_DEPTH_REACHED: {
    explanation: 'Already escalated as far as the settings allow.',
  },
  NO_LAST_MODIFIED_TIME: {
    explanation: 'The complaint has no timestamp to measure the SLA from.',
  },
  NO_ASSIGNEES: {
    explanation:
      "Nobody is currently assigned, so there is no one to escalate from — enable 'Escalate complaints nobody has picked up' under Escalation behaviour to act on these.",
  },
  NO_SUPERVISOR_IN_HRMS: {
    explanation: 'The assigned staff member has no supervisor on record.',
  },
  // Role-escalation skips — appear only once "Escalate complaints nobody
  // has picked up" is enabled in Escalation behaviour.
  ROLE_NOT_MAPPED: {
    explanation:
      "The complaint's status has no acting role under 'Escalate complaints nobody has picked up' — add one in Escalation behaviour.",
  },
  ROLE_SUPERVISOR_AMBIGUOUS: {
    explanation:
      'Two or more people matched as the escalation target — pin a specific person for the role, or fix the staff records so exactly one matches.',
  },
  NO_ROLE_SUPERVISOR: {
    explanation:
      'No one matched as the escalation target — create or activate the supervisor in the staff records, or pin a specific person for the role.',
  },
  WORKFLOW_TRANSITION_FAILED: {
    explanation: 'The complaint system refused the escalation step.',
  },
  UNMAPPED_CATEGORY: {
    explanation: "The complaint's category has no SLA Matrix row of its own.",
    advisory: true,
  },
  STATE_MAPPING_MISSING: {
    explanation: "The complaint's status isn't mapped to an SLA column.",
    advisory: true,
  },
};

/** Fallback for reason codes this build doesn't know about yet. */
export const UNKNOWN_SKIP_REASON: SkipReasonCopy = {
  explanation: 'See the server logs for details on this reason.',
};

/** Label appended to advisory reasons so operators don't over-react. */
export const ADVISORY_LABEL = 'advisory — complaint still processed';
