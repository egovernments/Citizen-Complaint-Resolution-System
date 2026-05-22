import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';

const columns: DigitColumn[] = [
  { source: 'code', label: 'app.fields.code' },
  { source: 'name', label: 'app.fields.name' },
  { source: 'city.name', label: 'app.fields.city' },
  {
    source: 'city.districtName',
    label: 'app.fields.district',
    render: (record) => {
      const city = record.city as Record<string, unknown> | undefined;
      const districtName = typeof city?.districtName === 'string' ? city.districtName : '';
      return districtName
        ? <span>{districtName}</span>
        : <span className="text-muted-foreground" title="Missing city.districtName in tenant MDMS">—</span>;
    },
  },
];

export function TenantList() {
  return (
    <DigitList title="app.resources.tenants" sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
