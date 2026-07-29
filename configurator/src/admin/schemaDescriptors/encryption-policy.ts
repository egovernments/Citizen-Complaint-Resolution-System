import type { SchemaDescriptor } from './types';

/**
 * CCSD-1998: an EncryptionPolicy record is `{key, attributeList:[{jsonPath,
 * type}]}` — `key` is the idField (rendered disabled) and `attributeList` was
 * skipped as an undescribed object, so the Edit page had zero editable inputs.
 * The object-table widget gives the attribute list a proper row editor.
 */
export const encryptionPolicyDescriptor: SchemaDescriptor = {
  schema: 'DataSecurity.EncryptionPolicy',
  fields: [
    {
      path: 'attributeList',
      label: 'Encrypted attributes',
      widget: 'object-table',
      required: true,
      columns: [
        { key: 'jsonPath', label: 'JSON Path' },
        { key: 'type', label: 'Type' },
      ],
      help: 'Attributes encrypted for this key; type selects the encryption technique (e.g. Normal).',
    },
  ],
};
