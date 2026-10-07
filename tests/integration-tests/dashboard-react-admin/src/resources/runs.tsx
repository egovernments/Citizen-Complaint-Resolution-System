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

/** " · 68 not run · cut short" — empty for a complete run (and for older catalogs). */
const notRunSuffix = (r: RunSummary) =>
  `${r.notRun ? ` · ${r.notRun} not run` : ''}${r.cutShort ? ' · cut short' : ''}`;

export const RunList = () => (
  <List perPage={20} sort={{ field: 'startedAt', order: 'DESC' }}>
    <Datagrid rowClick="show" bulkActionButtons={false}>
      <TextField source="id" label="Run id" />
      <TextField source="branch" />
      <TextField source="sha" />
      <FunctionField label="Result" render={(r: RunSummary) => `${r.passed}p · ${r.failed}f · ${r.skipped}s of ${r.total}${notRunSuffix(r)}`} />
      <FunctionField label="Duration" render={(r: RunSummary) => `${(r.durationMs / 60000).toFixed(1)} min`} />
      <TextField source="startedAt" label="Started" />
    </Datagrid>
  </List>
);

const PlaywrightReportLink = () => {
  const r = useRecordContext<RunSummary>();
  if (!r) return null;
  return (
    <p>
      <a href={`runs/${r.id}/playwright-report/index.html`} target="_blank" rel="noopener">
        Open Playwright report for this run →
      </a>
    </p>
  );
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
