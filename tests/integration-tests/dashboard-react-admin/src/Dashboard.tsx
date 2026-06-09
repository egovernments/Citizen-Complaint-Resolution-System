/**
 * Home dashboard. Surfaces overall test-suite health across the last N
 * runs in catalog.runs, plus per-area / per-persona pass rates and the
 * worst-offender tests over the rolling window. Driven entirely by the
 * already-fetched catalog.json — no extra API calls.
 */
import { useGetList } from 'react-admin';
import {
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
  groups: Array<{ key: string; passed: number; failed: number; skipped: number; total: number }>;
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
                  </Typography>
                </Stack>
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
 * Run-by-run pass/fail/skip stacked bars across the runs window.
 */
function RunTrend({ runs }: { runs: RunSummary[] }) {
  if (runs.length === 0) {
    return (
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Typography variant="body2" color="text.secondary">No runs yet.</Typography>
        </CardContent>
      </Card>
    );
  }
  const ordered = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1, letterSpacing: '0.08em' }}>
          Run trend (last {ordered.length})
        </Typography>
        <Stack direction="row" spacing={1.5} alignItems="flex-end" sx={{ height: 160, mt: 0.5 }}>
          {ordered.map(r => {
            const total = Math.max(r.total, 1);
            const passH = (r.passed / total) * 130;
            const failH = (r.failed / total) * 130;
            const skipH = (r.skipped / total) * 130;
            return (
              <Box key={r.id} sx={{ flex: 1, textAlign: 'center', minWidth: 60 }}>
                <Box sx={{ height: 130, display: 'flex', flexDirection: 'column-reverse', borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
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
 * facet-value tags and count pass/fail/skip per group.
 */
function aggregateByFacet(tests: CatalogTest[], facet: string) {
  const groups = new Map<string, { passed: number; failed: number; skipped: number; total: number }>();
  for (const t of tests) {
    if (!t.lastStatus) continue;
    const values = new Set<string>();
    for (const tag of t.tags) {
      const m = tag.match(/^@([a-z]+):(.+)$/i);
      if (m && m[1] === facet) values.add(m[2]);
    }
    if (values.size === 0) values.add('—');
    for (const v of values) {
      const g = groups.get(v) ?? { passed: 0, failed: 0, skipped: 0, total: 0 };
      g.total++;
      if (t.lastStatus === 'passed') g.passed++;
      else if (t.lastStatus === 'skipped') g.skipped++;
      else g.failed++;
      groups.set(v, g);
    }
  }
  return Array.from(groups.entries())
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Tests that have been red the most often in the rolling history window.
 * Surfaces flake/regression candidates.
 */
function topFailers(tests: CatalogTest[]) {
  return tests
    .map(t => {
      const fails = t.history.filter(h => h.status === 'failed' || h.status === 'timedOut').length;
      return { test: t, fails };
    })
    .filter(x => x.fails >= 1)
    .sort((a, b) => b.fails - a.fails || (b.test.history.length - a.test.history.length))
    .slice(0, 8);
}

export default function Dashboard() {
  const { data: tests = [] } = useGetList<CatalogTest>('tests', {
    pagination: { page: 1, perPage: 1000 },
  });
  const { data: runs = [] } = useGetList<RunSummary>('runs', {
    pagination: { page: 1, perPage: 50 },
    sort: { field: 'startedAt', order: 'DESC' },
  });

  const latest = runs[0];
  const passRate = latest && latest.total > 0 ? Math.round((latest.passed / latest.total) * 100) : 0;
  const trendDelta = useMemo(() => {
    if (runs.length < 2 || !runs[0].total || !runs[1].total) return null;
    const a = runs[0].passed / runs[0].total;
    const b = runs[1].passed / runs[1].total;
    return Math.round((a - b) * 100);
  }, [runs]);

  const byArea = useMemo(() => aggregateByFacet(tests, 'area'), [tests]);
  const byPersona = useMemo(() => aggregateByFacet(tests, 'persona'), [tests]);
  const fails = useMemo(() => topFailers(tests), [tests]);

  return (
    <Box sx={{ p: { xs: 1, sm: 2 }, maxWidth: 1400, mx: 'auto' }}>
      {/* Hero stats */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Latest run"
            value={`${passRate}%`}
            sub={latest ? `${latest.passed} passed of ${latest.total} · ${relTime(latest.startedAt)}` : 'no runs yet'}
            color={passRate > 80 ? STATUS_COLOR.passed : passRate > 50 ? STATUS_COLOR.skipped : STATUS_COLOR.failed}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Trend vs prior run"
            value={trendDelta == null ? '—' : `${trendDelta > 0 ? '+' : ''}${trendDelta}%`}
            sub={runs.length >= 2 ? `was ${Math.round((runs[1].passed / Math.max(runs[1].total, 1)) * 100)}% on ${runs[1].id.split('_').slice(0,2).join(' ')}` : 'first run'}
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
          <RunTrend runs={runs} />
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
                Top failing tests (last {runs.length || 0} runs)
              </Typography>
              {fails.length === 0 && (
                <Typography variant="body2" color="text.secondary">All green — no failing tests in the rolling history window.</Typography>
              )}
              {fails.map(({ test, fails }, i) => (
                <Box key={test.id}>
                  {i > 0 && <Divider />}
                  <Stack direction="row" spacing={2} alignItems="center" sx={{ py: 1 }}>
                    <Chip label={`${fails}/${test.history.length || 1}`} size="small" sx={{ bgcolor: STATUS_COLOR.failed, color: '#fff', minWidth: 56 }} />
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
