// Schema is `additionalProperties: false`; keep this descriptor in sync with
// utilities/default-data-handler/.../schema/NOTIFICATIONS.json (ProviderTemplate).

import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `NOTIFICATIONS.ProviderTemplate` — provider-side approved
 * templates (Twilio WhatsApp Content SIDs) mapped to a routing key, with the
 * ORDERED variables the provider template expects. WhatsApp is template-only at
 * the provider: a routing key with no approved row is recorded
 * SKIPPED / NB_TEMPLATE_NOT_APPROVED on every event.
 */
export const notificationsProviderTemplateDescriptor: SchemaDescriptor = {
  schema: 'NOTIFICATIONS.ProviderTemplate',
  notice:
    'Fill this screen from Providers → Sync WhatsApp templates: it pulls the SIDs Twilio has '
    + 'approved and matches them to your routing rows. Hand-editing is for bulk or unusual work — '
    + 'the event, audience and locale must match the message row exactly, or WhatsApp sends nothing.',
  groups: [
    { title: 'Routing key', fields: ['provider', 'channel', 'eventName', 'audience', 'locale'] },
    { title: 'Provider template', fields: ['templateId', 'templateName', 'variables', 'approvalStatus', 'active'] },
  ],
  fields: [
    { path: 'provider', required: true, label: 'Provider', help: 'twilio' },
    { path: 'channel', required: true, label: 'Channel', help: 'WHATSAPP (SMS/EMAIL bodies live in Notification Templates).' },
    // Picked from the catalogue, not typed — see notifications-routing.ts.
    {
      path: 'eventName', required: true, label: 'Event',
      widget: 'reference-select',
      reference: 'notifications-event-catalogue',
      optionValue: 'eventName',
      optionText: 'label',
      help: 'The event key from the event catalogue — must match the template row it pairs with.',
    },
    { path: 'audience', required: true, label: 'Audience', help: 'Must match the template row it pairs with.' },
    { path: 'locale', required: true, label: 'Locale', help: 'e.g. en_IN, hi_IN — must match the template row it pairs with.' },
    { path: 'templateId', required: true, label: 'Template ID', help: 'Twilio Content SID (HX…). Use Providers → Sync WhatsApp templates to pull these.' },
    { path: 'templateName', label: 'Template name' },
    { path: 'variables', widget: 'chip-array', required: true, label: 'Variables (ordered)', help: 'Placeholder names in the order the provider template expects them ({{1}}, {{2}}, …): e.g. complaint_type, id, date. A body placeholder missing from this list never reaches the recipient.' },
    { path: 'approvalStatus', label: 'Approval status', help: 'Only "approved" rows are used at runtime.' },
    { path: 'active', widget: 'boolean', label: 'Active' },
  ],
};
