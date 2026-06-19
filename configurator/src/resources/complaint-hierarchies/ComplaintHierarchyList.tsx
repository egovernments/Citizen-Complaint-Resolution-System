import { DigitList, DigitDatagrid, SearchFilterInput } from '@/admin';
import type { DigitColumn } from '@/admin';
import { MigrateHierarchyAction } from './MigrateHierarchyAction';

const filters = [<SearchFilterInput key="q" source="q" alwaysOn />];

const columns: DigitColumn[] = [
  { source: 'hierarchyType', label: 'Hierarchy Type' },
  {
    source: 'levels',
    label: 'Levels',
    sortable: false,
    render: (record) => {
      const levels = record.levels as Array<Record<string, unknown>> | undefined;
      if (!levels || levels.length === 0)
        return <span className="text-muted-foreground">--</span>;
      const ordered = [...levels].sort(
        (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)
      );
      return (
        <span className="font-mono text-xs">
          {ordered
            .map((l) => String(l.levelCode ?? '?') + (l.isLeafServiceCode ? ' (leaf)' : ''))
            .join(' → ')}
        </span>
      );
    },
  },
];

export function ComplaintHierarchyList() {
  return (
    <DigitList
      title="Complaint Hierarchies"
      hasCreate
      sort={{ field: 'hierarchyType', order: 'ASC' }}
      filters={filters}
      actions={<MigrateHierarchyAction />}
    >
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
