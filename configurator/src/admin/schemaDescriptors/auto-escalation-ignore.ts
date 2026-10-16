import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `Workflow.AutoEscalationStatesToIgnore`.
 *
 * Each record names a workflow (businessService + module) and the set of
 * states the auto-escalation cron should skip. The JSON Schema declares
 * `state` as `array<string>`, which the default auto-form would skip, so
 * this descriptor wires it to the `chip-array` widget.
 *
 * Note: `businessService` is `x-unique` on the schema, so it also serves as
 * the record's unique identifier. It must match an existing
 * `Workflow.BusinessService` code or the cron will silently no-op.
 */
export const autoEscalationIgnoreDescriptor: SchemaDescriptor = {
  schema: 'Workflow.AutoEscalationStatesToIgnore',
  groups: [
    { title: 'Scope', fields: ['businessService', 'module'] },
    { title: 'Ignored states', fields: ['state'] },
  ],
  fields: [
    { path: 'businessService', widget: 'text', required: true,
      help: 'Must match a Workflow.BusinessService code (e.g. "NewTL"). Becomes the record\'s unique identifier.' },
    { path: 'module', widget: 'text', required: true,
      help: 'The module that owns this workflow (e.g. "TL").' },
    { path: 'state', widget: 'chip-array', label: 'States to ignore',
      help: 'Workflow states the escalation cron should skip, e.g. INITIATED, PENDINGAPPROVAL. Match the state\'s `state` field, not its name.' },
  ],
};
