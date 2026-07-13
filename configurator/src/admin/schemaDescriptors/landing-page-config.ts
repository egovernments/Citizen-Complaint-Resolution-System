/**
 * RAINMAKER-PGR.LandingPageConfig — page-level singleton (code = "default")
 * for the config-driven public landing (CCSD-2008, P3).
 *
 * Scalar/toggle fields + the sectionOrder string array are editable through
 * the generic form. Nested `seo{}`, `theme{}` and `publish{}` are deliberately
 * NOT listed (no generic widget) — they arrive with the P4 Builder / P5
 * Draft-Publish work via the customEditor escape hatch on this descriptor.
 */
import type { SchemaDescriptor } from './types';

export const landingPageConfigDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.LandingPageConfig',
  groups: [
    { title: 'General', fields: ['code', 'enabled', 'defaultLocale'] },
    { title: 'Page chrome', fields: ['showUtilityBar', 'showWhatsAppFab'] },
    { title: 'Ordering', fields: ['sectionOrder'] },
  ],
  fields: [
    { path: 'code', widget: 'text', required: true, label: 'Code',
      help: 'Singleton row — keep "default".' },
    { path: 'enabled', widget: 'boolean', label: 'Enabled',
      help: 'Master switch. Off = the page falls back to its built-in default layout.' },
    { path: 'defaultLocale', widget: 'text', label: 'Default locale',
      help: 'e.g. pt_PT.' },
    { path: 'showUtilityBar', widget: 'boolean', label: 'Show utility bar',
      help: 'The top strip (state name, green line, phone, language, sign-in).' },
    { path: 'showWhatsAppFab', widget: 'boolean', label: 'Show WhatsApp button',
      help: 'The floating WhatsApp action bottom-right.' },
    { path: 'sectionOrder', widget: 'chip-array', label: 'Section order override',
      help: 'Optional list of section codes; when set it wins over each section’s numeric order.' },
  ],
};
