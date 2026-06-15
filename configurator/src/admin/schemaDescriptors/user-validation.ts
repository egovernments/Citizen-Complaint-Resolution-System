import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `common-masters.MobileNumberValidation` — the flat schema
 * with `countryCode` and `mobileNumberRegex` fields (e.g. Kenya: +254,
 * `^[17][0-9]{8}$`).
 *
 * Replaces the old `common-masters.UserValidation` nested schema
 * (attributes.prefix / rules.pattern / rules.minLength etc.).
 */
export const userValidationDescriptor: SchemaDescriptor = {
  schema: 'common-masters.MobileNumberValidation',
  groups: [
    { title: 'Country', fields: ['countryCode', 'default', 'isActive'] },
    { title: 'Validation', fields: ['mobileNumberRegex'] },
  ],
  fields: [
    { path: 'countryCode', widget: 'text', required: true,
      help: 'E.164 country dialling prefix (e.g. +254 for Kenya, +91 for India). This is the record\'s unique key.' },
    { path: 'mobileNumberRegex', widget: 'regex', required: true, label: 'Regex pattern',
      help: 'Regex applied to the local subscriber number (without country code). E.g. ^[17][0-9]{8}$ for Kenya.' },
    { path: 'default', widget: 'boolean',
      help: 'Mark this as the default country for the tenant. Only one record should have default: true.' },
    { path: 'isActive', widget: 'boolean' },
  ],
};
