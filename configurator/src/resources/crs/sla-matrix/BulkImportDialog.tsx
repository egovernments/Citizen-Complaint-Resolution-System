import { useRef, useState } from 'react';
import { Upload, FileText, CheckCircle2, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { parseCsv, parseXlsx, type ParseResult, type ParsedRow } from './csvParser';
import type { CategorySlaRecord } from './types';
import { formatCell } from './types';
import { STATE_KEYS, STATE_LABELS } from './types';

interface BulkImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (records: CategorySlaRecord[], filename: string) => Promise<void>;
}

/**
 * Bulk-import modal for the SLA matrix. Accepts CSV or XLSX, runs the
 * shared parser, renders a preview with per-row status, and only writes
 * valid rows on confirm. The parent is responsible for the MDMS fan-out
 * and the bulk-import audit summary entry.
 */
export function BulkImportDialog({ open, onClose, onImport }: BulkImportDialogProps) {
  const [filename, setFilename] = useState<string>('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFilename('');
    setParsed(null);
    setImporting(false);
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    if (importing) return;
    reset();
    onClose();
  }

  async function handleFile(file: File) {
    setFilename(file.name);
    setImportError(null);
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        const buf = await file.arrayBuffer();
        setParsed(parseXlsx(buf));
      } else {
        const text = await file.text();
        setParsed(parseCsv(text));
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to read file');
      setParsed(null);
    }
  }

  async function handleImport() {
    if (!parsed) return;
    const validRecords = parsed.rows
      .filter((r) => r.errors.length === 0 && r.record)
      .map((r) => r.record!) as CategorySlaRecord[];
    if (validRecords.length === 0) {
      setImportError('No valid rows to import');
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      await onImport(validRecords, filename);
      reset();
      onClose();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk import SLA rows</DialogTitle>
          <DialogDescription>
            Upload a CSV or XLSX. Cells may be empty (fall back to defaults),
            a number (hours), or a range "min-max". The expected columns are
            <code className="ml-1 text-xs">path, category, subcategoryL1, subcategoryL2, sla_new, sla_triage, sla_forwarded, sla_investigation, sla_awaiting, sla_resolved</code>.
          </DialogDescription>
        </DialogHeader>

        {!parsed ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12 border-2 border-dashed border-border rounded-lg">
            <Upload className="w-10 h-10 text-muted-foreground" />
            <div className="text-center space-y-2">
              <p className="text-sm font-medium">Drop a CSV or XLSX file here</p>
              <p className="text-xs text-muted-foreground">or click to browse</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <Button onClick={() => fileInputRef.current?.click()}>
              <FileText className="w-4 h-4 mr-2" />
              Choose file
            </Button>
            {importError && (
              <p className="text-sm text-destructive">{importError}</p>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="flex items-center justify-between border border-border rounded-md px-3 py-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">{filename}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-emerald-100 text-emerald-700 border-emerald-200">
                  {parsed.totalValid} valid
                </Badge>
                {parsed.totalInvalid > 0 && (
                  <Badge variant="destructive">{parsed.totalInvalid} invalid</Badge>
                )}
                <Button variant="ghost" size="sm" onClick={reset}>Change file</Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto border border-border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-2 py-2 text-left w-10">Row</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Path</th>
                    <th className="px-2 py-2 text-left">Category</th>
                    <th className="px-2 py-2 text-left">Subcategory L1</th>
                    {STATE_KEYS.map((k) => (
                      <th key={k} className="px-2 py-2 text-left">{STATE_LABELS[k]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((row) => (
                    <PreviewRow key={row.rowNumber} row={row} />
                  ))}
                </tbody>
              </table>
            </div>

            {importError && (
              <p className="text-sm text-destructive">{importError}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose} disabled={importing}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={importing || parsed.totalValid === 0}>
                {importing ? 'Importing…' : `Import ${parsed.totalValid} valid row${parsed.totalValid === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewRow({ row }: { row: ParsedRow }) {
  const hasErrors = row.errors.length > 0;
  return (
    <tr className={hasErrors ? 'bg-red-50/50' : ''}>
      <td className="px-2 py-1.5 text-muted-foreground">{row.rowNumber}</td>
      <td className="px-2 py-1.5">
        {hasErrors ? (
          <span className="inline-flex items-center gap-1 text-destructive" title={row.errors.join('\n')}>
            <XCircle className="w-3.5 h-3.5" />
            <span className="text-[10px]">{row.errors.length} error{row.errors.length === 1 ? '' : 's'}</span>
          </span>
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        )}
      </td>
      <td className="px-2 py-1.5">{row.record?.path ?? '-'}</td>
      <td className="px-2 py-1.5">{row.record?.category ?? '-'}</td>
      <td className="px-2 py-1.5">{row.record?.subcategoryL1 ?? '-'}</td>
      {STATE_KEYS.map((k) => (
        <td key={k} className="px-2 py-1.5 text-muted-foreground">
          {row.record ? formatCell(row.record.slaHoursByState[k] ?? null) : '-'}
        </td>
      ))}
      {hasErrors && (
        <td colSpan={11} className="hidden">
          {row.errors.map((e, i) => (
            <p key={i} className="text-[10px] text-destructive pl-12">{e}</p>
          ))}
        </td>
      )}
    </tr>
  );
}
