import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `common-masters.UserValidation` (e.g. the Kenya mobile rule
 * keyed "mobile" with pattern `^0?[17][0-9]{8}$`, prefix +254).
 *
 * The JSON Schema declares `rules` and `attributes` as nested objects, so the
 * default auto-form would skip them entirely. This descriptor expands nested
 * paths into individual widgets.
 *
 * Note: DIGIT runtime also reads `ValidationConfigs.mobileNumberValidation`
 * via `useMobileValidation`. The two schemas overlap; for now editing one
 * does NOT auto-propagate to the other. Flagship `UserValidationEditor`
 * (Stage 3) will write both atomically.
 */
export const userValidationDescriptor: SchemaDescriptor = {
  schema: 'common-masters.UserValidation',
  groups: [
    { title: 'Field', fields: ['fieldType', 'default', 'isActive'] },
    { title: 'Format rules', fields: [
      'attributes.prefix',
      'rules.pattern',
      'rules.minLength',
      'rules.maxLength',
      'rules.allowedStartingCharacters',
      'rules.errorMessage',
    ] },
  ],
  fields: [
    { path: 'fieldType', widget: 'text', required: true,
      help: 'e.g. "mobile", "email". Becomes the record\'s unique identifier.' },
    { path: 'default', widget: 'boolean',
      help: 'Mark this rule as the default for its fieldType.' },
    { path: 'isActive', widget: 'boolean' },
    { path: 'attributes.prefix', widget: 'text', label: 'Dial code prefix',
      help: 'Country prefix shown/stored with the value (e.g. +254 for Kenya).' },
    { path: 'rules.pattern', widget: 'regex', label: 'Regex pattern',
      help: 'The validation regex — use the sample box below to test.' },
    { path: 'rules.minLength', widget: 'integer', min: 1, max: 30,
      label: 'Min length' },
    { path: 'rules.maxLength', widget: 'integer', min: 1, max: 30,
      label: 'Max length' },
    { path: 'rules.allowedStartingCharacters', widget: 'chip-array',
      label: 'Allowed first characters',
      help: 'First digit/char each value must start with. For KE mobile: 0, 1, 7.' },
    { path: 'rules.errorMessage', widget: 'text', label: 'Error message key',
      help: 'Localization key shown on validation failure, e.g. CORE_COMMON_MOBILE_ERROR.' },
  ],
};
