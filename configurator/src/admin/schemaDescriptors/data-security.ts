import type { SchemaDescriptor } from './types';

/**
 * CCSD-2000: the generic MDMS edit form skips object/array fields with no
 * descriptor; SecurityPolicy's only editable content IS object/array (`model`
 * is the immutable id), so the Edit page rendered nothing editable.
 *
 * `model` is deliberately not listed: descriptor-rendered fields bypass the
 * idField-disable logic in MdmsResourceEdit, so leaving it to the generic
 * fallback loop keeps the record key rendered but immutable.
 */
export const securityPolicyDescriptor: SchemaDescriptor = {
  schema: 'DataSecurity.SecurityPolicy',
  fields: [
    {
      path: 'uniqueIdentifier',
      label: 'Unique Identifier (JSON)',
      widget: 'json',
      required: true,
      help: 'Object {name, jsonPath} locating the record id inside the model, e.g. {"name":"uuid","jsonPath":"/uuid"}',
    },
    {
      path: 'attributes',
      label: 'Attributes (JSON)',
      widget: 'json',
      required: true,
      help: 'Array of {name, jsonPath, patternId, defaultVisibility} — the model fields this policy masks',
    },
    {
      path: 'roleBasedDecryptionPolicy',
      label: 'Role-Based Decryption Policy (JSON)',
      widget: 'json',
      required: true,
      help: 'Array of {roles[], attributeAccessList[{attribute, firstLevelVisibility, secondLevelVisibility}]}',
    },
  ],
};
