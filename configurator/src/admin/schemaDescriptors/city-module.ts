import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `tenant.citymodule` — which DIGIT modules are enabled per
 * city, plus module-home presentation (CCSD-1959).
 *
 * Needed because the generic Edit form derives its fields from the keys the
 * RECORD already has: optional properties a row doesn't carry yet (like
 * `bannerImage` on rows created before the schema gained it) never get an
 * input, so operators can't set them at all. Declaring them here makes the
 * field render regardless of the record's current shape.
 *
 * `code` and `tenants` are intentionally not listed: `code` stays on the
 * generic loop (rendered disabled as the row identifier) and `tenants` keeps
 * its existing JSON/complex-field handling.
 */
export const cityModuleDescriptor: SchemaDescriptor = {
  schema: 'tenant.citymodule',
  groups: [
    { title: 'Module', fields: ['module', 'order', 'active'] },
    { title: 'Presentation', fields: ['bannerImage'] },
  ],
  fields: [
    { path: 'module', widget: 'text', label: 'Module', required: true,
      help: 'DIGIT module code this entry enables (e.g. "PGR").' },
    { path: 'order', widget: 'integer', label: 'Order',
      help: 'Position of the module on the citizen home page.' },
    { path: 'active', widget: 'boolean', label: 'Active',
      help: 'Inactive modules are hidden from the citizen home page.' },
    { path: 'bannerImage', widget: 'text', label: 'Banner image',
      help: 'URL of the banner shown on the citizen module home page. Falls back to StateInfo.bannerUrl when empty.' },
  ],
};
