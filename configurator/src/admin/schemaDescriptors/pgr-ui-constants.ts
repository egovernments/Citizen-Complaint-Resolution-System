// Schema is `additionalProperties: false` so this descriptor stays tight — every future field must be declared explicitly.

import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `RAINMAKER-PGR.UIConstants` — PGR UI-facing constants.
 *
 * Currently holds a single knob, `REOPENSLA`: the millisecond window during
 * which a resolved or rejected complaint can still be reopened. Shipped default
 * is 259200000 (72 hours) as of #1252; tenants seeded before that carry the old
 * 432000000 (5 days) until an operator edits them here.
 *
 * This is the ONLY place the window is configured. Both the citizen timeline and
 * the employee/CSR action bar gate on it, and pgr-services validateReOpen()
 * enforces the same value server-side, so an edit here changes every surface.
 */
export const pgrUiConstantsDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.UIConstants',
  groups: [
    { title: 'Constants', fields: ['REOPENSLA'] },
  ],
  fields: [
    {
      path: 'REOPENSLA',
      widget: 'duration-ms',
      required: true,
      min: 60000,
      max: 2592000000,
      label: 'Reopen window (ms)',
      help: 'How long after a complaint is resolved or rejected it can still be reopened, by the citizen or by a CSR on their behalf. Stored as milliseconds. Shipped default is 72 hours (259200000). Applies immediately to both the citizen and employee screens and to server-side enforcement.',
    },
  ],
};
