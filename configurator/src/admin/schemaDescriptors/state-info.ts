import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `common-masters.StateInfo` — the per-state metadata record
 * that drives a few cross-cutting things in DIGIT-UI:
 *
 *  - `languages: [{ label, value }]` → populates the configurator's locale
 *    dropdowns (LocaleSelector on /manage/localization) AND the digit-ui's
 *    language switcher chip in the top-right. Adding a row here is the
 *    single hook for "make a new locale appear in the UI".
 *  - `localizationModules` → the modules the digit-ui will fetch on init.
 *    Touching this is risky; we expose it as a chip-array of free strings
 *    so an operator who knows what they're doing can add a module.
 *  - `code`, `name`, brand URLs, defaultUrl → mostly static. Surfaced as
 *    plain text inputs so they're editable but not flashy.
 *
 * The schema declares `languages` and `localizationModules` as arrays of
 * objects, which the auto-form would skip silently. The `locale-list` and
 * `chip-array` widgets here close that gap.
 */
export const stateInfoDescriptor: SchemaDescriptor = {
  schema: 'common-masters.StateInfo',
  // The schema-driven form path silently swallows submits on this resource.
  // Until that's root-caused, mount the dedicated editor so adding a locale
  // actually persists. Save is the load-bearing operation here.
  customEditor: 'state-info',
  groups: [
    { title: 'Identity', fields: ['code', 'name'] },
    { title: 'Languages', fields: ['languages'] },
    { title: 'Localization modules', fields: ['hasLocalisation', 'localizationModules'] },
    { title: 'Branding', fields: ['logoUrl', 'logoUrlWhite', 'statelogo', 'bannerUrl'] },
    { title: 'Routing', fields: ['defaultUrl.citizen', 'defaultUrl.employee'] },
  ],
  fields: [
    { path: 'code', widget: 'text', required: true,
      help: 'State code (uppercase, e.g. KE).' },
    { path: 'name', widget: 'text', required: true,
      help: 'Display name of the state / country (e.g. Kenya).' },
    { path: 'languages', widget: 'locale-list', label: 'Languages',
      help: 'Each row appears in the digit-ui language switcher and in the configurator\'s locale dropdowns.' },
    { path: 'hasLocalisation', widget: 'boolean',
      help: 'When false, the digit-ui skips the localization fetch entirely.' },
    { path: 'localizationModules', widget: 'locale-list', label: 'Localization modules',
      help: 'Localization modules the UI will pre-fetch on init. Same {label, value} shape as Languages.' },
    { path: 'logoUrl', widget: 'text', label: 'Logo URL',
      help: 'Primary state logo (used in headers and login).' },
    { path: 'logoUrlWhite', widget: 'text', label: 'Logo URL (white variant)' },
    { path: 'statelogo', widget: 'text', label: 'State logo (legacy)',
      help: 'Older alias kept for back-compat with screens that still read this field.' },
    { path: 'bannerUrl', widget: 'text', label: 'Banner URL',
      help: 'Background image used on the citizen landing.' },
    { path: 'defaultUrl.citizen', widget: 'text', label: 'Default URL — Citizen' },
    { path: 'defaultUrl.employee', widget: 'text', label: 'Default URL — Employee' },
  ],
};
