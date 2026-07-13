/** Builder draft store (P4a, CCSD-2009).
 *
 * One useReducer + context — no extra state library. All IO goes through the
 * existing DigitApiClient (same MDMS APIs as the P3 generic CRUD). Edits stay
 * client-side until Save; the preview adapter assembles a plain
 * ResolvedLandingConfig from draft state, so the production LandingRenderer
 * receives exactly what it receives in production — never Builder internals.
 */
import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import { digitClient } from '@/providers/bridge';
import { getEditorEntry } from './sectionEditorRegistry';
import type {
  BuilderState,
  LandingPageData,
  LandingSectionData,
  MdmsRow,
  PreviewConfig,
  SectionEntry,
  ValidationIssue,
} from './types';

export const SECTION_SCHEMA = 'RAINMAKER-PGR.LandingSection';
export const PAGE_SCHEMA = 'RAINMAKER-PGR.LandingPageConfig';

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type Action =
  | { type: 'loadStart' }
  | { type: 'loadError'; error: string }
  | { type: 'hydrate'; sections: MdmsRow[]; page?: MdmsRow; select?: string }
  | { type: 'select'; id: string }
  | { type: 'patchSection'; code: string; patch: Partial<LandingSectionData> }
  | { type: 'patchPage'; patch: Partial<LandingPageData> }
  | { type: 'move'; code: string; dir: -1 | 1 }
  | { type: 'setPreviewMode'; mode: 'draft' | 'published' }
  | { type: 'setViewport'; viewport: BuilderState['viewport'] }
  | { type: 'saveStart' }
  | { type: 'saveDone'; sections: MdmsRow[]; page?: MdmsRow }
  | { type: 'saveError'; error: string }
  | { type: 'setValidation'; issues: ValidationIssue[] | null };

export const initialState: BuilderState = {
  loading: true,
  page: null,
  sections: [],
  selected: 'page',
  previewMode: 'draft',
  viewport: 'desktop',
  saving: false,
  validation: null,
};

const byOrder = (a: SectionEntry, b: SectionEntry) =>
  (a.draft.order ?? 0) - (b.draft.order ?? 0);

function hydrateSections(rows: MdmsRow[]): SectionEntry[] {
  return rows
    .filter((r) => r.isActive)
    .map((r) => ({ record: r, draft: { ...(r.data as LandingSectionData) }, state: 'clean' as const }))
    .sort(byOrder);
}

/** Rewrite order as (index+1)*10 over the given visual order. Marks rows whose
 *  order changed as dirty. */
function renumber(sections: SectionEntry[]): SectionEntry[] {
  return sections.map((s, i) => {
    const order = (i + 1) * 10;
    if (s.draft.order === order) return s;
    return {
      ...s,
      draft: { ...s.draft, order },
      state: s.state === 'clean' ? 'dirty' : s.state,
    };
  });
}

export function reducer(state: BuilderState, action: Action): BuilderState {
  switch (action.type) {
    case 'loadStart':
      return { ...state, loading: true, error: undefined };
    case 'loadError':
      return { ...state, loading: false, error: action.error };
    case 'hydrate': {
      const sections = hydrateSections(action.sections);
      const pageRow = action.page;
      return {
        ...state,
        loading: false,
        error: undefined,
        sections,
        page: pageRow
          ? { record: pageRow, draft: { ...(pageRow.data as LandingPageData) }, dirty: false }
          : { draft: { code: 'default', enabled: true }, dirty: false },
        selected:
          action.select && sections.some((s) => s.draft.code === action.select)
            ? action.select
            : 'page',
        validation: null,
      };
    }
    case 'select':
      return { ...state, selected: action.id };
    case 'patchSection': {
      const sections = state.sections.map((s) => {
        if (s.draft.code !== action.code) return s;
        return {
          ...s,
          draft: { ...s.draft, ...action.patch },
          state: s.state === 'clean' ? ('dirty' as const) : s.state,
        };
      });
      return { ...state, sections, validation: null };
    }
    case 'patchPage': {
      if (!state.page) return state;
      return {
        ...state,
        page: { ...state.page, draft: { ...state.page.draft, ...action.patch }, dirty: true },
        validation: null,
      };
    }
    case 'move': {
      const ordered = [...state.sections].sort(byOrder);
      const idx = ordered.findIndex((s) => s.draft.code === action.code);
      const target = idx + action.dir;
      if (idx < 0 || target < 0 || target >= ordered.length) return state;
      [ordered[idx], ordered[target]] = [ordered[target], ordered[idx]];
      return { ...state, sections: renumber(ordered), validation: null };
    }
    case 'setPreviewMode':
      return { ...state, previewMode: action.mode };
    case 'setViewport':
      return { ...state, viewport: action.viewport };
    case 'saveStart':
      return { ...state, saving: true };
    case 'saveDone': {
      const sections = hydrateSections(action.sections);
      return {
        ...state,
        saving: false,
        sections,
        page: action.page
          ? { record: action.page, draft: { ...(action.page.data as LandingPageData) }, dirty: false }
          : state.page,
        validation: null,
      };
    }
    case 'saveError':
      return { ...state, saving: false, error: action.error };
    case 'setValidation':
      return { ...state, validation: action.issues };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Derived: preview adapter + dirty check + validation
// ---------------------------------------------------------------------------

/** Draft state -> the plain config the production renderer consumes. The
 *  ordering/visibility semantics mirror the runtime's useLandingConfig. */
export function buildPreviewConfig(state: BuilderState): PreviewConfig {
  const sections = [...state.sections]
    .filter((s) => s.state !== 'deleted')
    .filter((s) => s.draft.enabled !== false)
    .filter((s) => (state.previewMode === 'published' ? s.draft.status === 'PUBLISHED' : true))
    .sort(byOrder)
    .map((s) => {
      const adapter = getEditorEntry(s.draft.type)?.previewAdapter;
      return adapter ? adapter(s.draft) : s.draft;
    });
  return { page: state.page?.draft ?? {}, sections };
}

export function isDirty(state: BuilderState): boolean {
  return (
    !!state.page?.dirty ||
    state.sections.some((s) => s.state !== 'clean')
  );
}

export function validateAll(state: BuilderState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenCodes = new Set<string>();
  const seenOrders = new Map<number, string>();
  state.sections
    .filter((s) => s.state !== 'deleted')
    .forEach((s) => {
      const d = s.draft;
      const code = d.code ?? '';
      if (!code) issues.push({ level: 'error', message: 'A section is missing its code.' });
      else if (seenCodes.has(code))
        issues.push({ level: 'error', section: code, message: `Duplicate code "${code}".` });
      seenCodes.add(code);
      if (!d.type || !getEditorEntry(d.type))
        issues.push({ level: 'error', section: code, message: `Unknown section type "${d.type ?? ''}" — the page would skip it.` });
      const order = d.order ?? 0;
      if (seenOrders.has(order))
        issues.push({ level: 'error', section: code, message: `Order ${order} duplicates section "${seenOrders.get(order)}".` });
      seenOrders.set(order, code);
      if (d.status && d.status !== 'DRAFT' && d.status !== 'PUBLISHED')
        issues.push({ level: 'error', section: code, message: `Invalid status "${d.status}".` });
      const entry = getEditorEntry(d.type);
      if (entry) issues.push(...entry.validate(d));
    });
  return issues;
}

// ---------------------------------------------------------------------------
// Save pipeline — same MDMS APIs as the P3 generic CRUD
// ---------------------------------------------------------------------------

export async function persist(state: BuilderState, tenantId: string): Promise<void> {
  // Sections: created -> _create, dirty -> _update, deleted -> _update(isActive:false)
  for (const s of state.sections) {
    const entry = getEditorEntry(s.draft.type);
    const data = entry ? entry.normalize(s.draft) : s.draft;
    if (s.state === 'created') {
      await digitClient.mdmsCreate(tenantId, SECTION_SCHEMA, String(data.code), data as Record<string, unknown>);
    } else if (s.state === 'dirty' && s.record) {
      await digitClient.mdmsUpdate({ ...s.record, data: data as Record<string, unknown> }, true);
    } else if (s.state === 'deleted' && s.record) {
      await digitClient.mdmsUpdate(s.record, false); // soft delete, as in P3
    }
  }
  if (state.page?.dirty && state.page.record) {
    await digitClient.mdmsUpdate(
      { ...state.page.record, data: state.page.draft as Record<string, unknown> },
      true,
    );
  }
}

export async function fetchAll(tenantId: string): Promise<{ sections: MdmsRow[]; page?: MdmsRow }> {
  const [sections, pages] = await Promise.all([
    digitClient.mdmsSearch(tenantId, SECTION_SCHEMA, { limit: 100 }) as Promise<MdmsRow[]>,
    digitClient.mdmsSearch(tenantId, PAGE_SCHEMA, { limit: 10 }) as Promise<MdmsRow[]>,
  ]);
  return { sections, page: pages.find((p) => p.isActive) };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface BuilderCtx {
  state: BuilderState;
  dispatch: React.Dispatch<Action>;
}

const Ctx = createContext<BuilderCtx | null>(null);

export function BuilderProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBuilder(): BuilderCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBuilder must be used inside BuilderProvider');
  return ctx;
}
