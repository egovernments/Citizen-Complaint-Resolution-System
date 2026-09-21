// Schema is `additionalProperties: false`; keep this descriptor in sync with
// utilities/default-data-handler/.../schema/NOTIFICATIONS.json (Template).

import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `NOTIFICATIONS.Template` — the message bodies. One record per
 * (eventName, audience, channel, locale).
 *
 * NOTE what this help text deliberately does NOT contain: a list of placeholder
 * tokens. There used to be one here — nine of the thirteen tokens, a second
 * copy that nothing checked, one directory away from the parity test built to
 * prevent exactly that drift. The tokens an event fills are declared by that
 * event's catalogue row and shown by Notifications → Configure, which is the one
 * place that can be right for every module.
 */
export const notificationsTemplateDescriptor: SchemaDescriptor = {
  schema: 'NOTIFICATIONS.Template',
  groups: [
    { title: 'Key', fields: ['module', 'eventName', 'audience', 'channel', 'locale'] },
    { title: 'Content', fields: ['subject', 'body', 'placeholders', 'active'] },
  ],
  fields: [
    { path: 'module', required: true, label: 'Module', help: 'The module that produces this event, e.g. Complaints.' },
    { path: 'eventName', required: true, label: 'Event', help: 'The event key from the event catalogue, e.g. COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME.' },
    { path: 'audience', required: true, label: 'Audience', help: 'Must match the routing row exactly: ACTOR:<name>, ROLE:<code>, EVENT_RECIPIENTS, or a | chain.' },
    { path: 'channel', required: true, label: 'Channel', help: 'SMS, WHATSAPP, EMAIL.' },
    { path: 'locale', required: true, label: 'Locale', help: 'e.g. en_IN, sw_KE. A recipient whose locale has no row falls back to en_IN.' },
    { path: 'subject', label: 'Subject', help: 'EMAIL only; leave blank for SMS/WHATSAPP.' },
    { path: 'body', widget: 'textarea', required: true, label: 'Body', help: 'Use single-brace {token} placeholders. Which tokens this event fills is declared by its catalogue row — Notifications → Configure lists them next to the body and warns about one that does not exist.' },
    { path: 'placeholders', widget: 'chip-array', label: 'Placeholders', help: 'Declared tokens this body uses (documentation; Configure regenerates it on save).' },
    { path: 'active', widget: 'boolean', label: 'Active' },
  ],
};
