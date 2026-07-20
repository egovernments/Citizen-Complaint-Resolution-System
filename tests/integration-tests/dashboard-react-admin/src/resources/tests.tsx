import {
  List,
  Datagrid,
  FunctionField,
  Show,
  TextInput,
  SelectArrayInput,
  TopToolbar,
  FilterButton,
  useRecordContext,
  useGetList,
} from 'react-admin';
import { Suspense, lazy, useMemo } from 'react';
import { Box, Card, CardContent, Chip, Divider, Grid, Link as MuiLink, Stack, Typography } from '@mui/material';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));
import type { CatalogTest, TestStatus } from '../types';

// ---------------------------------------------------------------------------
// Filters: every facet always-on alongside search; no "Add filter" dropdown.
// ---------------------------------------------------------------------------

/**
 * Choices for SelectArrayInput, derived live from the catalog. We compute
 * them once at module level as a Promise — since the dataProvider caches
 * the catalog after the first fetch, react-admin's first useGetList call
 * fills the choices on subsequent renders.
 */
function FacetChoices(facet: string) {
  const { data } = useGetList<CatalogTest>('tests', {
    pagination: { page: 1, perPage: 1000 },
  });
  return useMemo(() => {
    const seen = new Set<string>();
    for (const t of data ?? []) {
      for (const tag of t.tags) {
        const m = tag.match(/^@([a-z]+):(.+)$/i);
        if (m && m[1] === facet) seen.add(m[2]);
      }
    }
    return Array.from(seen).sort().map(v => ({ id: `@${facet}:${v}`, name: v }));
  }, [data, facet]);
}

// react-admin reads `alwaysOn` from the outer JSX element in the filter
// array. Keeping each facet input as a top-level <SelectArrayInput> in
// the array (no wrapper component) makes alwaysOn visible to the List.
type FilterPassthrough = { alwaysOn?: boolean };

function PersonaFilter(props: FilterPassthrough) {
  return <SelectArrayInput source="tags_any_persona" label="Persona" choices={FacetChoices('persona')} sx={{ minWidth: 160 }} {...props} />;
}
function AreaFilter(props: FilterPassthrough) {
  return <SelectArrayInput source="tags_any_area" label="Area" choices={FacetChoices('area')} sx={{ minWidth: 180 }} {...props} />;
}
function LayerFilter(props: FilterPassthrough) {
  return <SelectArrayInput source="tags_any_layer" label="Layer" choices={FacetChoices('layer')} sx={{ minWidth: 140 }} {...props} />;
}
function KindFilter(props: FilterPassthrough) {
  return <SelectArrayInput source="tags_any_kind" label="Kind" choices={FacetChoices('kind')} sx={{ minWidth: 160 }} {...props} />;
}

const TestFilters = [
  <TextInput key="q" source="q" label="Search title or file" alwaysOn resettable sx={{ minWidth: 220 }} />,
  <PersonaFilter key="persona" alwaysOn />,
  <AreaFilter key="area" alwaysOn />,
  <LayerFilter key="layer" alwaysOn />,
  <KindFilter key="kind" alwaysOn />,
];

// ---------------------------------------------------------------------------
// Cell renderers: chips for tags, colored badge for status, monospace path.
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<TestStatus | 'never', 'success' | 'error' | 'warning' | 'default'> = {
  passed: 'success',
  failed: 'error',
  timedOut: 'error',
  interrupted: 'error',
  skipped: 'warning',
  never: 'default',
};

function StatusBadge() {
  const r = useRecordContext<CatalogTest>();
  const status = (r?.lastStatus ?? 'never') as TestStatus | 'never';
  return (
    <Chip
      size="small"
      label={status}
      color={STATUS_COLORS[status] ?? 'default'}
      variant={status === 'never' ? 'outlined' : 'filled'}
    />
  );
}

const FACET_CHIP_COLOR: Record<string, 'primary' | 'secondary' | 'info' | 'default' | 'warning' | 'success'> = {
  persona: 'primary',
  area: 'info',
  layer: 'default',
  kind: 'secondary',
  ccrs: 'warning',
  pr: 'warning',
  health: 'success',
};

function TagsCell() {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  const visible = r.tags.slice(0, 6);
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {visible.map(t => {
        const m = t.match(/^@([a-z]+):(.+)$/i);
        const facet = m?.[1] ?? 'other';
        const value = m?.[2] ?? t;
        return (
          <Chip
            key={t}
            size="small"
            label={value}
            color={FACET_CHIP_COLOR[facet] ?? 'default'}
            variant="outlined"
            sx={{ height: 20, fontSize: 11 }}
          />
        );
      })}
      {r.tags.length > visible.length && (
        <Typography variant="caption" color="text.secondary">+{r.tags.length - visible.length}</Typography>
      )}
    </Stack>
  );
}

function FileCell() {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  return (
    <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'text.secondary' }}>
      {r.file}:{r.line}
    </Typography>
  );
}

function TitleCell() {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.3 }}>{r.title}</Typography>
      {r.describe && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
          {r.describe}
        </Typography>
      )}
    </Box>
  );
}

/**
 * Sparkline of the last 5 run outcomes for this test. Mirrors the vanilla
 * dashboard's dot row: green=passed, red=failed/timedOut, amber=skipped,
 * outlined=no entry. Hover any dot for the run-id + duration.
 */
const HISTORY_SLOTS = 5;
const HISTORY_COLOR: Record<string, string> = {
  passed: '#2ea043',
  failed: '#f85149',
  timedOut: '#f85149',
  interrupted: '#f85149',
  skipped: '#d29922',
};
function HistoryDots() {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  const slots = Array.from({ length: HISTORY_SLOTS }, (_, i) => r.history[i] ?? null);
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {slots.map((h, i) => {
        if (!h) {
          return (
            <Box
              key={i}
              sx={{
                width: 8, height: 8, borderRadius: '50%',
                border: '1px dashed', borderColor: 'divider',
              }}
            />
          );
        }
        const color = HISTORY_COLOR[h.status] ?? '#7d8590';
        const tooltip = `${h.runId} · ${h.status} · ${h.durationMs < 1000 ? Math.round(h.durationMs) + 'ms' : (h.durationMs/1000).toFixed(1) + 's'}`;
        return (
          <Box
            key={i}
            title={tooltip}
            sx={{
              width: 10, height: 10, borderRadius: '50%',
              backgroundColor: color,
              cursor: 'help',
            }}
          />
        );
      })}
    </Stack>
  );
}

function DurationCell() {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  if (r.lastDurationMs == null) return <Typography variant="caption" color="text.secondary">—</Typography>;
  const ms = r.lastDurationMs;
  const text = ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms/1000).toFixed(1)}s` : `${Math.floor(ms/60_000)}m ${Math.round((ms%60_000)/1000)}s`;
  return <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>{text}</Typography>;
}

const ListActions = () => (
  <TopToolbar>
    <FilterButton />
  </TopToolbar>
);

export const TestList = () => (
  <List
    filters={TestFilters}
    actions={<ListActions />}
    perPage={50}
    sort={{ field: 'file', order: 'ASC' }}
    sx={{
      '& .RaList-main': { paddingTop: 1 },
      '& .MuiTableCell-head': { fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' },
      '& .MuiTableCell-body': { verticalAlign: 'top', paddingTop: 1, paddingBottom: 1 },
    }}
  >
    <Datagrid
      rowClick="show"
      bulkActionButtons={false}
      sx={{
        '& .column-title': { width: '28%' },
        '& .column-file': { width: '22%' },
        '& .column-tags': { width: '26%' },
        '& .column-history': { width: '8%' },
        '& .column-lastStatus': { width: '8%' },
        '& .column-duration': { width: '8%' },
      }}
    >
      <FunctionField label="Title" source="title" render={() => <TitleCell />} />
      <FunctionField label="File" source="file" render={() => <FileCell />} />
      <FunctionField label="Tags" source="tags" render={() => <TagsCell />} />
      <FunctionField label="Last 5" source="history" render={() => <HistoryDots />} />
      <FunctionField label="Last status" source="lastStatus" render={() => <StatusBadge />} />
      <FunctionField label="Duration" source="duration" render={() => <DurationCell />} />
    </Datagrid>
  </List>
);

// ---------------------------------------------------------------------------
// Show: description, video, source.
// ---------------------------------------------------------------------------

/**
 * The catalog stores attachment URLs relative to the dashboard root (e.g.
 * 'runs/<id>/test-results/.../video.webm'). Browsers resolve such relative
 * URLs against the *current page* URL, which under react-router becomes
 * '/tests-v2/tests/<id>/show' and yields broken paths. Anchor every URL
 * to import.meta.env.BASE_URL so relatives behave like '/tests-v2/runs/...'.
 */
/** Strip ANSI color/style escape sequences so terminal output renders cleanly. */
function stripAnsi(s: string): string {
  // Match either real ESC (0x1b) or the literal "[" wrapped form Playwright
  // sometimes emits: e.g. '[2m...[22m', '[31m...[39m'. The capture range
  // covers SGR codes + their bracketed pseudo-form.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '').replace(/\[\d{1,3}(?:;\d{1,3})*m/g, '');
}

function rootedUrl(rel: string | null | undefined): string | undefined {
  if (!rel) return undefined;
  if (/^https?:\/\//i.test(rel)) return rel;
  if (rel.startsWith('/')) return rel;
  const base = import.meta.env.BASE_URL || '/';
  return `${base}${rel}`.replace(/\/{2,}/g, '/');
}

// VideoBlock was inlined into the show layout's hero card; the standalone
// component was unused after the rewrite.

const DescriptionBlock = () => {
  const r = useRecordContext<CatalogTest>();
  if (!r?.description) return <Typography color="text.secondary" variant="body2">No description.</Typography>;
  // Detect "Steps:" block and render as a numbered list; everything else is paragraphs.
  const blocks = r.description.trim().split(/\n{2,}/);
  return (
    <Box>
      {blocks.map((b, i) => {
        if (/^Steps:\s*$/m.test(b.split('\n')[0])) {
          const items = b.split('\n').slice(1).map(l => l.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean);
          return (
            <Box key={i} mb={1}>
              <Typography variant="overline" color="text.secondary">Steps:</Typography>
              <Box component="ol" sx={{ mt: 0.5, mb: 0, pl: 3 }}>
                {items.map((s, j) => <li key={j}><Typography variant="body2">{s}</Typography></li>)}
              </Box>
            </Box>
          );
        }
        return <Typography key={i} variant="body2" sx={{ mb: 1, lineHeight: 1.55 }}>{b}</Typography>;
      })}
    </Box>
  );
};

/**
 * IDE-style source viewer with Monaco (the editor used by VS Code).
 * Lazy-loaded so the list view doesn't pay for the editor bundle.
 * Read-only, TypeScript syntax, line numbers, code folding, vs-dark theme.
 * The file-name strip on top mimics a tab so it reads as an IDE pane.
 */
const SourceBlock = () => {
  const r = useRecordContext<CatalogTest>();
  if (!r?.source) return null;
  const lineCount = r.source.split('\n').length;
  // Cap height so very long tests scroll inside the editor; min so short
  // tests don't render a tiny strip.
  const height = Math.min(640, Math.max(220, lineCount * 19 + 40));
  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{
        bgcolor: '#1f2428',
        color: '#cdd9e5',
        px: 1.5, py: 0.75,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid',
        borderColor: '#30363d',
      }}>
        <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {r.file}:{r.line}
        </Typography>
        <Typography variant="caption" sx={{ color: '#7d8590' }}>
          TypeScript · read-only
        </Typography>
      </Box>
      <Suspense fallback={
        <Box component="pre" sx={{
          m: 0, p: 1.5, bgcolor: '#0d1117', color: '#e6edf3',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12, height: 220, overflow: 'auto',
        }}>{r.source}</Box>
      }>
        <MonacoEditor
          height={height}
          defaultLanguage="typescript"
          value={r.source}
          theme="vs-dark"
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            lineNumbers: 'on',
            renderLineHighlight: 'none',
            folding: true,
            wordWrap: 'on',
            scrollbar: { vertical: 'auto', horizontal: 'auto' },
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </Suspense>
    </Card>
  );
};

const TagsListShow = () => {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {r.tags.map(t => {
        const m = t.match(/^@([a-z]+):(.+)$/i);
        const facet = m?.[1] ?? 'other';
        const value = m?.[2] ?? t;
        return (
          <Chip key={t} size="small" label={value} color={FACET_CHIP_COLOR[facet] ?? 'default'} variant="outlined" />
        );
      })}
    </Stack>
  );
};

/**
 * Tabular run history. Each row: status, run-id, duration, links to the
 * stock Playwright report + per-attachment for the latest run.
 */
function RunHistoryBlock() {
  const r = useRecordContext<CatalogTest>();
  if (!r || !r.history.length) {
    return <Typography variant="body2" color="text.secondary">No prior runs recorded.</Typography>;
  }
  return (
    <Box>
      {r.history.map((h, i) => {
        const dur = h.durationMs < 1000 ? `${Math.round(h.durationMs)}ms` : `${(h.durationMs/1000).toFixed(1)}s`;
        const reportLink = rootedUrl(`runs/${h.runId}/playwright-report/index.html`);
        const isLatest = r.latestRun?.runId === h.runId;
        return (
          <Box
            key={i}
            sx={{
              display: 'grid',
              gridTemplateColumns: '90px minmax(220px, 1fr) 70px auto',
              alignItems: 'center',
              gap: 1.5,
              py: 0.75,
              borderTop: i === 0 ? 'none' : '1px solid',
              borderColor: 'divider',
            }}
          >
            <Chip size="small" label={h.status} color={STATUS_COLORS[h.status] ?? 'default'} sx={{ width: 80 }} />
            <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {h.runId}
              {isLatest && <Typography component="span" variant="caption" color="primary.main" sx={{ ml: 1 }}>★ latest</Typography>}
            </Typography>
            <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
              {dur}
            </Typography>
            <Stack direction="row" spacing={1.5}>
              <MuiLink href={reportLink} target="_blank" rel="noopener" variant="caption">Report</MuiLink>
              {isLatest && r.latestRun?.videoUrl && (
                <MuiLink href={rootedUrl(r.latestRun.videoUrl)} target="_blank" rel="noopener" variant="caption">Video</MuiLink>
              )}
              {isLatest && r.latestRun?.traceUrl && (
                <MuiLink href={rootedUrl(r.latestRun.traceUrl)} target="_blank" rel="noopener" variant="caption">Trace</MuiLink>
              )}
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Compact section heading: small uppercase label + thin divider, used to
 * give the show page consistent visual hierarchy across cards.
 */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '0.08em', fontWeight: 600 }}>
        {children}
      </Typography>
      <Divider sx={{ mt: 0.25 }} />
    </Box>
  );
}

/**
 * Hero card: title (large), describe + file:line subtitle, status pill,
 * tag chips. This is the first thing the user sees.
 */
function HeaderCard() {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
          <Box sx={{ flex: 1, mr: 2 }}>
            <Typography variant="h5" sx={{ fontWeight: 600, lineHeight: 1.25, mb: 0.5 }}>
              {r.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {r.describe}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'text.secondary' }}>
              {r.file}:{r.line}
            </Typography>
          </Box>
          <StatusBadge />
        </Stack>
        <TagsListShow />
      </CardContent>
    </Card>
  );
}

/**
 * Full show page composed of stacked Cards: header, latest run + history
 * (side by side on wide screens), description, source.
 */
function TestShowLayout() {
  const r = useRecordContext<CatalogTest>();
  if (!r) return null;
  return (
    <Box sx={{ p: { xs: 1, sm: 2 }, maxWidth: 1400, mx: 'auto' }}>
      <HeaderCard />

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <SectionHeader>Latest run · video</SectionHeader>
              {r.latestRun?.videoUrl ? (
                <video
                  src={rootedUrl(r.latestRun.videoUrl)}
                  controls
                  preload="metadata"
                  style={{ width: '100%', maxHeight: 420, background: 'black', borderRadius: 4, display: 'block' }}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No video for the latest run. API tests don't drive a browser, so they only have a trace.
                </Typography>
              )}
              {r.latestRun?.errorMessage && (
                <Box sx={{
                  mt: 1.5, p: 1.5, borderRadius: 1,
                  bgcolor: 'error.light',
                  color: 'error.contrastText',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  maxHeight: 200,
                  overflow: 'auto',
                }}>
                  {stripAnsi(r.latestRun.errorMessage)}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <SectionHeader>Run history (last 5)</SectionHeader>
              <RunHistoryBlock />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <SectionHeader>Description</SectionHeader>
          <DescriptionBlock />
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <Box sx={{ px: 2, pt: 1.5 }}>
            <SectionHeader>Source</SectionHeader>
          </Box>
          <SourceBlock />
        </CardContent>
      </Card>
    </Box>
  );
}

export const TestShow = () => (
  <Show component="div" actions={false}>
    <TestShowLayout />
  </Show>
);
