import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';

const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'boundaryType', label: 'Boundary Type' },
  { source: 'tenantId', label: 'Tenant' },
];

export function BoundaryList() {
  return (
    <DigitList title="Boundaries" hasCreate sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
