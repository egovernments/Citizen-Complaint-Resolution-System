import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';

const columns: DigitColumn[] = [
  { source: 'code', label: 'app.fields.code' },
  { source: 'name', label: 'app.fields.name' },
  { source: 'city.name', label: 'app.fields.city' },
  { source: 'city.districtName', label: 'app.fields.district' },
];

export function TenantList() {
  return (
    <DigitList title="app.resources.tenants" sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
