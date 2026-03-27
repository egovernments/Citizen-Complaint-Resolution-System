import React, { useCallback, useRef, useState } from 'react';
import { useListContext, useResourceContext, useUpdate, useTranslate } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
} from 'lucide-react';
import { EditableCell } from '@/components/ui/editable-cell';
import type { ValidationRule } from '@/components/ui/editable-cell';
import { ReferenceSelect } from '@/components/ui/ReferenceSelect';
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

export interface EditableColumnConfig {
  type?: 'text' | 'number' | 'reference';
  validation?: ValidationRule;
  /** For type: 'reference' — the react-admin resource to fetch choices from */
  reference?: string;
  /** For type: 'reference' — which field on the referenced record to display. Default: 'name' */
  displayField?: string;
}

export interface DigitColumn<RecordType extends RaRecord = RaRecord> {
  /** The field name on the record to display */
  source: string;
  /** Column header label */
  label: string;
  /** Whether this column is sortable */
  sortable?: boolean;
  /** Custom render function for cell content */
  render?: (record: RecordType) => React.ReactNode;
  /** Enable inline editing. true = text input. Object = config with type/validation. */
  editable?: boolean | EditableColumnConfig;
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

function getTypedValue(col: Pick<DigitColumn, 'editable'>, rawValue: string): unknown {
  const config = typeof col.editable === 'object' ? col.editable : {};
  if (config.type === 'number') return Number(rawValue);
  return rawValue;
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
  const translate = useTranslate();
  const [editingCell, setEditingCell] = useState<{ recordId: string | number; source: string } | null>(null);
  const [update] = useUpdate();
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check if any column is editable (enables delayed row click)
  const hasEditableColumns = columns.some((col) => Boolean(col.editable));

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

  const doNavigate = useCallback(
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
          const path = rowClick.replace(':id', String(record.id));
          navigate(path);
        }
      }
    },
    [onRowClick, rowClick, resource, navigate]
  );

  const handleRowClick = useCallback(
    (record: RecordType) => {
      if (hasEditableColumns) {
        // Delay navigation so double-click can cancel it
        if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
        clickTimerRef.current = setTimeout(() => {
          clickTimerRef.current = null;
          doNavigate(record);
        }, 250);
      } else {
        doNavigate(record);
      }
    },
    [hasEditableColumns, doNavigate]
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
                    {translate(col.label, { _: col.label })}
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
                    {translate(col.label, { _: col.label })}
                  </span>
                )}
              </TableHead>
            ))}
            {actions && (
              <TableHead className="text-right">
                <span className="font-medium text-muted-foreground">
                  {translate('app.list.actions')}
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
              {columns.map((col) => {
                const isEditing = editingCell?.recordId === record.id && editingCell?.source === col.source;
                const isEditable = Boolean(col.editable);

                return (
                  <TableCell
                    key={col.source}
                    onDoubleClick={isEditable ? (e) => {
                      e.stopPropagation();
                      // Cancel pending row-click navigation
                      if (clickTimerRef.current) {
                        clearTimeout(clickTimerRef.current);
                        clickTimerRef.current = null;
                      }
                      setEditingCell({ recordId: record.id, source: col.source });
                    } : undefined}
                    className={isEditable ? 'group/cell' : ''}
                  >
                    {isEditing ? (
                      typeof col.editable === 'object' && col.editable.type === 'reference' && col.editable.reference ? (
                        <ReferenceSelect
                          reference={col.editable.reference}
                          value={String(getNestedValue(record as Record<string, unknown>, col.source) ?? '')}
                          displayField={col.editable.displayField}
                          initialOpen
                          onSave={async (val) => {
                            await update(resource!, {
                              id: record.id,
                              data: { ...record, [col.source]: val },
                              previousData: record,
                            });
                            setEditingCell(null);
                          }}
                          onCancel={() => setEditingCell(null)}
                        />
                      ) : (
                        <EditableCell
                          value={String(getNestedValue(record as Record<string, unknown>, col.source) ?? '')}
                          onSave={async (val) => {
                            const typedVal = getTypedValue(col, val);
                            await update(resource!, {
                              id: record.id,
                              data: { ...record, [col.source]: typedVal },
                              previousData: record,
                            });
                            setEditingCell(null);
                          }}
                          type={typeof col.editable === 'object' && col.editable.type === 'number' ? 'number' : 'text'}
                          validation={typeof col.editable === 'object' ? col.editable.validation : undefined}
                          initialEditing
                        />
                      )
                    ) : col.render ? (
                      <span className={`flex items-center gap-1${isEditable ? ' pointer-events-none' : ''}`}>
                        {col.render(record)}
                        {isEditable && (
                          <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/cell:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        {renderCellValue(getNestedValue(record as Record<string, unknown>, col.source))}
                        {isEditable && (
                          <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/cell:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </span>
                    )}
                  </TableCell>
                );
              })}
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
            {translate('app.list.showing', { start: startRecord, end: endRecord, total })}
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
              {translate('app.list.previous')}
            </Button>
            <span className="text-sm text-muted-foreground px-2">
              {translate('app.list.page_info', { page, totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="gap-1"
            >
              {translate('app.list.next')}
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
