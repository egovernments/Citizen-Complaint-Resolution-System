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
import { Alert, Box, Card, CardContent, Chip, Divider, Grid, Link as MuiLink, Stack, Typography } from '@mui/material';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));
import type { CatalogTest, RunSlot, TestStatus } from '../types';
import { PAGE_SIZE, hasReport, reportsKept, summarize, windowOf } from '../runWindow';
import { RunPager, useRunWindow } from '../RunPager';
import { reportUrl, rootedUrl } from '../urls';

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
  // currentStatus (derived in dataProvider) is the LATEST run's outcome; a test
  // that run didn't reach is "not run", never its older carried-over result.
  const current = r?.currentStatus ?? 'never';
  if (r && current === 'notrun') {
    const last = r.lastStatus ?? r.history[0]?.status;
    const from = r.latestRun?.runId ?? r.history[0]?.runId;
    return (
      <Chip
        size="small"
        label="not run"
        variant="outlined"
        title={`Not run in the latest run · last: ${last}${from ? ` in ${from}` : ''}`}
      />
    );
  }
  const status = current as TestStatus | 'never';
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
 * Sparkline of this test's outcomes in the five runs of the current run
 * window (RunPager). Mirrors the vanilla dashboard's dot row:
 * green=passed, red=failed/timedOut, amber=skipped, ring=not run,
 * dashed=no run (short last page). Hover any dot for the run-id + duration.
 */
const HISTORY_COLOR: Record<string, string> = {
  passed: '#2ea043',
  failed: '#f85149',
  timedOut: '#f85149',
  interrupted: '#f85149',
  skipped: '#d29922',
};
function HistoryDots() {
  const r = useRecordContext<CatalogTest>();
  const { win } = useRunWindow();
  if (!r) return null;
  // One slot per run in the window (newest first; aligned once in dataProvider),
  // so a dot means the same run on every row; a run this test produced no
  // verdict in renders as a hollow "not run" ring instead of older results
  // sliding left into its slot.
  const page = windowOf(r.runSlots ?? [], win.page).items;
  const slots: Array<RunSlot | null> = Array.from({ length: PAGE_SIZE }, (_, i) => page[i] ?? null);
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {slots.map((h, i) => {
        if (h && 'notRun' in h) {
          return (
            <Box
              key={i}
              title={`${h.runId} · not run`}
              sx={{
                width: 8, height: 8, borderRadius: '50%',
                border: '1px solid', borderColor: 'text.secondary',
                cursor: 'help',
              }}
            />
          );
        }
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
  // A carried-over duration belongs to an older run; don't show it as this run's.
  if (r.lastDurationMs == null || r.ranInLatestRun === false) return <Typography variant="caption" color="text.secondary">—</Typography>;
  const ms = r.lastDurationMs;
  const text = ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms/1000).toFixed(1)}s` : `${Math.floor(ms/60_000)}m ${Math.round((ms%60_000)/1000)}s`;
  return <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>{text}</Typography>;
}

const ListActions = () => (
  <TopToolbar sx={{ alignItems: 'center' }}>
    <RunPager />
    <FilterButton />
  </TopToolbar>
);

/** Column header for the dots: which runs of the window they show. */
function RunsColumnLabel() {
  const { win } = useRunWindow();
  return <span title={`One dot per run, newest first: ${win.label}`}>{win.total ? `Runs ${win.first}–${win.last}` : 'Runs'}</span>;
}

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
        '& .column-currentStatus': { width: '8%' },
        '& .column-duration': { width: '8%' },
      }}
    >
      <FunctionField label="Title" source="title" render={() => <TitleCell />} />
      <FunctionField label="File" source="file" render={() => <FileCell />} />
      <FunctionField label="Tags" source="tags" render={() => <TagsCell />} />
      <FunctionField label={<RunsColumnLabel />} source="history" sortable={false} render={() => <HistoryDots />} />
      {/* Sorts on the latest run's status, not the carried-over lastStatus. */}
      <FunctionField label="Status" source="currentStatus" render={() => <StatusBadge />} />
      <FunctionField label="Duration" source="duration" render={() => <DurationCell />} />
    </Datagrid>
  </List>
);

// ---------------------------------------------------------------------------
// Show: description, video, source.
// ---------------------------------------------------------------------------

/** Strip ANSI color/style escape sequences so terminal output renders cleanly. */
function stripAnsi(s: string): string {
  // Match either real ESC (0x1b) or the literal "[" wrapped form Playwright
  // sometimes emits: e.g. '[2m...[22m', '[31m...[39m'. The capture range
  // covers SGR codes + their bracketed pseudo-form.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '').replace(/\[\d{1,3}(?:;\d{1,3})*m/g, '');
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
 * Tabular run history for the five runs of the current run window. Each row:
 * status (or "not run"), run-id, duration, a link to that run's stock
 * Playwright report while it still has one ("report pruned" after), and the
 * video/trace for the run whose media is kept. Below: the test's record across
 * every run the catalog keeps.
 */
function RunHistoryBlock() {
  const r = useRecordContext<CatalogTest>();
  const { runs, win } = useRunWindow();
  if (!r || !runs.length) {
    return <Typography variant="body2" color="text.secondary">No runs recorded yet.</Typography>;
  }
  const byId = new Map(runs.map(run => [run.id, run]));
  const slots = windowOf(r.runSlots ?? [], win.page).items;
  const recent = summarize(r.runSlots ?? []);
  const kept = reportsKept(runs);
  return (
    <Box>
      {slots.map((slot, i) => {
        const run = byId.get(slot.runId);
        const withReport = hasReport(run);
        const h = 'notRun' in slot ? null : slot;
        const dur = !h ? '—' : h.durationMs < 1000 ? `${Math.round(h.durationMs)}ms` : `${(h.durationMs/1000).toFixed(1)}s`;
        // latestRun is the run whose media is kept — the latest run only when
        // the test ran in it; otherwise it is the carried-over last result.
        const hasMedia = !!h && withReport && r.latestRun?.runId === slot.runId;
        const isLatest = hasMedia && !!r.ranInLatestRun;
        return (
          <Box
            key={i}
            sx={{
              display: 'grid',
              gridTemplateColumns: '90px minmax(220px, 1fr) 70px 150px',
              alignItems: 'center',
              gap: 1.5,
              py: 0.75,
              borderTop: i === 0 ? 'none' : '1px solid',
              borderColor: 'divider',
            }}
          >
            {h
              ? <Chip size="small" label={h.status} color={STATUS_COLORS[h.status] ?? 'default'} sx={{ width: 80 }} />
              : <Chip size="small" label="not run" variant="outlined" sx={{ width: 80 }} title="No result in this run" />}
            <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {slot.runId}
              {isLatest && <Typography component="span" variant="caption" color="primary.main" sx={{ ml: 1 }}>★ latest</Typography>}
              {hasMedia && !isLatest && <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>last result</Typography>}
            </Typography>
            <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
              {dur}
            </Typography>
            <Stack direction="row" spacing={1.5}>
              {withReport
                ? <MuiLink href={reportUrl(slot.runId)} target="_blank" rel="noopener" variant="caption">Report</MuiLink>
                : (
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    title={`Only the newest ${kept} runs keep their report, video and traces; this run's results are all that is left.`}
                    sx={{ cursor: 'help' }}
                  >
                    report pruned
                  </Typography>
                )}
              {hasMedia && r.latestRun?.videoUrl && (
                <MuiLink href={rootedUrl(r.latestRun.videoUrl)} target="_blank" rel="noopener" variant="caption">Video</MuiLink>
              )}
              {hasMedia && r.latestRun?.traceUrl && (
                <MuiLink href={rootedUrl(r.latestRun.traceUrl)} target="_blank" rel="noopener" variant="caption">Trace</MuiLink>
              )}
            </Stack>
          </Box>
        );
      })}
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 1, cursor: 'help' }}
        title={`Across all ${recent.runs} runs the dashboard keeps, not only the five shown`}
      >
        Last {recent.runs} runs: {recent.passed} passed · {recent.failed} failed
        {recent.skipped > 0 && ` · ${recent.skipped} skipped`}
        {recent.notRun > 0 && ` · ${recent.notRun} not run`}
      </Typography>
    </Box>
  );
}

/**
 * Compact section heading: small uppercase label + thin divider, used to
 * give the show page consistent visual hierarchy across cards.
 */
function SectionHeader({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} useFlexGap flexWrap="wrap">
        <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '0.08em', fontWeight: 600 }}>
          {children}
        </Typography>
        {action}
      </Stack>
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
  const { runs, win } = useRunWindow();
  if (!r) return null;
  return (
    <Box sx={{ p: { xs: 1, sm: 2 }, maxWidth: 1400, mx: 'auto' }}>
      <HeaderCard />

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <SectionHeader>{r.ranInLatestRun ? 'Latest run · video' : 'Last result · video'}</SectionHeader>
              {/* Same note as v1: a test the latest run didn't reach must not
                  present an older run's video and error as current. */}
              {!r.ranInLatestRun && r.currentStatus === 'notrun' && (
                <Alert severity="warning" sx={{ mb: 1.5 }}>
                  {r.latestRun
                    ? `Not run in the latest run. The video and error below are from ${r.latestRun.runId}, the last run that reached it (${r.lastStatus ?? r.history[0]?.status}).`
                    : `Not run in the latest run. Its last result was ${r.history[0]?.status} in ${r.history[0]?.runId}; that run's report has been pruned (only the newest ${reportsKept(runs)} runs keep one), so no video or error is kept for it.`}
                </Alert>
              )}
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
              <SectionHeader action={<RunPager />}>
                {win.total ? `Run history · runs ${win.first}–${win.last} of ${win.total}` : 'Run history'}
              </SectionHeader>
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
