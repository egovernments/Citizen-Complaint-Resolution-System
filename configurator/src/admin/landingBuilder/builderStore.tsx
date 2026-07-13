/** Builder draft store v2 (P4, CCSD-2009).
 *
 * One useReducer + context — no extra state library. All IO goes through the
 * existing DigitApiClient (same MDMS + localization APIs the rest of the
 * Configurator uses). Draft rows AND staged localization edits stay
 * client-side until Save Draft; Publish additionally promotes enabled
 * sections to PUBLISHED. Undo/redo snapshots {sections, page, locEdits}.
 */
import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import { digitClient } from '@/providers/bridge';
import { getEditorEntry } from './sectionEditorRegistry';
import { persistLocEdits } from './localization';
import type {
  BuilderState, HistorySnap, InspectorTab, LandingPageData, LandingSectionData,
  LocEdits, MdmsRow, PreviewConfig, SectionEntry, ValidationIssue,
} from './types';

export const SECTION_SCHEMA = 'RAINMAKER-PGR.LandingSection';
export const PAGE_SCHEMA = 'RAINMAKER-PGR.LandingPageConfig';
const HISTORY_MAX = 60;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | { type: 'loadStart' }
  | { type: 'loadError'; error: string }
  | { type: 'hydrate'; sections: MdmsRow[]; page?: MdmsRow; select?: string }
  | { type: 'select'; id: string; tab?: InspectorTab; focusField?: string | null }
  | { type: 'hover'; code: string | null }
  | { type: 'setTab'; tab: InspectorTab }
  | { type: 'patchSection'; code: string; patch: Partial<LandingSectionData>; coalesce?: string }
  | { type: 'patchPage'; patch: Partial<LandingPageData>; coalesce?: string }
  | { type: 'patchLoc'; locale: string; key: string; text: string; coalesce?: string }
  | { type: 'move'; code: string; toIndex: number }
  | { type: 'duplicate'; code: string }
  | { type: 'remove'; code: string }
  | { type: 'addSection'; sectionType: string; code: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'setPreviewMode'; mode: 'draft' | 'published' }
  | { type: 'setViewport'; viewport: BuilderState['viewport'] }
  | { type: 'setZoom'; zoom: number }
  | { type: 'setDisplayLocale'; locale: string }
  | { type: 'saveStart' }
  | { type: 'saveDone'; sections: MdmsRow[]; page?: MdmsRow }
  | { type: 'saveError'; error: string }
  | { type: 'setValidation'; issues: ValidationIssue[] | null };

export const initialState: BuilderState = {
  loading: true,
  page: null,
  sections: [],
  locEdits: {},
  selected: 'page',
  hovered: null,
  inspectorTab: 'content',
  focusField: null,
  previewMode: 'draft',
  viewport: 'desktop',
  zoom: 1,
  displayLocale: 'pt_PT',
  saving: false,
  lastSavedAt: null,
  validation: null,
  past: [],
  future: [],
};

const byOrder = (a: SectionEntry, b: SectionEntry) => (a.draft.order ?? 0) - (b.draft.order ?? 0);

function hydrateSections(rows: MdmsRow[]): SectionEntry[] {
  return rows
    .filter((r) => r.isActive)
    .map((r) => ({ record: r, draft: { ...(r.data as LandingSectionData) }, state: 'clean' as const }))
    .sort(byOrder);
}

function renumber(sections: SectionEntry[]): SectionEntry[] {
  return sections.map((s, i) => {
    const order = (i + 1) * 10;
    if (s.draft.order === order) return s;
    return { ...s, draft: { ...s.draft, order }, state: s.state === 'clean' ? 'dirty' : s.state };
  });
}

const snap = (s: BuilderState): HistorySnap => ({
  sections: s.sections, page: s.page, locEdits: s.locEdits,
});

/** Push a history snapshot; `coalesce` collapses rapid edits to one entry
 *  (e.g. typing) — same tag replaces the previous push instead of stacking. */
let lastCoalesce: string | undefined;
function withHistory(state: BuilderState, coalesce?: string): Pick<BuilderState, 'past' | 'future'> {
  if (coalesce && coalesce === lastCoalesce && state.past.length > 0) {
    return { past: state.past, future: [] };
  }
  lastCoalesce = coalesce;
  return { past: [...state.past.slice(-HISTORY_MAX + 1), snap(state)], future: [] };
}

export function reducer(state: BuilderState, action: Action): BuilderState {
  switch (action.type) {
    case 'loadStart':
      return { ...state, loading: true, error: undefined };
    case 'loadError':
      return { ...state, loading: false, error: action.error };
    case 'hydrate': {
      const sections = hydrateSections(action.sections);
      lastCoalesce = undefined;
      return {
        ...state,
        loading: false,
        error: undefined,
        sections,
        locEdits: {},
        past: [],
        future: [],
        page: action.page
          ? { record: action.page, draft: { ...(action.page.data as LandingPageData) }, dirty: false }
          : { draft: { code: 'default', enabled: true }, dirty: false },
        selected:
          action.select && sections.some((s) => s.draft.code === action.select)
            ? action.select
            : 'page',
        validation: null,
      };
    }
    case 'select':
      return {
        ...state,
        selected: action.id,
        inspectorTab: action.tab ?? (action.id === state.selected ? state.inspectorTab : 'content'),
        focusField: action.focusField ?? null,
      };
    case 'hover':
      return state.hovered === action.code ? state : { ...state, hovered: action.code };
    case 'setTab':
      return { ...state, inspectorTab: action.tab, focusField: null };
    case 'patchSection': {
      const hist = withHistory(state, action.coalesce);
      const sections = state.sections.map((s) =>
        s.draft.code !== action.code
          ? s
          : { ...s, draft: { ...s.draft, ...action.patch }, state: s.state === 'clean' ? ('dirty' as const) : s.state },
      );
      return { ...state, ...hist, sections, validation: null };
    }
    case 'patchPage': {
      if (!state.page) return state;
      const hist = withHistory(state, action.coalesce);
      return {
        ...state, ...hist,
        page: { ...state.page, draft: { ...state.page.draft, ...action.patch }, dirty: true },
        validation: null,
      };
    }
    case 'patchLoc': {
      const hist = withHistory(state, action.coalesce);
      const locale = { ...(state.locEdits[action.locale] ?? {}) };
      locale[action.key] = action.text;
      return { ...state, ...hist, locEdits: { ...state.locEdits, [action.locale]: locale } };
    }
    case 'move': {
      const ordered = [...state.sections].sort(byOrder);
      const from = ordered.findIndex((s) => s.draft.code === action.code);
      if (from < 0) return state;
      const to = Math.max(0, Math.min(ordered.length - 1, action.toIndex));
      if (from === to) return state;
      const hist = withHistory(state);
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      return { ...state, ...hist, sections: renumber(ordered), validation: null };
    }
    case 'duplicate': {
      const src = state.sections.find((s) => s.draft.code === action.code);
      if (!src) return state;
      const hist = withHistory(state);
      let n = 1;
      let code = `${action.code}-copy`;
      const codes = new Set(state.sections.map((s) => s.draft.code));
      while (codes.has(code)) code = `${action.code}-copy-${++n}`;
      const ordered = [...state.sections].sort(byOrder);
      const idx = ordered.findIndex((s) => s.draft.code === action.code);
      const copy: SectionEntry = {
        draft: { ...JSON.parse(JSON.stringify(src.draft)), code, status: 'DRAFT' },
        state: 'created',
      };
      ordered.splice(idx + 1, 0, copy);
      return { ...state, ...hist, sections: renumber(ordered), selected: code, validation: null };
    }
    case 'remove': {
      const hist = withHistory(state);
      const sections = state.sections
        .map((s) => {
          if (s.draft.code !== action.code) return s;
          // created-in-session rows vanish outright; persisted rows soft-delete
          return s.state === 'created' ? null : { ...s, state: 'deleted' as const };
        })
        .filter(Boolean) as SectionEntry[];
      return {
        ...state, ...hist, sections,
        selected: state.selected === action.code ? 'page' : state.selected,
        validation: null,
      };
    }
    case 'addSection': {
      const entryDef = getEditorEntry(action.sectionType);
      if (!entryDef) return state;
      const hist = withHistory(state);
      const ordered = [...state.sections].sort(byOrder);
      ordered.push({ draft: { ...entryDef.defaults(), code: action.code }, state: 'created' });
      return { ...state, ...hist, sections: renumber(ordered), selected: action.code, validation: null };
    }
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      lastCoalesce = undefined;
      return {
        ...state,
        sections: prev.sections, page: prev.page, locEdits: prev.locEdits,
        past: state.past.slice(0, -1),
        future: [snap(state), ...state.future].slice(0, HISTORY_MAX),
        validation: null,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      lastCoalesce = undefined;
      return {
        ...state,
        sections: next.sections, page: next.page, locEdits: next.locEdits,
        past: [...state.past, snap(state)].slice(-HISTORY_MAX),
        future: state.future.slice(1),
        validation: null,
      };
    }
    case 'setPreviewMode':
      return { ...state, previewMode: action.mode };
    case 'setViewport':
      return { ...state, viewport: action.viewport };
    case 'setZoom':
      return { ...state, zoom: action.zoom };
    case 'setDisplayLocale':
      return { ...state, displayLocale: action.locale };
    case 'saveStart':
      return { ...state, saving: true };
    case 'saveDone': {
      const sections = hydrateSections(action.sections);
      lastCoalesce = undefined;
      return {
        ...state,
        saving: false,
        sections,
        locEdits: {},
        past: [], future: [],
        lastSavedAt: Date.now(),
        page: action.page
          ? { record: action.page, draft: { ...(action.page.data as LandingPageData) }, dirty: false }
          : state.page,
        selected: sections.some((s) => s.draft.code === state.selected) ? state.selected : 'page',
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
// Derived
// ---------------------------------------------------------------------------

export function buildPreviewConfig(state: BuilderState): PreviewConfig {
  const sections = [...state.sections]
    .filter((s) => s.state !== 'deleted')
    .filter((s) => s.draft.enabled !== false)
    .filter((s) => (state.previewMode === 'published' ? s.draft.status === 'PUBLISHED' : true))
    .sort(byOrder)
    .map((s) => s.draft);
  return { page: state.page?.draft ?? {}, sections };
}

export function isDirty(state: BuilderState): boolean {
  return (
    !!state.page?.dirty ||
    state.sections.some((s) => s.state !== 'clean') ||
    Object.values(state.locEdits).some((m) => Object.keys(m).length > 0)
  );
}

const URL_OK = /^(\/|#$|#\w|https?:|tel:|mailto:)/i;

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
        issues.push({ level: 'error', section: code, message: `Unknown section type "${d.type ?? ''}".` });
      const order = d.order ?? 0;
      if (seenOrders.has(order))
        issues.push({ level: 'error', section: code, message: `Order ${order} duplicates "${seenOrders.get(order)}".` });
      seenOrders.set(order, code);
      if (d.status && d.status !== 'DRAFT' && d.status !== 'PUBLISHED')
        issues.push({ level: 'error', section: code, message: `Invalid status "${d.status}".` });
      (d.items ?? []).forEach((it) => {
        if (it.navigationUrl && !URL_OK.test(it.navigationUrl))
          issues.push({ level: 'error', section: code, message: `Invalid URL on item "${it.code ?? it.labelKey}".` });
      });
      const entryDef = getEditorEntry(d.type);
      if (entryDef) issues.push(...entryDef.validate(d));
    });
  return issues;
}

// ---------------------------------------------------------------------------
// Persistence — same MDMS + localization APIs as the rest of the Configurator
// ---------------------------------------------------------------------------

async function persistRows(state: BuilderState, tenantId: string, promote: boolean): Promise<void> {
  for (const s of state.sections) {
    const entryDef = getEditorEntry(s.draft.type);
    let data = entryDef ? entryDef.normalize(s.draft) : s.draft;
    if (promote && s.state !== 'deleted' && data.enabled !== false && data.status !== 'PUBLISHED') {
      data = { ...data, status: 'PUBLISHED' };
    }
    const changed = s.state !== 'clean' || (promote && data.status !== s.draft.status);
    if (s.state === 'created') {
      await digitClient.mdmsCreate(tenantId, SECTION_SCHEMA, String(data.code), data as Record<string, unknown>);
    } else if (s.state === 'deleted' && s.record) {
      await digitClient.mdmsUpdate(s.record, false);
    } else if (changed && s.record) {
      await digitClient.mdmsUpdate({ ...s.record, data: data as Record<string, unknown> }, true);
    }
  }
  if (state.page?.dirty && state.page.record) {
    await digitClient.mdmsUpdate(
      { ...state.page.record, data: state.page.draft as Record<string, unknown> },
      true,
    );
  }
}

/** Save Draft: rows as-is + staged localization. Publish: also promote
 *  enabled sections to PUBLISHED. */
export async function persist(state: BuilderState, tenantId: string, opts: { publish?: boolean } = {}): Promise<void> {
  await persistLocEdits(tenantId, state.locEdits);
  await persistRows(state, tenantId, !!opts.publish);
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
