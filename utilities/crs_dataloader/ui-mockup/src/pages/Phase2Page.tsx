import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import {
  MapPin,
  Plus,
  FolderOpen,
  Download,
  Check,
  ChevronRight,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DigitCard } from '@/components/digit/DigitCard';
import { Header, SubHeader } from '@/components/digit/Header';
import { LabelFieldPair, CardLabel, Field } from '@/components/digit/LabelFieldPair';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { Banner } from '@/components/digit/Banner';

type Step = 'landing' | 'create-hierarchy' | 'select-hierarchy' | 'template' | 'upload' | 'verify' | 'complete';

const mockHierarchies = [
  { type: 'ADMIN', levels: ['Country', 'State', 'City', 'Ward'], boundaries: 45 },
  { type: 'REVENUE', levels: ['State', 'District', 'Block', 'Village'], boundaries: 120 },
];

const mockBoundaryData = [
  { code: 'WARD_001', name: 'Ward 1', parent: 'CITYA', status: 'valid' },
  { code: 'WARD_002', name: 'Ward 2', parent: 'CITYA', status: 'valid' },
  { code: 'WARD_003', name: 'Ward 3', parent: 'CITYA', status: 'valid' },
  { code: 'WARD_004', name: 'Ward 4', parent: 'INVALID_CITY', status: 'error' },
];

export default function Phase2Page() {
  const { completePhase, addUndo, state } = useApp();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('landing');
  const [loading, setLoading] = useState(false);
  const [selectedHierarchy, setSelectedHierarchy] = useState(mockHierarchies[0]);
  const [hierarchyLevels, setHierarchyLevels] = useState(['Country', 'State', 'City', 'Ward']);
  const [hierarchyType, setHierarchyType] = useState('ADMIN');

  const handleCreateHierarchy = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    setLoading(false);
    addUndo('create_hierarchy', `Created hierarchy: ${hierarchyType}`);
    setStep('template');
  };

  const handleSelectHierarchy = () => {
    setStep('template');
  };

  const handleUploadBoundaries = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 2000));
    setLoading(false);
    addUndo('create_boundaries', 'Created 13 boundaries');
    setStep('complete');
  };

  const handleContinue = () => {
    completePhase(2);
    navigate('/phase/3');
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header - DIGIT style */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 border-2 border-primary rounded flex items-center justify-center flex-shrink-0">
          <MapPin className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
        </div>
        <div className="min-w-0">
          <Header className="mb-0 text-lg sm:text-2xl">Phase 2: Boundary Setup</Header>
          <p className="text-sm sm:text-base text-muted-foreground truncate">Define geographic hierarchy for your tenant</p>
        </div>
      </div>

      {/* Landing */}
      {step === 'landing' && (
        <DigitCard>
          <Alert variant="info" className="mb-4 sm:mb-6">
            <AlertDescription>
              <strong className="block mb-2 text-sm sm:text-base">What are Boundaries?</strong>
              <span className="text-xs sm:text-sm">
                Boundaries define the geographic hierarchy of your tenant:
                <span className="font-mono block sm:inline sm:ml-2 mt-1 sm:mt-0 text-primary">State → District → City → Zone → Ward → Locality</span>
              </span>
            </AlertDescription>
          </Alert>

          <SubHeader>Choose Your Path</SubHeader>

          <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
            <button
              onClick={() => setStep('create-hierarchy')}
              className="p-4 sm:p-6 border-2 border-border rounded hover:border-primary hover:bg-primary/5 transition-all text-left group"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 rounded flex items-center justify-center mb-3 sm:mb-4 group-hover:bg-primary/20">
                <Plus className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              </div>
              <h4 className="font-condensed font-semibold text-foreground mb-2 text-sm sm:text-base">Option 1: Create New Hierarchy</h4>
              <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
                For first-time setup. Define levels like: State → City → Ward
              </p>
              <span className="text-primary font-medium text-xs sm:text-sm flex items-center gap-1">
                Create New <ChevronRight className="w-4 h-4" />
              </span>
            </button>

            <button
              onClick={() => setStep('select-hierarchy')}
              className="p-4 sm:p-6 border-2 border-border rounded hover:border-primary hover:bg-primary/5 transition-all text-left group"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 rounded flex items-center justify-center mb-3 sm:mb-4 group-hover:bg-primary/20">
                <FolderOpen className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              </div>
              <h4 className="font-condensed font-semibold text-foreground mb-2 text-sm sm:text-base">Option 2: Use Existing Hierarchy</h4>
              <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
                If hierarchy already exists in DIGIT for this tenant.
              </p>
              <span className="text-primary font-medium text-xs sm:text-sm flex items-center gap-1">
                Select Existing <ChevronRight className="w-4 h-4" />
              </span>
            </button>
          </div>
        </DigitCard>
      )}

      {/* Create Hierarchy */}
      {step === 'create-hierarchy' && (
        <DigitCard>
          <SubHeader>Create Boundary Hierarchy</SubHeader>
          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">Define the boundary hierarchy for tenant: <span className="text-primary font-medium">{state.tenant.toUpperCase()}</span></p>

          <div className="space-y-6">
            <LabelFieldPair>
              <CardLabel required>Hierarchy Type Name</CardLabel>
              <Field>
                <Input
                  id="hierarchyType"
                  value={hierarchyType}
                  onChange={(e) => setHierarchyType(e.target.value)}
                  placeholder="ADMIN"
                  className="border-input-border focus:border-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">Common types: ADMIN, REVENUE, ADMIN1, ADMIN2</p>
              </Field>
            </LabelFieldPair>

            <div className="mb-4 sm:mb-6">
              <CardLabel className="mb-2">Define Levels (top to bottom)</CardLabel>
              <div className="border border-border rounded p-3 sm:p-4 mt-2 bg-muted/30">
                {hierarchyLevels.map((level, idx) => (
                  <div key={idx} className="flex items-center gap-2 sm:gap-3 mb-3 last:mb-0">
                    <span className="text-xs sm:text-sm text-muted-foreground w-14 sm:w-16 flex-shrink-0 font-condensed">Level {idx + 1}:</span>
                    <Input
                      value={level}
                      onChange={(e) => {
                        const newLevels = [...hierarchyLevels];
                        newLevels[idx] = e.target.value;
                        setHierarchyLevels(newLevels);
                      }}
                      className="flex-1 border-input-border focus:border-primary"
                    />
                    {idx === 0 && <span className="text-xs text-primary hidden sm:inline">[Root]</span>}
                    {idx === hierarchyLevels.length - 1 && <span className="text-xs text-primary hidden sm:inline">[Lowest]</span>}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHierarchyLevels([...hierarchyLevels, ''])}
                  className="mt-3 border-primary text-primary hover:bg-primary/10"
                >
                  <Plus className="w-4 h-4 mr-1" /> Add Level
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0 mt-6">
            <Button variant="ghost" size="sm" onClick={() => setStep('landing')} className="text-muted-foreground hover:text-primary">
              ← Back
            </Button>
            <SubmitBar
              label={loading ? 'Creating...' : 'Create Hierarchy'}
              onSubmit={handleCreateHierarchy}
              disabled={loading}
              icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Select Hierarchy */}
      {step === 'select-hierarchy' && (
        <DigitCard>
          <SubHeader>Select Existing Hierarchy</SubHeader>
          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">Available hierarchies for tenant: <span className="text-primary font-medium">{state.tenant.toUpperCase()}</span></p>

          <div className="space-y-3 mb-4 sm:mb-6">
            {mockHierarchies.map((hierarchy) => (
              <button
                key={hierarchy.type}
                onClick={() => setSelectedHierarchy(hierarchy)}
                className={`w-full p-3 sm:p-4 border-2 rounded text-left transition-all ${
                  selectedHierarchy.type === hierarchy.type
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    selectedHierarchy.type === hierarchy.type ? 'border-primary bg-primary' : 'border-muted-foreground'
                  }`}>
                    {selectedHierarchy.type === hierarchy.type && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-condensed font-medium text-foreground text-sm sm:text-base">{hierarchy.type}</p>
                    <p className="text-xs sm:text-sm text-muted-foreground truncate">
                      Levels: <span className="text-primary">{hierarchy.levels.join(' → ')}</span>
                    </p>
                    <p className="text-xs sm:text-sm text-muted-foreground">Boundaries: {hierarchy.boundaries} defined</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('landing')} className="text-muted-foreground hover:text-primary">← Back</Button>
            <SubmitBar
              label="Use Selected Hierarchy"
              onSubmit={handleSelectHierarchy}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Template */}
      {step === 'template' && (
        <DigitCard>
          <SubHeader>Generate Boundary Template</SubHeader>
          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
            Hierarchy: <span className="text-primary font-medium">{selectedHierarchy.type}</span> • Levels: <span className="text-primary">{selectedHierarchy.levels.join(' → ')}</span>
          </p>

          <div className="p-4 bg-success/10 border border-success/20 rounded mb-4 sm:mb-6">
            <div className="flex items-center gap-2 text-success mb-2">
              <Check className="w-5 h-5" />
              <strong className="text-sm font-condensed">Template Generated!</strong>
            </div>
            <p className="text-xs sm:text-sm mb-2 text-foreground">Boundary_Template_{selectedHierarchy.type}.xlsx</p>
            <p className="text-xs sm:text-sm mb-2 text-muted-foreground">Sheets:</p>
            <ul className="text-xs sm:text-sm space-y-1 mb-3 sm:mb-4 text-muted-foreground">
              <li>• Instructions - How to fill the template</li>
              {selectedHierarchy.levels.map((level) => (
                <li key={level}>• {level} - {level} level boundaries</li>
              ))}
            </ul>
            <Button size="sm" className="bg-success hover:bg-success/90 text-white">
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>

          <Alert variant="warning" className="mb-4 sm:mb-6">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              <strong className="block mb-2 text-sm">Important Rules:</strong>
              <ul className="text-xs sm:text-sm space-y-1">
                <li>• Each boundary must have a unique code</li>
                <li>• Parent boundary must exist before child</li>
                <li>• Do not skip hierarchy levels</li>
              </ul>
            </AlertDescription>
          </Alert>

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
          <SubHeader>Upload Boundary Data</SubHeader>

          <div className="flex items-center gap-2 text-primary mb-3 sm:mb-4">
            <Check className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-sm sm:text-base truncate">Boundary_Template_{selectedHierarchy.type}_filled.xlsx</span>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0 mb-3 sm:mb-4">
            <div className="px-4 sm:px-0">
              <Tabs defaultValue={selectedHierarchy.levels[selectedHierarchy.levels.length - 1]}>
                <TabsList className="w-full sm:w-auto flex-wrap h-auto gap-1 p-1 bg-muted">
                  {selectedHierarchy.levels.map((level, idx) => (
                    <TabsTrigger key={level} value={level} className="text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-white">
                      {level} ({idx === selectedHierarchy.levels.length - 1 ? '10' : '1'})
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0 mb-3 sm:mb-4">
            <div className="min-w-[500px] sm:min-w-0 px-4 sm:px-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs sm:text-sm font-condensed">Status</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Code</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Name</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Parent</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Validation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockBoundaryData.map((row) => (
                    <TableRow key={row.code} className={row.status === 'error' ? 'bg-destructive/10' : ''}>
                      <TableCell>
                        {row.status === 'valid' ? (
                          <Badge className="gap-1 text-xs bg-success text-white"><Check className="w-3 h-3" /> Valid</Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1 text-xs"><AlertTriangle className="w-3 h-3" /> Error</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">{row.code}</TableCell>
                      <TableCell className="text-xs sm:text-sm">{row.name}</TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">{row.parent}</TableCell>
                      <TableCell className="text-xs sm:text-sm">
                        {row.status === 'error' && <span className="text-destructive">Parent missing</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">Summary: 12 total | <span className="text-success">11 valid</span> | <span className="text-destructive">1 error</span></p>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('template')} className="text-muted-foreground hover:text-primary">← Back</Button>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-primary/10">Fix Errors</Button>
              <SubmitBar
                label={loading ? 'Uploading...' : 'Upload Valid Only'}
                onSubmit={handleUploadBoundaries}
                disabled={loading}
                icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
              />
            </div>
          </div>
        </DigitCard>
      )}

      {/* Complete */}
      {step === 'complete' && (
        <DigitCard>
          <Banner
            successful={true}
            message="Boundaries Created Successfully!"
            info={`Hierarchy: ${selectedHierarchy.type} • Tenant: ${state.tenant.toUpperCase()}`}
          />

          <div className="mt-6 p-4 bg-muted rounded overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs sm:text-sm font-condensed">Level</TableHead>
                  <TableHead className="text-xs sm:text-sm font-condensed">Count</TableHead>
                  <TableHead className="text-xs sm:text-sm font-condensed">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedHierarchy.levels.map((level, idx) => (
                  <TableRow key={level}>
                    <TableCell className="text-xs sm:text-sm">{level}</TableCell>
                    <TableCell className="text-xs sm:text-sm">{idx === selectedHierarchy.levels.length - 1 ? 10 : 1}</TableCell>
                    <TableCell className="text-success text-xs sm:text-sm">✓ Created</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-sm sm:text-base text-muted-foreground mt-4 text-center">Total: <span className="text-primary font-medium">13 boundaries</span> created</p>

          <div className="mt-6 flex justify-center">
            <SubmitBar
              label="Continue to Phase 3"
              onSubmit={handleContinue}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}
    </div>
  );
}
