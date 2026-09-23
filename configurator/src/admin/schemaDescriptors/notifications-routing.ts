// Schema is `additionalProperties: false`; keep this descriptor in sync with
// utilities/default-data-handler/.../schema/NOTIFICATIONS.json (Routing).

import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `NOTIFICATIONS.Routing` — "who is notified, on which channel,
 * when this event happens". One record per (eventName, audience, channel);
 * joins 1:1 with NOTIFICATIONS.Template. Flat scalar fields only, so the generic
 * form handles it with no custom editor.
 *
 * Prefer Notifications → Configure over this raw form: it offers the event and
 * audience as pickers driven by the event catalogue, and writes the routing row
 * and its template as a pair. That preference is also stated in `notice` below,
 * so it reaches the operator on the page rather than only the next developer.
 */
export const notificationsRoutingDescriptor: SchemaDescriptor = {
  schema: 'NOTIFICATIONS.Routing',
  notice:
    'Prefer Notifications → Configure. It picks the event and audience for you and writes the '
    + 'routing row together with its message, so the two halves cannot drift apart. This raw form '
    + 'is for bulk or unusual edits — a routing row saved here with no matching template delivers '
    + 'nothing.',
  groups: [
    { title: 'Event', fields: ['module', 'eventName'] },
    { title: 'Routing', fields: ['audience', 'channel', 'active'] },
  ],
  fields: [
    { path: 'module', required: true, label: 'Module', help: 'The module that produces this event, e.g. Complaints. Not part of the key — it is here so a row\'s owner is visible without a join.' },
    // Picked from the catalogue rather than typed: a typo here is invisible —
    // the row saves and simply never matches an event. Degrades to a text input
    // when the catalogue cannot be read (see ReferenceSelectInput).
    {
      path: 'eventName', required: true, label: 'Event',
      widget: 'reference-select',
      reference: 'notifications-event-catalogue',
      optionValue: 'eventName',
      optionText: 'label',
      help: 'The event key from the event catalogue, e.g. COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME. It must be an active catalogue row or nothing will ever match it.',
    },
    { path: 'audience', required: true, label: 'Audience', help: 'ACTOR:<name> for an actor the event carries (ACTOR:citizen, ACTOR:assignee), ROLE:<code> for every holder of a role (ROLE:GRO), EVENT_RECIPIENTS for contacts sent on the event itself, or a "first non-empty wins" chain: ACTOR:assignee|ROLE:PGR_LME.' },
    { path: 'channel', required: true, label: 'Channel', help: 'SMS, WHATSAPP, EMAIL.' },
    { path: 'active', widget: 'boolean', label: 'Active' },
  ],
};
