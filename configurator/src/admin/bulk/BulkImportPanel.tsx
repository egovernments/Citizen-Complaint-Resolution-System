import { useCallback, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Download,
  Upload,
  Check,
  X,
  Loader2,
  AlertTriangle,
  AlertCircle,
  FileSpreadsheet,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DigitCard } from '@/components/digit/DigitCard';

type Step = 'landing' | 'preview' | 'creating' | 'complete';

export interface BulkRow extends Record<string, unknown> {
  status: 'valid' | 'error';
  error?: string;
}

export interface BulkColumn<Row extends BulkRow = BulkRow> {
  header: string;
  render: (row: Row) => ReactNode;
  mono?: boolean;
}

export interface ReferenceSheetColumn {
  header: string;
  rows: string[];
}

export interface BulkImportPanelProps<Row extends BulkRow = BulkRow> {
  /** Page title (e.g. "Bulk import departments"). */
  title: string;
  /** Where the Back button navigates to. */
  backTo: string;
  /** Tenant label rendered as context. */
  tenantId: string;
  /** Reference counts shown on the landing page (e.g. departments / designations). */
  referenceCounts?: Array<{ label: string; value: number; loading?: boolean }>;
  /** True when reference data is still being fetched. */
  referenceLoading?: boolean;
  /** Builds the downloadable template workbook. */
  buildTemplate: () => Blob;
  /** File name of the generated template. */
  templateFilename: string;
  /** Parses an uploaded workbook into row objects + optional parser-level error. */
  parseWorkbook: (wb: XLSX.WorkBook) => { data: Row[]; parseError?: string };
  /** Runs per-row validation against live reference data. */
  validateRow: (row: Row) => string[];
  /** Columns to render in the preview + completion tables. */
  columns: BulkColumn<Row>[];
  /** Called once per valid row. Throw to mark the row failed. */
  createOne: (row: Row, index: number) => Promise<void>;
  /** Singular / plural noun for labels ("department" → "departments"). */
  entityLabel: { singular: string; plural: string };
  /** Noun for the code-style accept attribute: ".xlsx,.xls,.csv" by default. */
  acceptExtensions?: string;
  /** Optional post-creation extras (e.g. credentials CSV download). */
  completionExtras?: (createdCount: number) => ReactNode;
}

export function BulkImportPanel<Row extends BulkRow>({
  title,
  backTo,
  tenantId,
  referenceCounts,
  referenceLoading,
  buildTemplate,
  templateFilename,
  parseWorkbook,
  validateRow,
  columns,
  createOne,
  entityLabel,
  acceptExtensions = '.xlsx,.xls,.csv',
  completionExtras,
}: BulkImportPanelProps<Row>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('landing');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [createdCount, setCreatedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [failures, setFailures] = useState<{ row: Row; error: string }[]>([]);

  const handleTemplateDownload = useCallback(() => {
    const blob = buildTemplate();
    triggerDownload(blob, templateFilename);
  }, [buildTemplate, templateFilename]);

  const handleUpload = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
        const parsed = parseWorkbook(wb);
        if (parsed.parseError) {
          setError(parsed.parseError);
          return;
        }
        if (parsed.data.length === 0) {
          setError('No rows parsed. Check the sheet name matches the template.');
          return;
        }
        const validated = parsed.data.map((row) => {
          const errs = validateRow(row);
          return {
            ...row,
            status: errs.length === 0 ? 'valid' : 'error',
            error: errs.length > 0 ? errs.join('; ') : undefined,
          } as Row;
        });
        setRows(validated);
        setUploadedFile(file);
        setStep('preview');
      } catch (err) {
        console.error('Parse error', err);
        setError('Failed to parse file. Please upload a valid .xlsx, .xls, or .csv.');
      } finally {
        setLoading(false);
      }
    },
    [parseWorkbook, validateRow],
  );

  const handleCreate = useCallback(async () => {
    setStep('creating');
    setProgress(0);
    setCreatedCount(0);
    setFailedCount(0);
    setFailures([]);

    const valid = rows.filter((r) => r.status === 'valid');
    for (let i = 0; i < valid.length; i += 1) {
      const row = valid[i];
      setProgressMsg(`Creating ${describeRow(row, columns)}…`);
      try {
        await createOne(row, i);
        setCreatedCount((n) => n + 1);
      } catch (err) {
        const msg =
          err && typeof err === 'object' && 'firstError' in err
            ? String((err as { firstError: string }).firstError)
            : err instanceof Error
            ? err.message
            : 'Unknown error';
        setFailures((prev) => [...prev, { row, error: msg }]);
        setFailedCount((n) => n + 1);
      }
      setProgress(Math.round(((i + 1) / valid.length) * 100));
    }
    // Bust react-query cache so the list view we navigate back to
    // shows the fresh count, not the pre-import snapshot. Previously
    // the operator had to manually refresh — the bug Gurjeet flagged
    // on egovernments/CCRS#472. invalidateQueries() with no key
    // invalidates everything, which is overkill but safe (the SPA's
    // remaining queries are cheap to refetch).
    await queryClient.invalidateQueries();
    setStep('complete');
  }, [rows, createOne, columns, queryClient]);

  const validCount = rows.filter((r) => r.status === 'valid').length;
  const errorCount = rows.length - validCount;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(backTo)} className="gap-1.5">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">{title}</h1>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-start justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss"
              className="shrink-0 hover:opacity-70"
            >
              <X className="h-4 w-4" />
            </button>
          </AlertDescription>
        </Alert>
      )}

      {step === 'landing' && (
        <DigitCard className="max-w-none">
          <div className="space-y-6">
            <div>
              <p className="text-sm text-muted-foreground mb-3">
                Tenant: <span className="font-mono">{tenantId}</span>
              </p>
              {referenceCounts && referenceCounts.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {referenceCounts.map((ref) => (
                    <RefCount
                      key={ref.label}
                      label={ref.label}
                      value={ref.value}
                      loading={Boolean(ref.loading ?? referenceLoading)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Step 1 · Download template
              </h2>
              <Button
                type="button"
                variant="outline"
                onClick={handleTemplateDownload}
                disabled={Boolean(referenceLoading)}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                Download template
              </Button>
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Step 2 · Upload filled file
              </h2>
              <label
                htmlFor="bulk-file-input"
                className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary/30 bg-primary/5 p-8 text-center hover:border-primary hover:bg-primary/10 transition-colors cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                    <p className="text-sm">Parsing…</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-primary" />
                    <p className="text-sm font-medium">
                      Drop {acceptExtensions.split(',').join(' / ')} here, or click to browse
                    </p>
                  </>
                )}
                <input
                  id="bulk-file-input"
                  type="file"
                  accept={acceptExtensions}
                  className="hidden"
                  disabled={loading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </DigitCard>
      )}

      {step === 'preview' && (
        <DigitCard className="max-w-none">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
                <span className="text-sm font-medium truncate">{uploadedFile?.name}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Total: {rows.length}</span>
                <Badge className="bg-success text-white">{validCount} valid</Badge>
                {errorCount > 0 && (
                  <Badge variant="destructive">{errorCount} with errors</Badge>
                )}
              </div>
            </div>

            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <div className="min-w-[600px] sm:min-w-0 px-4 sm:px-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Status</TableHead>
                      {columns.map((c) => (
                        <TableHead key={c.header}>{c.header}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 50).map((r, i) => (
                      <TableRow key={i} className={r.status === 'error' ? 'bg-destructive/10' : ''}>
                        <TableCell>
                          {r.status === 'valid' ? (
                            <Badge className="gap-1 bg-success text-white">
                              <Check className="w-3 h-3" /> Valid
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1" title={r.error}>
                              <AlertTriangle className="w-3 h-3" /> Error
                            </Badge>
                          )}
                        </TableCell>
                        {columns.map((c) => (
                          <TableCell
                            key={c.header}
                            className={c.mono ? 'font-mono text-xs' : 'text-sm'}
                          >
                            {c.render(r)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rows.length > 50 && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Showing first 50 of {rows.length} rows
                  </p>
                )}
              </div>
            </div>

            {errorCount > 0 && (
              <Alert variant="warning">
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription className="text-sm">
                  <p className="font-medium mb-1">{errorCount} row(s) will be skipped:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {rows
                      .filter((r) => r.status === 'error')
                      .slice(0, 5)
                      .map((r, i) => (
                        <li key={i}>
                          {describeRow(r, columns)}: {r.error}
                        </li>
                      ))}
                    {errorCount > 5 && <li>…and {errorCount - 5} more</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col sm:flex-row justify-between gap-3">
              <Button variant="outline" onClick={() => setStep('landing')} className="gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Upload a different file
              </Button>
              <Button onClick={handleCreate} disabled={validCount === 0} className="gap-1.5">
                Create {validCount} {validCount === 1 ? entityLabel.singular : entityLabel.plural}
              </Button>
            </div>
          </div>
        </DigitCard>
      )}

      {step === 'creating' && (
        <DigitCard className="max-w-none">
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{progressMsg || 'Preparing…'}</span>
              <span className="text-primary font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-muted-foreground">
              {createdCount} created
              {failedCount > 0 && <span className="text-destructive"> · {failedCount} failed</span>}
              {' · '}
              {validCount} total
            </p>
          </div>
        </DigitCard>
      )}

      {step === 'complete' && (
        <DigitCard className="max-w-none">
          <div className="space-y-4">
            <div
              className={`rounded-md border p-4 ${
                failedCount === 0
                  ? 'bg-success/10 border-success/30'
                  : 'bg-warning/10 border-warning/30'
              }`}
            >
              <p className="font-semibold">
                {failedCount === 0
                  ? `Created ${createdCount} ${entityLabel.plural}`
                  : `Created ${createdCount}, ${failedCount} failed`}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {errorCount > 0 && `${errorCount} row(s) skipped for validation errors. `}
                Tenant: <span className="font-mono">{tenantId}</span>
              </p>
            </div>

            {failures.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      {columns.map((c) => (
                        <TableHead key={c.header}>{c.header}</TableHead>
                      ))}
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {failures.slice(0, 20).map((f, i) => (
                      <TableRow key={i}>
                        {columns.map((c) => (
                          <TableCell
                            key={c.header}
                            className={c.mono ? 'font-mono text-xs' : 'text-sm'}
                          >
                            {c.render(f.row)}
                          </TableCell>
                        ))}
                        <TableCell className="text-sm text-destructive">{f.error}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {failures.length > 20 && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Showing first 20 of {failures.length} failures
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row justify-between gap-3">
              <div>{completionExtras?.(createdCount)}</div>
              <Button onClick={() => navigate(backTo)} className="gap-1.5">
                Back
              </Button>
            </div>
          </div>
        </DigitCard>
      )}
    </div>
  );
}

function RefCount({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-0.5">
        {loading ? <span className="text-muted-foreground">…</span> : value}
      </div>
    </div>
  );
}

function describeRow<Row extends BulkRow>(row: Row, columns: BulkColumn<Row>[]): string {
  // Pick something human-readable for progress/error messages — prefer the
  // first non-mono column, falling back to the first column or the row's code.
  const col = columns.find((c) => !c.mono) ?? columns[0];
  if (col) {
    const node = col.render(row);
    if (typeof node === 'string' || typeof node === 'number') return String(node);
  }
  return String(row.code ?? row.name ?? 'row');
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
