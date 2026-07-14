/** Landing Page Builder — shared types (P4, CCSD-2009).
 *
 * The Builder edits the SAME MDMS entities as the P3 generic CRUD
 * (RAINMAKER-PGR.LandingSection / LandingPageConfig) through the same
 * DigitApiClient. No new storage model. Draft state (rows + staged
 * localization edits) lives client-side until Save; the preview receives a
 * plain ResolvedLandingConfig via postMessage — the production LandingRenderer
 * never knows a Builder exists.
 */

export interface MdmsRow {
  id: string;
  tenantId: string;
  schemaCode: string;
  uniqueIdentifier: string;
  data: Record<string, unknown>;
  isActive: boolean;
  auditDetails?: Record<string, unknown>;
}

export interface LandingItemData {
  code?: string;
  labelKey?: string;
  descKey?: string;
  iconId?: string;
  navigationUrl?: string;
  enabled?: boolean;
  order?: number;
}

export interface LandingSectionData {
  code?: string;
  type?: string;
  order?: number;
  enabled?: boolean;
  status?: 'DRAFT' | 'PUBLISHED';
  version?: number;
  roles?: string[];
  titleKey?: string;
  subtitleKey?: string;
  bodyKey?: string;
  media?: { imageId?: string; altKey?: string };
  items?: LandingItemData[];
  theme?: { accent?: string; bg?: string };
  [key: string]: unknown;
}

export interface LandingPageData {
  code?: string;
  enabled?: boolean;
  defaultLocale?: string;
  showWhatsAppFab?: boolean;
  showUtilityBar?: boolean;
  sectionOrder?: string[];
  [key: string]: unknown;
}

export type RowState = 'clean' | 'dirty' | 'created' | 'deleted';

export interface SectionEntry {
  record?: MdmsRow;
  draft: LandingSectionData;
  state: RowState;
}

export interface PageEntry {
  record?: MdmsRow;
  draft: LandingPageData;
  dirty: boolean;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  section?: string;
  message: string;
}

/** locale -> i18n key -> staged message text (persisted on Save Draft). */
export type LocEdits = Record<string, Record<string, string>>;

/** What the preview iframe receives — matches the runtime's
 *  ResolvedLandingConfig exactly. */
export interface PreviewConfig {
  page: LandingPageData;
  sections: LandingSectionData[];
}

export type InspectorTab = 'content' | 'media' | 'actions' | 'design' | 'visibility' | 'advanced';

export interface BuilderState {
  loading: boolean;
  error?: string;
  page: PageEntry | null;
  sections: SectionEntry[];
  /** Staged localization text edits (all locales), saved with Save Draft. */
  locEdits: LocEdits;
  /** 'page' or a section code. */
  selected: string;
  /** Section the pointer is over (either pane) — drives both highlights. */
  hovered: string | null;
  /** Inspector tab + a field to focus (set by click-to-edit in the preview). */
  inspectorTab: InspectorTab;
  focusField: string | null;
  previewMode: 'draft' | 'published';
  viewport: 'desktop' | 'tablet' | 'mobile';
  zoom: number; // 0.5 | 0.75 | 1 (1 = 100%)
  /** Locale whose text the Inspector displays/edits + preview language. */
  displayLocale: string;
  saving: boolean;
  lastSavedAt: number | null;
  validation: ValidationIssue[] | null;
  /** Undo/redo — snapshots of {sections, page, locEdits}. */
  past: HistorySnap[];
  future: HistorySnap[];
}

export interface HistorySnap {
  sections: SectionEntry[];
  page: PageEntry | null;
  locEdits: LocEdits;
}
