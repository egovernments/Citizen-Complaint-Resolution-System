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
    { path: 'audience', required: true, label: 'Audience', help: 'CITIZEN or EMPLOYEE (employee covers ASSIGNEE/CREATOR/PREVIOUS_ASSIGNEE).' },
    { path: 'action', required: true, label: 'Action' },
    { path: 'toState', required: true, label: 'To State' },
    { path: 'channel', required: true, label: 'Channel', help: 'SMS, WHATSAPP, EMAIL.' },
    { path: 'locale', required: true, label: 'Locale', help: 'e.g. en_IN, sw_KE.' },
    { path: 'subject', label: 'Subject', help: 'EMAIL only; leave blank for SMS/WHATSAPP.' },
    { path: 'body', widget: 'textarea', required: true, label: 'Body', help: 'Use {placeholder} tokens: {id} {complaint_type} {emp_name} {ulb} {status} {date} {download_link} {rating} {additional_comments}.' },
    { path: 'placeholders', widget: 'chip-array', label: 'Placeholders', help: 'Declared tokens this body uses (documentation).' },
    { path: 'active', widget: 'boolean', label: 'Active' },
  ],
};
