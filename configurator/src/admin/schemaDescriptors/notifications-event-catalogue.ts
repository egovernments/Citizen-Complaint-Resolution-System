// Schema is `additionalProperties: false`; keep this descriptor in sync with
// utilities/default-data-handler/.../schema/NOTIFICATIONS.json (EventCatalogue).

import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `NOTIFICATIONS.EventCatalogue` — the event vocabulary.
 *
 * READ-ONLY in the Configurator (resourceRegistry marks the resource
 * `readOnly`): a module declares its own events, and PGR's rows are GENERATED
 * from its workflow at seed time, which is what preserves the transition
 * validation the browser used to do by walking the state machine. The descriptor
 * exists so the Show screen renders the arrays legibly rather than skipping
 * them.
 */
export const notificationsEventCatalogueDescriptor: SchemaDescriptor = {
  schema: 'NOTIFICATIONS.EventCatalogue',
  groups: [
    { title: 'Event', fields: ['module', 'eventName', 'label', 'entityType', 'active'] },
    { title: 'Vocabulary', fields: ['actors', 'placeholders', 'channels'] },
  ],
  fields: [
    { path: 'module', required: true, label: 'Module', help: 'The module that owns and produces this event.' },
    { path: 'eventName', required: true, label: 'Event', help: 'The globally unique, dotted, module-prefixed event key. Routing and template rows reference it.' },
    { path: 'label', label: 'Label', help: 'What the pickers show instead of the raw key.' },
    { path: 'entityType', label: 'Entity type', help: 'What the event\'s entityId names, e.g. COMPLAINT.' },
    { path: 'actors', widget: 'json', label: 'Actors', help: 'The actor names the producer sends: [{name, label, required}]. An ACTOR:<name> audience must name one of these.' },
    { path: 'placeholders', widget: 'json', label: 'Placeholders', help: 'The token vocabulary for this event: [{name, label, blankWhen}]. A template token that is not here ships its braces literally.' },
    { path: 'channels', widget: 'chip-array', label: 'Channels', help: 'Channels this event may be routed to. Empty means no restriction.' },
    { path: 'active', widget: 'boolean', label: 'Active' },
  ],
};
