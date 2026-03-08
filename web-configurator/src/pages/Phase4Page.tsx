import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import {
  Users,
  Download,
  Upload,
  Check,
  Loader2,
  AlertTriangle,
  AlertCircle,
  ChevronRight,
  X,
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
import { Header, SubHeader } from '@/components/digit/Header';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { Banner } from '@/components/digit/Banner';
import {
  mdmsService,
  boundaryService,
  hrmsService,
  ApiClientError,
  PGR_ROLES,
} from '@/api';
import { parseExcelFile, parseEmployeeExcel } from '@/utils/excelParser';
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

export default function Phase4Page() {
  const { completePhase, addUndo, state } = useApp();
  const navigate = useNavigate();

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
  const [loadingRefs, setLoadingRefs] = useState(false);

  // Parsed employee data
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [employees, setEmployees] = useState<ParsedEmployee[]>([]);

  // Created counts
  const [createdCount, setCreatedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [createdEmployees, setCreatedEmployees] = useState<Employee[]>([]);

  // Fetch reference data on mount
  useEffect(() => {
    fetchReferenceData();
  }, [state.tenant]);

  const fetchReferenceData = async () => {
    setLoadingRefs(true);
    try {
      // Fetch departments
      const depts = await mdmsService.getDepartments(state.tenant);
      setDepartments(depts);

      // Fetch designations
      const desigs = await mdmsService.getDesignations(state.tenant);
      setDesignations(desigs);

      // Fetch boundaries
      const bounds = await boundaryService.searchBoundaries(state.tenant);
      setBoundaries(bounds);
    } catch (err) {
      console.error('Failed to fetch reference data:', err);
      // Don't show error - will validate on upload
    } finally {
      setLoadingRefs(false);
    }
  };

  const handleGenerateTemplate = async () => {
    setLoading(true);
    // Simulate template generation
    await new Promise((resolve) => setTimeout(resolve, 500));
    setLoading(false);
    setStep('generate');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setLoading(true);

    try {
      const workbook = await parseExcelFile(file);
      const result = parseEmployeeExcel(workbook);

      if (result.data.length === 0) {
        setError('No employee data found in Excel file.');
        return;
      }

      // Validate employees against reference data
      const validatedEmployees = validateEmployees(result.data);
      setEmployees(validatedEmployees);
      setUploadedFile(file);
      setStep('preview');
    } catch (err) {
      console.error('Excel parse error:', err);
      setError('Failed to parse Excel file. Please ensure it is a valid .xlsx file.');
    } finally {
      setLoading(false);
    }
  };

  const validateEmployees = (rawEmployees: EmployeeExcelRow[]): ParsedEmployee[] => {
    const deptCodes = departments.map((d) => d.code);
    const desigCodes = designations.map((d) => d.code);
    const boundaryCodes = boundaries.map((b) => b.code);
    const validRoles = PGR_ROLES.map((r) => r.code);

    return rawEmployees.map((emp) => {
      const errors: string[] = [];

      // Validate department
      if (emp.department && !deptCodes.includes(emp.department)) {
        errors.push(`Department "${emp.department}" not found`);
      }

      // Validate designation
      if (emp.designation && !desigCodes.includes(emp.designation)) {
        errors.push(`Designation "${emp.designation}" not found`);
      }

      // Validate roles
      if (emp.roles) {
        const empRoles = emp.roles.split(',').map((r) => r.trim());
        for (const role of empRoles) {
          if (!validRoles.includes(role)) {
            errors.push(`Role "${role}" not valid`);
          }
        }
      }

      // Validate jurisdictions (boundaries)
      if (emp.jurisdictions) {
        const empBoundaries = emp.jurisdictions.split(',').map((b) => b.trim());
        for (const boundary of empBoundaries) {
          if (!boundaryCodes.includes(boundary)) {
            errors.push(`Boundary "${boundary}" not found`);
          }
        }
      }

      // Validate mobile number
      if (emp.mobileNumber && !/^\d{10}$/.test(emp.mobileNumber)) {
        errors.push('Invalid mobile number');
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
    setCreatedEmployees([]);

    const validEmployees = employees.filter((e) => e.status === 'valid');

    try {
      for (let i = 0; i < validEmployees.length; i++) {
        const emp = validEmployees[i];
        setProgressMessage(`Creating ${emp.name}...`);

        try {
          // Parse roles
          const roles = emp.roles
            ? emp.roles.split(',').map((r) => {
                const roleDef = PGR_ROLES.find((pr) => pr.code === r.trim());
                return {
                  code: r.trim(),
                  name: roleDef?.name || r.trim(),
                };
              })
            : [{ code: 'EMPLOYEE', name: 'Employee' }];

          // Parse jurisdictions
          const jurisdictions = emp.jurisdictions
            ? emp.jurisdictions.split(',').map((b) => {
                const boundary = boundaries.find((bd) => bd.code === b.trim());
                return {
                  boundary: b.trim(),
                  boundaryType: boundary?.boundaryType || 'Ward',
                  hierarchyType: boundary?.hierarchyType || 'ADMIN',
                };
              })
            : [];

          // Build employee object
          const employee = hrmsService.buildEmployee({
            tenantId: state.tenant,
            code: emp.employeeCode || hrmsService.generateEmployeeCode('EMP', i + 1),
            name: emp.name,
            userName: emp.userName || hrmsService.generateUsername(emp.name),
            mobileNumber: emp.mobileNumber,
            emailId: emp.emailId,
            gender: emp.gender,
            department: emp.department,
            designation: emp.designation,
            roles,
            jurisdictions,
            dateOfAppointment: emp.dateOfAppointment
              ? new Date(emp.dateOfAppointment).getTime()
              : undefined,
          });

          // Create employee
          const created = await hrmsService.createEmployee(employee);
          setCreatedEmployees((prev) => [...prev, created]);
          setCreatedCount((prev) => prev + 1);
        } catch (err) {
          console.error(`Failed to create employee ${emp.name}:`, err);
          setFailedCount((prev) => prev + 1);
        }

        setProgress(Math.round(((i + 1) / validEmployees.length) * 100));
      }

      addUndo('create_employees', `Created ${createdCount} employees`);
      setStep('complete');
    } catch (err) {
      console.error('Employee creation error:', err);
      if (err instanceof ApiClientError) {
        setError(err.firstError);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create employees. Please try again.');
      }
      setStep('preview');
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    completePhase(4);
    navigate('/complete');
  };

  const handleDownloadTemplate = () => {
    alert('Template download would start here.');
  };

  const handleDownloadCredentials = () => {
    // Generate CSV content
    const headers = ['Name', 'Username', 'Password', 'Mobile', 'Department', 'Designation'];
    const rows = createdEmployees.map((emp) => [
      emp.user.name,
      emp.user.userName,
      'eGov@123', // Default password
      emp.user.mobileNumber,
      emp.assignments?.[0]?.department || '',
      emp.assignments?.[0]?.designation || '',
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employee_credentials_${state.tenant}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = employees.filter((e) => e.status === 'valid').length;
  const errorCount = employees.filter((e) => e.status === 'error').length;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header - DIGIT style */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 border-2 border-primary rounded flex items-center justify-center flex-shrink-0">
          <Users className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
        </div>
        <div className="min-w-0">
          <Header className="mb-0 text-lg sm:text-2xl">Phase 4: Employee Onboarding</Header>
          <p className="text-sm sm:text-base text-muted-foreground truncate">
            Bulk create employee accounts with roles and jurisdictions
          </p>
        </div>
      </div>

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

      {/* Prerequisites check */}
      <div className="p-4 bg-success/10 border border-success/20 rounded">
        <div className="flex items-center gap-2 text-success mb-2">
          <Check className="w-5 h-5" />
          <strong className="text-sm font-condensed">Prerequisites Met:</strong>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-1 sm:gap-4 text-xs sm:text-sm text-foreground">
          <span className="flex items-center gap-1">
            <Check className="w-3 h-3 text-success" /> Phase 1: Tenant created
          </span>
          <span className="flex items-center gap-1">
            <Check className="w-3 h-3 text-success" /> Phase 2: Boundaries configured
          </span>
          <span className="flex items-center gap-1">
            <Check className="w-3 h-3 text-success" /> Phase 3: Departments & Designations created
          </span>
        </div>
      </div>

      {/* Landing */}
      {step === 'landing' && (
        <DigitCard>
          <Alert variant="info" className="mb-4 sm:mb-6">
            <AlertDescription>
              <strong className="block mb-2 text-sm sm:text-base">What You'll Do:</strong>
              <ul className="text-xs sm:text-sm space-y-1">
                <li>• Generate a dynamic employee template</li>
                <li>• Fill in employee details (name, mobile, department, role)</li>
                <li>• Bulk create employee accounts with login credentials</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="bg-primary/5 border border-primary/20 rounded p-3 sm:p-4 mb-4 sm:mb-6">
            <p className="font-condensed font-medium text-foreground mb-2 text-sm sm:text-base">
              Template: Employee_Master_Dynamic.xlsx
            </p>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {loadingRefs ? 'Loading reference data...' : 'Available data from DIGIT:'}
            </p>
            <ul className="text-xs sm:text-sm text-muted-foreground mt-1 space-y-1">
              <li>• Departments: {departments.length} loaded</li>
              <li>• Designations: {designations.length} loaded</li>
              <li>• Roles: {PGR_ROLES.length} available</li>
              <li>• Boundaries: {boundaries.length} loaded</li>
            </ul>
          </div>

          <div className="flex justify-end">
            <SubmitBar
              label={loading || loadingRefs ? 'Loading...' : 'Start Phase 4'}
              onSubmit={handleGenerateTemplate}
              disabled={loading || loadingRefs}
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
          <SubHeader>Step 4.1: Generate Employee Template</SubHeader>

          <div className="p-4 bg-success/10 border border-success/20 rounded mb-4 sm:mb-6">
            <div className="flex items-center gap-2 text-success mb-2">
              <Check className="w-5 h-5" />
              <strong className="text-sm font-condensed">Template Generated!</strong>
            </div>
            <p className="text-xs sm:text-sm mb-2 text-foreground">
              Employee_Master_Dynamic_{state.tenant.toUpperCase()}.xlsx
            </p>

            <div className="grid grid-cols-2 gap-2 sm:gap-4 text-xs sm:text-sm mb-3 sm:mb-4">
              <div className="text-success">✓ Departments: {departments.length} loaded</div>
              <div className="text-success">✓ Designations: {designations.length} loaded</div>
              <div className="text-success">✓ Roles: {PGR_ROLES.length} available</div>
              <div className="text-success">✓ Boundaries: {boundaries.length} loaded</div>
            </div>

            <p className="text-xs sm:text-sm mb-2 text-muted-foreground">Required columns:</p>
            <ul className="text-xs sm:text-sm space-y-1 mb-3 sm:mb-4 text-muted-foreground">
              <li>
                • <strong>name</strong> - Employee full name
              </li>
              <li>
                • <strong>mobileNumber</strong> - 10-digit mobile number
              </li>
              <li>
                • <strong>department</strong> - Department code
              </li>
              <li>
                • <strong>designation</strong> - Designation code
              </li>
              <li>
                • <strong>roles</strong> - Comma-separated role codes
              </li>
              <li>
                • <strong>jurisdictions</strong> - Comma-separated boundary codes
              </li>
            </ul>

            <Button
              size="sm"
              className="bg-success hover:bg-success/90 text-white"
              onClick={handleDownloadTemplate}
            >
              <Download className="w-4 h-4 mr-2" />
              Download Template
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
                  Parsing Excel file...
                </p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-primary mx-auto mb-3" />
                <p className="text-sm font-condensed font-medium text-foreground mb-2">
                  Drop your filled employee template here
                </p>
                <p className="text-xs text-muted-foreground">or click to browse</p>
              </>
            )}
            <input
              id="employee-file-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
              disabled={loading}
            />
          </div>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep('landing')}
              className="text-muted-foreground hover:text-primary"
            >
              ← Back
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
              File: {uploadedFile?.name}
            </span>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0 mb-3 sm:mb-4">
            <div className="min-w-[600px] sm:min-w-0 px-4 sm:px-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs sm:text-sm font-condensed">Status</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Name</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Mobile</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Dept</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Designation</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Roles</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.slice(0, 15).map((emp, idx) => (
                    <TableRow key={idx} className={emp.status === 'error' ? 'bg-destructive/10' : ''}>
                      <TableCell>
                        {emp.status === 'valid' ? (
                          <Badge className="gap-1 text-xs bg-success text-white">
                            <Check className="w-3 h-3" /> Valid
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1 text-xs">
                            <AlertTriangle className="w-3 h-3" /> Error
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-xs sm:text-sm">{emp.name}</TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">{emp.mobileNumber}</TableCell>
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
                  Showing first 15 of {employees.length} employees
                </p>
              )}
            </div>
          </div>

          <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
            Summary: {employees.length} total |{' '}
            <span className="text-success">{validCount} valid</span> |{' '}
            <span className="text-destructive">{errorCount} errors</span>
          </p>

          {errorCount > 0 && (
            <Alert variant="warning" className="mb-4 sm:mb-6">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription className="text-xs sm:text-sm">
                <p className="font-medium mb-1">Validation errors found:</p>
                <ul className="list-disc list-inside space-y-1">
                  {employees
                    .filter((e) => e.status === 'error')
                    .slice(0, 3)
                    .map((e, i) => (
                      <li key={i}>
                        {e.name}: {e.error}
                      </li>
                    ))}
                  {errorCount > 3 && <li>...and {errorCount - 3} more errors</li>}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep('generate')}
              className="text-muted-foreground hover:text-primary"
            >
              ← Back
            </Button>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              {errorCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('employee-file-upload')?.click()}
                  className="border-primary text-primary hover:bg-primary/10"
                >
                  Re-upload Fixed File
                </Button>
              )}
              <SubmitBar
                label={`Create ${validCount} Employees`}
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
          <SubHeader>Step 4.3: Creating Employees</SubHeader>

          <div className="mb-4 sm:mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs sm:text-sm font-medium">{progressMessage}</span>
              <span className="text-xs sm:text-sm text-primary font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs sm:text-sm text-muted-foreground mt-2">
              {createdCount} of {validCount} employees created
              {failedCount > 0 && <span className="text-destructive"> ({failedCount} failed)</span>}
            </p>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <div className="min-w-[500px] sm:min-w-0 px-4 sm:px-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs sm:text-sm font-condensed">#</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Name</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Employee</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">User Account</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Assignments</TableHead>
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
                            <span className="text-muted-foreground">⏭️ Skipped</span>
                          ) : isCreated ? (
                            <span className="text-success">✓ Created</span>
                          ) : isCreating ? (
                            <Loader2 className="w-4 h-4 text-primary animate-spin" />
                          ) : (
                            <span className="text-muted-foreground">○ Pending</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm">
                          {isSkipped ? '-' : isCreated ? <span className="text-success">✓ Created</span> : '-'}
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm">
                          {isSkipped ? '-' : isCreated ? <span className="text-success">✓ Done</span> : '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {employees.length > 10 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Showing first 10 of {employees.length} employees
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
            successful={true}
            message="Employees Created Successfully!"
            info={`Tenant: ${state.tenant.toUpperCase()}`}
          />

          <div className="mt-6 p-4 bg-muted rounded">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">✓ Created</TableCell>
                  <TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-success">
                    {createdCount}
                  </TableCell>
                </TableRow>
                {failedCount > 0 && (
                  <TableRow>
                    <TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">✗ Failed</TableCell>
                    <TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-destructive">
                      {failedCount}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">⏭️ Skipped (errors)</TableCell>
                  <TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-muted-foreground">
                    {errorCount}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">Total</TableCell>
                  <TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-primary">
                    {employees.length}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <Alert variant="info" className="text-left mt-4 sm:mt-6 max-w-md mx-auto">
            <AlertDescription className="text-xs sm:text-sm">
              <p className="mb-2">
                <strong>Each employee received:</strong>
              </p>
              <ul className="space-y-1">
                <li>• HRMS employee record</li>
                <li>• User account (username: lowercase name)</li>
                <li>
                  • Password: <code className="bg-muted px-1 rounded text-xs text-primary">eGov@123</code>
                </li>
                <li>• Role assignments</li>
                <li>• Boundary jurisdiction</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="border-primary text-primary hover:bg-primary/10"
              onClick={handleDownloadCredentials}
              disabled={createdEmployees.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Download Credentials CSV
            </Button>
            <SubmitBar
              label="Complete Setup"
              onSubmit={handleContinue}
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
              Confirm Employee Creation
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              You're about to create <strong className="text-primary">{validCount} employees</strong>.
              This will:
              <ul className="mt-2 space-y-1">
                <li>• Create {validCount} HRMS records</li>
                <li>• Create {validCount} user accounts</li>
                <li>• Assign roles and jurisdictions</li>
              </ul>
            </DialogDescription>
          </DialogHeader>

          {errorCount > 0 && (
            <Alert variant="warning">
              <AlertDescription className="text-xs sm:text-sm">
                <strong>Note:</strong> {errorCount} row(s) with errors will be skipped.
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
              Cancel
            </Button>
            <SubmitBar label={`Create ${validCount} Employees`} onSubmit={handleCreateEmployees} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
