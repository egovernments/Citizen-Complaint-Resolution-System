import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';

const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'name', label: 'Name' },
  { source: 'city.name', label: 'City' },
  { source: 'city.districtName', label: 'District' },
];

export function TenantList() {
  return (
    <DigitList title="Tenants" sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
