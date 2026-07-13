/** SECTION_EDITOR_REGISTRY — everything the Builder knows about a section type
 * (P4, CCSD-2009).
 *
 * Per the approved design this is a metadata registry, not just a field map:
 * each section type contributes its editor fields, validation, defaults and
 * (reserved) normalizer / preview adapter / toolbar actions. Adding a future
 * section type = add a runtime renderer entry + register here — the Builder
 * shell never changes.
 *
 * The registry mirrors (never redefines) the runtime contract: the frozen v1
 * catalog and which keys each section component consumes come from
 * digit-ui-esbuild/products/pgr/.../Landing/config/sectionRegistry.tsx.
 * Application behavior (CTA destinations, routing) is deliberately NOT
 * editable — only content (localization keys, media, items, visibility).
 */
import type { LucideIcon } from 'lucide-react';
import {
  Image,
  Navigation,
  LayoutGrid,
  ListOrdered,
  Radio,
  Lock,
  Newspaper,
  Landmark,
  Megaphone,
  PanelBottom,
} from 'lucide-react';
import type { LandingSectionData, ValidationIssue } from './types';

export type BuilderWidget = 'text' | 'number' | 'boolean' | 'select';

export interface BuilderFieldDef {
  /** dot-path into LandingSectionData (P4a: top-level scalars only). */
  path: string;
  label: string;
  widget: BuilderWidget;
  help?: string;
  options?: string[]; // for select
  readOnly?: boolean;
  /** i18n-key field — P4b upgrades these to LocalizationKeyInput. */
  isLocKey?: boolean;
}

export interface SectionEditorEntry {
  type: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Type-specific fields (common fields render for every type). */
  fields: BuilderFieldDef[];
  /** Seed data for a newly added section of this type (P4b: Add Section). */
  defaults: () => LandingSectionData;
  /** Type-specific validation, merged with the common checks. */
  validate: (d: LandingSectionData) => ValidationIssue[];
  /** Pre-save cleanup (trim keys, drop empties). Identity by default. */
  normalize: (d: LandingSectionData) => LandingSectionData;
  /** Reserved (P4b/P4c): draft -> preview-config row transform, toolbar. */
  previewAdapter?: (d: LandingSectionData) => LandingSectionData;
}

/** Fields every section type shares (rendered above the type-specific ones). */
export const COMMON_FIELDS: BuilderFieldDef[] = [
  { path: 'code', label: 'Code', widget: 'text', readOnly: true,
    help: 'Unique section id — fixed after creation.' },
  { path: 'enabled', label: 'Enabled', widget: 'boolean',
    help: 'Off = hidden on the public page.' },
  { path: 'status', label: 'Status', widget: 'select', options: ['DRAFT', 'PUBLISHED'],
    help: 'The public page renders PUBLISHED only.' },
];

const key = (path: string, label: string, help?: string): BuilderFieldDef => ({
  path, label, widget: 'text', isLocKey: true,
  help: help ?? 'PGR_LANDING_* localization key.',
});

const trimStrings = (d: LandingSectionData): LandingSectionData => {
  const out: LandingSectionData = { ...d };
  (['titleKey', 'subtitleKey', 'bodyKey'] as const).forEach((k) => {
    const v = out[k];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) out[k] = t;
      else delete out[k];
    }
  });
  return out;
};

const noIssues = (): ValidationIssue[] => [];

const entry = (
  type: string,
  label: string,
  icon: LucideIcon,
  description: string,
  fields: BuilderFieldDef[],
  extra?: Partial<SectionEditorEntry>,
): SectionEditorEntry => ({
  type,
  label,
  icon,
  description,
  fields,
  defaults: () => ({ type, enabled: true, status: 'DRAFT' }),
  validate: noIssues,
  normalize: trimStrings,
  ...extra,
});

export const SECTION_EDITOR_REGISTRY: Record<string, SectionEditorEntry> = {
  navigation: entry('navigation', 'Navigation', Navigation,
    'Masthead + sticky primary navigation. Nav items become editable in P4b.',
    []),
  hero: entry('hero', 'Hero', Image,
    'Title banner with the primary CTAs. CTA destinations are application behavior and are not editable.',
    [
      key('titleKey', 'Title key'),
      key('subtitleKey', 'Lede key'),
      key('bodyKey', 'Eyebrow key'),
    ]),
  types: entry('types', 'Submission types', LayoutGrid,
    'The four manifestation-type cards. Cards become editable in P4b.',
    [key('titleKey', 'Title key'), key('subtitleKey', 'Intro key')]),
  steps: entry('steps', 'How it works', ListOrdered,
    'Numbered case-lifecycle steps. Steps become editable in P4b.',
    [key('titleKey', 'Title key')]),
  channels: entry('channels', 'Channels', Radio,
    'Service-channel cards. Channel items become editable in P4b.',
    [key('titleKey', 'Title key'), key('subtitleKey', 'Intro key')]),
  privacy: entry('privacy', 'Privacy', Lock,
    'Confidentiality assurance block.',
    [
      key('titleKey', 'Title key'),
      key('bodyKey', 'First paragraph key'),
      key('subtitleKey', 'Second paragraph key'),
    ]),
  news: entry('news', 'News', Newspaper,
    'Latest-updates grid. Per decision: heading & visibility only — the card feed is content management (future news master / CMS).',
    [key('titleKey', 'Heading key')]),
  institutions: entry('institutions', 'Institutions', Landmark,
    'IGE / IGSAE legitimacy block. Cards become editable in P4b.',
    [key('titleKey', 'Title key')]),
  cta: entry('cta', 'Final call-to-action', Megaphone,
    'Closing conversion band. CTA destinations are application behavior and are not editable.',
    [key('titleKey', 'Title key'), key('subtitleKey', 'Text key')]),
  footer: entry('footer', 'Footer', PanelBottom,
    'Per decision: structural layout is fixed; texts are editable via Localization, logos via Branding.',
    []),
};

export const SECTION_TYPES = Object.keys(SECTION_EDITOR_REGISTRY);

export function getEditorEntry(type?: string): SectionEditorEntry | undefined {
  return type ? SECTION_EDITOR_REGISTRY[type] : undefined;
}
