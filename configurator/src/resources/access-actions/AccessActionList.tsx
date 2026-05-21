import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';

const columns: DigitColumn[] = [
  { source: 'displayName', label: 'app.fields.name' },
  { source: 'url', label: 'app.fields.url' },
  { source: 'serviceName', label: 'app.fields.service' },
  { source: 'enabled', label: 'app.fields.enabled' },
];

export function AccessActionList() {
  return (
    <DigitList title="app.resources.access_actions" sort={{ field: 'displayName', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
