/**
 * Home dashboard. Surfaces overall test-suite health: the latest run's
 * headline numbers and per-area / per-persona pass rates, the run trend for
 * the five runs of the shared run window (RunPager), and the worst-offender
 * tests across every run the catalog keeps (up to 30). Driven entirely by the
 * already-fetched catalog.json — no extra API calls.
 */
import { useGetList } from 'react-admin';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';
import type { CatalogTest, RunSummary, TestStatus } from './types';
import { RunPager, useRunWindow } from './RunPager';
import { hasReport, summarize } from './runWindow';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function relTime(iso: string): string {
  if (!iso) return '';
  const dt = (Date.now() - new Date(iso).getTime()) / 1000;
  if (dt < 60) return `${Math.round(dt)}s ago`;
  if (dt < 3600) return `${Math.round(dt/60)}m ago`;
  if (dt < 86400) return `${Math.round(dt/3600)}h ago`;
  return `${Math.round(dt/86400)}d ago`;
}

const STATUS_COLOR: Record<TestStatus | 'never', string> = {
  passed: '#2ea043',
  failed: '#f85149',
  timedOut: '#f85149',
  interrupted: '#f85149',
  skipped: '#d29922',
  never: '#484f58',
};

/** A summary recorded before not-run tracking: its counts may include carried-over results. */
const isLegacyCount = (r: RunSummary) => typeof r.notRun !== 'number';
const LEGACY_NOTE = 'Legacy count: recorded before not-run tracking, so it may include results carried over from older runs.';

/**
 * Header strip with one summary stat tile per metric.
 */
function StatTile({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.08em' }}>
          {label}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, color: color ?? 'text.primary', mt: 0.5, mb: 0.5 }}>
          {value}
        </Typography>
        {sub && (
          <Typography variant="caption" color="text.secondary">
            {sub}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Horizontal bar showing a test pass rate by group (e.g. by area, by persona).
 */
function GroupedPassRate({
  title,
  groups,
}: {
  title: string;
  groups: Array<{ key: string; passed: number; failed: number; skipped: number; notRun: number; total: number }>;
}) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: '0.08em' }}>
          {title}
        </Typography>
        <Stack spacing={1.25}>
          {groups.length === 0 && (
            <Typography variant="body2" color="text.secondary">No data.</Typography>
          )}
          {groups.map(g => {
            const passPct = g.total > 0 ? (g.passed / g.total) * 100 : 0;
            return (
              <Box key={g.key}>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{g.key}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {g.passed}/{g.total} pass · {g.failed} fail · {g.skipped} skip
                    {g.notRun > 0 && ` · ${g.notRun} not run`}
                  </Typography>
                </Stack>
                {/* Not-run is the unfilled remainder of the track. */}
                <Box sx={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: 'action.hover' }}>
                  <Box sx={{ width: `${passPct}%`, bgcolor: STATUS_COLOR.passed }} />
                  <Box sx={{ width: `${g.total > 0 ? (g.failed / g.total) * 100 : 0}%`, bgcolor: STATUS_COLOR.failed }} />
                  <Box sx={{ width: `${g.total > 0 ? (g.skipped / g.total) * 100 : 0}%`, bgcolor: STATUS_COLOR.skipped }} />
                </Box>
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * Run-by-run pass/fail/skip stacked bars for the five runs of the shared run
 * window, newest first like every other run row in the dashboard; page with
 * Newer/Older.
 */
function RunTrend() {
  const { win } = useRunWindow();
  const runs = win.items;
  if (runs.length === 0) {
    return (
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Typography variant="body2" color="text.secondary">No runs yet.</Typography>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.08em' }}>
            Run trend · {win.label} · newest first
          </Typography>
          <RunPager />
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="flex-end" sx={{ height: 172, mt: 0.5 }}>
          {runs.map(r => {
            const total = Math.max(r.total, 1);
            const passH = (r.passed / total) * 130;
            const failH = (r.failed / total) * 130;
            const skipH = (r.skipped / total) * 130;
            const legacy = isLegacyCount(r);
            // The unfilled top of the bar is "not run"; say so in the tooltip.
            const barTitle = legacy
              ? LEGACY_NOTE
              : r.notRun
                ? `${r.notRun} of ${r.total} not run${r.cutShort ? ` — cut short: ${r.cutShort}` : ''}`
                : undefined;
            return (
              <Box key={r.id} sx={{ flex: 1, textAlign: 'center', minWidth: 60 }}>
                <Box title={barTitle} sx={{ height: 130, display: 'flex', flexDirection: 'column-reverse', borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover', opacity: legacy ? 0.45 : 1 }}>
                  <Box sx={{ height: passH, bgcolor: STATUS_COLOR.passed }} title={`${r.passed} passed`} />
                  <Box sx={{ height: failH, bgcolor: STATUS_COLOR.failed }} title={`${r.failed} failed`} />
                  <Box sx={{ height: skipH, bgcolor: STATUS_COLOR.skipped }} title={`${r.skipped} skipped`} />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10 }}>
                  {r.id.split('_').slice(0, 2).join(' ')}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 10 }}>
                  {r.passed}/{r.total}
                </Typography>
                {!!r.notRun && (
                  <Typography variant="caption" sx={{ display: 'block', fontSize: 10, color: r.cutShort ? STATUS_COLOR.failed : 'text.secondary' }}>
                    {r.notRun} not run{r.cutShort ? ' ⚠' : ''}
                  </Typography>
                )}
                {legacy && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 10, fontStyle: 'italic' }}>
                    legacy count
                  </Typography>
                )}
                {!hasReport(r) && (
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    sx={{ display: 'block', fontSize: 10, cursor: 'help' }}
                    title="This run's report, videos and traces were pruned; its counts are all that is left."
                  >
                    report pruned
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * Per-tag-facet aggregator: for the latest run, group tests by their
 * facet-value tags and count pass/fail/skip per group. A test that did not run
 * in the latest run counts as not run, never as its older carried-over result.
 */
function aggregateByFacet(tests: CatalogTest[], facet: string) {
  const groups = new Map<string, { passed: number; failed: number; skipped: number; notRun: number; total: number }>();
  for (const t of tests) {
    // Same rule as the builder's run total: only a config-excluded @local-only
    // test (no verdict, filtered out by playwright.config) is left out; every
    // other test without a verdict in the latest run counts as not run.
    if (!t.ranInLatestRun && (t.tags || []).includes('@local-only')) continue;
    const status = t.currentStatus; // derived in dataProvider: the latest run's outcome
    const values = new Set<string>();
    for (const tag of t.tags) {
      const m = tag.match(/^@([a-z]+):(.+)$/i);
      if (m && m[1] === facet) values.add(m[2]);
    }
    if (values.size === 0) values.add('—');
    for (const v of values) {
      const g = groups.get(v) ?? { passed: 0, failed: 0, skipped: 0, notRun: 0, total: 0 };
      g.total++;
      if (status === 'passed') g.passed++;
      else if (status === 'skipped') g.skipped++;
      else if (status === 'failed' || status === 'timedOut') g.failed++;
      else g.notRun++;
      groups.set(v, g);
    }
  }
  return Array.from(groups.entries())
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Tests that have been red the most often across every run the catalog keeps
 * (catalog.runs, up to 30 — deliberately not the five-run page: a flake needs
 * the long window to show). `ran` counts the runs that reached the test.
 * Surfaces flake/regression candidates.
 */
function topFailers(tests: CatalogTest[]) {
  return tests
    .map(t => {
      const s = summarize(t.runSlots ?? []);
      return { test: t, fails: s.failed, ran: s.runs - s.notRun };
    })
    .filter(x => x.fails >= 1)
    .sort((a, b) => b.fails - a.fails || b.ran - a.ran)
    .slice(0, 8);
}

export default function Dashboard() {
  const { data: tests = [] } = useGetList<CatalogTest>('tests', {
    pagination: { page: 1, perPage: 1000 },
  });
  const { runs } = useRunWindow(); // catalog order, newest first

  const latest = runs[0];
  const passRate = latest && latest.total > 0 ? Math.round((latest.passed / latest.total) * 100) : 0;
  // Compare like with like: an honest count against a legacy one (which may
  // include carried-over passes) would show a drop that isn't real.
  const prior = useMemo(
    () => (latest ? runs.slice(1).find(r => isLegacyCount(r) === isLegacyCount(latest) && r.total > 0) : undefined),
    [runs, latest],
  );
  const trendDelta = useMemo(() => {
    if (!latest?.total || !prior) return null;
    return Math.round((latest.passed / latest.total - prior.passed / prior.total) * 100);
  }, [latest, prior]);

  const byArea = useMemo(() => aggregateByFacet(tests, 'area'), [tests]);
  const byPersona = useMemo(() => aggregateByFacet(tests, 'persona'), [tests]);
  const fails = useMemo(() => topFailers(tests), [tests]);

  return (
    <Box sx={{ p: { xs: 1, sm: 2 }, maxWidth: 1400, mx: 'auto' }}>
      {/* A run that skipped part of the suite must say so up front: the pass
          rate below counts those tests as not passed, and nothing else on the
          page would explain the gap. */}
      {latest && (latest.cutShort || (latest.notRun ?? 0) > 0) && (
        <Alert severity={latest.cutShort ? 'error' : 'warning'} sx={{ mb: 2 }}>
          {latest.cutShort ? `Latest run was cut short (${latest.cutShort}). ` : ''}
          {latest.notRun ?? 0} of {latest.total} tests did not run, so they count as not passed.
        </Alert>
      )}
      {/* Hero stats */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Latest run"
            value={`${passRate}%`}
            sub={latest
              ? `${latest.passed} passed of ${latest.total}${latest.notRun ? ` · ${latest.notRun} not run` : ''} · ${relTime(latest.startedAt)}`
              : 'no runs yet'}
            color={passRate > 80 ? STATUS_COLOR.passed : passRate > 50 ? STATUS_COLOR.skipped : STATUS_COLOR.failed}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Trend vs prior run"
            value={trendDelta == null ? '—' : `${trendDelta > 0 ? '+' : ''}${trendDelta}%`}
            sub={prior
              ? `was ${Math.round((prior.passed / Math.max(prior.total, 1)) * 100)}% on ${prior.id.split('_').slice(0,2).join(' ')}`
              : runs.length >= 2 ? 'no comparable prior run (older ones are legacy counts)' : 'first run'}
            color={trendDelta == null ? undefined : trendDelta >= 0 ? STATUS_COLOR.passed : STATUS_COLOR.failed}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Tests in suite"
            value={tests.length}
            sub={`${tests.filter(t => t.tags.some(tg => tg.startsWith('@layer:ui'))).length} UI · ${tests.filter(t => t.tags.some(tg => tg.startsWith('@layer:api'))).length} API`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Last run duration"
            value={latest ? formatDuration(latest.durationMs) : '—'}
            sub={latest ? `${latest.branch}@${latest.sha}` : ''}
          />
        </Grid>
      </Grid>

      {/* Run trend */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={12}>
          <RunTrend />
        </Grid>
      </Grid>

      {/* Per-area + per-persona pass rates */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <GroupedPassRate title="Pass rate by area (latest run)" groups={byArea} />
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <GroupedPassRate title="Pass rate by persona (latest run)" groups={byPersona} />
        </Grid>
      </Grid>

      {/* Top failers */}
      <Grid container spacing={2}>
        <Grid size={12}>
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: '0.08em' }}>
                Top failing tests (last {runs.length || 0} runs, all the dashboard keeps)
              </Typography>
              {fails.length === 0 && (
                <Typography variant="body2" color="text.secondary">All green — no failing tests in the last {runs.length} runs.</Typography>
              )}
              {fails.map(({ test, fails, ran }, i) => (
                <Box key={test.id}>
                  {i > 0 && <Divider />}
                  <Stack direction="row" spacing={2} alignItems="center" sx={{ py: 1 }}>
                    <Chip
                      label={`${fails}/${ran}`}
                      title={`Failed in ${fails} of the ${ran} runs (of the last ${runs.length}) that reached it`}
                      size="small"
                      sx={{ bgcolor: STATUS_COLOR.failed, color: '#fff', minWidth: 56 }}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {test.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                        {test.file}:{test.line}
                      </Typography>
                    </Box>
                    <MuiLink
                      href={`#/tests/${encodeURIComponent(test.id)}/show`}
                      variant="caption"
                      sx={{ flexShrink: 0 }}
                    >
                      Open
                    </MuiLink>
                  </Stack>
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

// silence unused-import lint when LinearProgress isn't used.
void LinearProgress;
