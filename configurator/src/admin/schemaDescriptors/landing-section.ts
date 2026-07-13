/**
 * RAINMAKER-PGR.LandingSection — one row per configurable public-landing
 * section (CCSD-2008, P3).
 *
 * P3 exposes the data model through the generic CRUD form: everything
 * structural (order, enabled, status, roles, text keys) is editable here with
 * standard widgets. The nested `items[]`, `media{}` and `theme{}` fields are
 * deliberately NOT listed — the generic form skips complex fields it has no
 * widget for (they stay visible in Show and editable via API). The P4 Landing
 * Page Builder takes over item/media/theme editing by setting `customEditor`
 * on this descriptor — same resource, routes, schema and MDMS APIs, so P3→P4
 * needs no migration.
 */
import type { SchemaDescriptor } from './types';

export const landingSectionDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.LandingSection',
  // P4 (CCSD-2009): row edit opens the visual Builder (same data model/APIs).
  customEditor: 'landing-builder',
  groups: [
    { title: 'Identity', fields: ['code', 'type'] },
    { title: 'Visibility & ordering', fields: ['order', 'enabled', 'status', 'roles'] },
    { title: 'Content (localization keys)', fields: ['titleKey', 'subtitleKey', 'bodyKey'] },
  ],
  fields: [
    { path: 'code', widget: 'text', required: true, label: 'Code',
      help: 'Unique section id (e.g. "hero"). Also the tenant-override join key.' },
    { path: 'type', widget: 'text', required: true, label: 'Type',
      help: 'Section component. v1 catalog: hero | navigation | types | steps | channels | privacy | news | institutions | cta | footer. Unknown types are skipped by the page.' },
    { path: 'order', widget: 'integer', min: 0, label: 'Order',
      help: 'Sort position on the page (ascending). The page re-sorts on reload.' },
    { path: 'enabled', widget: 'boolean', label: 'Enabled',
      help: 'Off = the section is hidden on the public page.' },
    { path: 'status', widget: 'text', label: 'Status',
      help: 'DRAFT or PUBLISHED. The public page renders PUBLISHED only.' },
    { path: 'roles', widget: 'chip-array', label: 'Restrict to roles',
      help: 'Empty = public. When set, only users holding one of these role codes see the section.' },
    { path: 'titleKey', widget: 'text', label: 'Title key',
      help: 'PGR_LANDING_* localization key (edit the text under Localization Messages).' },
    { path: 'subtitleKey', widget: 'text', label: 'Subtitle key',
      help: 'PGR_LANDING_* localization key for the intro/lede.' },
    { path: 'bodyKey', widget: 'text', label: 'Body key',
      help: 'PGR_LANDING_* localization key for body/eyebrow copy (section-type dependent).' },
    { path: 'version', widget: 'integer', min: 0, label: 'Version', hidden: 'create' },
  ],
};
