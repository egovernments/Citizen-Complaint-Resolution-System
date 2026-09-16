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
 *
 * The record is keyed on `code` (DEFAULT), not on REOPENSLA. It used to be keyed
 * on REOPENSLA itself, which made this form unusable: mdms-v2 refuses to update
 * a record's x-unique fields, so Save on the only field the form has always came
 * back `400 UNIQUE_KEY_UPDATE_ERR` (#1252). Never key a master on a value an
 * operator is meant to change.
 */
export const pgrUiConstantsDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.UIConstants',
  groups: [
    { title: 'Constants', fields: ['code', 'REOPENSLA'] },
  ],
  fields: [
    {
      path: 'code',
      widget: 'text',
      required: true,
      // Shown on create, hidden on edit. mdms-v2 rejects an update that changes
      // an x-unique field, so leaving this editable would re-create the exact
      // trap this record was re-keyed to escape: a Save that always 400s, just
      // on a different field. The update path merges into `existing.data`
      // (dataProvider.ts), so a hidden `code` still round-trips intact.
      hidden: 'edit',
      label: 'Record key',
      help: 'Record key. The UI surfaces read a single constants record, so use DEFAULT unless you are deliberately keeping several variants. Fixed once the record exists — mdms-v2 rejects an update that changes it.',
    },
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
