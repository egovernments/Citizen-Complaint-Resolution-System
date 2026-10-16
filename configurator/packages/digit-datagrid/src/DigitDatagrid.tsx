import React, { useCallback, useRef, useState, useMemo } from 'react';
import { useListContext, useResourceContext } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
} from 'lucide-react';
import { EditableCell } from './editing/EditableCell';
import { useMutationMode } from './editing/useMutationMode';
import { RowActions } from './actions/RowActions';
import { useNarrow } from './hooks/useNarrow';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from './primitives/table';
import { Button } from './primitives/button';
import { T } from './i18n/T';
import { ColumnLabel } from './i18n/ColumnLabel';
import type { RaRecord } from 'ra-core';
import type {
  DigitColumn,
  DigitDatagridProps,
  EditableColumnConfig,
  EditableCellType,
} from './columns/types';

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

/**
 * Convert a raw string value back to the appropriate typed value
 * based on column editable config.
 */
function getTypedValue(
  editableConfig: boolean | EditableColumnConfig | undefined,
  rawValue: string
): unknown {
  const config = typeof editableConfig === 'object' ? editableConfig : {};
  if (config.type === 'number') return Number(rawValue);
  if (config.type === 'boolean') return rawValue === 'true';
  return rawValue;
}

/**
 * Resolve the EditableCellType from column config.
 */
function resolveEditableType(
  editable: boolean | EditableColumnConfig | undefined
): EditableCellType {
  if (typeof editable === 'object' && editable.type) {
    // Reference type falls back to text until ReferenceSelect is available
    if (editable.type === 'reference') return 'text';
    return editable.type;
  }
  return 'text';
}

/**
 * Check whether a column type renders inline (no double-click entry needed).
 */
function isInlineEditType(type: EditableCellType): boolean {
  return type === 'boolean' || type === 'select';
}

/** Render a cell value as a string, handling common types. */
function renderCellValue(value: unknown): React.ReactNode {
  if (value == null) return <span className="text-muted-foreground">--</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function DigitDatagrid<RecordType extends RaRecord = RaRecord>({
  columns,
  rowClick,
  onRowClick,
  actions,
  rowActions: rowActionsProp,
  mutationMode: mutationModeProp = 'undoable',
  mutationOptions,
  noDelete = false,
  configurable: _configurable,
  preferenceKey: _preferenceKey,
  disableAutofocus = false,
}: DigitDatagridProps<RecordType>) {
  const {
    data,
    total,
    page,
    perPage,
    setPage,
    setPerPage,
    sort,
    setSort,
    isPending,
  } = useListContext<RecordType>();
  const resource = useResourceContext();
  const navigate = useNavigate();
  const [editingCell, setEditingCell] = useState<{
    recordId: string | number;
    source: string;
  } | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use the mutation mode hook instead of raw useUpdate
  const { mutate, deleteMutate } = useMutationMode({
    mode: mutationModeProp,
    undoTimeout: 5000,
    onSuccess: mutationOptions?.onSuccess,
    onError: mutationOptions?.onError,
    transform: mutationOptions?.transform,
    meta: mutationOptions?.meta,
  });

  // Check if any column is editable
  const hasEditableColumns = useMemo(
    () => columns.some((col) => Boolean(col.editable)),
    [columns]
  );

  // Resolve effective rowActions
  const effectiveRowActions = useMemo(() => {
    if (rowActionsProp !== undefined) return rowActionsProp;
    return hasEditableColumns ? 'auto' : 'none';
  }, [rowActionsProp, hasEditableColumns]);

  const showAutoRowActions = effectiveRowActions === 'auto';
  const showCustomRowActions = typeof effectiveRowActions === 'function';

  // Sorting handler
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

  // Navigation handler
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

  // Row click with delayed navigation for editable columns
  const handleRowClick = useCallback(
    (record: RecordType) => {
      if (hasEditableColumns) {
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

  // Save handler for editable cells
  const handleCellSave = useCallback(
    async (record: RecordType, col: DigitColumn<RecordType>, rawValue: string) => {
      const typedVal = getTypedValue(col.editable, rawValue);

      // Apply column-level transform if configured
      const editConfig = typeof col.editable === 'object' ? col.editable : undefined;
      const finalValue = editConfig?.transform
        ? editConfig.transform(typedVal)
        : typedVal;

      await mutate(resource!, {
        id: record.id,
        data: { ...record, [col.source]: finalValue },
        previousData: record,
      });
      setEditingCell(null);
    },
    [mutate, resource]
  );

  // Delete handler for row actions
  const handleRowDelete = useCallback(
    async (record: RecordType) => {
      await deleteMutate(resource!, {
        id: record.id,
        previousData: record,
      });
    },
    [deleteMutate, resource]
  );

  const isClickable = Boolean(rowClick || onRowClick);
  const narrow = useNarrow();

  // Pagination calculations
  const totalPages = total != null ? Math.ceil(total / perPage) : 0;
  const startRecord =
    total != null && total > 0 ? (page - 1) * perPage + 1 : 0;
  const endRecord =
    total != null ? Math.min(page * perPage, total) : 0;

  if (isPending || !data) {
    return null;
  }

  return (
    <div>
      {narrow ? (
        // ours (cfgreview F22, #1568): below md each record is a card of label / value lines (the table's columns
        // clipped and scrolled inside the card on a phone). No inline editing here: the record page edits.
        <ul className="divide-y divide-border" data-testid="datagrid-cards">
          {data.map((record) => (
            <li
              key={record.id}
              onClick={isClickable ? () => handleRowClick(record) : undefined}
              className={`py-3 ${isClickable ? 'cursor-pointer' : ''}`}
            >
              <dl className="grid grid-cols-[minmax(6rem,40%)_1fr] gap-x-3 gap-y-1 text-sm">
                {columns.map((col) => (
                  <React.Fragment key={col.source}>
                    <dt className="text-muted-foreground">{translate(col.label, { _: col.label })}</dt>
                    <dd className="min-w-0 break-words">
                      {col.render ? col.render(record) : renderCellValue(getNestedValue(record as Record<string, unknown>, col.source))}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
              {(showCustomRowActions || (actions && !showAutoRowActions)) && (
                <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
                  {showCustomRowActions
                    ? (effectiveRowActions as (record: RecordType) => React.ReactNode)(record)
                    : actions!(record)}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
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
                    <ColumnLabel column={col} />
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
                    <ColumnLabel column={col} />
                  </span>
                )}
              </TableHead>
            ))}
            {/* Header for actions column */}
            {(actions || showAutoRowActions || showCustomRowActions) && (
              <TableHead className="text-right">
                <span className="font-medium text-muted-foreground">
                  <T i18nKey="app.list.actions">Actions</T>
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
              className={`group/row${isClickable ? ' cursor-pointer' : ''}`}
            >
              {columns.map((col) => {
                const isEditing =
                  editingCell?.recordId === record.id &&
                  editingCell?.source === col.source;
                const isEditable = Boolean(col.editable);
                const editType = resolveEditableType(col.editable);
                const editConfig =
                  typeof col.editable === 'object' ? col.editable : undefined;
                const inlineEdit = isInlineEditType(editType);
                const rawValue = getNestedValue(
                  record as Record<string, unknown>,
                  col.source
                );
                const stringValue = String(rawValue ?? '');

                return (
                  <TableCell
                    key={col.source}
                    onDoubleClick={
                      isEditable && !inlineEdit
                        ? (e) => {
                            e.stopPropagation();
                            // Cancel pending row-click navigation
                            if (clickTimerRef.current) {
                              clearTimeout(clickTimerRef.current);
                              clickTimerRef.current = null;
                            }
                            setEditingCell({
                              recordId: record.id,
                              source: col.source,
                            });
                          }
                        : undefined
                    }
                    className={isEditable ? 'group/cell' : ''}
                  >
                    {/* Inline edit types (boolean, select) always show their control */}
                    {isEditable && inlineEdit ? (
                      <EditableCell
                        value={stringValue}
                        onSave={(val) => handleCellSave(record, col, val)}
                        type={editType}
                        options={editConfig?.options}
                        disableAutofocus={disableAutofocus}
                      />
                    ) : isEditing ? (
                      <EditableCell
                        value={stringValue}
                        onSave={(val) => handleCellSave(record, col, val)}
                        type={editType}
                        validation={editConfig?.validation}
                        options={editConfig?.options}
                        initialEditing
                        disableAutofocus={disableAutofocus}
                        onCancel={() => setEditingCell(null)}
                      />
                    ) : col.render ? (
                      <span
                        className={`flex items-center gap-1${
                          isEditable ? ' pointer-events-none' : ''
                        }`}
                      >
                        {col.render(record)}
                        {isEditable && (
                          <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/cell:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        {renderCellValue(rawValue)}
                        {isEditable && (
                          <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover/cell:opacity-100 transition-opacity flex-shrink-0" />
                        )}
                      </span>
                    )}
                  </TableCell>
                );
              })}

              {/* Auto row actions */}
              {showAutoRowActions && (
                <RowActions
                  record={record}
                  onDelete={handleRowDelete}
                  noDelete={noDelete}
                  mutationMode={mutationModeProp}
                />
              )}

              {/* Custom row actions function */}
              {showCustomRowActions && (
                <TableCell className="text-right">
                  {(effectiveRowActions as (record: RecordType) => React.ReactNode)(record)}
                </TableCell>
              )}

              {/* Legacy actions prop */}
              {actions && !showAutoRowActions && !showCustomRowActions && (
                <TableCell className="text-right">
                  {actions(record)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      )}

      {/* Pagination footer */}
      {total != null && total > 0 && (
        <div className="flex items-center justify-between pt-4 border-t border-border mt-2">
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">
              <T i18nKey="app.list.showing" options={{ start: startRecord, end: endRecord, total }}>
                {`Showing ${startRecord}-${endRecord} of ${total}`}
              </T>
            </p>
            <div className="flex items-center gap-1.5">
              <label htmlFor="rows-per-page" className="text-sm text-muted-foreground">
                <T i18nKey="app.list.rows_per_page">Rows per page:</T>
              </label>
              <select
                id="rows-per-page"
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setPage(1);
                }}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              <T i18nKey="app.list.previous">Previous</T>
            </Button>
            <span className="text-sm text-muted-foreground px-2">
              <T i18nKey="app.list.page_info" options={{ page, totalPages }}>{`Page ${page} of ${totalPages}`}</T>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="gap-1"
            >
              <T i18nKey="app.list.next">Next</T>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
