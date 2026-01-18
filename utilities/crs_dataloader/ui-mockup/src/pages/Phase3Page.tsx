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
  AlertCircle
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

type Step = 'landing' | 'upload' | 'preview' | 'creating-depts' | 'creating-complaints' | 'complete';

const mockDepartments = [
  { code: 'WATER', name: 'Water Department', designations: ['Engineer', 'Junior Engineer'] },
  { code: 'SANITATION', name: 'Sanitation Dept', designations: ['Inspector'] },
  { code: 'REVENUE', name: 'Revenue Department', designations: ['Tax Officer', 'Clerk'] },
];

const mockComplaintTypes = [
  { code: 'WS001', name: 'No Water Supply', dept: 'WATER', sla: 24 },
  { code: 'WS002', name: 'Low Pressure', dept: 'WATER', sla: 48 },
  { code: 'SN001', name: 'Garbage Pile', dept: 'SANITATION', sla: 24 },
  { code: 'SN002', name: 'Drain Blockage', dept: 'SANITATION', sla: 48 },
  { code: 'RV001', name: 'Tax Query', dept: 'REVENUE', sla: 72 },
];

export default function Phase3Page() {
  const { completePhase, addUndo, state } = useApp();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('landing');
  const [, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleUpload = async () => {
    setLoading(true);
    setStep('creating-depts');

    // Simulate creating departments
    for (let i = 0; i <= 100; i += 20) {
      await new Promise(resolve => setTimeout(resolve, 400));
      setProgress(i);
    }

    addUndo('create_departments', 'Created 3 departments and 5 designations');
    setStep('creating-complaints');
    setProgress(0);

    // Simulate creating complaint types
    for (let i = 0; i <= 100; i += 20) {
      await new Promise(resolve => setTimeout(resolve, 300));
      setProgress(i);
    }

    addUndo('create_complaints', 'Created 5 complaint types');
    setLoading(false);
    setStep('complete');
  };

  const handleContinue = () => {
    completePhase(3);
    navigate('/phase/4');
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
            <Button variant="outline" size="sm" className="sm:ml-auto w-full sm:w-auto border-primary text-primary hover:bg-primary/10">
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
            onClick={() => setStep('preview')}
          >
            <Upload className="w-8 h-8 sm:w-12 sm:h-12 text-primary mx-auto mb-3 sm:mb-4" />
            <p className="text-sm sm:text-lg font-condensed font-medium text-foreground mb-2">
              Drop Common and Complaint Master.xlsx here
            </p>
            <p className="text-xs sm:text-sm text-muted-foreground">or click to browse</p>
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
            <span className="font-medium text-sm sm:text-base truncate">File loaded: Common and Complaint Master.xlsx</span>
          </div>

          <Tabs defaultValue="depts" className="mb-3 sm:mb-4">
            <TabsList className="w-full sm:w-auto flex-wrap h-auto gap-1 p-1 bg-muted">
              <TabsTrigger value="depts" className="text-xs sm:text-sm flex-1 sm:flex-none data-[state=active]:bg-primary data-[state=active]:text-white">Depts & Desig ({mockDepartments.length})</TabsTrigger>
              <TabsTrigger value="complaints" className="text-xs sm:text-sm flex-1 sm:flex-none data-[state=active]:bg-primary data-[state=active]:text-white">Complaints ({mockComplaintTypes.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="depts">
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <div className="min-w-[500px] sm:min-w-0 px-4 sm:px-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs sm:text-sm font-condensed">Status</TableHead>
                        <TableHead className="text-xs sm:text-sm font-condensed">Dept Code</TableHead>
                        <TableHead className="text-xs sm:text-sm font-condensed">Dept Name</TableHead>
                        <TableHead className="text-xs sm:text-sm font-condensed">Designations</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mockDepartments.map((dept) => (
                        <TableRow key={dept.code}>
                          <TableCell>
                            <Badge className="gap-1 text-xs bg-success text-white"><Check className="w-3 h-3" /> Valid</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs sm:text-sm">{dept.code}</TableCell>
                          <TableCell className="text-xs sm:text-sm">{dept.name}</TableCell>
                          <TableCell className="text-xs sm:text-sm">{dept.designations.join(', ')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="complaints">
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
                      {mockComplaintTypes.map((type) => (
                        <TableRow key={type.code}>
                          <TableCell>
                            <Badge className="gap-1 text-xs bg-success text-white"><Check className="w-3 h-3" /> Valid</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs sm:text-sm">{type.code}</TableCell>
                          <TableCell className="text-xs sm:text-sm">{type.name}</TableCell>
                          <TableCell className="text-xs sm:text-sm">{type.sla}h</TableCell>
                          <TableCell className="font-mono text-xs sm:text-sm">{type.dept}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
            Summary: <span className="text-primary font-medium">{mockDepartments.length} departments</span> • <span className="text-primary font-medium">5 designations</span> • <span className="text-primary font-medium">{mockComplaintTypes.length} complaint types</span>
          </p>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('upload')} className="text-muted-foreground hover:text-primary">← Change File</Button>
            <SubmitBar
              label="Create All"
              onSubmit={handleUpload}
              icon={<ChevronRight className="w-4 h-4" />}
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
              <span className="text-xs sm:text-sm font-medium">Creating Departments...</span>
              <span className="text-xs sm:text-sm text-primary font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <div className="space-y-2">
            {mockDepartments.map((dept, idx) => (
              <div key={dept.code} className="flex items-center gap-3 text-xs sm:text-sm">
                {progress >= (idx + 1) * 33 ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                )}
                <span>{dept.code} - {dept.name}</span>
              </div>
            ))}
          </div>
        </DigitCard>
      )}

      {/* Creating Complaints */}
      {step === 'creating-complaints' && (
        <DigitCard>
          <SubHeader>Step 3.3: Creating Complaint Types</SubHeader>

          <div className="mb-4 sm:mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs sm:text-sm font-medium">Creating Complaint Types...</span>
              <span className="text-xs sm:text-sm text-primary font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <div className="space-y-2">
            {mockComplaintTypes.map((type, idx) => (
              <div key={type.code} className="flex items-center gap-3 text-xs sm:text-sm">
                {progress >= (idx + 1) * 20 ? (
                  <Check className="w-4 h-4 text-success" />
                ) : (
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                )}
                <span>{type.code} - {type.name}</span>
              </div>
            ))}
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
                <TableRow><TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">Departments</TableCell><TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-primary">{mockDepartments.length}</TableCell></TableRow>
                <TableRow><TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">Designations</TableCell><TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-primary">5</TableCell></TableRow>
                <TableRow><TableCell className="px-3 sm:px-4 py-2 text-xs sm:text-sm">Complaint Types</TableCell><TableCell className="px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm text-primary">{mockComplaintTypes.length}</TableCell></TableRow>
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
