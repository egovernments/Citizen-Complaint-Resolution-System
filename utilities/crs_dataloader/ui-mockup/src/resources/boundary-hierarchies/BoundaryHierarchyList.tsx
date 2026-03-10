import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';

const columns: DigitColumn[] = [
  { source: 'hierarchyType', label: 'Hierarchy Type' },
  { source: 'tenantId', label: 'Tenant' },
];

export function BoundaryHierarchyList() {
  return (
    <DigitList title="Boundary Hierarchies" sort={{ field: 'hierarchyType', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
