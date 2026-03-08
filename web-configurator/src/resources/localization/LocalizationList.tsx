import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';

const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  {
    source: 'message',
    label: 'Message',
    render: (record) => {
      const msg = String(record.message ?? '');
      return <span className="truncate max-w-[300px] block">{msg.length > 80 ? msg.slice(0, 80) + '...' : msg}</span>;
    },
  },
  { source: 'module', label: 'Module' },
  { source: 'locale', label: 'Locale' },
];

export function LocalizationList() {
  return (
    <DigitList title="Localization Messages" hasCreate sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
