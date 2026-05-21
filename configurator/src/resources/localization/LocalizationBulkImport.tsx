import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Upload,
  Download,
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
import { triggerDownload } from '@/admin/bulk/BulkImportPanel';
import { localizationService } from '@/api';
import { useApp } from '../../App';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';

type Step = 'landing' | 'preview' | 'uploading' | 'complete';

interface ParsedRow {
  code: string;
  module: string;
  locale: string;
  message: string;
  status: 'valid' | 'error';
  error?: string;
}

const REQUIRED_COLUMNS = ['code', 'module', 'locale', 'message'] as const;

function buildTemplate(tenantId: string, locales: string[]): Blob {
  const wb = XLSX.utils.book_new();

  const sample = XLSX.utils.aoa_to_sheet([
    REQUIRED_COLUMNS as unknown as string[],
    ['EXAMPLE_KEY_HELLO', 'rainmaker-pgr', locales[0] ?? 'en_IN', 'Hello'],
    ['EXAMPLE_KEY_HELLO', 'rainmaker-pgr', locales[1] ?? 'sw_KE', 'Habari'],
    ['EXAMPLE_KEY_GOODBYE', 'rainmaker-pgr', locales[0] ?? 'en_IN', 'Goodbye'],
  ]);
  sample['!cols'] = [{ wch: 36 }, { wch: 22 }, { wch: 10 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, sample, 'Localization');

  const notesRows = [
    ['Localization bulk import template'],
    [`Tenant: ${tenantId}`],
    [`Locales registered for this tenant: ${locales.join(', ') || '(none)'}`],
    [''],
    ['Required columns (case-sensitive headers, in this order):'],
    ['  code      The lookup key the UI calls t() with (e.g. CS_REJECT_COMPLAINT).'],
    ['  module    Localization module — e.g. rainmaker-pgr, rainmaker-common, digit-ui.'],
    ['  locale    Locale code (en_IN, sw_KE, …). Must be registered on the tenant.'],
    ['  message   Display text shown to the user. May contain spaces, punctuation, and Unicode.'],
    [''],
    ['Behaviour:'],
    ['  - Rows are upserted: existing (tenant, locale, module, code) tuples are overwritten,'],
    ['    new ones inserted. Nothing is deleted. To remove a key, ignore this importer and'],
    ['    use the localization-service _delete endpoint directly.'],
    ['  - Duplicate (tenant, locale, module, code) rows in one file are deduped — last wins.'],
    ['  - On success, the localization service cache is busted automatically; users may'],
    ['    still need to refresh their browser to drop the SPA localStorage cache.'],
    [''],
    ['Tip: download an export of the current state, edit messages in Excel, re-upload.'],
  ];
  const notes = XLSX.utils.aoa_to_sheet(notesRows);
  notes['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, notes, 'Instructions');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function parseWorkbook(wb: XLSX.WorkBook): { rows: Omit<ParsedRow, 'status' | 'error'>[]; parseError?: string } {
  const sheetName =
    wb.SheetNames.find((n) => /localization/i.test(n)) ?? wb.SheetNames[0];
  if (!sheetName) return { rows: [], parseError: 'Workbook has no sheets.' };
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  if (rows.length === 0) {
    return { rows: [], parseError: `Sheet "${sheetName}" is empty.` };
  }

  const firstRow = rows[0];
  const missing = REQUIRED_COLUMNS.filter((c) => !(c in firstRow));
  if (missing.length > 0) {
    return {
      rows: [],
      parseError: `Missing required column(s): ${missing.join(', ')}. Expected headers: ${REQUIRED_COLUMNS.join(', ')}.`,
    };
  }

  const parsed = rows.map((r) => ({
    code: String(r.code ?? '').trim(),
    module: String(r.module ?? '').trim(),
    locale: String(r.locale ?? '').trim(),
    message: String(r.message ?? ''),
  }));
  return { rows: parsed };
}

function validateRow(row: Omit<ParsedRow, 'status' | 'error'>, knownLocales: Set<string>): string[] {
  const errs: string[] = [];
  if (!row.code) errs.push('code is required');
  if (!row.module) errs.push('module is required');
  if (!row.locale) errs.push('locale is required');
  if (!row.message) errs.push('message is required');
  if (row.locale && knownLocales.size > 0 && !knownLocales.has(row.locale)) {
    errs.push(`locale "${row.locale}" is not registered on this tenant`);
  }
  return errs;
}

export function LocalizationBulkImport() {
  const { state } = useApp();
  const tenantId = state.tenant;
  const navigate = useNavigate();
  const { locales, isLoading: localesLoading } = useAvailableLocales();
  const knownLocales = new Set(locales.map((l) => l.value));

  const [step, setStep] = useState<Step>('landing');
  const [error, setError] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [success, setSuccess] = useState(0);
  const [failed, setFailed] = useState(0);

  const handleTemplateDownload = useCallback(() => {
    const blob = buildTemplate(tenantId, locales.map((l) => l.value));
    triggerDownload(blob, `localization-template-${tenantId}.xlsx`);
  }, [tenantId, locales]);

  const handleUpload = useCallback(
    async (file: File) => {
      setError(null);
      setUploadedFile(file);
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        const { rows: parsed, parseError } = parseWorkbook(wb);
        if (parseError) {
          setError(parseError);
          return;
        }
        const validated: ParsedRow[] = parsed.map((r) => {
          const errs = validateRow(r, knownLocales);
          return {
            ...r,
            status: errs.length === 0 ? 'valid' : 'error',
            error: errs.length > 0 ? errs.join('; ') : undefined,
          };
        });
        setRows(validated);
        setStep('preview');
      } catch (e) {
        console.error('Parse error', e);
        setError('Failed to parse file. Upload a valid .xlsx, .xls, or .csv.');
      }
    },
    [knownLocales],
  );

  const handleConfirm = useCallback(async () => {
    setStep('uploading');
    setProgress(0);
    setSuccess(0);
    setFailed(0);

    const valid = rows.filter((r) => r.status === 'valid');

    // Group by locale; the localization service writes one batch per locale
    // and dedupes within a batch by (tenant, locale, module, code).
    const byLocale = new Map<string, ParsedRow[]>();
    for (const r of valid) {
      if (!byLocale.has(r.locale)) byLocale.set(r.locale, []);
      byLocale.get(r.locale)!.push(r);
    }

    const totalLocales = byLocale.size;
    let i = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    for (const [locale, msgs] of byLocale) {
      i += 1;
      setProgressMsg(`Upserting ${msgs.length} message${msgs.length === 1 ? '' : 's'} into ${locale} (${i}/${totalLocales})…`);
      const result = await localizationService.upsertMessages(tenantId, locale, msgs);
      totalSuccess += result.success;
      totalFailed += result.failed;
      setProgress(Math.round((i / (totalLocales + 1)) * 100));
    }

    setProgressMsg('Busting localization cache…');
    try {
      await localizationService.cacheBust();
    } catch (e) {
      console.warn('cache-bust failed', e);
      // Don't block — upserts succeeded; cache will eventually expire.
    }
    setProgress(100);
    setSuccess(totalSuccess);
    setFailed(totalFailed + (rows.length - valid.length));
    setStep('complete');
  }, [rows, tenantId]);

  const validCount = rows.filter((r) => r.status === 'valid').length;
  const invalidCount = rows.length - validCount;

  return (
    <div className="container mx-auto py-6 px-4 max-w-5xl">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/manage/localization')} className="gap-1">
          <ArrowLeft className="w-4 h-4" />
          Back to Localization
        </Button>
      </div>

      <h1 className="text-2xl font-semibold mb-1">Bulk import localization</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Upload an .xlsx/.csv with columns <code>code</code>, <code>module</code>, <code>locale</code>, <code>message</code>. Tenant: <span className="font-mono">{tenantId}</span>.
      </p>

      {step === 'landing' && (
        <div className="space-y-4">
          <DigitCard className="p-6">
            <div className="flex items-start gap-4">
              <FileSpreadsheet className="w-8 h-8 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <h2 className="font-semibold mb-1">1. Download the template</h2>
                <p className="text-sm text-muted-foreground mb-3">
                  Pre-filled with example rows for {locales.map((l) => l.value).join(', ') || 'the default locale'}, plus an Instructions sheet.
                </p>
                <Button onClick={handleTemplateDownload} variant="outline" size="sm" className="gap-1.5" disabled={localesLoading}>
                  <Download className="w-4 h-4" />
                  Download template
                </Button>
              </div>
            </div>
          </DigitCard>

          <DigitCard className="p-6">
            <div className="flex items-start gap-4">
              <Upload className="w-8 h-8 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <h2 className="font-semibold mb-1">2. Upload your file</h2>
                <p className="text-sm text-muted-foreground mb-3">
                  Existing keys will be overwritten. Localization service cache is busted automatically on success.
                </p>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                  }}
                  className="block text-sm file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary-main file:text-white hover:file:opacity-90 cursor-pointer"
                />
              </div>
            </div>
          </DigitCard>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <Alert>
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              <span className="font-medium">{uploadedFile?.name}</span> — {rows.length} rows parsed:{' '}
              <Badge variant="secondary" className="ml-1">{validCount} valid</Badge>
              {invalidCount > 0 && <Badge variant="destructive" className="ml-1">{invalidCount} invalid</Badge>}
            </AlertDescription>
          </Alert>

          <DigitCard>
            <div className="max-h-[420px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>code</TableHead>
                    <TableHead>module</TableHead>
                    <TableHead>locale</TableHead>
                    <TableHead>message</TableHead>
                    <TableHead className="w-24">status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 200).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell className="font-mono text-xs">{r.module}</TableCell>
                      <TableCell className="font-mono text-xs">{r.locale}</TableCell>
                      <TableCell className="text-xs max-w-[280px] truncate" title={r.message}>{r.message}</TableCell>
                      <TableCell>
                        {r.status === 'valid' ? (
                          <Badge variant="secondary" className="gap-1"><Check className="w-3 h-3" />ok</Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1" title={r.error}><X className="w-3 h-3" />{r.error}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > 200 && (
                <p className="text-xs text-muted-foreground p-3 text-center">
                  Showing first 200 of {rows.length} rows.
                </p>
              )}
            </div>
          </DigitCard>

          <div className="flex gap-2">
            <Button onClick={handleConfirm} disabled={validCount === 0} className="gap-1.5">
              <Upload className="w-4 h-4" />
              Import {validCount} valid {validCount === 1 ? 'row' : 'rows'}
            </Button>
            <Button variant="outline" onClick={() => { setStep('landing'); setRows([]); setUploadedFile(null); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === 'uploading' && (
        <DigitCard className="p-6">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 className="w-5 h-5 animate-spin text-primary-main" />
            <span className="font-medium">{progressMsg}</span>
          </div>
          <Progress value={progress} />
        </DigitCard>
      )}

      {step === 'complete' && (
        <div className="space-y-4">
          <Alert>
            <Check className="w-4 h-4" />
            <AlertDescription>
              <span className="font-medium">{success}</span> message{success === 1 ? '' : 's'} upserted
              {failed > 0 ? <>, <span className="font-medium text-destructive">{failed}</span> failed</> : null}.
              Localization cache busted. Users may need to refresh their browsers.
            </AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/manage/localization')}>Back to Localization</Button>
            <Button variant="outline" onClick={() => { setStep('landing'); setRows([]); setUploadedFile(null); setError(null); }}>
              Import another file
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
