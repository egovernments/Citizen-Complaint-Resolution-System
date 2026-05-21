import {
  DigitList,
  DigitDatagrid,
  SearchFilterInput,
  SelectFilterInput,
} from '@/admin';
import type { DigitColumn } from '@/admin';

const filters = [
  <SearchFilterInput key="q" source="q" alwaysOn />,
  <SelectFilterInput
    key="tenantId"
    source="tenantId"
    label="Tenant"
    // Choices are populated at render time in future work; for now the
    // Search input covers tenant filtering via substring match.
    choices={[]}
  />,
];

const columns: DigitColumn[] = [
  { source: 'hierarchyType', label: 'app.fields.hierarchy_type' },
  { source: 'tenantId', label: 'app.fields.tenant' },
  {
    source: 'boundaryHierarchy',
    label: 'app.fields.levels',
    sortable: false,
    render: (record) => {
      const levels = record.boundaryHierarchy as Array<Record<string, unknown>> | undefined;
      if (!levels || levels.length === 0) return <span className="text-muted-foreground">--</span>;
      return (
        <span className="font-mono text-xs">
          {levels.map((l) => String(l.boundaryType ?? '?')).join(' → ')}
        </span>
      );
    },
  },
];

export function BoundaryHierarchyList() {
  return (
    <DigitList
      title="app.resources.boundary_hierarchies"
      hasCreate
      sort={{ field: 'hierarchyType', order: 'ASC' }}
      filters={filters}
    >
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
