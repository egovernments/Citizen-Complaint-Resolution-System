// Schema is `additionalProperties: false`; keep this descriptor in sync with
// utilities/default-data-handler/.../schema/RAINMAKER-PGR.json (NotificationTemplate).

import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `RAINMAKER-PGR.NotificationTemplate` — config-driven message
 * bodies. One record per (audience, action, toState, channel, locale). PGR
 * renders + localizes these BEFORE publishing to Kafka.
 */
export const notificationTemplateDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.NotificationTemplate',
  groups: [
    { title: 'Key', fields: ['audience', 'action', 'toState', 'channel', 'locale'] },
    { title: 'Content', fields: ['subject', 'body', 'placeholders', 'active'] },
  ],
  fields: [
    { path: 'audience', required: true, label: 'Audience', help: 'CITIZEN (the complaint filer), any workflow role code (e.g. GRO, PGR_LME) to notify every holder, or EMPLOYEE (legacy alias for the current assignee).' },
    { path: 'action', required: true, label: 'Action' },
    { path: 'toState', required: true, label: 'To State' },
    { path: 'channel', required: true, label: 'Channel', help: 'SMS, WHATSAPP, EMAIL.' },
    { path: 'locale', required: true, label: 'Locale', help: 'e.g. en_IN, sw_KE.' },
    { path: 'subject', label: 'Subject', help: 'EMAIL only; leave blank for SMS/WHATSAPP.' },
    // The help text here used to carry its own list of placeholder tokens — nine
    // of the thirteen, never parity-checked against the Java that fills them, one
    // directory away from the test built to prevent exactly that drift. Deleted.
    // The tokens an event fills are declared by its event-catalogue row.
    { path: 'body', widget: 'textarea', required: true, label: 'Body', help: 'Use single-brace {token} placeholders. The tokens available for an event are listed by Notifications → Configure, which reads them from the event catalogue.' },
    { path: 'placeholders', widget: 'chip-array', label: 'Placeholders', help: 'Declared tokens this body uses (documentation).' },
    { path: 'active', widget: 'boolean', label: 'Active' },
  ],
};
