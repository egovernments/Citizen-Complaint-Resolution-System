// Theme config migration: legacy (v1) and semantic (v2) `common-masters.ThemeConfig`
// records → the v3 "designer 1:1" field shape the configurator's Theme editor binds to.
//
// WHY: the editor was rebuilt around v3 (flat granular keys: `primary-1`,
// `button-primary-bg-default`, `sidebar-selected-bg`, …). Existing tenant
// records are stored as v1 (nested groups: `primary.main`, `digitv2.header-sidenav`,
// `text.heading`, …) or v2 (12 semantic keys). On load the v3 form binds against
// those paths, finds nothing, and shows every color field blank — so the admin
// can neither see nor safely edit the live theme.
//
// This is the inverse of the runtime `V3_EXPANSION` / `SEMANTIC_EXPANSION` in
// theflywheel/digit-ui-esbuild `src/theme/applyTheme.js` — the same source of
// truth the configurator's `ThemePreview` already mirrors (v3→v1 fallback).
// Here we go forward (v1/v2 → v3): flatten the record exactly like applyTheme's
// Pass 1, fan v2 keys out via Pass 2, then for each v3 field pick the first
// matching legacy CSS var. The result drives the form AND, on save, persists a
// clean v3 record the runtime renders via Pass 3. Original legacy keys are
// retained so nothing is ever lost on a partial migration.

// v2 → CSS var(s). Mirror of SEMANTIC_EXPANSION (applyTheme.js).
const SEMANTIC_EXPANSION: Record<string, string[]> = {
  brand: ['--color-primary-main'],
  'brand-on': [
    '--color-primary-dark',
    '--color-primary-accent',
    '--color-link-normal',
    '--color-link-hover',
    '--color-text-heading',
  ],
  'surface-header': ['--color-secondary', '--color-digitv2-header-sidenav'],
  'surface-page': ['--color-grey-light'],
  'text-primary': ['--color-text-primary'],
  'text-secondary': ['--color-text-secondary', '--color-text-muted'],
  'text-disabled': ['--color-grey-disabled', '--color-digitv2-text-color-disabled'],
  border: ['--color-border', '--color-input-border'],
  error: ['--color-error', '--color-error-dark'],
  success: ['--color-success'],
  info: ['--color-digitv2-alert-info', '--color-info-dark'],
  warning: ['--color-warning-dark'],
  'selected-bg': ['--color-primary-selected-bg', '--color-digitv2-primary-bg'],
};

// v3 field → CSS var(s), in priority order. Mirror of V3_EXPANSION (applyTheme.js).
// The FIRST var present in the flattened legacy record supplies the field's value,
// so the ordering encodes the designer's "canonical source" for each collapsed role.
const V3_EXPANSION: Record<string, string[]> = {
  'primary-1': [
    '--color-primary-1',
    '--color-primary-dark',
    '--color-primary-accent',
    '--color-link-normal',
    '--color-link-hover',
    '--color-text-heading',
    '--color-secondary',
    '--color-digitv2-header-sidenav',
  ],
  'primary-2': ['--color-primary-2', '--color-primary-main'],
  'primary-1-bg': [
    '--color-primary-1-bg',
    '--color-primary-selected-bg',
    '--color-digitv2-primary-bg',
  ],
  'primary-2-bg': ['--color-primary-2-bg'],

  'text-heading': ['--color-text-heading'],
  'text-primary': ['--color-text-primary'],
  'text-secondary': ['--color-text-secondary', '--color-text-muted'],
  'text-disabled': [
    '--color-text-disabled',
    '--color-grey-disabled',
    '--color-digitv2-text-color-disabled',
  ],

  'page-bg': ['--color-page-bg'],
  'page-secondary-bg': [
    '--color-page-secondary-bg',
    '--color-grey-light',
    '--color-grey-lighter',
    '--color-grey-bg',
  ],

  'button-primary-bg-default': ['--color-button-primary-bg-default'],
  'button-primary-bg-hover': ['--color-button-primary-bg-hover'],
  'button-primary-bg-pressed': ['--color-button-primary-bg-pressed'],
  'button-primary-text': ['--color-button-primary-text'],
  'button-primary-border': ['--color-button-primary-border'],
  'button-primary-disabled-bg': ['--color-button-primary-disabled-bg'],
  'button-primary-disabled-text': ['--color-button-primary-disabled-text'],

  'button-secondary-bg-default': ['--color-button-secondary-bg-default'],
  'button-secondary-bg-hover': ['--color-button-secondary-bg-hover'],
  'button-secondary-bg-pressed': ['--color-button-secondary-bg-pressed'],
  'button-secondary-text': ['--color-button-secondary-text'],
  'button-secondary-border': ['--color-button-secondary-border'],

  'button-tertiary-text': [
    '--color-button-tertiary-text',
    '--color-link-normal',
    '--color-link-hover',
  ],

  'input-bg': ['--color-input-bg'],
  'input-border-default': ['--color-input-border-default', '--color-input-border'],
  'input-border-focus': ['--color-input-border-focus'],
  'input-border-error': ['--color-input-border-error'],
  'input-placeholder': ['--color-input-placeholder'],
  'input-text': ['--color-input-text'],
  'input-label': ['--color-input-label'],
  'input-helper': ['--color-input-helper'],

  'header-bg': ['--color-header-bg'],
  'header-text': ['--color-header-text'],
  'header-icon': ['--color-header-icon'],

  'sidebar-bg': ['--color-sidebar-bg'],
  'sidebar-text-active': ['--color-sidebar-text-active'],
  'sidebar-text-default': ['--color-sidebar-text-default'],
  'sidebar-hover-text': ['--color-sidebar-hover-text'],
  'sidebar-hover-bg': ['--color-sidebar-hover-bg'],
  'sidebar-icon-active': ['--color-sidebar-icon-active'],
  'sidebar-selected-bg': ['--color-sidebar-selected-bg'],
  'sidebar-selected-text': ['--color-sidebar-selected-text'],

  'card-border': ['--color-card-border', '--color-border'],
  'card-divider': ['--color-card-divider'],
  'card-success': ['--color-card-success'],
  'card-error': ['--color-card-error'],

  'status-success-text': ['--color-status-success-text', '--color-success'],
  'status-success-bg': ['--color-status-success-bg', '--color-digitv2-alert-success-bg'],
  'status-success-border': ['--color-status-success-border'],
  'status-error-text': ['--color-status-error-text', '--color-error', '--color-error-dark'],
  'status-error-bg': ['--color-status-error-bg', '--color-digitv2-alert-error-bg'],
  'status-error-border': ['--color-status-error-border'],
  'status-warning-text': ['--color-status-warning-text', '--color-warning-dark'],
  'status-warning-bg': ['--color-status-warning-bg'],
  'status-warning-border': ['--color-status-warning-border'],
  'status-info-text': [
    '--color-status-info-text',
    '--color-info-dark',
    '--color-digitv2-alert-info',
  ],
  'status-info-bg': ['--color-status-info-bg', '--color-digitv2-alert-info-bg'],
  'status-info-border': ['--color-status-info-border'],

  'table-header-bg': ['--color-table-header-bg'],
  'table-header-text': ['--color-table-header-text'],
  'table-row-bg': ['--color-table-row-bg'],
  'table-alt-row': ['--color-table-alt-row'],
  'table-row-text': ['--color-table-row-text'],
  'table-border': ['--color-table-border'],
  'table-hover': ['--color-table-hover'],
  'table-selected': ['--color-table-selected'],
  'table-hover-text': ['--color-table-hover-text'],
  'table-selected-text': ['--color-table-selected-text'],

  loader: ['--color-loader'],
  progress: ['--color-progress'],
  'tooltip-bg': ['--color-tooltip-bg'],
  'tooltip-text': ['--color-tooltip-text'],
};

type Colors = Record<string, unknown>;

/** Flatten nested color groups into `--color-<dashed-path>` keys, exactly like
 *  applyTheme.js Pass 1. Top-level string keys become `--color-<key>`. */
function flattenToVars(obj: Colors, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const next = prefix ? `${prefix}-${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenToVars(value as Colors, next, out);
    } else if (typeof value === 'string') {
      out[`--color-${next}`] = value;
    }
  }
  return out;
}

/** True once the record already carries the v3 marker key. */
function isV3(colors: Colors): boolean {
  return typeof colors['primary-1'] === 'string';
}

/**
 * Migrate a `common-masters.ThemeConfig` record's `data` into the v3 shape the
 * editor binds to. Idempotent — a record already in v3 is returned untouched.
 * Non-theme / malformed input is returned as-is.
 */
export function migrateThemeConfigToV3<T extends Record<string, unknown>>(data: T): T {
  const colors = data?.colors as Colors | undefined;
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return data;
  if (isV3(colors)) return data;

  // Pass 1: flatten legacy nested + flat keys to the CSS-var namespace.
  const vars = flattenToVars(colors);

  // Pass 2: fan v2 semantic keys out, so v2 records resolve too.
  if (typeof colors['brand'] === 'string') {
    for (const [token, cssVars] of Object.entries(SEMANTIC_EXPANSION)) {
      const value = colors[token];
      if (typeof value === 'string') for (const name of cssVars) vars[name] = value;
    }
  }

  // Resolve each v3 field from the first matching legacy var.
  const v3: Record<string, string> = {};
  for (const [field, cssVars] of Object.entries(V3_EXPANSION)) {
    for (const name of cssVars) {
      const v = vars[name];
      if (typeof v === 'string') {
        v3[field] = v;
        break;
      }
    }
  }

  // Charts: v3 reads `chart-N`; legacy stores them under `digitv2.chart-N`.
  for (let i = 1; i <= 5; i++) {
    const v = vars[`--color-digitv2-chart-${i}`] ?? vars[`--color-chart-${i}`];
    if (typeof v === 'string') v3[`chart-${i}`] = v;
  }

  // Retain original legacy keys (lossless) and overlay the resolved v3 keys.
  return {
    ...data,
    colors: { ...colors, ...v3 },
    version: '3',
  } as T;
}

export const __testing = { flattenToVars, SEMANTIC_EXPANSION, V3_EXPANSION };
