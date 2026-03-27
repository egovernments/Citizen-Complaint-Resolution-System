import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';

const columns: DigitColumn[] = [
  { source: 'hierarchyType', label: 'app.fields.hierarchy_type' },
  { source: 'tenantId', label: 'app.fields.tenant' },
];

export function BoundaryHierarchyList() {
  return (
    <DigitList title="app.resources.boundary_hierarchies" sort={{ field: 'hierarchyType', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
