// Schema is `additionalProperties: false`; keep this descriptor in sync with
// utilities/default-data-handler/.../schema/RAINMAKER-PGR.json (NotificationRouting).

import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `RAINMAKER-PGR.NotificationRouting` — config-driven "who is
 * notified" per workflow transition. FLATTENED: one record per
 * (businessService, action, toState, audience, channel). Joins 1:1 with
 * NotificationTemplate. Flat scalar fields only, so the generic form handles it
 * with no custom editor.
 */
export const notificationRoutingDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.NotificationRouting',
  groups: [
    { title: 'Transition', fields: ['businessService', 'fromState', 'action', 'toState'] },
    { title: 'Routing', fields: ['audience', 'channel', 'active'] },
  ],
  fields: [
    { path: 'businessService', required: true, label: 'Business Service', help: 'Workflow business service, e.g. PGR.' },
    { path: 'fromState', label: 'From State', help: 'Documentation/UI only — runtime matches on action + toState (the consumer lacks fromState). Leave blank for "any". Not currently enforced at runtime — a value here matches EVERY transition into toState. Leave blank.' },
    { path: 'action', required: true, label: 'Action', help: 'Workflow action, e.g. ASSIGN, REASSIGN, REJECT, RESOLVE, REOPEN, RATE, APPLY.' },
    { path: 'toState', required: true, label: 'To State', help: 'Resulting status, e.g. PENDINGATLME. Disambiguates same-action transitions (RATE -> CLOSEDAFTERRESOLUTION vs CLOSEDAFTERREJECTION).' },
    { path: 'audience', required: true, label: 'Audience', help: 'CITIZEN (the complaint filer), any workflow role code (e.g. GRO, PGR_LME) to notify every holder, or EMPLOYEE (legacy alias for the current assignee).' },
    { path: 'channel', required: true, label: 'Channel', help: 'SMS, WHATSAPP, EMAIL.' },
    { path: 'active', widget: 'boolean', label: 'Active' },
  ],
};
