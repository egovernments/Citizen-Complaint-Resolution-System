import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import {
  FileSpreadsheet,
  Upload,
  Download,
  Check,
  ChevronRight,
  Loader2,
  Building,
  MessageSquare,
  AlertCircle,
  X,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DigitCard } from '@/components/digit/DigitCard';
import { Header, SubHeader } from '@/components/digit/Header';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { Banner } from '@/components/digit/Banner';
import { mdmsService, localizationService, ApiClientError } from '@/api';
import {
  parseExcelFile,
  parseDepartmentExcel,
  parseDesignationExcel,
  parseComplaintTypeExcel,
} from '@/utils/excelParser';
import type {
  DepartmentExcelRow,
  DesignationExcelRow,
  ComplaintTypeExcelRow,
} from '@/api/types';

type Step = 'landing' | 'upload' | 'preview' | 'creating-depts' | 'creating-complaints' | 'complete';

export default function Phase3Page() {
  const { completePhase, addUndo, state } = useApp();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('landing');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');

  // Parsed data
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [departments, setDepartments] = useState<DepartmentExcelRow[]>([]);
  const [designations, setDesignations] = useState<DesignationExcelRow[]>([]);
  const [complaintTypes, setComplaintTypes] = useState<ComplaintTypeExcelRow[]>([]);

  // Created counts
  const [createdDepts, setCreatedDepts] = useState(0);
  const [createdDesigs, setCreatedDesigs] = useState(0);
  const [createdComplaints, setCreatedComplaints] = useState(0);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setLoading(true);

    try {
      const workbook = await parseExcelFile(file);

      // Try to parse departments
      const deptResult = parseDepartmentExcel(workbook);
      if (deptResult.data.length > 0) {
        setDepartments(deptResult.data);
      }

      // Try to parse designations
      const desigResult = parseDesignationExcel(workbook);
      if (desigResult.data.length > 0) {
        setDesignations(desigResult.data);
      }

      // Try to parse complaint types
      const complaintResult = parseComplaintTypeExcel(workbook);
      if (complaintResult.data.length > 0) {
        setComplaintTypes(complaintResult.data);
      }

      // Check if we have any data
      if (deptResult.data.length === 0 && desigResult.data.length === 0 && complaintResult.data.length === 0) {
        setError('No valid data found in Excel file. Please check the format.');
        return;
      }

      setUploadedFile(file);
      setStep('preview');
    } catch (err) {
      console.error('Excel parse error:', err);
      setError('Failed to parse Excel file. Please ensure it is a valid .xlsx file.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    setLoading(true);
    setError(null);
    setStep('creating-depts');
    setProgress(0);

    try {
      // Create departments
      if (departments.length > 0) {
        setProgressMessage('Creating departments...');
        const deptResults = await mdmsService.createDepartments(
          state.tenant,
          departments.map(d => ({
            code: d.code,
            name: d.name,
            active: d.active,
          }))
        );
        setCreatedDepts(deptResults.success.length);

        // Create localizations for departments
        await localizationService.uploadDepartmentLocalizations(
          state.tenant,
          departments.map(d => ({ code: d.code, name: d.name })),
          'en_IN'
        );

        setProgress(30);
      }

      // Create designations
      if (designations.length > 0) {
        setProgressMessage('Creating designations...');
        const desigResults = await mdmsService.createDesignations(
          state.tenant,
          designations.map(d => ({
            code: d.code,
            name: d.name,
            department: d.department,
            active: d.active,
          }))
        );
        setCreatedDesigs(desigResults.success.length);

        // Create localizations for designations
        await localizationService.uploadDesignationLocalizations(
          state.tenant,
          designations.map(d => ({ code: d.code, name: d.name })),
          'en_IN'
        );

        setProgress(60);
      }

      addUndo('create_departments', `Created ${createdDepts} departments and ${createdDesigs} designations`);

      // Switch to complaint types
      setStep('creating-complaints');
      setProgress(0);

      // Create complaint types
      if (complaintTypes.length > 0) {
        setProgressMessage('Creating complaint types...');
        const complaintResults = await mdmsService.createComplaintTypes(
          state.tenant,
          complaintTypes.map(ct => ({
            serviceCode: ct.serviceCode,
            serviceName: ct.serviceName,
            department: ct.department,
            slaHours: ct.slaHours,
            active: ct.active,
          }))
        );
        setCreatedComplaints(complaintResults.success.length);

        // Create localizations for complaint types
        await localizationService.uploadComplaintTypeLocalizations(
          state.tenant,
          complaintTypes.map(ct => ({
            serviceCode: ct.serviceCode,
            serviceName: ct.serviceName,
          })),
          'en_IN'
        );

        setProgress(100);
      }

      addUndo('create_complaints', `Created ${createdComplaints} complaint types`);
      setStep('complete');
    } catch (err) {
      console.error('MDMS creation error:', err);
      if (err instanceof ApiClientError) {
        setError(err.firstError);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create master data. Please try again.');
      }
      setStep('preview'); // Go back to preview on error
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    completePhase(3);
    navigate('/phase/4');
  };

  const handleDownloadTemplate = () => {
    alert('Template download would start here.');
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header - DIGIT style */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 border-2 border-primary rounded flex items-center justify-center flex-shrink-0">
          <FileSpreadsheet className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
        </div>
        <div className="min-w-0">
          <Header className="mb-0 text-lg sm:text-2xl">Phase 3: Common Masters</Header>
          <p className="text-sm sm:text-base text-muted-foreground truncate">Configure departments, designations, and complaint types</p>
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

      {/* Landing */}
      {step === 'landing' && (
        <DigitCard>
          <Alert variant="info" className="mb-4 sm:mb-6">
            <AlertDescription>
              <strong className="block mb-2 text-sm sm:text-base">What You'll Do:</strong>
              <ul className="text-xs sm:text-sm space-y-1">
                <li>• Create departments for your tenant</li>
                <li>• Create designations linked to departments</li>
                <li>• Configure CRS complaint types and categories</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-primary/5 border border-primary/20 rounded mb-4 sm:mb-6">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-6 h-6 sm:w-8 sm:h-8 text-primary flex-shrink-0" />
              <div>
                <p className="font-medium text-foreground text-sm sm:text-base">Template Required:</p>
                <p className="text-xs sm:text-sm text-muted-foreground">Common and Complaint Master.xlsx</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="sm:ml-auto w-full sm:w-auto border-primary text-primary hover:bg-primary/10"
              onClick={handleDownloadTemplate}
            >
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>

          <Alert variant="warning" className="mb-4 sm:mb-6">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription className="text-xs sm:text-sm">
              <strong>Important:</strong> Departments & Designations created here will be used in Phase 4 (Employee Creation)
            </AlertDescription>
          </Alert>

          <div className="grid sm:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
            <div className="p-4 border border-border rounded bg-card shadow-card">
              <div className="flex items-center gap-2 mb-2">
                <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                <span className="font-condensed font-medium text-sm sm:text-base">Step 3.1</span>
              </div>
              <p className="text-muted-foreground text-xs sm:text-sm">Upload Common Master Excel</p>
            </div>
            <div className="p-4 border border-border rounded bg-card shadow-card opacity-50">
              <div className="flex items-center gap-2 mb-2">
                <Building className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
                <span className="font-condensed font-medium text-sm sm:text-base">Step 3.2</span>
              </div>
              <p className="text-muted-foreground text-xs sm:text-sm">Create Depts & Designations</p>
            </div>
            <div className="p-4 border border-border rounded bg-card shadow-card opacity-50">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
                <span className="font-condensed font-medium text-sm sm:text-base">Step 3.3</span>
              </div>
              <p className="text-muted-foreground text-xs sm:text-sm">Create Complaint Types</p>
            </div>
          </div>

          <div className="flex justify-end">
            <SubmitBar
              label="Start Setup"
              onSubmit={() => setStep('upload')}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Upload */}
      {step === 'upload' && (
        <DigitCard>
          <SubHeader>Step 3.1: Upload Common Master Excel</SubHeader>

          <div
            className="border-2 border-dashed border-primary/30 rounded p-6 sm:p-12 text-center hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer mb-4 sm:mb-6"
            onClick={() => document.getElementById('common-master-upload')?.click()}
          >
            {loading ? (
              <>
                <Loader2 className="w-8 h-8 sm:w-12 sm:h-12 text-primary mx-auto mb-3 sm:mb-4 animate-spin" />
                <p className="text-sm sm:text-lg font-condensed font-medium text-foreground mb-2">
                  Parsing Excel file...
                </p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 sm:w-12 sm:h-12 text-primary mx-auto mb-3 sm:mb-4" />
                <p className="text-sm sm:text-lg font-condensed font-medium text-foreground mb-2">
                  Drop Common and Complaint Master.xlsx here
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground">or click to browse</p>
              </>
            )}
            <input
              id="common-master-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
              disabled={loading}
            />
          </div>

          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setStep('landing')} className="text-muted-foreground hover:text-primary">← Back</Button>
          </div>
        </DigitCard>
      )}

      {/* Preview */}
      {step === 'preview' && (
        <DigitCard>
          <div className="flex items-center gap-2 text-primary mb-3 sm:mb-4">
            <Check className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="font-medium text-sm sm:text-base truncate">File: {uploadedFile?.name}</span>
          </div>

          <Tabs defaultValue="depts" className="mb-3 sm:mb-4">
            <TabsList className="w-full sm:w-auto flex-wrap h-auto gap-1 p-1 bg-muted">
              <TabsTrigger value="depts" className="text-xs sm:text-sm flex-1 sm:flex-none data-[state=active]:bg-primary data-[state=active]:text-white">
                Depts ({departments.length}) & Desig ({designations.length})
              </TabsTrigger>
              <TabsTrigger value="complaints" className="text-xs sm:text-sm flex-1 sm:flex-none data-[state=active]:bg-primary data-[state=active]:text-white">
                Complaints ({complaintTypes.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="depts">
              <div className="space-y-4">
                {/* Departments */}
                {departments.length > 0 && (
                  <div>
                    <h4 className="font-condensed font-medium text-sm mb-2">Departments</h4>
                    <div className="overflow-x-auto -mx-4 sm:mx-0">
                      <div className="min-w-[400px] sm:min-w-0 px-4 sm:px-0">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              <TableHead className="text-xs sm:text-sm font-condensed">Status</TableHead>
                              <TableHead className="text-xs sm:text-sm font-condensed">Code</TableHead>
                              <TableHead className="text-xs sm:text-sm font-condensed">Name</TableHead>
                              <TableHead className="text-xs sm:text-sm font-condensed">Active</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {departments.slice(0, 10).map((dept) => (
                              <TableRow key={dept.code}>
                                <TableCell>
                                  <Badge className="gap-1 text-xs bg-success text-white">
                                    <Check className="w-3 h-3" /> Valid
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs sm:text-sm">{dept.code}</TableCell>
                                <TableCell className="text-xs sm:text-sm">{dept.name}</TableCell>
                                <TableCell className="text-xs sm:text-sm">{dept.active ? 'Yes' : 'No'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {departments.length > 10 && (
                          <p className="text-xs text-muted-foreground text-center py-2">
                            Showing first 10 of {departments.length} departments
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Designations */}
                {designations.length > 0 && (
                  <div>
                    <h4 className="font-condensed font-medium text-sm mb-2">Designations</h4>
                    <div className="overflow-x-auto -mx-4 sm:mx-0">
                      <div className="min-w-[400px] sm:min-w-0 px-4 sm:px-0">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              <TableHead className="text-xs sm:text-sm font-condensed">Status</TableHead>
                              <TableHead className="text-xs sm:text-sm font-condensed">Code</TableHead>
                              <TableHead className="text-xs sm:text-sm font-condensed">Name</TableHead>
                              <TableHead className="text-xs sm:text-sm font-condensed">Department</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {designations.slice(0, 10).map((desig) => (
                              <TableRow key={desig.code}>
                                <TableCell>
                                  <Badge className="gap-1 text-xs bg-success text-white">
                                    <Check className="w-3 h-3" /> Valid
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs sm:text-sm">{desig.code}</TableCell>
                                <TableCell className="text-xs sm:text-sm">{desig.name}</TableCell>
                                <TableCell className="font-mono text-xs sm:text-sm">{desig.department || '-'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {designations.length > 10 && (
                          <p className="text-xs text-muted-foreground text-center py-2">
                            Showing first 10 of {designations.length} designations
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {departments.length === 0 && designations.length === 0 && (
                  <Alert variant="warning">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>No departments or designations found in the file.</AlertDescription>
                  </Alert>
                )}
              </div>
            </TabsContent>

            <TabsContent value="complaints">
              {complaintTypes.length > 0 ? (
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                  <div className="min-w-[500px] sm:min-w-0 px-4 sm:px-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-xs sm:text-sm font-condensed">Status</TableHead>
                          <TableHead className="text-xs sm:text-sm font-condensed">Service Code</TableHead>
                          <TableHead className="text-xs sm:text-sm font-condensed">Service Name</TableHead>
                          <TableHead className="text-xs sm:text-sm font-condensed">SLA</TableHead>
                          <TableHead className="text-xs sm:text-sm font-condensed">Dept</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {complaintTypes.slice(0, 15).map((type) => (
                          <TableRow key={type.serviceCode}>
                            <TableCell>
                              <Badge className="gap-1 text-xs bg-success text-white">
                                <Check className="w-3 h-3" /> Valid
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs sm:text-sm">{type.serviceCode}</TableCell>
                            <TableCell className="text-xs sm:text-sm">{type.serviceName}</TableCell>
                            <TableCell className="text-xs sm:text-sm">{type.slaHours}h</TableCell>
                            <TableCell className="font-mono text-xs sm:text-sm">{type.department}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {complaintTypes.length > 15 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        Showing first 15 of {complaintTypes.length} complaint types
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>No complaint types found in the file.</AlertDescription>
                </Alert>
              )}
            </TabsContent>
          </Tabs>

          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
            Summary:
            <span className="text-primary font-medium"> {departments.length} departments</span> •
            <span className="text-primary font-medium"> {designations.length} designations</span> •
            <span className="text-primary font-medium"> {complaintTypes.length} complaint types</span>
          </p>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('upload')} className="text-muted-foreground hover:text-primary">← Change File</Button>
            <SubmitBar
              label={loading ? 'Creating...' : 'Create All'}
              onSubmit={handleUpload}
              disabled={loading || (departments.length === 0 && designations.length === 0 && complaintTypes.length === 0)}
              icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Creating Departments */}
      {step === 'creating-depts' && (
        <DigitCard>
          <SubHeader>Step 3.2: Creating Departments & Designations</SubHeader>

          <div className="mb-4 sm:mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs sm:text-sm font-medium">{progressMessage}</span>
              <span className="text-xs sm:text-sm text-primary font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <div className="space-y-2">
            {departments.slice(0, 5).map((dept, idx) => (
              <div key={dept.code} className="flex items-center gap-3 text-xs sm:text-sm">
                {progress >= ((idx + 1) / departments.length) * 30 ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                )}
                <span>{dept.code} - {dept.name}</span>
              </div>
            ))}
            {departments.length > 5 && (
              <p className="text-xs text-muted-foreground">...and {departments.length - 5} more</p>
            )}
          </div>
        </DigitCard>
      )}

      {/* Creating Complaints */}
      {step === 'creating-complaints' && (
        <DigitCard>
          <SubHeader>Step 3.3: Creating Complaint Types</SubHeader>

          <div className="mb-4 sm:mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs sm:text-sm font-medium">{progressMessage}</span>
              <span className="text-xs sm:text-sm text-primary font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <div className="space-y-2">
            {complaintTypes.slice(0, 5).map((type, idx) => (
              <div key={type.serviceCode} className="flex items-center gap-3 text-xs sm:text-sm">
                {progress >= ((idx + 1) / complaintTypes.length) * 100 ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                )}
                <span>{type.serviceCode} - {type.serviceName}</span>
              </div>
            ))}
            {complaintTypes.length > 5 && (
              <p className="text-xs text-muted-foreground">...and {complaintTypes.length - 5} more</p>
            )}
          </div>
        </DigitCard>
      )}

      {/* Complete */}
      {step === 'complete' && (
        <DigitCard>
          <Banner
            successful={true}
            message="Phase 3 Complete!"
            info={`Common masters configured for tenant: ${state.tenant.toUpperCase()}`}
          />

          <div className="mt-6 p-4 bg-muted rounded">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">Departments</TableCell>
                  <TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-primary">{createdDepts}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">Designations</TableCell>
                  <TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-primary">{createdDesigs}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">Complaint Types</TableCell>
                  <TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-primary">{createdComplaints}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <Alert variant="info" className="mt-4 sm:mt-6 text-left max-w-md mx-auto">
            <AlertDescription className="text-xs sm:text-sm">
              <strong>Ready for Phase 4:</strong> The departments and designations you created will be available as dropdown options when creating employees.
            </AlertDescription>
          </Alert>

          <div className="mt-6 flex justify-center">
            <SubmitBar
              label="Continue to Phase 4"
              onSubmit={handleContinue}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}
    </div>
  );
}
