import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import {
  Building2,
  Upload,
  Download,
  FileSpreadsheet,
  Check,
  AlertCircle,
  Loader2,
  ChevronRight,
  Eye,
  Image
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DigitCard, DigitCardText } from '@/components/digit/DigitCard';
import { Header, SubHeader } from '@/components/digit/Header';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { Banner } from '@/components/digit/Banner';

type Step = 'landing' | 'upload' | 'preview' | 'branding' | 'complete';

// Mock data
const mockTenantData = {
  displayName: 'City A ULB',
  tenantCode: 'PG.CITYA',
  tenantType: 'City',
  logoPath: 'https://via.placeholder.com/100',
  cityName: 'City A',
  districtName: 'District X',
  latitude: 28.6139,
  longitude: 77.209,
};

const mockBrandingData = {
  bannerUrl: 'https://via.placeholder.com/800x200',
  logoUrl: 'https://via.placeholder.com/200',
  logoUrlWhite: 'https://via.placeholder.com/200',
  stateLogo: 'https://via.placeholder.com/100',
};

export default function Phase1Page() {
  const { completePhase, addUndo } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('landing');
  const [loading, setLoading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      setStep('preview');
    }
  };

  const handleUploadToDigit = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 2000));
    setLoading(false);
    addUndo('create_tenant', `Created tenant: ${mockTenantData.tenantCode}`);
    setStep('branding');
  };

  const handleBrandingUpload = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    setLoading(false);
    addUndo('create_branding', 'Configured branding assets');
    setStep('complete');
  };

  const handleContinue = () => {
    completePhase(1);
    navigate('/phase/2');
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header - DIGIT style */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 border-2 border-primary rounded flex items-center justify-center flex-shrink-0">
          <Building2 className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
        </div>
        <div className="min-w-0">
          <Header className="mb-0 text-lg sm:text-2xl">Phase 1: Tenant & Branding Setup</Header>
          <p className="text-sm sm:text-base text-muted-foreground truncate">Create tenant and configure branding assets</p>
        </div>
      </div>

      {/* Sub-step indicator - DIGIT style */}
      {step !== 'landing' && step !== 'complete' && (
        <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm overflow-x-auto pb-1">
          <span className={`whitespace-nowrap px-2 py-1 rounded ${step === 'upload' ? 'bg-primary text-white font-medium' : 'text-muted-foreground'}`}>
            {step === 'upload' ? '1. Upload' : '✓ Upload'}
          </span>
          <div className="w-4 sm:w-8 h-0.5 bg-border flex-shrink-0" />
          <span className={`whitespace-nowrap px-2 py-1 rounded ${step === 'preview' ? 'bg-primary text-white font-medium' : step === 'branding' ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
            {step === 'branding' ? '✓ Preview' : '2. Preview'}
          </span>
          <div className="w-4 sm:w-8 h-0.5 bg-border flex-shrink-0" />
          <span className={`whitespace-nowrap px-2 py-1 rounded ${step === 'branding' ? 'bg-primary text-white font-medium' : 'text-muted-foreground'}`}>
            3. Branding
          </span>
        </div>
      )}

      {/* Landing */}
      {step === 'landing' && (
        <DigitCard>
          <Alert variant="info" className="mb-4 sm:mb-6">
            <AlertDescription>
              <strong className="block mb-2 text-sm sm:text-base">What You'll Do:</strong>
              <ul className="text-xs sm:text-sm space-y-1">
                <li>• Create new tenant/ULB configuration</li>
                <li>• Upload logo and branding assets</li>
                <li>• Configure state-level branding</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-primary/5 border border-primary/20 rounded mb-4 sm:mb-6">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-6 h-6 sm:w-8 sm:h-8 text-primary flex-shrink-0" />
              <div>
                <p className="font-medium text-foreground text-sm sm:text-base">Template Required:</p>
                <p className="text-xs sm:text-sm text-muted-foreground">Tenant And Branding Master.xlsx</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="sm:ml-auto w-full sm:w-auto border-primary text-primary hover:bg-primary/10">
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
            <div className="p-4 border border-border rounded bg-card shadow-card">
              <div className="flex items-center gap-2 mb-2">
                <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                <span className="font-condensed font-medium text-sm sm:text-base">Step 1.1</span>
              </div>
              <p className="text-muted-foreground text-xs sm:text-sm mb-3 sm:mb-4">Upload Tenant Master Excel</p>
              <Badge className="bg-muted text-muted-foreground text-xs">Not started</Badge>
            </div>
            <div className="p-4 border border-border rounded bg-card shadow-card opacity-50">
              <div className="flex items-center gap-2 mb-2">
                <Image className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
                <span className="font-condensed font-medium text-sm sm:text-base">Step 1.2</span>
              </div>
              <p className="text-muted-foreground text-xs sm:text-sm mb-3 sm:mb-4">State Branding Configuration</p>
              <Badge className="bg-muted text-muted-foreground text-xs">Requires Step 1.1</Badge>
            </div>
          </div>

          <div className="mt-4 sm:mt-6 flex justify-end">
            <SubmitBar
              label="Start Setup"
              onSubmit={() => setStep('upload')}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Upload Step */}
      {step === 'upload' && (
        <DigitCard>
          <SubHeader>Step 1.1: Upload Tenant Master Excel</SubHeader>

          <div
            className="border-2 border-dashed border-primary/30 rounded p-6 sm:p-12 text-center hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer"
            onClick={() => document.getElementById('file-upload')?.click()}
          >
            <Upload className="w-8 h-8 sm:w-12 sm:h-12 text-primary mx-auto mb-3 sm:mb-4" />
            <p className="text-sm sm:text-lg font-condensed font-medium text-foreground mb-2">
              Drop Tenant And Branding Master.xlsx here
            </p>
            <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">or click to browse</p>
            <input
              id="file-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-primary/10">
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>

          <div className="mt-4 sm:mt-6 flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setStep('landing')} className="text-muted-foreground hover:text-primary">
              ← Back
            </Button>
          </div>
        </DigitCard>
      )}

      {/* Preview Step */}
      {step === 'preview' && (
        <DigitCard>
          <div className="flex items-center gap-2 text-primary mb-3 sm:mb-4">
            <Check className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="font-medium text-sm sm:text-base truncate">File loaded: {uploadedFile?.name || 'Tenant And Branding Master.xlsx'}</span>
          </div>

          <Tabs defaultValue="tenant" className="mb-3 sm:mb-4">
            <TabsList className="w-full sm:w-auto bg-muted">
              <TabsTrigger value="tenant" className="text-xs sm:text-sm flex-1 sm:flex-none data-[state=active]:bg-primary data-[state=active]:text-white">Tenant Info</TabsTrigger>
              <TabsTrigger value="branding" className="text-xs sm:text-sm flex-1 sm:flex-none data-[state=active]:bg-primary data-[state=active]:text-white">Branding Details</TabsTrigger>
            </TabsList>
            <TabsContent value="tenant">
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <div className="min-w-[500px] sm:min-w-0 px-4 sm:px-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs sm:text-sm font-condensed">Status</TableHead>
                        <TableHead className="text-xs sm:text-sm font-condensed">Display Name</TableHead>
                        <TableHead className="text-xs sm:text-sm font-condensed">Tenant Code</TableHead>
                        <TableHead className="text-xs sm:text-sm font-condensed">Type</TableHead>
                        <TableHead className="text-xs sm:text-sm font-condensed">City</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>
                          <Badge className="gap-1 text-xs bg-success text-white">
                            <Check className="w-3 h-3" /> Valid
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium text-xs sm:text-sm">{mockTenantData.displayName}</TableCell>
                        <TableCell className="text-xs sm:text-sm">{mockTenantData.tenantCode}</TableCell>
                        <TableCell className="text-xs sm:text-sm">{mockTenantData.tenantType}</TableCell>
                        <TableCell className="text-xs sm:text-sm">{mockTenantData.cityName}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="branding">
              <DigitCardText className="py-4">Branding details will be configured in the next step.</DigitCardText>
            </TabsContent>
          </Tabs>

          <Alert variant="info" className="mt-3 sm:mt-4">
            <AlertDescription>
              <strong className="text-sm">This will create:</strong>
              <ul className="text-xs sm:text-sm mt-1 space-y-1">
                <li>• New tenant: {mockTenantData.tenantCode} ({mockTenantData.displayName})</li>
                <li>• City module configuration</li>
                <li>• MDMS entries for tenant</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('upload')} className="text-muted-foreground hover:text-primary">
              ← Change File
            </Button>
            <SubmitBar
              label={loading ? 'Uploading...' : 'Upload to DIGIT'}
              onSubmit={handleUploadToDigit}
              disabled={loading}
              icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Branding Step */}
      {step === 'branding' && (
        <DigitCard>
          <div className="text-center mb-4 sm:mb-6">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-success/10 border-2 border-success rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <Check className="w-6 h-6 sm:w-8 sm:h-8 text-success" />
            </div>
            <h2 className="text-lg sm:text-xl font-condensed font-semibold text-foreground">Tenant Master Uploaded!</h2>
            <p className="text-sm sm:text-base text-muted-foreground">Created: {mockTenantData.tenantCode} ({mockTenantData.displayName})</p>
          </div>

          <SubHeader>Step 1.2: State Branding Configuration</SubHeader>

          <div className="grid gap-3 sm:gap-4">
            {Object.entries(mockBrandingData).map(([key, value]) => (
              <div key={key} className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 border border-border rounded bg-card">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-muted rounded flex items-center justify-center flex-shrink-0">
                  <Image className="w-5 h-5 sm:w-6 sm:h-6 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm sm:text-base">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                  <p className="text-xs sm:text-sm text-muted-foreground truncate">{value}</p>
                </div>
                <Button variant="outline" size="sm" className="hidden sm:flex border-primary text-primary hover:bg-primary/10">
                  <Eye className="w-4 h-4 mr-1" />
                  Preview
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('preview')} className="text-muted-foreground hover:text-primary">
              ← Back
            </Button>
            <SubmitBar
              label={loading ? 'Uploading...' : 'Upload Branding'}
              onSubmit={handleBrandingUpload}
              disabled={loading}
              icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Complete Step */}
      {step === 'complete' && (
        <DigitCard>
          <Banner
            successful={true}
            message="Phase 1 Complete!"
            info="Tenant and branding have been configured"
          />

          <div className="mt-6 p-4 bg-muted rounded">
            <p className="font-condensed font-medium text-foreground mb-2 text-sm sm:text-base">Created:</p>
            <ul className="text-xs sm:text-sm text-muted-foreground space-y-1">
              <li>✓ Tenant: {mockTenantData.tenantCode} ({mockTenantData.displayName})</li>
              <li>✓ Branding assets configured</li>
            </ul>
          </div>

          <Alert variant="warning" className="mt-4 sm:mt-6 text-left">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription className="text-xs sm:text-sm">
              <strong>Next:</strong> You must complete Phase 2 (Boundary Setup) before proceeding to employee creation.
            </AlertDescription>
          </Alert>

          <div className="mt-6 flex justify-center">
            <SubmitBar
              label="Continue to Phase 2"
              onSubmit={handleContinue}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}
    </div>
  );
}
