/**
 * Descriptor for `Workflow.BusinessServiceMasterConfig` — a state-level override
 * controlling whether a workflow business service (e.g. "Incident", "NewTL") is
 * managed state-wide or per-tenant.
 *
 * NOTE on string-typed booleans:
 * Both `isStatelevel` and `active` are typed as `string` in the schema but
 * store the literal text 'true' / 'false'. UI does not boolean-coerce — it
 * preserves whatever the user types. Consider a dedicated string-bool widget
 * in Stage 3.
 *
 * NOTE on unique identifier:
 * Live records use `active` as the unique identifier (observed value: "true"),
 * which collapses the whole master to a single row per state. This looks like
 * an upstream config bug — flagged for Stage 4 QA, preserved as-is here.
 */
import type { SchemaDescriptor } from './types';

export const workflowBsMasterDescriptor: SchemaDescriptor = {
  schema: 'Workflow.BusinessServiceMasterConfig',
  groups: [
    { title: 'Config', fields: ['businessService', 'isStatelevel', 'active'] },
  ],
  fields: [
    { path: 'businessService', widget: 'text', required: true,
      help: 'Workflow business service code, e.g. Incident, NewTL.' },
    { path: 'isStatelevel', widget: 'text', required: true,
      help: "String-typed bool: 'true' or 'false'. Controls whether this BS is shared across all tenants." },
    { path: 'active', widget: 'text', required: true,
      help: "String-typed bool: 'true' or 'false'. Also used as the record's unique identifier — upstream quirk." },
  ],
};
