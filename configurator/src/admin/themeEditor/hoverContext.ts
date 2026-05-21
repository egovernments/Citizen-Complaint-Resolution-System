import { createContext, useContext, useRef, useCallback, type RefObject } from 'react';

/**
 * DOM-level hover highlight for the theme preview.
 *
 * Why DOM-level and not React state: hovering 38 color fields in quick
 * succession would trigger 38 re-renders of ThemePreview (and its `useWatch`
 * child). Instead, we mutate a single attribute on the preview root and let
 * a short imperative pass toggle a class on matching `[data-token]` elements.
 * Zero React re-renders, no context value churn.
 */
export interface HoverContextValue {
  previewRootRef: RefObject<HTMLDivElement | null>;
  setHoveredToken: (token: string | null) => void;
}

const HIGHLIGHT_CLASS = 'theme-token-hover';

/**
 * v2/v3 semantic key → list of v1 paths it fans out to. Mirrors the
 * SEMANTIC_EXPANSION + V3_EXPANSION maps in theflywheel/digit-ui-esbuild's
 * applyTheme.js and the V2_TO_V1_FALLBACK map in ThemePreview. Kept here
 * so hovering a form input lights up every v1 [data-token] element it
 * ultimately drives in the preview.
 *
 * Keys are without the `colors.` prefix; the matcher adds it back.
 */
const V2_TO_V1: Record<string, string[]> = {
  // v2
  brand: ['primary.main'],
  'brand-on': ['primary.dark', 'primary.accent', 'link.normal', 'link.hover', 'text.heading'],
  'surface-header': ['secondary', 'digitv2.header-sidenav'],
  'surface-page': ['grey.light'],
  'text-primary': ['text.primary'],
  'text-secondary': ['text.secondary', 'text.muted'],
  'text-disabled': ['grey.disabled', 'digitv2.text-color-disabled'],
  border: ['border', 'input-border'],
  error: ['error', 'error-dark'],
  success: ['success'],
  info: ['digitv2.alert-info', 'info-dark'],
  warning: ['warning-dark'],
  'selected-bg': ['primary.selected-bg', 'digitv2.primary-bg'],
  // v3 — main palette
  'primary-1': ['primary.dark', 'primary.accent', 'link.normal', 'link.hover', 'text.heading', 'secondary', 'digitv2.header-sidenav'],
  'primary-2': ['primary.main'],
  'primary-1-bg': ['primary.selected-bg', 'digitv2.primary-bg'],
  // v3 — text
  'text-heading': ['text.heading'],
  // v3 — page
  'page-bg': ['grey.bg'],
  'page-secondary-bg': ['grey.light', 'grey.lighter'],
  // v3 — buttons
  'button-primary-bg-default': ['primary.main'],
  'button-primary-text': ['primary.dark'],
  'button-secondary-bg-default': ['grey.bg'],
  'button-secondary-text': ['primary.dark'],
  'button-tertiary-text': ['link.normal'],
  // v3 — inputs
  'input-bg': ['grey.bg'],
  'input-border-default': ['input-border'],
  'input-text': ['text.primary'],
  'input-placeholder': ['text.muted'],
  // v3 — header / sidebar
  'header-bg': ['digitv2.header-sidenav'],
  'header-text': ['secondary'],
  'sidebar-bg': ['digitv2.header-sidenav'],
  'sidebar-selected-bg': ['primary.selected-bg'],
  'sidebar-selected-text': ['primary.main'],
  // v3 — status
  'status-success-text': ['success'],
  'status-success-bg': ['digitv2.alert-success-bg'],
  'status-error-text': ['error', 'error-dark'],
  'status-error-bg': ['digitv2.alert-error-bg'],
  'status-warning-text': ['warning-dark'],
  'status-info-text': ['info-dark', 'digitv2.alert-info'],
  'status-info-bg': ['digitv2.alert-info-bg'],
  // v3 — charts
  'chart-1': ['digitv2.chart-1'],
  'chart-2': ['digitv2.chart-2'],
  'chart-3': ['digitv2.chart-3'],
  'chart-4': ['digitv2.chart-4'],
  'chart-5': ['digitv2.chart-5'],
};

/** Tokens to look for given a hovered form field path. For a v2 form input
 *  (`colors.brand`), returns the v2 path itself plus every v1 path the v2 key
 *  expands to. For a legacy v1 path or any non-v2 token, returns it unchanged. */
function expandTokenForMatching(token: string): string[] {
  const v2Key = token.startsWith('colors.') ? token.slice('colors.'.length) : token;
  const v1Paths = V2_TO_V1[v2Key];
  if (!v1Paths) return [token];
  return [token, ...v1Paths.map((p) => `colors.${p}`)];
}

const HoverContext = createContext<HoverContextValue | null>(null);

export function useHoverContext(): HoverContextValue | null {
  return useContext(HoverContext);
}

export { HoverContext };

/** Creates the setter paired with a ref to the preview root. Call once at
 *  the editor level and pass the pair down via context. */
export function useCreateHoverContext(): HoverContextValue {
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const lastSelectorRef = useRef<string | null>(null);

  const setHoveredToken = useCallback((token: string | null) => {
    const root = previewRootRef.current;
    if (!root) return;
    // Clear previous highlights.
    if (lastSelectorRef.current) {
      root.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
        el.classList.remove(HIGHLIGHT_CLASS);
      });
      lastSelectorRef.current = null;
    }
    if (!token) return;
    // CSS attribute selectors can't have escaped commas / colons without quoting,
    // so we filter by exact match against the full token path stored on data-token.
    // Multiple tokens on one element are space-separated (e.g. "colors.border colors.input-border").
    // For a v2 input (e.g. colors.brand), we also light up any element whose
    // data-token contains the v1 paths brand fans out into (colors.primary.main, …).
    const candidates = expandTokenForMatching(token);
    const matches = Array.from(root.querySelectorAll<HTMLElement>('[data-token]'))
      .filter((el) => {
        const list = el.dataset.token?.split(/\s+/) ?? [];
        return candidates.some((c) => list.includes(c));
      });
    matches.forEach((el) => el.classList.add(HIGHLIGHT_CLASS));
    lastSelectorRef.current = token;
  }, []);

  return { previewRootRef, setHoveredToken };
}

export const HIGHLIGHT_CLASS_NAME = HIGHLIGHT_CLASS;
