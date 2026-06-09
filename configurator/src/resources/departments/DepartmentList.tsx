import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import {
  DigitList,
  DigitDatagrid,
  SearchFilterInput,
  SelectFilterInput,
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
  { source: 'description', label: 'app.fields.description', editable: true },
];

const exportColumns = [
  { header: 'code', value: (r: Record<string, unknown>) => r.code },
  { header: 'name', value: (r: Record<string, unknown>) => r.name },
  { header: 'description', value: (r: Record<string, unknown>) => r.description },
  { header: 'active', value: (r: Record<string, unknown>) => r.active },
];

export function DepartmentList() {
  return (
    <DigitList
      title="app.resources.departments"
      hasCreate
      sort={{ field: 'code', order: 'ASC' }}
      filters={filters}
      actions={
        <>
          <BulkExportButton
            filename="departments"
            sheetName="Department"
            columns={exportColumns}
          />
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/manage/departments/bulk">
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
