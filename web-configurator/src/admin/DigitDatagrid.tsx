import React, { useCallback } from 'react';
import { useListContext, useResourceContext } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { RaRecord } from 'ra-core';

export interface DigitColumn<RecordType extends RaRecord = RaRecord> {
  /** The field name on the record to display */
  source: string;
  /** Column header label */
  label: string;
  /** Whether this column is sortable */
  sortable?: boolean;
  /** Custom render function for cell content */
  render?: (record: RecordType) => React.ReactNode;
}

export interface DigitDatagridProps<RecordType extends RaRecord = RaRecord> {
  /** Column definitions */
  columns: DigitColumn<RecordType>[];
  /** Navigate to detail on row click: 'show', 'edit', or a path template */
  rowClick?: 'show' | 'edit' | string;
  /** Custom row click handler (takes precedence over rowClick) */
  onRowClick?: (record: RecordType) => void;
  /** Additional action column render function */
  actions?: (record: RecordType) => React.ReactNode;
}

/**
 * Get a nested value from an object using dot notation.
 * e.g. getNestedValue({ a: { b: 'c' } }, 'a.b') => 'c'
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

export function DigitDatagrid<RecordType extends RaRecord = RaRecord>({
  columns,
  rowClick,
  onRowClick,
  actions,
}: DigitDatagridProps<RecordType>) {
  const {
    data,
    total,
    page,
    perPage,
    setPage,
    sort,
    setSort,
    isPending,
  } = useListContext<RecordType>();
  const resource = useResourceContext();
  const navigate = useNavigate();

  const handleSort = useCallback(
    (source: string) => {
      if (sort.field === source) {
        setSort({
          field: source,
          order: sort.order === 'ASC' ? 'DESC' : 'ASC',
        });
      } else {
        setSort({ field: source, order: 'ASC' });
      }
    },
    [sort, setSort]
  );

  const handleRowClick = useCallback(
    (record: RecordType) => {
      if (onRowClick) {
        onRowClick(record);
        return;
      }
      if (rowClick) {
        if (rowClick === 'show') {
          navigate(`/manage/${resource}/${record.id}/show`);
        } else if (rowClick === 'edit') {
          navigate(`/manage/${resource}/${record.id}/edit`);
        } else {
          // Custom path template — replace :id with actual id
          const path = rowClick.replace(':id', String(record.id));
          navigate(path);
        }
      }
    },
    [onRowClick, rowClick, resource, navigate]
  );

  const isClickable = Boolean(rowClick || onRowClick);

  // Pagination calculations
  const totalPages = total != null ? Math.ceil(total / perPage) : 0;
  const startRecord = total != null && total > 0 ? (page - 1) * perPage + 1 : 0;
  const endRecord =
    total != null ? Math.min(page * perPage, total) : 0;

  if (isPending || !data) {
    return null;
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            {columns.map((col) => (
              <TableHead key={col.source}>
                {col.sortable !== false ? (
                  <button
                    onClick={() => handleSort(col.source)}
                    className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {col.label}
                    {sort.field === col.source ? (
                      sort.order === 'ASC' ? (
                        <ArrowUp className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />
                    )}
                  </button>
                ) : (
                  <span className="font-medium text-muted-foreground">
                    {col.label}
                  </span>
                )}
              </TableHead>
            ))}
            {actions && (
              <TableHead className="text-right">
                <span className="font-medium text-muted-foreground">
                  Actions
                </span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((record) => (
            <TableRow
              key={record.id}
              onClick={isClickable ? () => handleRowClick(record) : undefined}
              className={isClickable ? 'cursor-pointer' : ''}
            >
              {columns.map((col) => (
                <TableCell key={col.source}>
                  {col.render
                    ? col.render(record)
                    : renderCellValue(getNestedValue(record as Record<string, unknown>, col.source))}
                </TableCell>
              ))}
              {actions && (
                <TableCell className="text-right">
                  {actions(record)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Pagination footer */}
      {total != null && total > 0 && (
        <div className="flex items-center justify-between pt-4 border-t border-border mt-2">
          <p className="text-sm text-muted-foreground">
            Showing {startRecord}-{endRecord} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground px-2">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="gap-1"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Render a cell value as a string, handling common types */
function renderCellValue(value: unknown): React.ReactNode {
  if (value == null) return <span className="text-muted-foreground">--</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
