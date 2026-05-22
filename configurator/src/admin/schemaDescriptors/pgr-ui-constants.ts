// Schema is `additionalProperties: false` so this descriptor stays tight — every future field must be declared explicitly.

import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `RAINMAKER-PGR.UIConstants` — PGR UI-facing constants.
 *
 * Currently holds a single knob, `REOPENSLA`: the millisecond window during
 * which a citizen can reopen a resolved complaint. Live default is 432000000
 * (5 days).
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
      help: 'How long after a complaint is resolved a citizen can still reopen it. Stored as milliseconds. Current default is 5 days (432000000).',
    },
  ],
};
