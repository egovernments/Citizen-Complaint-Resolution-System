import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `ValidationConfigs.mobileNumberValidation` — the mobile regex
 * rules consumed by the `useMobileValidation` hook in DIGIT-UI (e.g. the Kenya
 * default keyed "defaultMobileValidation" with pattern `^[17][0-9]{8}$`,
 * prefix +254).
 *
 * This is the *sister* schema of `common-masters.UserValidation` (see
 * `user-validation.ts`). The two overlap: both describe the same underlying
 * format rules, but DIGIT runtime reads them from different MDMS locations.
 * Editing one does NOT currently auto-propagate to the other — flagship
 * `UserValidationEditor` (Stage 3) will write both atomically.
 *
 * The JSON Schema declares `rules` as a nested object, which the default
 * auto-form would skip entirely. This descriptor expands nested paths into
 * individual widgets.
 */
export const mobileValidationDescriptor: SchemaDescriptor = {
  schema: 'ValidationConfigs.mobileNumberValidation',
  groups: [
    { title: 'Identity', fields: ['validationName'] },
    { title: 'Format rules', fields: [
      'rules.prefix',
      'rules.pattern',
      'rules.minLength',
      'rules.maxLength',
      'rules.allowedStartingDigits',
      'rules.errorMessage',
      'rules.isActive',
    ] },
  ],
  fields: [
    { path: 'validationName', widget: 'text', required: true,
      help: 'Unique name for this validation rule — becomes the record\'s unique identifier (e.g. "defaultMobileValidation").' },
    { path: 'rules.prefix', widget: 'text', label: 'Dial code prefix',
      help: 'Country dial code shown/stored with the value, e.g. +254 (Kenya) or +91 (India).' },
    { path: 'rules.pattern', widget: 'regex', label: 'Regex pattern',
      help: 'The validation regex — use the sample box below to test.' },
    { path: 'rules.minLength', widget: 'integer', min: 1, max: 20,
      label: 'Min length',
      help: 'Usually equal to Max length — most country mobile formats are fixed-length (e.g. 9 digits for KE, 10 for IN).' },
    { path: 'rules.maxLength', widget: 'integer', min: 1, max: 20,
      label: 'Max length',
      help: 'Usually equal to Min length — most country mobile formats are fixed-length (e.g. 9 digits for KE, 10 for IN).' },
    { path: 'rules.allowedStartingDigits', widget: 'chip-array',
      label: 'Allowed starting digits',
      help: 'First digit each mobile number must start with. For KE: 1, 7. For IN: 6, 7, 8, 9.' },
    { path: 'rules.errorMessage', widget: 'text', label: 'Error message',
      help: 'Literal message shown inline in DIGIT-UI on validation failure. Not a localization key — the exact text entered here is displayed to the user.' },
    { path: 'rules.isActive', widget: 'boolean', label: 'Is active',
      help: 'Whether this validation rule is currently active.' },
  ],
};
