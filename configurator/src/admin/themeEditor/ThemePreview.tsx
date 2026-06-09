import { useMemo, type CSSProperties } from 'react';
import { useWatch } from 'react-hook-form';
import { useHoverContext } from './hoverContext';

/** Flatten a nested record (tolerant of undefined) into a dotted map, e.g.
 *  { primary: { main: '#006B3F' } }  ->  { 'primary.main': '#006B3F' }. */
function flatten(obj: unknown, prefix = ''): Record<string, string> {
  if (!obj || typeof obj !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') {
      Object.assign(out, flatten(v, key));
    } else if (typeof v === 'string') {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Mirror of the runtime SEMANTIC_EXPANSION + V3_EXPANSION (theflywheel/
 * digit-ui-esbuild src/theme/applyTheme.js). Each v2/v3 input back-fills the
 * v1 paths the preview's data-token attributes already target. The preview
 * was built against v1 paths; rather than rewrite every data-token, we
 * project v2 and v3 → v1 here so any input shape drives the preview.
 *
 * For v3, each section's input maps to the closest v1 path that the preview
 * already renders. Where the preview doesn't have a dedicated visual for a
 * granular role (e.g. button-primary-bg-hover, sidebar-selected-text), the
 * input is omitted from this map and only takes effect on the live UI via
 * the surgical CSS overrides in overrides.css.
 */
const V2_TO_V1_FALLBACK: Record<string, string[]> = {
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
  // v3 — buttons (preview shows Primary + Secondary buttons)
  'button-primary-bg-default': ['primary.main'],
  'button-primary-text': ['primary.dark'],
  'button-secondary-bg-default': ['grey.bg'],
  'button-secondary-text': ['primary.dark'],
  'button-tertiary-text': ['link.normal'],
  // v3 — inputs (preview has a disabled input)
  'input-bg': ['grey.bg'],
  'input-border-default': ['input-border'],
  'input-text': ['text.primary'],
  'input-placeholder': ['text.muted'],
  // v3 — header / sidebar (preview shows both)
  'header-bg': ['digitv2.header-sidenav'],
  'header-text': ['secondary'],
  'sidebar-bg': ['digitv2.header-sidenav'],
  'sidebar-selected-bg': ['primary.selected-bg'],
  'sidebar-selected-text': ['primary.main'],
  // v3 — status (preview shows alerts)
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

/** Apply v2 → v1 fan-out so the preview reads consistent values whether the
 *  admin is entering v1 (legacy) or v2 (semantic) keys. v2 wins on overlap.
 *  Mirrors applyTheme.js's two-pass behavior. */
function expandV2(flat: Record<string, string>): Record<string, string> {
  const out = { ...flat };
  for (const [v2Key, v1Paths] of Object.entries(V2_TO_V1_FALLBACK)) {
    const value = flat[v2Key];
    if (typeof value === 'string' && value) {
      for (const v1Path of v1Paths) out[v1Path] = value;
    }
  }
  return out;
}

/** Token helper: read `colors.<path>` with a safe default for empty cells. */
function tk(flat: Record<string, string>, path: string, fallback: string): string {
  return flat[path] || fallback;
}

/**
 * Mini-DIGIT preview: header + sidenav + card with heading, body, link,
 * buttons, 5-series bar chart, mini table, info/error/success alerts,
 * disabled input and disabled button. Every visual element carries
 * `data-token="colors.foo.bar"` (space-separated when multiple tokens
 * apply) so the hover highlight can light it up when the matching field
 * in the form is hovered.
 *
 * The component subscribes to `colors.*` via useWatch — a single watcher
 * at the preview root — so form-level keystrokes on individual ColorInputs
 * don't re-render the form, only this widget.
 */
export function ThemePreview() {
  const colors = useWatch({ name: 'colors' });
  const hover = useHoverContext();

  // First flatten the form record, then fan v2 semantic keys into the v1
  // paths the preview was originally built against. Either entry shape now
  // drives the preview consistently.
  const flat = useMemo(() => expandV2(flatten(colors)), [colors]);

  // Chart bars — heights are hard-coded; colors come from chart-1..5.
  const chart = [
    { h: 72, token: 'colors.digitv2.chart-1' },
    { h: 48, token: 'colors.digitv2.chart-2' },
    { h: 92, token: 'colors.digitv2.chart-3' },
    { h: 36, token: 'colors.digitv2.chart-4' },
    { h: 60, token: 'colors.digitv2.chart-5' },
  ];

  const root: CSSProperties = {
    backgroundColor: tk(flat, 'grey.light', '#F5F5F5'),
    color: tk(flat, 'text.primary', '#0B0C0C'),
    borderColor: tk(flat, 'border', '#D6D5D4'),
  };

  return (
    <div
      ref={hover?.previewRootRef}
      className="theme-preview rounded-md border overflow-hidden text-xs select-none"
      style={root}
      data-token="colors.grey.light colors.text.primary colors.border"
    >
      <style>{`
        .theme-preview .${'theme-token-hover'} {
          outline: 2px solid #1e90ff;
          outline-offset: 1px;
          border-radius: 2px;
          transition: outline 0.08s ease-out;
        }
      `}</style>

      {/* Header bar */}
      <div
        className="h-9 flex items-center px-3 gap-3"
        style={{ backgroundColor: tk(flat, 'digitv2.header-sidenav', '#006B3F'), color: '#FFF' }}
        data-token="colors.digitv2.header-sidenav"
      >
        <span className="font-bold">DIGIT</span>
        <span className="text-[11px] opacity-80">Dashboard</span>
        <div className="ml-auto flex gap-2 opacity-80">
          <span>[user]</span>
          <span>*</span>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div
          className="w-20 py-2 space-y-0.5"
          style={{ backgroundColor: tk(flat, 'digitv2.header-sidenav', '#006B3F') }}
          data-token="colors.digitv2.header-sidenav"
        >
          <div className="px-2 py-1 text-[10px]" style={{ color: tk(flat, 'secondary', '#FFF') }} data-token="colors.secondary">
            Menu
          </div>
          <div
            className="mx-1 px-2 py-1 text-[10px] rounded"
            style={{ backgroundColor: tk(flat, 'primary.selected-bg', '#E6F2EC'), color: tk(flat, 'primary.main', '#006B3F') }}
            data-token="colors.primary.selected-bg colors.primary.main"
          >
            Home
          </div>
          <div className="px-3 py-1 text-[10px] opacity-80" style={{ color: '#FFF' }}>Reports</div>
          <div className="px-3 py-1 text-[10px] opacity-80" style={{ color: '#FFF' }}>Forms</div>
        </div>

        {/* Main content */}
        <div className="flex-1 p-2.5 space-y-2">
          <div
            className="font-bold text-sm"
            style={{ color: tk(flat, 'text.heading', '#1A1A2E') }}
            data-token="colors.text.heading"
          >
            Dashboard
          </div>
          <div
            className="text-[10px]"
            style={{ color: tk(flat, 'text.muted', '#6B7280') }}
            data-token="colors.text.muted"
          >
            Overview of recent activity
          </div>

          {/* Card */}
          <div
            className="rounded border p-2 space-y-1.5"
            style={{
              backgroundColor: tk(flat, 'grey.bg', '#FFFFFF'),
              borderColor: tk(flat, 'border', '#D6D5D4'),
            }}
            data-token="colors.grey.bg colors.border"
          >
            <div style={{ color: tk(flat, 'text.heading', '#1A1A2E') }} data-token="colors.text.heading" className="font-semibold text-[11px]">
              Card title
            </div>
            <p style={{ color: tk(flat, 'text.secondary', '#505A5F') }} data-token="colors.text.secondary" className="text-[10px] leading-tight">
              Body paragraph with a{' '}
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                style={{ color: tk(flat, 'link.normal', '#006B3F') }}
                data-token="colors.link.normal colors.link.hover"
                className="underline hover:opacity-75"
              >
                link
              </a>{' '}
              here.
            </p>

            {/* Buttons */}
            <div className="flex gap-1.5">
              <button
                type="button"
                className="text-[10px] font-medium px-2 py-1 rounded text-white"
                style={{ backgroundColor: tk(flat, 'primary.main', '#006B3F') }}
                data-token="colors.primary.main colors.primary.dark"
              >
                Primary
              </button>
              <button
                type="button"
                className="text-[10px] font-medium px-2 py-1 rounded text-white"
                style={{ backgroundColor: tk(flat, 'primary.accent', '#BB0000') }}
                data-token="colors.primary.accent"
              >
                Secondary
              </button>
            </div>

            {/* Chart */}
            <div
              className="flex items-end gap-1 h-16 pt-1 border-t"
              style={{ borderColor: tk(flat, 'grey.mid', '#EEEEEE') }}
              data-token="colors.grey.mid"
            >
              {chart.map((b) => (
                <div
                  key={b.token}
                  className="flex-1 rounded-t"
                  style={{ height: `${b.h}%`, backgroundColor: tk(flat, b.token.replace('colors.', ''), '#888') }}
                  data-token={b.token}
                />
              ))}
            </div>

            {/* Table */}
            <div className="space-y-0">
              <div
                className="text-[9px] uppercase tracking-wide px-1 py-0.5"
                style={{ color: tk(flat, 'text.muted', '#6B7280') }}
                data-token="colors.text.muted"
              >
                Row
              </div>
              <div
                className="text-[10px] px-1 py-0.5 border-t"
                style={{ borderColor: tk(flat, 'border', '#D6D5D4'), backgroundColor: tk(flat, 'grey.lighter', '#F0F0F0') }}
                data-token="colors.grey.lighter colors.border"
              >
                Row A
              </div>
              <div
                className="text-[10px] px-1 py-0.5 border-t"
                style={{
                  borderColor: tk(flat, 'border', '#D6D5D4'),
                  backgroundColor: tk(flat, 'digitv2.primary-bg', '#E6F2EC'),
                  color: tk(flat, 'primary.main', '#006B3F'),
                }}
                data-token="colors.digitv2.primary-bg colors.primary.light"
              >
                Row B (selected)
              </div>
              <div
                className="text-[10px] px-1 py-0.5 border-t"
                style={{ borderColor: tk(flat, 'border', '#D6D5D4') }}
                data-token="colors.border"
              >
                Row C
              </div>
            </div>
          </div>

          {/* Alerts */}
          <div className="space-y-1">
            <div
              className="px-2 py-1 text-[10px] rounded border-l-2"
              style={{
                backgroundColor: tk(flat, 'digitv2.alert-info-bg', '#C7E0F1'),
                borderLeftColor: tk(flat, 'digitv2.alert-info', '#3498DB'),
                color: tk(flat, 'info-dark', '#0057BD'),
              }}
              data-token="colors.digitv2.alert-info-bg colors.digitv2.alert-info colors.info-dark"
            >
              i  Info alert
            </div>
            <div
              className="px-2 py-1 text-[10px] rounded border-l-2"
              style={{
                backgroundColor: tk(flat, 'digitv2.alert-error-bg', '#F5CCCC'),
                borderLeftColor: tk(flat, 'error', '#BB0000'),
                color: tk(flat, 'error-dark', '#8B0000'),
              }}
              data-token="colors.digitv2.alert-error-bg colors.error colors.error-dark"
            >
              !  Error alert
            </div>
            <div
              className="px-2 py-1 text-[10px] rounded border-l-2"
              style={{
                backgroundColor: tk(flat, 'digitv2.alert-success-bg', '#BAD6C9'),
                borderLeftColor: tk(flat, 'success', '#006B3F'),
                color: tk(flat, 'success', '#006B3F'),
              }}
              data-token="colors.digitv2.alert-success-bg colors.success"
            >
              ✓  Success alert
            </div>
            <div
              className="px-2 py-1 text-[10px] rounded"
              style={{
                backgroundColor: tk(flat, 'digitv2.alert-info-bg', '#FFF3CD'),
                color: tk(flat, 'warning-dark', '#9E5F00'),
              }}
              data-token="colors.warning-dark"
            >
              ⚠  Warning badge
            </div>
          </div>

          {/* Disabled input + button */}
          <div className="flex gap-1.5 items-center">
            <input
              type="text"
              disabled
              placeholder="Disabled input"
              className="flex-1 text-[10px] px-2 py-1 rounded border"
              style={{
                borderColor: tk(flat, 'input-border', '#464646'),
                color: tk(flat, 'digitv2.text-color-disabled', '#B1B4B6'),
              }}
              data-token="colors.input-border colors.digitv2.text-color-disabled"
            />
            <button
              type="button"
              disabled
              className="text-[10px] font-medium px-2 py-1 rounded"
              style={{
                backgroundColor: tk(flat, 'grey.disabled', '#C5C5C5'),
                color: tk(flat, 'digitv2.text-color-disabled', '#FFF'),
              }}
              data-token="colors.grey.disabled colors.digitv2.text-color-disabled"
            >
              Disabled
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
