import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { parseDepartmentExcel, parseDesignationExcel, parseExcelFile } from '@/utils/excelParser';
import { downloadCommonMastersTemplate } from '@/utils/templateBuilder';
import { describeSaveError } from '../errors';
import { reportStepError } from '../telemetry';
import { useOnboardingT } from '../i18n';
import { importMasters, type ImportResult, type MasterInput } from './mastersApi';

interface Parsed {
  fileName: string;
  departments: MasterInput[];
  designations: MasterInput[];
  problems: string[];
}

export interface BulkImportSummary {
  departments: ImportResult;
  designations: ImportResult;
}

/**
 * The spreadsheet route: one workbook with a Department sheet and a
 * Designation sheet. It reads the file, says what it found, and imports on
 * confirmation; codes the workspace already has are skipped.
 */
export function BulkMastersUpload({
  tenantId,
  existingDepartments,
  existingDesignations,
  onDone,
  onCancel,
}: {
  tenantId: string;
  existingDepartments: Set<string>;
  existingDesignations: Set<string>;
  onDone: (summary: BulkImportSummary) => void;
  onCancel: () => void;
}) {
  const t = useOnboardingT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const workbook = await parseExcelFile(file);
      const departments = parseDepartmentExcel(workbook);
      const designations = parseDesignationExcel(workbook);
      if (!departments.data.length && !designations.data.length) {
        setError(t('departments.bulk.none_found', 'No departments or designations found. Use the template’s Department and Designation sheets.'));
        setParsed(null);
        return;
      }
      setParsed({
        fileName: file.name,
        departments: departments.data.filter((row) => row.active !== false).map(({ code, name }) => ({ code, name })),
        designations: designations.data
          .filter((row) => row.active !== false)
          .map(({ code, name, department }) => ({ code, name, departments: department ?? [] })),
        problems: [...departments.validation.errors, ...designations.validation.errors].map((problem) =>
          problem.row ? t('common.row_problem', 'Row %{row}: %{problem}', { row: problem.row, problem: problem.message }) : problem.message,
        ),
      });
    } catch {
      setError(t('departments.bulk.unreadable', 'That file couldn’t be read. Upload the filled-in .xlsx template.'));
    } finally {
      setReading(false);
    }
  };

  const bringIn = async () => {
    if (!parsed) return;
    setImporting(true);
    setError(null);
    try {
      const departments = await importMasters(tenantId, 'department', parsed.departments, existingDepartments);
      const designations = await importMasters(tenantId, 'designation', parsed.designations, existingDesignations);
      onDone({ departments, designations });
    } catch (err) {
      reportStepError('departments', 'import_bulk', err, tenantId);
      setError(describeSaveError(err, t('common.import_failed', 'Importing failed. Try again.'), t));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
      <div className="mx-auto w-12 h-12 rounded-md bg-primary/10 text-primary flex items-center justify-center">
        <FileSpreadsheet className="w-6 h-6" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-foreground">{t('departments.bulk.title', 'Upload your departments and designations')}</h3>

      {!parsed ? (
        <>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t('departments.bulk.intro', 'Choose the filled-in spreadsheet. It has one sheet for departments and one for designations.')}
          </p>
          <Button className="mt-4 gap-2" onClick={() => fileInput.current?.click()} disabled={reading}>
            {reading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {t('common.choose_file', 'Choose a file')}
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">{t('common.template_hint', 'Not sure of the columns? Start from ours.')}</p>
          <Button variant="ghost" size="sm" className="mt-1 gap-1.5 text-primary" onClick={downloadCommonMastersTemplate}>
            <Download className="w-4 h-4" />
            {t('common.download_template', 'Download template')}
          </Button>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t('departments.bulk.found', '%{file} has %{departments} and %{designations}.', {
              file: parsed.fileName,
              departments:
                parsed.departments.length === 1
                  ? t('departments.count_department_one', '%{count} department', { count: 1 })
                  : t('departments.count_department_other', '%{count} departments', { count: parsed.departments.length }),
              designations:
                parsed.designations.length === 1
                  ? t('departments.count_designation_one', '%{count} designation', { count: 1 })
                  : t('departments.count_designation_other', '%{count} designations', { count: parsed.designations.length }),
            })}
          </p>
          {parsed.problems.length > 0 && (
            <ul className="mt-3 max-h-32 overflow-y-auto rounded-md bg-muted/60 p-3 text-left text-xs text-muted-foreground space-y-1">
              {parsed.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="ghost" onClick={() => setParsed(null)} disabled={importing}>
              {t('common.choose_another_file', 'Choose another file')}
            </Button>
            <Button onClick={bringIn} disabled={importing} className="gap-2">
              {importing && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('common.bring_them_in', 'Bring them in')}
            </Button>
          </div>
        </>
      )}

      {error && (
        <Alert variant="destructive" className="mt-4 text-left">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(event) => read(event.target.files?.[0])}
      />
      <div className="mt-4 border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={importing}>
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  );
}
