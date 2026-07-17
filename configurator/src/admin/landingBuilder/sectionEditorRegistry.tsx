/** SECTION_EDITOR_REGISTRY — everything the Builder knows about a section type
 * (P4, CCSD-2009). Metadata registry per the approved design: fields (tagged
 * with their Inspector tab), item-editor config, defaults, validation,
 * normalization. Adding a future section type = runtime renderer entry +
 * an entry here; the Builder shell never changes.
 *
 * Mirrors (never redefines) the runtime contract in
 * digit-ui .../Landing/config/sectionRegistry.tsx. Application behavior (CTA
 * destinations, routing) is NOT editable — content only (locked Decision 1).
 */
import type { LucideIcon } from 'lucide-react';
import {
  Image, Navigation, LayoutGrid, ListOrdered, Radio, Lock, Newspaper,
  Landmark, Megaphone, PanelBottom,
} from 'lucide-react';
import type { InspectorTab, LandingSectionData, ValidationIssue } from './types';

export type BuilderWidget =
  | 'loctext'   // localized text: shows RESOLVED message, edits staged locEdits
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'media'     // media.imageId via the media library
  | 'theme'     // theme token selects
  | 'action'    // CTA row: editable label (loctext) + fixed destination
  | 'pagetoggle'; // boolean living on LandingPageConfig (e.g. showUtilityBar)

export interface BuilderFieldDef {
  /** dot-path into LandingSectionData; for fixedKey loctext fields the path is
   *  informational only. */
  path: string;
  label: string;
  tab: InspectorTab;
  widget: BuilderWidget;
  help?: string;
  required?: boolean;
  options?: string[];
  readOnly?: boolean;
  multiline?: boolean;
  /** loctext bound to a FIXED deck key (e.g. hero CTA labels) instead of a
   *  key stored in section data. */
  fixedKey?: string;
  /** for widget 'action': human description of the fixed destination. */
  destination?: string;
  /** Optional group heading rendered above this field (e.g. "Top Bar Settings"). */
  group?: string;
}

export interface ItemsEditorConfig {
  /** Inspector card title, e.g. "Highlights", "Channels". */
  label: string;
  tab: InspectorTab;
  withIcons: boolean;
  withDesc: boolean;
  withUrl: boolean;
  help?: string;
  /** New-item template. */
  newItem: () => { code: string; labelKey: string };
  /** Built-in defaults shown as editable rows when the section carries no
   *  items[] yet (copy-on-write: first edit materialises them into config). */
  inherited?: () => Array<{ code: string; labelKey: string; iconId?: string; enabled?: boolean; order?: number }>;
}

export interface SectionEditorEntry {
  type: string;
  label: string;
  icon: LucideIcon;
  description: string;
  fields: BuilderFieldDef[];
  items?: ItemsEditorConfig;
  defaults: () => LandingSectionData;
  validate: (d: LandingSectionData) => ValidationIssue[];
  normalize: (d: LandingSectionData) => LandingSectionData;
}

/** Common fields rendered for every type (Visibility / Advanced tabs). */
export const COMMON_FIELDS: BuilderFieldDef[] = [
  { path: 'enabled', label: 'Visible on page', tab: 'visibility', widget: 'boolean',
    help: 'Off = hidden on the public page.' },
  { path: 'status', label: 'Status', tab: 'visibility', widget: 'select',
    options: ['DRAFT', 'PUBLISHED'], help: 'The public page renders PUBLISHED only.' },
  { path: 'roles', label: 'Restrict to roles', tab: 'visibility', widget: 'text',
    help: 'Comma-separated role codes. Empty = public.' },
  { path: 'code', label: 'Section code', tab: 'advanced', widget: 'text', readOnly: true },
  { path: 'order', label: 'Order', tab: 'advanced', widget: 'number', readOnly: true,
    help: 'Managed by drag-and-drop in the section list.' },
  { path: 'titleKey', label: 'Title localization key', tab: 'advanced', widget: 'text' },
  { path: 'subtitleKey', label: 'Subtitle localization key', tab: 'advanced', widget: 'text' },
  { path: 'bodyKey', label: 'Body localization key', tab: 'advanced', widget: 'text' },
];

const loc = (
  path: string, label: string, opts: Partial<BuilderFieldDef> = {},
): BuilderFieldDef => ({ path, label, tab: 'content', widget: 'loctext', ...opts });

const themeField: BuilderFieldDef = {
  path: 'theme', label: 'Theme tokens', tab: 'design', widget: 'theme',
  help: 'Accent / background reference existing --pgrl-* theme tokens (Theme Config). No second theming system.',
};

const mediaField = (label = 'Background image'): BuilderFieldDef => ({
  path: 'media.imageId', label, tab: 'media', widget: 'media',
  help: 'From the platform file store, or paste an image URL.',
});

const trimStrings = (d: LandingSectionData): LandingSectionData => {
  const out: LandingSectionData = { ...d };
  (['titleKey', 'subtitleKey', 'bodyKey'] as const).forEach((k) => {
    const v = out[k];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) out[k] = t; else delete out[k];
    }
  });
  if (Array.isArray(out.items)) {
    out.items = out.items.filter((it) => it && (it.code || it.labelKey));
    if (!out.items.length) delete out.items;
  }
  return out;
};

const entry = (
  type: string, label: string, icon: LucideIcon, description: string,
  fields: BuilderFieldDef[], extra?: Partial<SectionEditorEntry>,
): SectionEditorEntry => ({
  type, label, icon, description, fields,
  defaults: () => ({ type, enabled: true, status: 'DRAFT' }),
  validate: () => [],
  normalize: trimStrings,
  ...extra,
});

let itemSeq = 0;
const newItem = (prefix: string) => () => {
  itemSeq += 1;
  const code = `${prefix}-${Date.now().toString(36)}${itemSeq}`;
  return { code, labelKey: `PGR_LANDING_${code.replace(/[^a-z0-9]/gi, '_').toUpperCase()}_LABEL` };
};

export const SECTION_EDITOR_REGISTRY: Record<string, SectionEditorEntry> = {
  navigation: entry('navigation', 'Navigation', Navigation,
    'Masthead + sticky primary navigation.',
    [
      mediaField('Emblem image'),
      // Top bar (utility strip) — texts are fixed deck keys; the visibility
      // toggle lives on LandingPageConfig (surfaced here for convenience).
      { path: 'showUtilityBar', label: 'Show top bar', tab: 'content', widget: 'pagetoggle',
        group: 'Top Bar Settings' },
      { path: 'topbar.left', label: 'Top bar text (Left)', tab: 'content', widget: 'loctext',
        fixedKey: 'PGR_LANDING_GOV_NAME', group: 'Top Bar Settings' },
      { path: 'topbar.center', label: 'Top bar text (Center)', tab: 'content', widget: 'loctext',
        fixedKey: 'PGR_LANDING_UTILITY_GREEN_LINE', group: 'Top Bar Settings' },
      { path: 'topbar.right', label: 'Login link text (Right)', tab: 'content', widget: 'loctext',
        fixedKey: 'PGR_LANDING_LOGIN', group: 'Top Bar Settings' },
      themeField,
    ],
    {
      items: {
        label: 'Menu items', tab: 'content', withIcons: false, withDesc: false, withUrl: true,
        help: 'Overrides the built-in menu when set.', newItem: newItem('nav'),
      },
    }),
  hero: entry('hero', 'Hero', Image,
    'Title banner with the primary calls to action.',
    [
      loc('bodyKey', 'Eyebrow / Badge'),
      loc('titleKey', 'Title', { required: true }),
      loc('subtitleKey', 'Subtitle', { multiline: true }),
      mediaField(),
      { path: 'cta.primary', label: 'Primary CTA', tab: 'actions', widget: 'action',
        fixedKey: 'PGR_LANDING_HERO_CTA_SUBMIT', destination: 'Opens the submission form' },
      { path: 'cta.secondary', label: 'Secondary CTA', tab: 'actions', widget: 'action',
        fixedKey: 'PGR_LANDING_HERO_CTA_TRACK', destination: 'Opens case tracking' },
      themeField,
    ],
    {
      items: {
        label: 'Highlights', tab: 'content', withIcons: true, withDesc: false, withUrl: false,
        help: 'Trust markers under the CTAs.', newItem: newItem('trust'),
        inherited: () => [
          { code: 'trust-confidential', labelKey: 'PGR_LANDING_HERO_TRUST_CONFIDENTIAL', iconId: 'Lock', enabled: true, order: 10 },
          { code: 'trust-case-number', labelKey: 'PGR_LANDING_HERO_TRUST_CASE_NUMBER', iconId: 'Hash', enabled: true, order: 20 },
          { code: 'trust-notifications', labelKey: 'PGR_LANDING_HERO_TRUST_NOTIFICATIONS', iconId: 'Bell', enabled: true, order: 30 },
        ],
      },
    }),
  types: entry('types', 'Submission types', LayoutGrid,
    'The manifestation-type cards.',
    [loc('titleKey', 'Title', { required: true }), loc('subtitleKey', 'Intro', { multiline: true }), themeField],
    {
      items: {
        label: 'Cards', tab: 'content', withIcons: true, withDesc: true, withUrl: true,
        help: 'Overrides the built-in four when set.', newItem: newItem('type'),
      },
    }),
  steps: entry('steps', 'How it works', ListOrdered,
    'Numbered case-lifecycle steps.',
    [loc('titleKey', 'Title', { required: true }), themeField],
    {
      items: {
        label: 'Steps', tab: 'content', withIcons: true, withDesc: false, withUrl: false,
        help: 'Overrides the built-in six when set.', newItem: newItem('step'),
      },
    }),
  channels: entry('channels', 'Channels', Radio,
    'Service-channel cards.',
    [loc('titleKey', 'Title', { required: true }), loc('subtitleKey', 'Intro', { multiline: true }), themeField],
    {
      items: {
        label: 'Channels', tab: 'content', withIcons: true, withDesc: true, withUrl: true,
        help: 'Overrides the built-in four when set.', newItem: newItem('channel'),
      },
    }),
  privacy: entry('privacy', 'Privacy', Lock,
    'Confidentiality assurance block.',
    [
      loc('titleKey', 'Title', { required: true }),
      loc('bodyKey', 'First paragraph', { multiline: true }),
      loc('subtitleKey', 'Second paragraph', { multiline: true }),
      themeField,
    ]),
  news: entry('news', 'News', Newspaper,
    'Latest-updates grid. Cards are content management (future news master / CMS) — heading & visibility here.',
    [loc('titleKey', 'Heading', { required: true })]),
  institutions: entry('institutions', 'Institutions', Landmark,
    'IGE / IGSAE legitimacy block.',
    [loc('titleKey', 'Title', { required: true }), themeField],
    {
      items: {
        label: 'Institutions', tab: 'content', withIcons: true, withDesc: true, withUrl: false,
        help: 'Overrides the built-in two when set.', newItem: newItem('inst'),
      },
    }),
  cta: entry('cta', 'Final call-to-action', Megaphone,
    'Closing conversion band.',
    [
      loc('titleKey', 'Title', { required: true }),
      loc('subtitleKey', 'Text', { multiline: true }),
      { path: 'cta.primary', label: 'Primary CTA', tab: 'actions', widget: 'action',
        fixedKey: 'PGR_LANDING_FINAL_CTA', destination: 'Opens the submission form' },
      themeField,
    ]),
  footer: entry('footer', 'Footer', PanelBottom,
    'Structural layout is fixed (locked decision); texts are editable via Localization, logos via Branding.',
    []),
};

export const SECTION_TYPES = Object.keys(SECTION_EDITOR_REGISTRY);

export function getEditorEntry(type?: string): SectionEditorEntry | undefined {
  return type ? SECTION_EDITOR_REGISTRY[type] : undefined;
}

export const INSPECTOR_TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'content', label: 'Content' },
  { id: 'media', label: 'Media' },
  { id: 'actions', label: 'Actions' },
  { id: 'design', label: 'Design' },
  { id: 'visibility', label: 'Visibility' },
  { id: 'advanced', label: 'Advanced' },
];

/** Card health: quick content/media checks for the section list. */
export function sectionHealth(
  d: LandingSectionData,
  resolve: (key?: string) => string | undefined,
): { ok: boolean; warnings: string[] } {
  const entryDef = getEditorEntry(d.type);
  const warnings: string[] = [];
  entryDef?.fields.forEach((f) => {
    if (f.widget === 'loctext' && f.required && !f.fixedKey) {
      const key = (d as Record<string, unknown>)[f.path] as string | undefined;
      if (!key || resolve(key) === undefined) warnings.push(`Missing ${f.label.toLowerCase()}`);
    }
  });
  if (d.type === 'hero' && !d.media?.imageId) warnings.push('No background image (uses gradient)');
  return { ok: warnings.length === 0, warnings };
}
