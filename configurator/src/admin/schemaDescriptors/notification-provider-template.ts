// Schema is `additionalProperties: false`; keep this descriptor in sync with
// utilities/default-data-handler/.../schema/RAINMAKER-PGR.json (NotificationProviderTemplate).

import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `RAINMAKER-PGR.NotificationProviderTemplate` — provider-side approved
 * templates (Twilio WhatsApp Content SIDs) mapped to a routing key, with the ORDERED
 * variables the provider template expects. pgr-services reads this for every WHATSAPP
 * event; a routing key with no approved row is recorded SKIPPED / NB_TEMPLATE_NOT_APPROVED.
 * Without this descriptor the generic form skipped `variables` (an array) entirely.
 */
export const notificationProviderTemplateDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.NotificationProviderTemplate',
  groups: [
    { title: 'Routing key', fields: ['provider', 'channel', 'audience', 'action', 'toState', 'locale'] },
    { title: 'Provider template', fields: ['templateId', 'templateName', 'variables', 'approvalStatus', 'active'] },
  ],
  fields: [
    { path: 'provider', required: true, label: 'Provider', help: 'twilio' },
    { path: 'channel', required: true, label: 'Channel', help: 'WHATSAPP (SMS/EMAIL bodies live in Notification Templates).' },
    { path: 'audience', required: true, label: 'Audience' },
    { path: 'action', required: true, label: 'Action' },
    { path: 'toState', required: true, label: 'To State' },
    { path: 'locale', required: true, label: 'Locale', help: 'e.g. en_IN, hi_IN — must match the NotificationTemplate row it pairs with.' },
    { path: 'templateId', required: true, label: 'Template ID', help: 'Twilio Content SID (HX…). Use Providers → Sync WhatsApp templates to pull these.' },
    { path: 'templateName', label: 'Template name' },
    { path: 'variables', widget: 'chip-array', required: true, label: 'Variables (ordered)', help: 'Placeholder names in the order the provider template expects them ({{1}}, {{2}}, …): e.g. complaint_type, id, date.' },
    { path: 'approvalStatus', label: 'Approval status', help: 'Only "approved" rows are used at runtime.' },
    { path: 'active', widget: 'boolean', label: 'Active' },
  ],
};
