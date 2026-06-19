// Karix WhatsApp Business API workflow definitions.
//
// Novu has no native Karix provider, so these workflows use step.custom() to
// call the Karix REST API directly from the bridge endpoint. The Java
// novu-bridge enriches the Novu trigger payload with Karix credentials and
// routing data before triggering these workflows — the Novu API call path is
// unchanged; only the bridge-side delivery step differs from the Twilio SMS path.
//
// Workflow IDs follow the pattern: <event>-karix
// Operators configure TemplateBinding with these IDs for Karix tenants.
//
// Karix API ref: https://api.karix.io / https://documenter.getpostman.com/view/19789335/UzR1M3Tj

import { workflow } from '@novu/framework';
import { z } from 'zod';

const KARIX_BASE_URL = process.env.KARIX_BASE_URL || 'https://api.karix.io';

// ─── Karix API caller ────────────────────────────────────────────────────────

async function sendViaKarix(payload) {
  const {
    karixAccountId,
    karixAuthToken,
    karixSenderNumber,
    karixTemplateName,
    karixRecipientPhone,
    karixParams = [],
    karixLanguage = 'en',
  } = payload;

  const credentials = Buffer
    .from(`${karixAccountId}:${karixAuthToken}`)
    .toString('base64');

  // WhatsApp template message body per Karix RCM API
  const templatePayload = {
    name: karixTemplateName,
    language: karixLanguage,
  };

  if (karixParams.length > 0) {
    templatePayload.components = [
      {
        type: 'body',
        parameters: karixParams.map((text) => ({
          type: 'text',
          text: text ?? '',
        })),
      },
    ];
  }

  const body = {
    channel: 'whatsapp',
    source: karixSenderNumber,
    destination: [karixRecipientPhone],
    content: {
      type: 'template',
      template: templatePayload,
    },
  };

  const response = await fetch(`${KARIX_BASE_URL}/message/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseData = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Karix API error: HTTP ${response.status} — ${JSON.stringify(responseData)}`
    );
  }

  return responseData;
}

// ─── Shared payload schema ───────────────────────────────────────────────────
// Karix credentials and routing data are injected by novu-bridge at trigger time.

const karixPayloadSchema = z.object({
  karixAccountId: z.string(),
  karixAuthToken: z.string(),
  karixSenderNumber: z.string(),
  karixTemplateName: z.string(),
  karixRecipientPhone: z.string(),
  karixParams: z.array(z.string()).default([]),
  karixLanguage: z.string().default('en'),
}).passthrough();

const karixOutputSchema = z.object({
  success: z.boolean(),
  karixUid: z.string().optional(),
});

// ─── Workflow factory ────────────────────────────────────────────────────────

function karixWhatsAppWorkflow(workflowId, displayName) {
  return workflow(
    workflowId,
    async ({ step, payload }) => {
      await step.custom(
        'karix-whatsapp-send',
        async () => {
          const result = await sendViaKarix(payload);
          return {
            success: true,
            // Karix returns uid in the response for delivery tracking
            karixUid: result?.uid ?? result?.ackid ?? undefined,
          };
        },
        { outputSchema: karixOutputSchema },
      );
    },
    {
      name: displayName,
      payloadSchema: karixPayloadSchema,
    },
  );
}

// ─── PGR complaint lifecycle — Karix WhatsApp ────────────────────────────────
// Template IDs set in TemplateBinding.contentSid for each tenant/event.

export const karixComplaintsApply = karixWhatsAppWorkflow(
  'complaints-workflow-apply-karix',
  'COMPLAINTS WORKFLOW APPLY (Karix WhatsApp)',
);

export const karixComplaintsAssign = karixWhatsAppWorkflow(
  'complaints-workflow-assign-karix',
  'COMPLAINTS WORKFLOW ASSIGN (Karix WhatsApp)',
);

export const karixComplaintsResolve = karixWhatsAppWorkflow(
  'complaints-workflow-resolve-karix',
  'COMPLAINTS WORKFLOW RESOLVE (Karix WhatsApp)',
);

export const karixComplaintsReject = karixWhatsAppWorkflow(
  'complaints-workflow-reject-karix',
  'COMPLAINTS WORKFLOW REJECT (Karix WhatsApp)',
);

export const karixComplaintsReopen = karixWhatsAppWorkflow(
  'complaints-workflow-reopen-karix',
  'COMPLAINTS WORKFLOW REOPEN (Karix WhatsApp)',
);

export const karixComplaintsReassign = karixWhatsAppWorkflow(
  'complaints-workflow-reassign-karix',
  'COMPLAINTS WORKFLOW REASSIGN (Karix WhatsApp)',
);

export const karixComplaintsRate = karixWhatsAppWorkflow(
  'complaints-workflow-rate-karix',
  'COMPLAINTS WORKFLOW RATE (Karix WhatsApp)',
);

export const KARIX_WORKFLOWS = [
  karixComplaintsApply,
  karixComplaintsAssign,
  karixComplaintsResolve,
  karixComplaintsReject,
  karixComplaintsReopen,
  karixComplaintsReassign,
  karixComplaintsRate,
];
