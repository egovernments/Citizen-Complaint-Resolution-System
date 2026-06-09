import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import {
  DigitList,
  DigitDatagrid,
  SearchFilterInput,
  SelectFilterInput,
  ReferenceFilterInput,
} from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';
import { Button } from '@/components/ui/button';
import { BulkExportButton } from '@/admin/bulk/BulkExportButton';

const filters = [
  <SearchFilterInput key="q" source="q" alwaysOn />,
  <SelectFilterInput
    key="active"
    source="active"
    label="Status"
    choices={[
      { id: 'true', name: 'Active' },
      { id: 'false', name: 'Inactive' },
    ]}
    alwaysOn
  />,
  <ReferenceFilterInput
    key="department"
    source="department"
    reference="departments"
    label="Department"
  />,
];

const columns: DigitColumn[] = [
  { source: 'code', label: 'app.fields.code' },
  { source: 'name', label: 'app.fields.name', editable: true },
  {
    source: 'active',
    label: 'app.fields.status',
    render: (record) => (
      <StatusChip value={record.active} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
  {
    source: 'department',
    label: 'app.fields.department',
    sortable: false,
    render: (record) => {
      const raw = record.department;
      if (Array.isArray(raw) && raw.length > 0) {
        return <span className="font-mono text-xs">{raw.join(', ')}</span>;
      }
      if (typeof raw === 'string' && raw) {
        return <span className="font-mono text-xs">{raw}</span>;
      }
      return <span className="text-muted-foreground">--</span>;
    },
  },
  { source: 'description', label: 'app.fields.description', editable: true },
];

const exportColumns = [
  { header: 'code', value: (r: Record<string, unknown>) => r.code },
  { header: 'name', value: (r: Record<string, unknown>) => r.name },
  { header: 'description', value: (r: Record<string, unknown>) => r.description },
  { header: 'department', value: (r: Record<string, unknown>) => r.department },
  { header: 'active', value: (r: Record<string, unknown>) => r.active },
];

export function DesignationList() {
  return (
    <DigitList
      title="app.resources.designations"
      hasCreate
      sort={{ field: 'code', order: 'ASC' }}
      filters={filters}
      actions={
        <>
          <BulkExportButton
            filename="designations"
            sheetName="Designation"
            columns={exportColumns}
          />
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/manage/designations/bulk">
              <Upload className="w-4 h-4" />
              Bulk import
            </Link>
          </Button>
        </>
      }
    >
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
