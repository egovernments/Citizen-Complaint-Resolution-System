import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { parentOf } from './parentOf';

const columns: DigitColumn[] = [
  { source: 'code', label: 'app.fields.code' },
  { source: 'name', label: 'app.fields.name' },
  // ours (cfgreview F07, #1554): where the tenant sits (tenants are admin boundary layers of any depth)
  { source: 'code', label: 'Parent', sortable: false, render: (record) => <span className="font-mono text-xs">{parentOf(String(record.code ?? '')) || '—'}</span> },
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
    // ours (cfgreview F07, #1554): Create was reachable only by typing its URL (the screen is patch 19)
    <DigitList title="app.resources.tenants" hasCreate sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
