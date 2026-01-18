import { useState } from 'react';
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
  ChevronRight
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

type Step = 'landing' | 'generate' | 'upload' | 'preview' | 'creating' | 'complete';

const mockEmployees = [
  { name: 'John Doe', mobile: '9876543210', dept: 'WATER', desig: 'Engineer', roles: 'Employee', status: 'valid' },
  { name: 'Jane Smith', mobile: '9876543211', dept: 'WATER', desig: 'Jr. Engineer', roles: 'Employee', status: 'valid' },
  { name: 'Bob Johnson', mobile: '9876543212', dept: 'SANITATION', desig: 'Inspector', roles: 'Employee, CRS Viewer', status: 'valid' },
  { name: 'Alice Brown', mobile: '9876543213', dept: 'INVALID', desig: 'Clerk', roles: 'Employee', status: 'error' },
  { name: 'Charlie Lee', mobile: '9876543214', dept: 'REVENUE', desig: 'Tax Officer', roles: 'CRS Admin', status: 'valid' },
];

export default function Phase4Page() {
  const { completePhase, addUndo, state } = useApp();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('landing');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [createdCount, setCreatedCount] = useState(0);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const handleGenerateTemplate = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    setLoading(false);
    setStep('generate');
  };

  const handleCreateEmployees = async () => {
    setShowConfirmDialog(false);
    setStep('creating');
    setLoading(true);

    const validEmployees = mockEmployees.filter(e => e.status === 'valid');
    for (let i = 0; i < validEmployees.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 800));
      setCreatedCount(i + 1);
      setProgress(Math.round(((i + 1) / validEmployees.length) * 100));
    }

    addUndo('create_employees', `Created ${validEmployees.length} employees`);
    setLoading(false);
    setStep('complete');
  };

  const handleContinue = () => {
    completePhase(4);
    navigate('/complete');
  };

  const validCount = mockEmployees.filter(e => e.status === 'valid').length;
  const errorCount = mockEmployees.filter(e => e.status === 'error').length;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header - DIGIT style */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 border-2 border-primary rounded flex items-center justify-center flex-shrink-0">
          <Users className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
        </div>
        <div className="min-w-0">
          <Header className="mb-0 text-lg sm:text-2xl">Phase 4: Employee Onboarding</Header>
          <p className="text-sm sm:text-base text-muted-foreground truncate">Bulk create employee accounts with roles and jurisdictions</p>
        </div>
      </div>

      {/* Prerequisites check */}
      <div className="p-4 bg-success/10 border border-success/20 rounded">
        <div className="flex items-center gap-2 text-success mb-2">
          <Check className="w-5 h-5" />
          <strong className="text-sm font-condensed">Prerequisites Met:</strong>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-1 sm:gap-4 text-xs sm:text-sm text-foreground">
          <span className="flex items-center gap-1"><Check className="w-3 h-3 text-success" /> Phase 1: Tenant created</span>
          <span className="flex items-center gap-1"><Check className="w-3 h-3 text-success" /> Phase 2: Boundaries configured</span>
          <span className="flex items-center gap-1"><Check className="w-3 h-3 text-success" /> Phase 3: Departments & Designations created</span>
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
            <p className="font-condensed font-medium text-foreground mb-2 text-sm sm:text-base">Template: Employee_Master_Dynamic.xlsx</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Generated with dropdowns for your tenant's:</p>
            <ul className="text-xs sm:text-sm text-muted-foreground mt-1 space-y-1">
              <li>• Departments (from Phase 3)</li>
              <li>• Designations (from Phase 3)</li>
              <li>• Roles (Employee, CRS Viewer, CRS Admin, etc.)</li>
            </ul>
          </div>

          <div className="flex justify-end">
            <SubmitBar
              label={loading ? 'Starting...' : 'Start Phase 4'}
              onSubmit={handleGenerateTemplate}
              disabled={loading}
              icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
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
            <p className="text-xs sm:text-sm mb-2 text-foreground">Employee_Master_Dynamic_{state.tenant.toUpperCase()}.xlsx</p>

            <div className="grid grid-cols-2 gap-2 sm:gap-4 text-xs sm:text-sm mb-3 sm:mb-4">
              <div className="text-success">✓ Departments: 3 loaded</div>
              <div className="text-success">✓ Designations: 5 loaded</div>
              <div className="text-success">✓ Roles: 8 available</div>
              <div className="text-success">✓ Boundaries: 13 loaded</div>
            </div>

            <p className="text-xs sm:text-sm mb-2 text-muted-foreground">Sheets:</p>
            <ul className="text-xs sm:text-sm space-y-1 mb-3 sm:mb-4 text-muted-foreground">
              <li>• README - Instructions and role descriptions</li>
              <li>• Ref_Departments - Available departments</li>
              <li>• Ref_Designations - Available designations</li>
              <li>• Ref_Roles - Available roles with descriptions</li>
              <li>• Employee Master - <strong className="text-primary">Fill this sheet</strong></li>
            </ul>

            <Button size="sm" className="bg-success hover:bg-success/90 text-white">
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('landing')} className="text-muted-foreground hover:text-primary">← Back</Button>
            <SubmitBar
              label="I've Filled the Template"
              onSubmit={() => setStep('upload')}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Upload */}
      {step === 'upload' && (
        <DigitCard>
          <SubHeader>Step 4.2: Upload Employee Master</SubHeader>

          <div
            className="border-2 border-dashed border-primary/30 rounded p-6 sm:p-12 text-center hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer mb-4 sm:mb-6"
            onClick={() => setStep('preview')}
          >
            <Upload className="w-8 h-8 sm:w-12 sm:h-12 text-primary mx-auto mb-3 sm:mb-4" />
            <p className="text-sm sm:text-lg font-condensed font-medium text-foreground mb-2">
              Drop Employee_Master_Dynamic.xlsx here
            </p>
            <p className="text-xs sm:text-sm text-muted-foreground">or click to browse</p>
          </div>

          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setStep('generate')} className="text-muted-foreground hover:text-primary">← Back</Button>
          </div>
        </DigitCard>
      )}

      {/* Preview */}
      {step === 'preview' && (
        <DigitCard>
          <div className="flex items-center gap-2 text-primary mb-3 sm:mb-4">
            <Check className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="font-medium text-sm sm:text-base truncate">File loaded: Employee_Master_Dynamic_{state.tenant.toUpperCase()}_filled.xlsx</span>
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
                  {mockEmployees.map((emp, idx) => (
                    <TableRow key={idx} className={emp.status === 'error' ? 'bg-destructive/10' : ''}>
                      <TableCell>
                        {emp.status === 'valid' ? (
                          <Badge className="gap-1 text-xs bg-success text-white"><Check className="w-3 h-3" /> Valid</Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1 text-xs"><AlertTriangle className="w-3 h-3" /> Error</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-xs sm:text-sm">{emp.name}</TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">{emp.mobile}</TableCell>
                      <TableCell className="text-xs sm:text-sm">
                        <span className={emp.status === 'error' ? 'text-destructive' : ''}>{emp.dept}</span>
                      </TableCell>
                      <TableCell className="text-xs sm:text-sm">{emp.desig}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{emp.roles}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
            Summary: {mockEmployees.length} total | <span className="text-success">{validCount} valid</span> | <span className="text-destructive">{errorCount} error</span>
          </p>

          {errorCount > 0 && (
            <Alert variant="warning" className="mb-4 sm:mb-6">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription className="text-xs sm:text-sm">
                <p className="font-medium">Row 4: Department "INVALID" not found in tenant {state.tenant.toUpperCase()}</p>
                <p>Available departments: WATER, SANITATION, REVENUE</p>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('upload')} className="text-muted-foreground hover:text-primary">← Back</Button>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-primary/10">Fix Errors</Button>
              <SubmitBar
                label="Create Valid Only"
                onSubmit={() => setShowConfirmDialog(true)}
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
              <span className="text-xs sm:text-sm font-medium">Overall Progress</span>
              <span className="text-xs sm:text-sm text-primary font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs sm:text-sm text-muted-foreground mt-2">{createdCount} of {validCount} employees created</p>
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
                  {mockEmployees.map((emp, idx) => {
                    const isCreated = idx < createdCount;
                    const isCreating = idx === createdCount && emp.status === 'valid';
                    const isSkipped = emp.status === 'error';

                    return (
                      <TableRow key={idx}>
                        <TableCell className="text-xs sm:text-sm">{idx + 1}</TableCell>
                        <TableCell className="font-medium text-xs sm:text-sm">{emp.name}</TableCell>
                        <TableCell className="text-xs sm:text-sm">
                          {isSkipped ? <span className="text-muted-foreground">⏭️ Skipped</span> :
                           isCreated ? <span className="text-success">✓ Created</span> :
                           isCreating ? <Loader2 className="w-4 h-4 text-primary animate-spin" /> :
                           <span className="text-muted-foreground">○ Pending</span>}
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm">
                          {isSkipped ? '-' :
                           isCreated ? <span className="text-success">✓ Created</span> :
                           '-'}
                        </TableCell>
                        <TableCell className="text-xs sm:text-sm">
                          {isSkipped ? '-' :
                           isCreated ? <span className="text-success">✓ Done</span> :
                           '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
                <TableRow><TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">✓ Created</TableCell><TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-success">{validCount}</TableCell></TableRow>
                <TableRow><TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">⏭️ Skipped (errors)</TableCell><TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-destructive">{errorCount}</TableCell></TableRow>
                <TableRow><TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">Total</TableCell><TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-primary">{mockEmployees.length}</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>

          <Alert variant="info" className="text-left mt-4 sm:mt-6 max-w-md mx-auto">
            <AlertDescription className="text-xs sm:text-sm">
              <p className="mb-2"><strong>Each employee received:</strong></p>
              <ul className="space-y-1">
                <li>• HRMS employee record</li>
                <li>• User account (username: lowercase name)</li>
                <li>• Password: <code className="bg-muted px-1 rounded text-xs text-primary">eGov@123</code></li>
                <li>• Role assignments</li>
                <li>• Boundary jurisdiction</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
            <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-primary/10">
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
              You're about to create <strong className="text-primary">{validCount} employees</strong>. This will:
              <ul className="mt-2 space-y-1">
                <li>• Create {validCount} HRMS records</li>
                <li>• Create {validCount} user accounts</li>
                <li>• Assign roles and jurisdictions</li>
              </ul>
            </DialogDescription>
          </DialogHeader>

          <Alert variant="warning">
            <AlertDescription className="text-xs sm:text-sm">
              <strong>Note:</strong> {errorCount} row(s) with errors will be skipped.
            </AlertDescription>
          </Alert>

          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setShowConfirmDialog(false)} className="border-border">Cancel</Button>
            <SubmitBar
              label={`Create ${validCount} Employees`}
              onSubmit={handleCreateEmployees}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
