import { useCallback } from 'react';
import { useListContext } from 'ra-core';
import { Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { triggerDownload } from './BulkImportPanel';

export interface BulkExportButtonProps {
  /** File name (without extension). Extension is appended based on `.xlsx`. */
  filename: string;
  /** Columns to include. Renders as strings so XLSX cells are predictable. */
  columns: Array<{ header: string; value: (record: Record<string, unknown>) => unknown }>;
  /** Sheet name inside the workbook. */
  sheetName: string;
  /** Label override. */
  label?: string;
}

/** Downloads the current list's records as a single-sheet XLSX. Honours any
 *  active filter / sort in the react-admin list context. */
export function BulkExportButton({ filename, columns, sheetName, label = 'Export' }: BulkExportButtonProps) {
  const { data, isPending } = useListContext();

  const handleClick = useCallback(() => {
    const records = data ?? [];
    const header = columns.map((c) => c.header);
    const rows = records.map((r) =>
      columns.map((c) => {
        const v = c.value(r as Record<string, unknown>);
        if (v === null || v === undefined) return '';
        if (Array.isArray(v)) return v.join(',');
        return v as string | number | boolean;
      }),
    );
    const aoa = [header, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = header.map((h) => ({ wch: Math.max(12, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    triggerDownload(blob, `${filename}.xlsx`);
  }, [data, columns, filename, sheetName]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={isPending || (data ?? []).length === 0}
      className="gap-1.5"
    >
      <Download className="w-4 h-4" />
      {label}
    </Button>
  );
}
