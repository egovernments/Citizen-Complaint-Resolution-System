import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `common-masters.MobileNumberValidation` — the single source
 * of truth for mobile validation across all frontends and backends. Fields:
 * `countryCode`, `mobileNumberRegex`, `default`, `isActive`.
 */
export const mobileValidationDescriptor: SchemaDescriptor = {
  schema: 'common-masters.MobileNumberValidation',
  groups: [
    { title: 'Identity', fields: ['countryCode'] },
    { title: 'Format rules', fields: [
      'mobileNumberRegex',
      'default',
      'isActive',
    ] },
  ],
  fields: [
    { path: 'countryCode', widget: 'text', required: true,
      help: 'Country dial code — serves as the unique identifier (e.g. "+251" for Ethiopia, "+91" for India).' },
    { path: 'mobileNumberRegex', widget: 'regex', label: 'Regex pattern',
      help: 'Full-anchor regex for the national number portion (without country code), e.g. "^[79][0-9]{8}$".' },
    { path: 'default', widget: 'boolean', label: 'Default',
      help: 'Whether this is the default validation rule for the deployment.' },
    { path: 'isActive', widget: 'boolean', label: 'Is active',
      help: 'Inactive records are ignored by the validation hooks.' },
  ],
};
