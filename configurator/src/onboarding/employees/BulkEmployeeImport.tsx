import { useState, useEffect } from 'react';
import { useApp } from '../../App';
import {
  Download,
  Upload,
  Check,
  Loader2,
  AlertTriangle,
  AlertCircle,
  ChevronRight,
  X,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DigitCard } from '@/components/digit/DigitCard';
import { SubHeader } from '@/components/digit/Header';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { Banner } from '@/components/digit/Banner';
import {
  mdmsService,
  boundaryService,
  hrmsService,
  ApiClientError,
} from '@/api';
import { parseExcelFile, parseEmployeeExcel } from '@/utils/excelParser';
import { downloadEmployeeTemplate } from '@/utils/templateBuilder';
import { reportStepError, trackStepAction } from '../telemetry';
import { useOnboardingT } from '../i18n';
import { allowedEmployeeRoles, pickerChoices } from '@/lib/systemRecords';
import type {
  EmployeeExcelRow,
  Employee,
  Department,
  Designation,
  Boundary,
} from '@/api/types';

type Step = 'landing' | 'generate' | 'upload' | 'preview' | 'creating' | 'complete';

interface ParsedEmployee extends EmployeeExcelRow {
  status: 'valid' | 'error';
  error?: string;
}

/**
 * The staff-list route into Employees: a template built from the workspace's
 * own departments, designations, roles and boundaries, filled in and uploaded,
 * checked row by row, then created. Hands back to the Employees list when done
 * (onDone) or backed out of (onCancel).
 */
export default function BulkEmployeeImport({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { addUndo, state } = useApp();
  const t = useOnboardingT();
  const targetTenant = state.targetTenant || state.tenant;

  const [step, setStep] = useState<Step>('landing');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Reference data from DIGIT
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [roles, setRoles] = useState<{ code: string; name: string; description?: string }[]>([]);
  const [mobileRules, setMobileRules] = useState<{ mobileNumberRegex: string; pattern: string; countryCode?: string; prefix?: string; errorMessage: string } | null>(null);
  const [loadingRefs, setLoadingRefs] = useState(false);
  // Set when reference data is unavailable (fetch failed, or the boundary
  // tree came back empty). Distinct from per-row validation errors: without
  // reference data every jurisdiction would "validate" as not-found, so we
  // block processing instead of showing a wall of bogus row errors.
  const [refsError, setRefsError] = useState<string | null>(null);
  const [refsRetryKey, setRefsRetryKey] = useState(0);

  // Parsed employee data
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [employees, setEmployees] = useState<ParsedEmployee[]>([]);

  // Created counts
  const [createdCount, setCreatedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [createdEmployees, setCreatedEmployees] = useState<Employee[]>([]);
  // Per-row failure reasons. The loop below creates employees one at a time and
  // keeps going past a failure, so the enclosing try/catch never sees those
  // errors — without this the complete screen could only say "0 created, 1
  // failed" and the actual API message (e.g. "Unknown error occurred in
  // encryption process") was console-only.
  const [failures, setFailures] = useState<{ name: string; reason: string }[]>([]);

  useEffect(() => {
    async function fetchReferenceData() {
      setLoadingRefs(true);
      setRefsError(null);
      try {
        // Fetch hierarchy type first so boundaries come back with the correct
        // hierarchyType populated — the boundary-relationships API returns
        // hierarchyType=null in its wrapper unless explicitly filtered by it.
        const hierarchies = await boundaryService.getHierarchies(targetTenant).catch(() => []);
        const hierarchyType = hierarchies[0]?.hierarchyType;

        const [depts, desigs, bounds, fetchedRoles, fetchedMobileRules] = await Promise.all([
          mdmsService.getDepartments(targetTenant),
          mdmsService.getDesignations(targetTenant),
          // No operational hierarchy yet: an unfiltered search would return the
          // reserved WORKSPACE root, so treat it as no boundaries.
          hierarchyType ? boundaryService.searchBoundaries(targetTenant, { hierarchyType }) : Promise.resolve([]),
          mdmsService.getRoles(targetTenant).catch(() => [] as typeof roles),
          mdmsService.getMobileValidation(targetTenant).catch(() => null),
        ]);
        setDepartments(pickerChoices(depts, (dept) => dept.code));
        setDesignations(pickerChoices(desigs, (desig) => desig.code));
        setBoundaries(bounds);
        setRoles(allowedEmployeeRoles(fetchedRoles));
        setMobileRules(fetchedMobileRules);
        // Phase 2 is a prerequisite, so an empty boundary tree means the
        // reference data isn't usable for jurisdiction validation — block
        // rather than fail every row as "boundary not found".
        if (bounds.length === 0) {
          setRefsError(
            t('bulk_employees.no_boundaries', 'No boundaries found for tenant "%{tenant}". Complete Phase 2 (boundaries) first, then retry.', {
              tenant: targetTenant,
            }),
          );
        }
      } catch (err) {
        console.error('Failed to fetch reference data:', err);
        setRefsError(
          t(
            'bulk_employees.refs_failed',
            'Could not load reference data (departments, designations, boundaries) from DIGIT. Employee validation cannot run without it.',
          ),
        );
      } finally {
        setLoadingRefs(false);
      }
    }
    fetchReferenceData();
  }, [targetTenant, refsRetryKey, t]);

  const handleGenerateTemplate = async () => {
    setLoading(true);
    // Simulate template generation
    await new Promise((resolve) => setTimeout(resolve, 500));
    setLoading(false);
    setStep('generate');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so the same filename re-fires onChange on the next pick. Without
    // this, after a failed validation the user fixes the workbook + re-picks
    // the same file and nothing happens — the browser de-dupes the change.
    e.target.value = '';
    if (!file) return;

    setError(null);
    setLoading(true);

    try {
      const workbook = await parseExcelFile(file);
      const result = parseEmployeeExcel(workbook);

      if (result.data.length === 0) {
        setError(t('bulk_employees.no_rows', 'No employee data found in Excel file.'));
        return;
      }

      // Validate employees against reference data
      const validatedEmployees = validateEmployees(result.data);
      setEmployees(validatedEmployees);
      setUploadedFile(file);
      setStep('preview');
    } catch (err) {
      console.error('Excel parse error:', err);
      setError(t('bulk_employees.unreadable', 'Failed to parse Excel file. Please ensure it is a valid .xlsx file.'));
    } finally {
      setLoading(false);
    }
  };

  // Resolve a jurisdiction cell (boundary code or name) to a unique boundary.
  // Codes are authoritative; names match case-insensitively but are rejected
  // when they collide across levels (e.g. Maputo city vs Maputo province) —
  // the operator must use the code in that case. Shared by validation and
  // creation so the two can never disagree on what a cell resolves to.
  const resolveJurisdiction = (
    value: string
  ): { match: Boundary | null; reason?: 'not_found' | 'ambiguous' } => {
    const byCode = boundaries.find((b) => b.code === value);
    if (byCode) return { match: byCode };
    // Boundary nodes from the relationship search can arrive WITHOUT a name
    // at runtime (the type lies — see JurisdictionEditor.tsx, which types it
    // optional). Guard so name matching skips them instead of throwing.
    const byName = boundaries.filter((b) => (b.name ?? '').toLowerCase() === value.toLowerCase());
    if (byName.length === 1) return { match: byName[0] };
    return { match: null, reason: byName.length > 1 ? 'ambiguous' : 'not_found' };
  };

  const validateEmployees = (rawEmployees: EmployeeExcelRow[]): ParsedEmployee[] => {
    const deptCodes = departments.map((d) => d.code);
    const desigCodes = designations.map((d) => d.code);
    const validRoles = roles.map((r) => r.code);

    return rawEmployees.map((emp) => {
      const errors: string[] = [];
      if (!emp.emailId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emp.emailId)) errors.push(t('bulk_employees.email_required', 'A valid email is required to invite an employee.'));

      // Validate department(s) — comma-separated list supported; every code
      // must exist (each becomes an HRMS assignment in buildEmployee)
      if (emp.department) {
        for (const dept of emp.department.split(',').map((d) => d.trim()).filter(Boolean)) {
          if (!deptCodes.includes(dept)) {
            errors.push(t('bulk_employees.department_not_found', 'Department "%{code}" not found', { code: dept }));
          }
        }
      }

      // Validate designation
      if (emp.designation && !desigCodes.includes(emp.designation)) {
        errors.push(t('bulk_employees.designation_not_found', 'Designation "%{code}" not found', { code: emp.designation }));
      }

      // Validate roles
      if (emp.roles) {
        const empRoles = emp.roles.split(',').map((r) => r.trim());
        for (const role of empRoles) {
          if (!validRoles.includes(role)) {
            errors.push(t('bulk_employees.role_invalid', 'Role "%{code}" not valid', { code: role }));
          }
        }
      }

      // Validate jurisdictions (boundaries) — match by code OR name via the
      // shared resolver, so validation and creation agree.
      if (emp.jurisdictions) {
        const empBoundaries = emp.jurisdictions.split(',').map((b) => b.trim());
        for (const boundary of empBoundaries) {
          const resolved = resolveJurisdiction(boundary);
          if (!resolved.match) {
            if (resolved.reason === 'ambiguous') {
              errors.push(
                t('bulk_employees.boundary_ambiguous', 'Boundary name "%{name}" matches multiple boundaries — use the boundary code instead', {
                  name: boundary,
                }),
              );
            } else {
              errors.push(t('bulk_employees.boundary_not_found', 'Boundary "%{name}" not found', { name: boundary }));
            }
          }
        }
      }

      // Validate mobile number against the tenant's MDMS-configured pattern.
      // If MDMS didn't return a rule, fall back to a lenient 9-10 digit check
      // so we never silently block a valid number without a reason.
      if (emp.mobileNumber) {
        if (mobileRules) {
          let compiled: RegExp | null = null;
          try { compiled = new RegExp(mobileRules.mobileNumberRegex); } catch { compiled = null; }
          if (compiled && !compiled.test(emp.mobileNumber)) {
            errors.push(t('bulk_employees.mobile_format', 'Mobile number does not match the configured format'));
          }
        } else if (!/^\d{9,10}$/.test(emp.mobileNumber)) {
          errors.push(t('bulk_employees.mobile_digits', 'Mobile number must be 9-10 digits'));
        }
      }

      // DOB is optional (egovernments/CCRS#1949) — only a filled-in value has
      // to be well-formed. The parser already normalizes every supported cell
      // shape to YYYY-MM-DD, so this stays a defensive double-check.
      if (emp.dob && !/^\d{4}-\d{2}-\d{2}$/.test(emp.dob)) {
        errors.push(t('bulk_employees.dob_format', 'Date of birth malformed (expected YYYY-MM-DD)'));
      }

      return {
        ...emp,
        status: errors.length === 0 ? 'valid' : 'error',
        error: errors.length > 0 ? errors.join('; ') : undefined,
      };
    });
  };

  const handleCreateEmployees = async () => {
    setShowConfirmDialog(false);
    setStep('creating');
    setLoading(true);
    setProgress(0);
    setCreatedCount(0);
    setFailedCount(0);
    setFailures([]);
    setCreatedEmployees([]);

    const validEmployees = employees.filter((e) => e.status === 'valid');
    let createdTotal = 0;
    let failedTotal = 0;

    try {
      for (let i = 0; i < validEmployees.length; i++) {
        const emp = validEmployees[i];
        setProgressMessage(t('bulk_employees.creating_named', 'Creating %{name}...', { name: emp.name }));

        try {
          // Parse roles (empRoles to avoid shadowing the `roles` state)
          const empRoles = emp.roles
            ? emp.roles.split(',').map((r) => {
                const roleDef = roles.find((pr) => pr.code === r.trim());
                return {
                  code: r.trim(),
                  name: roleDef?.name || r.trim(),
                };
              })
            : [{ code: 'EMPLOYEE', name: 'Employee' }];

          // Parse jurisdictions via the same resolver validation used.
          // Validation already flags unmatched/ambiguous entries, so a miss
          // here only happens if something drifted between preview and
          // create — fail the row instead of silently defaulting to
          // 'Ward'/'ADMIN' with the raw string as the code, which would
          // create an employee with a dangling boundary reference.
          const jurisdictions = emp.jurisdictions
            ? emp.jurisdictions.split(',').map((b) => {
                const bTrimmed = b.trim();
                const resolved = resolveJurisdiction(bTrimmed);
                if (!resolved.match) {
                  throw new Error(
                    resolved.reason === 'ambiguous'
                      ? t('bulk_employees.jurisdiction_ambiguous', 'Jurisdiction "%{name}" matches multiple boundaries — use the boundary code', {
                          name: bTrimmed,
                        })
                      : t('bulk_employees.jurisdiction_unknown', 'Jurisdiction "%{name}" does not resolve to a known boundary', { name: bTrimmed })
                  );
                }
                return {
                  boundary: resolved.match.code,
                  boundaryType: resolved.match.boundaryType,
                  // eg_hrms_jurisdiction.hierarchy is NOT-NULL. The boundary
                  // resolver often has no hierarchyType (boundary-service search
                  // doesn't return it), which made buildEmployee write
                  // hierarchy=null → persister insert fails → the WHOLE employee
                  // rolls back (egov-user created, HRMS record never lands).
                  // Fall back to the tenant's boundary hierarchy ('ADMIN'),
                  // matching the bulk-import path.
                  hierarchyType: resolved.match.hierarchyType || 'ADMIN',
                };
              })
            : [];

          // Build employee object
          const employee = hrmsService.buildEmployee({
            tenantId: targetTenant,
            code: emp.employeeCode || hrmsService.generateEmployeeCode('EMP', i + 1),
            name: emp.name,
            userName: emp.userName || hrmsService.generateUsername(emp.name),
            mobileNumber: emp.mobileNumber,
            emailId: emp.emailId,
            gender: emp.gender,
            dob: emp.dob ? new Date(emp.dob).getTime() : undefined,
            department: emp.department,
            designation: emp.designation,
            roles: empRoles,
            jurisdictions,
            dateOfAppointment: emp.dateOfAppointment
              ? new Date(emp.dateOfAppointment).getTime()
              : undefined,
          });

          // Create employee
          const created = await hrmsService.createEmployee(employee);
          setCreatedEmployees((prev) => [...prev, created]);
          setCreatedCount((prev) => prev + 1);
          createdTotal += 1;
        } catch (err) {
          console.error(`Failed to create employee ${emp.name}:`, err);
          // Surface the reason, don't just count it. ApiClientError.firstError
          // carries the DIGIT error message ("Unknown error occurred in
          // encryption process", "INVALID_ROLE", …) — that string is the whole
          // difference between an operator who can fix the row and one staring
          // at "1 failed".
          const reason = err instanceof ApiClientError
            ? err.firstError
            : (err instanceof Error ? err.message : String(err));
          setFailures((prev) => [...prev, { name: emp.name, reason }]);
          setFailedCount((prev) => prev + 1);
          failedTotal += 1;
        }

        setProgress(Math.round(((i + 1) / validEmployees.length) * 100));
      }

      addUndo('create_employees', `Created ${createdCount} employees`);
      trackStepAction('employees', 'entity_import', 'employee', {
        tenant: targetTenant,
        source: 'bulk',
        count: createdTotal,
        failed: failedTotal,
      });
      setStep('complete');
    } catch (err) {
      console.error('Employee creation error:', err);
      reportStepError('employees', 'import_bulk', err, targetTenant);
      if (err instanceof ApiClientError) {
        setError(err.firstError);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('bulk_employees.create_failed', 'Failed to create employees. Please try again.'));
      }
      setStep('preview');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadTemplate = () => {
    downloadEmployeeTemplate();
  };

  const handleDownloadInvitations = () => {
    // Generate CSV content
    const headers = [
      t('common.name', 'Name'),
      t('employees.email', 'Email'),
      t('bulk_employees.mobile', 'Mobile'),
      t('departments.department', 'Department'),
      t('departments.designation', 'Designation'),
    ];
    const rows = createdEmployees.map((emp) => [
      emp.user.name,
      emp.user.emailId || '',
      emp.user.mobileNumber,
      emp.assignments?.[0]?.department || '',
      emp.assignments?.[0]?.designation || '',
    ]);

    const field = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(field).join(',')).join('\n');

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employee_invitations_${targetTenant}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = employees.filter((e) => e.status === 'valid').length;
  const errorCount = employees.filter((e) => e.status === 'error').length;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Hidden file picker. Lives at page root so the "Re-upload Fixed File"
          button in the `preview` step can trigger it — the dropzone (and the
          original input) only exist while step === 'generate', so on `preview`
          the previous getElementById call would return null and silently
          no-op (CCRS#563). */}
      <input
        id="employee-file-upload"
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileUpload}
        className="hidden"
        disabled={loading || loadingRefs || !!refsError}
      />
      {/* Reference data unavailable — blocking, with retry. Not dismissible:
          without departments/designations/boundaries, row validation would
          mark every jurisdiction as not-found. */}
      {refsError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{refsError}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRefsRetryKey((k) => k + 1)}
              disabled={loadingRefs}
              className="flex-shrink-0"
            >
              {loadingRefs ? <Loader2 className="w-4 h-4 animate-spin" /> : t('bulk_employees.retry', 'Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Error display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-6 w-6 p-0">
              <X className="h-4 w-4" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Landing */}
      {step === 'landing' && (
        <DigitCard>
          <Alert variant="info" className="mb-4 sm:mb-6">
            <AlertDescription>
              <strong className="block mb-2 text-sm sm:text-base">{t('bulk_employees.what_youll_do', 'What You’ll Do:')}</strong>
              <ul className="text-xs sm:text-sm space-y-1">
                <li>• {t('bulk_employees.do_template', 'Generate a dynamic employee template')}</li>
                <li>• {t('bulk_employees.do_fill', 'Fill in employee details (name, mobile, department, role)')}</li>
                <li>• {t('bulk_employees.do_create', 'Bulk create employees and invite them by email')}</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="bg-primary/5 border border-primary/20 rounded p-3 sm:p-4 mb-4 sm:mb-6">
            <p className="font-condensed font-medium text-foreground mb-2 text-sm sm:text-base">
              {t('bulk_employees.template_file', 'Template: %{file}', { file: 'Employee_Master_Dynamic.xlsx' })}
            </p>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {loadingRefs ? t('bulk_employees.loading_refs', 'Loading reference data...') : t('bulk_employees.available', 'Available data from DIGIT:')}
            </p>
            <ul className="text-xs sm:text-sm text-muted-foreground mt-1 space-y-1">
              <li>• {t('bulk_employees.departments_loaded', 'Departments: %{smart_count} loaded', { smart_count: departments.length })}</li>
              <li>• {t('bulk_employees.designations_loaded', 'Designations: %{smart_count} loaded', { smart_count: designations.length })}</li>
              <li>• {t('bulk_employees.roles_available', 'Roles: %{smart_count} available', { smart_count: roles.length })}</li>
              <li>• {t('bulk_employees.boundaries_loaded', 'Boundaries: %{smart_count} loaded', { smart_count: boundaries.length })}</li>
            </ul>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5 text-primary hover:text-primary">
              <ArrowLeft className="w-4 h-4" />
              {t('step.back', 'Back')}
            </Button>
            <SubmitBar
              label={loading || loadingRefs ? t('bulk_employees.loading', 'Loading...') : t('bulk_employees.get_template', 'Get the template')}
              onSubmit={handleGenerateTemplate}
              disabled={loading || loadingRefs || !!refsError}
              icon={
                loading || loadingRefs ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )
              }
            />
          </div>
        </DigitCard>
      )}

      {/* Generate Template */}
      {step === 'generate' && (
        <DigitCard>
          <SubHeader>{t('bulk_employees.generate_title', 'Step 4.1: Generate Employee Template')}</SubHeader>

          <div className="p-4 bg-success/10 border border-success/20 rounded mb-4 sm:mb-6">
            <div className="flex items-center gap-2 text-success mb-2">
              <Check className="w-5 h-5" />
              <strong className="text-sm font-condensed">{t('bulk_employees.generated', 'Template Generated!')}</strong>
            </div>
            <p className="text-xs sm:text-sm mb-2 text-foreground">
              Employee_Master_Dynamic_{targetTenant.toUpperCase()}.xlsx
            </p>

            <div className="grid grid-cols-2 gap-2 sm:gap-4 text-xs sm:text-sm mb-3 sm:mb-4">
              <div className="text-success">✓ {t('bulk_employees.departments_loaded', 'Departments: %{smart_count} loaded', { smart_count: departments.length })}</div>
              <div className="text-success">✓ {t('bulk_employees.designations_loaded', 'Designations: %{smart_count} loaded', { smart_count: designations.length })}</div>
              <div className="text-success">✓ {t('bulk_employees.roles_available', 'Roles: %{smart_count} available', { smart_count: roles.length })}</div>
              <div className="text-success">✓ {t('bulk_employees.boundaries_loaded', 'Boundaries: %{smart_count} loaded', { smart_count: boundaries.length })}</div>
            </div>

            <p className="text-xs sm:text-sm mb-2 text-muted-foreground">{t('bulk_employees.required_columns', 'Required columns:')}</p>
            <ul className="text-xs sm:text-sm space-y-1 mb-3 sm:mb-4 text-muted-foreground">
              <li>
                • <strong>name</strong> - {t('bulk_employees.col_name', 'Employee full name')}
              </li>
              <li>
                • <strong>mobileNumber</strong> -{' '}
                {!mobileRules
                  ? t('bulk_employees.col_mobile_rule', 'mobile number (validated against the tenant rule)')
                  : mobileRules.countryCode
                    ? t('bulk_employees.col_mobile_code', 'mobile number (%{code}) matching %{pattern}', {
                        code: mobileRules.countryCode,
                        pattern: mobileRules.mobileNumberRegex,
                      })
                    : t('bulk_employees.col_mobile_pattern', 'mobile number matching %{pattern}', { pattern: mobileRules.mobileNumberRegex })}
              </li>
              <li>
                • <strong>department</strong> - {t('bulk_employees.col_department', 'Department code')}
              </li>
              <li>
                • <strong>designation</strong> - {t('bulk_employees.col_designation', 'Designation code')}
              </li>
              <li>
                • <strong>roles</strong> - {t('bulk_employees.col_roles', 'Comma-separated role codes')}
              </li>
              <li>
                • <strong>jurisdictions</strong> - {t('bulk_employees.col_jurisdictions', 'Comma-separated boundary codes')}
              </li>
              <li>
                • <strong>dob</strong> - {t('bulk_employees.col_dob', 'Date of birth (YYYY-MM-DD), optional')}
              </li>
            </ul>

            <Button
              size="sm"
              className="bg-success hover:bg-success/90 text-white"
              onClick={handleDownloadTemplate}
            >
              <Download className="w-4 h-4 mr-2" />
              {t('bulk_employees.download_template', 'Download Template')}
            </Button>
          </div>

          <div
            className="border-2 border-dashed border-primary/30 rounded p-6 sm:p-8 text-center hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer mb-4"
            onClick={() => document.getElementById('employee-file-upload')?.click()}
          >
            {loading ? (
              <>
                <Loader2 className="w-8 h-8 text-primary mx-auto mb-3 animate-spin" />
                <p className="text-sm font-condensed font-medium text-foreground">
                  {t('bulk_employees.parsing', 'Parsing Excel file...')}
                </p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-primary mx-auto mb-3" />
                <p className="text-sm font-condensed font-medium text-foreground mb-2">
                  {t('bulk_employees.drop_here', 'Drop your filled employee template here')}
                </p>
                <p className="text-xs text-muted-foreground">{t('bulk_employees.or_browse', 'or click to browse')}</p>
              </>
            )}
          </div>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep('landing')}
              className="gap-1.5 text-primary hover:text-primary"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('step.back', 'Back')}
            </Button>
          </div>
        </DigitCard>
      )}

      {/* Preview */}
      {step === 'preview' && (
        <DigitCard>
          <div className="flex items-center gap-2 text-primary mb-3 sm:mb-4">
            <Check className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="font-medium text-sm sm:text-base truncate">
              {t('bulk_employees.file', 'File: %{name}', { name: uploadedFile?.name ?? '' })}
            </span>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0 mb-3 sm:mb-4">
            <div className="min-w-[600px] sm:min-w-0 px-4 sm:px-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs sm:text-sm font-condensed">{t('bulk_employees.status', 'Status')}</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">{t('common.name', 'Name')}</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">{t('bulk_employees.mobile', 'Mobile')}</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">{t('bulk_employees.dob', 'DOB')}</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">{t('bulk_employees.dept', 'Dept')}</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">{t('departments.designation', 'Designation')}</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">{t('bulk_employees.roles', 'Roles')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.slice(0, 15).map((emp, idx) => (
                    <TableRow key={idx} className={emp.status === 'error' ? 'bg-destructive/10' : ''}>
                      <TableCell>
                        {emp.status === 'valid' ? (
                          <Badge className="gap-1 text-xs bg-success text-white">
                            <Check className="w-3 h-3" /> {t('bulk_employees.valid', 'Valid')}
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1 text-xs">
                            <AlertTriangle className="w-3 h-3" /> {t('bulk_employees.error', 'Error')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-xs sm:text-sm">{emp.name}</TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">{emp.mobileNumber}</TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">{emp.dob}</TableCell>
                      <TableCell className="text-xs sm:text-sm">
                        <span className={emp.status === 'error' ? 'text-destructive' : ''}>
                          {emp.department}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm">{emp.designation}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{emp.roles}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {employees.length > 15 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  {t('bulk_employees.showing_first', 'Showing first %{shown} of %{total} employees', { shown: 15, total: employees.length })}
                </p>
              )}
            </div>
          </div>

          <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
            {t('bulk_employees.summary_total', 'Summary: %{smart_count} total', { smart_count: employees.length })} |{' '}
            <span className="text-success">{t('bulk_employees.summary_valid', '%{smart_count} valid', { smart_count: validCount })}</span> |{' '}
            <span className="text-destructive">{t('bulk_employees.summary_errors', '%{smart_count} errors', { smart_count: errorCount })}</span>
          </p>

          {errorCount > 0 && (
            <Alert variant="warning" className="mb-4 sm:mb-6">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription className="text-xs sm:text-sm">
                <p className="font-medium mb-1">{t('bulk_employees.errors_found', 'Validation errors found:')}</p>
                <ul className="list-disc list-inside space-y-1">
                  {employees
                    .filter((e) => e.status === 'error')
                    .slice(0, 3)
                    .map((e, i) => (
                      <li key={i}>
                        {e.name}: {e.error}
                      </li>
                    ))}
                  {errorCount > 3 && <li>{t('bulk_employees.more_errors', '...and %{smart_count} more errors', { smart_count: errorCount - 3 })}</li>}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep('generate')}
              className="gap-1.5 text-primary hover:text-primary"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('step.back', 'Back')}
            </Button>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              {errorCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('employee-file-upload')?.click()}
                  className="border-primary text-primary hover:bg-primary/10"
                >
                  {t('bulk_employees.reupload', 'Re-upload Fixed File')}
                </Button>
              )}
              <SubmitBar
                label={t('bulk_employees.create_count', 'Create %{smart_count} Employees', { smart_count: validCount })}
                onSubmit={() => setShowConfirmDialog(true)}
                disabled={validCount === 0}
                icon={<ChevronRight className="w-4 h-4" />}
              />
            </div>
          </div>
        </DigitCard>
      )}

      {/* Creating */}
      {step === 'creating' && (
        <DigitCard>
          <SubHeader>{t('bulk_employees.creating_title', 'Step 4.3: Creating Employees')}</SubHeader>

          <div className="mb-4 sm:mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs sm:text-sm font-medium">{progressMessage}</span>
              <span className="text-xs sm:text-sm text-primary font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs sm:text-sm text-muted-foreground mt-2">
              {t('bulk_employees.created_of', '%{created} of %{total} employees created', { created: createdCount, total: validCount })}
              {failedCount > 0 && (
                <span className="text-destructive"> {t('bulk_employees.failed_paren', '(%{smart_count} failed)', { smart_count: failedCount })}</span>
              )}
            </p>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <div className="min-w-[500px] sm:min-w-0 px-4 sm:px-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs sm:text-sm font-condensed">#</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">{t('common.name', 'Name')}</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">{t('bulk_employees.employee', 'Employee')}</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">{t('bulk_employees.user_account', 'User Account')}</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">{t('bulk_employees.assignments', 'Assignments')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.slice(0, 10).map((emp, idx) => {
                    const isCreated = idx < createdCount && emp.status === 'valid';
                    const isCreating =
                      idx === createdCount &&
                      emp.status === 'valid' &&
                      idx < createdCount + failedCount + 1;
                    const isSkipped = emp.status === 'error';

                    return (
                      <TableRow key={idx}>
                        <TableCell className="text-xs sm:text-sm">{idx + 1}</TableCell>
                        <TableCell className="font-medium text-xs sm:text-sm">{emp.name}</TableCell>
                        <TableCell className="text-xs sm:text-sm">
                          {isSkipped ? (
                            <span className="text-muted-foreground">⏭️ {t('bulk_employees.skipped', 'Skipped')}</span>
                          ) : isCreated ? (
                            <span className="text-success">✓ {t('bulk_employees.created', 'Created')}</span>
                          ) : isCreating ? (
                            <Loader2 className="w-4 h-4 text-primary animate-spin" />
                          ) : (
                            <span className="text-muted-foreground">○ {t('bulk_employees.pending', 'Pending')}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm">
                          {isSkipped ? '-' : isCreated ? <span className="text-success">✓ {t('bulk_employees.created', 'Created')}</span> : '-'}
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm">
                          {isSkipped ? '-' : isCreated ? <span className="text-success">✓ {t('bulk_employees.done', 'Done')}</span> : '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {employees.length > 10 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  {t('bulk_employees.showing_first', 'Showing first %{shown} of %{total} employees', { shown: 10, total: employees.length })}
                </p>
              )}
            </div>
          </div>
        </DigitCard>
      )}

      {/* Complete */}
      {step === 'complete' && (
        <DigitCard>
          <Banner
            successful={createdCount > 0 && failedCount === 0}
            message={
              createdCount > 0 && failedCount === 0
                ? t('bulk_employees.all_created', 'Employees Created Successfully!')
                : createdCount > 0
                ? t('bulk_employees.some_created', 'Created %{created}, %{failed} failed', { created: createdCount, failed: failedCount })
                : t('bulk_employees.none_created', 'No employees created — %{failed} failed', { failed: failedCount })
            }
            info={
              failedCount > 0
                ? `${t('bulk_employees.tenant', 'Tenant: %{tenant}', { tenant: targetTenant.toUpperCase() })} • ${t(
                    'bulk_employees.check_failures',
                    'Check the failure list below and retry the failed rows.',
                  )}`
                : t('bulk_employees.tenant', 'Tenant: %{tenant}', { tenant: targetTenant.toUpperCase() })
            }
          />

          <div className="mt-6 p-4 bg-muted rounded">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">✓ {t('bulk_employees.created', 'Created')}</TableCell>
                  <TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-success">
                    {createdCount}
                  </TableCell>
                </TableRow>
                {failedCount > 0 && (
                  <TableRow>
                    <TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">✗ {t('bulk_employees.failed', 'Failed')}</TableCell>
                    <TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-destructive">
                      {failedCount}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">⏭️ {t('bulk_employees.skipped_errors', 'Skipped (errors)')}</TableCell>
                  <TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-muted-foreground">
                    {errorCount}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">{t('bulk_employees.total', 'Total')}</TableCell>
                  <TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-primary">
                    {employees.length}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Why each row failed. The Banner above already promises a
              "failure list below" — this is it. */}
          {failures.length > 0 && (
            <Alert variant="destructive" className="text-left mt-4 sm:mt-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs sm:text-sm">
                <p className="mb-2">
                  <strong>{t('bulk_employees.failed_rows', 'Failed rows:')}</strong>
                </p>
                <ul className="space-y-1">
                  {failures.map((f, idx) => (
                    <li key={`${f.name}-${idx}`}>
                      <span className="font-medium">{f.name}</span>: {f.reason}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Alert variant="info" className="text-left mt-4 sm:mt-6 max-w-md mx-auto">
            <AlertDescription className="text-xs sm:text-sm">
              <p className="mb-2">
                <strong>{t('bulk_employees.each_received', 'Each employee received:')}</strong>
              </p>
              <ul className="space-y-1">
                <li>• {t('bulk_employees.got_record', 'HRMS employee record')}</li>
                <li>• {t('bulk_employees.got_account', 'User account (username: employee code)')}</li>
                <li>• {t('bulk_employees.got_email', 'New employees receive a secure password setup email.')}</li>
                <li>• {t('bulk_employees.got_roles', 'Role assignments')}</li>
                <li>• {t('bulk_employees.got_jurisdiction', 'Boundary jurisdiction')}</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="border-primary text-primary hover:bg-primary/10"
              onClick={handleDownloadInvitations}
              disabled={createdEmployees.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              {t('bulk_employees.download_csv', 'Download invitations CSV')}
            </Button>
            <SubmitBar
              label={t('bulk_employees.back_to_employees', 'Back to Employees')}
              onSubmit={onDone}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 sm:gap-3 text-base sm:text-lg font-condensed">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-primary/10 border-2 border-primary rounded flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
              </div>
              {t('bulk_employees.confirm_title', 'Confirm Employee Creation')}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              {t('bulk_employees.confirm_intro', 'You’re about to create %{smart_count} employees. This will:', { smart_count: validCount })}
              <ul className="mt-2 space-y-1">
                <li>• {t('bulk_employees.confirm_records', 'Create %{smart_count} HRMS records', { smart_count: validCount })}</li>
                <li>• {t('bulk_employees.confirm_accounts', 'Create %{smart_count} user accounts', { smart_count: validCount })}</li>
                <li>• {t('bulk_employees.confirm_roles', 'Assign roles and jurisdictions')}</li>
              </ul>
            </DialogDescription>
          </DialogHeader>

          {errorCount > 0 && (
            <Alert variant="warning">
              <AlertDescription className="text-xs sm:text-sm">
                <strong>{t('bulk_employees.note', 'Note:')}</strong>{' '}
                {t('bulk_employees.rows_skipped', '%{smart_count} row(s) with errors will be skipped.', { smart_count: errorCount })}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfirmDialog(false)}
              className="border-border"
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <SubmitBar label={t('bulk_employees.create_count', 'Create %{smart_count} Employees', { smart_count: validCount })} onSubmit={handleCreateEmployees} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
