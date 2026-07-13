/** Landing Page Builder — shared types (P4, CCSD-2009).
 *
 * The Builder edits the SAME MDMS entities exposed by the P3 generic CRUD
 * (RAINMAKER-PGR.LandingSection / LandingPageConfig) through the same
 * DigitApiClient. No new storage model. Draft state lives client-side until
 * Save; the preview receives a plain ResolvedLandingConfig via postMessage —
 * the production LandingRenderer never knows a Builder exists.
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
  /** Original MDMS row (absent for rows created in this session). */
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
  section?: string; // section code, absent = page-level
  message: string;
}

/** What the preview iframe receives — matches the runtime's
 *  ResolvedLandingConfig ({ page, sections }) exactly. */
export interface PreviewConfig {
  page: LandingPageData;
  sections: LandingSectionData[];
}

export interface BuilderState {
  loading: boolean;
  error?: string;
  page: PageEntry | null;
  sections: SectionEntry[];
  /** 'page' or a section code. */
  selected: string;
  previewMode: 'draft' | 'published';
  viewport: 'desktop' | 'tablet' | 'mobile';
  saving: boolean;
  validation: ValidationIssue[] | null;
}
