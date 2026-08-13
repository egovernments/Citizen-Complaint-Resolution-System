import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `common-masters.FormValidations` — per-fieldType user
 * validation patterns ({ fieldType, regex }, one row per fieldType).
 * Carries the non-mobile rules: email, name, postalCode
 * (MobileNumberValidation stays mobile-number-only).
 *
 * The `postalCode` row is the PRIMARY per-tenant postal rule: DDH seeds a
 * default 5-digit row at tenant creation, and editing it here changes the
 * rule in DIGIT Studio and the PGR create-complaint flows alike — it
 * outranks the deployment's host_vars
 * `core_postal_configs.postalCodePattern` (globalConfigs
 * CORE_POSTAL_CONFIGS), which remains the fallback for tenants without
 * the row.
 */
export const formValidationsDescriptor: SchemaDescriptor = {
  schema: 'common-masters.FormValidations',
  groups: [
    { title: 'Identity', fields: ['fieldType'] },
    { title: 'Format rule', fields: ['regex'] },
  ],
  fields: [
    { path: 'fieldType', widget: 'text', required: true,
      help: 'Which user field this pattern validates — "email", "name", or "postalCode". One row per fieldType; frontends fall back to their built-in pattern (for postalCode: the globalConfigs CORE_POSTAL_CONFIGS pattern) when a row is absent.' },
    { path: 'regex', widget: 'regex', label: 'Regex pattern', required: true,
      help: 'Full-anchor regex, e.g. "^[0-9]{5}$" for a 5-digit postal code. For postalCode the UI derives the localized error message from this pattern too — no separate message field exists.' },
  ],
};
