import {
  List,
  Datagrid,
  TextField,
  FunctionField,
  Show,
  SimpleShowLayout,
  useRecordContext,
} from 'react-admin';
import type { RunSummary } from '../types';
import { hasReport } from '../runWindow';
import { reportUrl } from '../urls';

/**
 * Link to the run's standalone Playwright report, or "report pruned" once the
 * runner deleted runs/<id>/ (only the newest RUN_LIMIT runs keep one; older
 * runs keep their counts and per-test results only).
 */
const ReportCell = ({ run, long }: { run: RunSummary; long?: boolean }) =>
  hasReport(run) ? (
    <a href={reportUrl(run.id)} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>
      {long ? 'Open Playwright report for this run →' : 'Report'}
    </a>
  ) : (
    <span style={{ opacity: 0.6 }} title="Only the newest runs keep their report, videos and traces; this run's results are all that is left.">
      report pruned
    </span>
  );

/**
 * " · 68 not run · cut short" for a counted run, " · legacy count" for one
 * recorded before not-run tracking (its counts may include carried-over
 * results), empty for a complete run.
 */
const notRunSuffix = (r: RunSummary) =>
  typeof r.notRun !== 'number'
    ? ' · legacy count'
    : `${r.notRun ? ` · ${r.notRun} not run` : ''}${r.cutShort ? ' · cut short' : ''}`;

export const RunList = () => (
  <List perPage={20} sort={{ field: 'startedAt', order: 'DESC' }}>
    <Datagrid rowClick="show" bulkActionButtons={false}>
      <TextField source="id" label="Run id" />
      <TextField source="branch" />
      <TextField source="sha" />
      <FunctionField label="Result" render={(r: RunSummary) => `${r.passed}p · ${r.failed}f · ${r.skipped}s of ${r.total}${notRunSuffix(r)}`} />
      <FunctionField label="Duration" render={(r: RunSummary) => `${(r.durationMs / 60000).toFixed(1)} min`} />
      <TextField source="startedAt" label="Started" />
      <FunctionField label="Report" render={(r: RunSummary) => <ReportCell run={r} />} />
    </Datagrid>
  </List>
);

const PlaywrightReportLink = () => {
  const r = useRecordContext<RunSummary>();
  if (!r) return null;
  return <p><ReportCell run={r} long /></p>;
};

export const RunShow = () => (
  <Show>
    <SimpleShowLayout>
      <TextField source="id" />
      <TextField source="branch" />
      <TextField source="sha" />
      <TextField source="baseUrl" />
      <FunctionField label="Result" render={(r: RunSummary) => `${r.passed} passed · ${r.failed} failed · ${r.skipped} skipped of ${r.total}${notRunSuffix(r)}`} />
      <FunctionField label="Duration" render={(r: RunSummary) => `${(r.durationMs / 60000).toFixed(1)} min`} />
      <FunctionField label="Cut short" render={(r: RunSummary) => r.cutShort ?? '—'} />
      <TextField source="startedAt" />
      <PlaywrightReportLink />
    </SimpleShowLayout>
  </Show>
);
