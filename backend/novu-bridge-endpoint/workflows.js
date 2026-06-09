// Novu Framework workflow definitions for the DIGIT notification stack.
//
// Each workflow corresponds to a domain event the platform publishes
// (OTP send, PGR complaint lifecycle, etc.). When Novu's API receives a
// trigger for one of these workflow ids, it POSTs to this bridge to
// render the SMS body — that's the part that doesn't work without a
// bridge endpoint.

import { workflow } from '@novu/framework';

// ─── Citizen OTP ─────────────────────────────────────────────────────
// Triggered when the SPA's citizen-login form sends an OTP request.
// `payload.otp` is the 6-digit code; `payload.userType` is "CITIZEN" or
// "EMPLOYEE" for the wording.
export const otpSendWorkflow = workflow('otp-send', async ({ step, payload }) => {
  await step.sms('send-otp', async () => ({
    body: `DIGIT: Your one-time login code is ${payload.otp}. It expires in 10 minutes. Do not share this code.`,
  }));
}, {
  payloadSchema: {
    type: 'object',
    properties: {
      otp: { type: 'string' },
      userType: { type: 'string' },
    },
    required: ['otp'],
  },
});

// ─── PGR complaint lifecycle ─────────────────────────────────────────
// Names match the kafka events novu-bridge consumes from
// `complaints.domain.events` and the workflow ids the bootstrap script
// pre-creates in Novu.

const complaintStep = (channel) => async ({ step, payload }) => {
  await step[channel](`complaints-${channel}`, async () => ({
    body:
      `DIGIT: Your complaint ${payload.complaintNo || payload.referenceNumber || '<unknown>'} ` +
      `is now ${payload.status || payload.workflowState || '<unknown>'}` +
      (payload.tenantId ? ` (${payload.tenantId})` : '') +
      '.',
  }));
};

export const complaintsApply = workflow(
  'complaints-workflow-apply',
  complaintStep('sms'),
  { name: 'COMPLAINTS WORKFLOW APPLY', payloadSchema: { type: 'object' } },
);

export const complaintsAssign = workflow(
  'complaints-workflow-assign',
  complaintStep('sms'),
  { name: 'COMPLAINTS WORKFLOW ASSIGN', payloadSchema: { type: 'object' } },
);

export const complaintsResolve = workflow(
  'complaints-workflow-resolve',
  complaintStep('sms'),
  { name: 'COMPLAINTS WORKFLOW RESOLVE', payloadSchema: { type: 'object' } },
);

export const complaintsReject = workflow(
  'complaints-workflow-reject',
  complaintStep('sms'),
  { name: 'COMPLAINTS WORKFLOW REJECT', payloadSchema: { type: 'object' } },
);

export const complaintsReopen = workflow(
  'complaints-workflow-reopen',
  complaintStep('sms'),
  { name: 'COMPLAINTS WORKFLOW REOPEN', payloadSchema: { type: 'object' } },
);

export const complaintsReassign = workflow(
  'complaints-workflow-reassign',
  complaintStep('sms'),
  { name: 'COMPLAINTS WORKFLOW REASSIGN', payloadSchema: { type: 'object' } },
);

export const complaintsRate = workflow(
  'complaints-workflow-rate',
  complaintStep('sms'),
  { name: 'COMPLAINTS WORKFLOW RATE', payloadSchema: { type: 'object' } },
);

// Legacy id from the upstream bootstrap script — keep it for backwards-
// compat with whatever may already exist in deployed Novu instances.
export const complaintsSmsV1 = workflow(
  'complaints-sms-workflow',
  complaintStep('sms'),
  { name: 'Complaints SMS Workflow', payloadSchema: { type: 'object' } },
);

export const ALL_WORKFLOWS = [
  otpSendWorkflow,
  complaintsApply,
  complaintsAssign,
  complaintsResolve,
  complaintsReject,
  complaintsReopen,
  complaintsReassign,
  complaintsRate,
  complaintsSmsV1,
];
