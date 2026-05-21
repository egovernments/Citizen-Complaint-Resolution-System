import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';

const columns: DigitColumn[] = [
  { source: 'code', label: 'app.fields.code' },
  { source: 'boundaryType', label: 'app.fields.boundary_type' },
  { source: 'tenantId', label: 'app.fields.tenant' },
];

export function BoundaryList() {
  return (
    <DigitList title="app.resources.boundaries" hasCreate sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
