import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import {
  MapPin,
  Plus,
  FolderOpen,
  Download,
  Upload,
  Check,
  ChevronRight,
  Loader2,
  AlertTriangle,
  AlertCircle,
  X,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DigitCard } from '@/components/digit/DigitCard';
import { Header, SubHeader } from '@/components/digit/Header';
import { LabelFieldPair, CardLabel, Field } from '@/components/digit/LabelFieldPair';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { Banner } from '@/components/digit/Banner';
import { boundaryService, localizationService, ApiClientError } from '@/api';
import { parseExcelFile, parseBoundaryExcel } from '@/utils/excelParser';
import type { BoundaryHierarchy, Boundary, BoundaryExcelRow } from '@/api/types';

type Step = 'landing' | 'create-hierarchy' | 'select-hierarchy' | 'template' | 'upload' | 'verify' | 'complete';

export default function Phase2Page() {
  const { completePhase, addUndo, state } = useApp();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('landing');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hierarchy state
  const [existingHierarchies, setExistingHierarchies] = useState<BoundaryHierarchy[]>([]);
  const [selectedHierarchy, setSelectedHierarchy] = useState<BoundaryHierarchy | null>(null);
  const [hierarchyLevels, setHierarchyLevels] = useState(['Country', 'State', 'City', 'Ward']);
  const [hierarchyType, setHierarchyType] = useState('ADMIN');
  const [loadingHierarchies, setLoadingHierarchies] = useState(false);

  // Boundary data state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedBoundaries, setParsedBoundaries] = useState<BoundaryExcelRow[]>([]);
  const [, setParsedLevels] = useState<string[]>([]);
  const [validBoundaries, setValidBoundaries] = useState<BoundaryExcelRow[]>([]);
  const [invalidBoundaries, setInvalidBoundaries] = useState<{ boundary: BoundaryExcelRow; error: string }[]>([]);

  // Created boundaries tracking
  const [createdCounts, setCreatedCounts] = useState<Record<string, number>>({});
  const [totalCreated, setTotalCreated] = useState(0);

  // Fetch existing hierarchies on mount
  useEffect(() => {
    fetchHierarchies();
  }, [state.tenant]);

  const fetchHierarchies = async () => {
    setLoadingHierarchies(true);
    try {
      const hierarchies = await boundaryService.getHierarchies(state.tenant);
      setExistingHierarchies(hierarchies);
      if (hierarchies.length > 0) {
        setSelectedHierarchy(hierarchies[0]);
      }
    } catch (err) {
      console.error('Failed to fetch hierarchies:', err);
      // Don't show error - just means no hierarchies exist yet
    } finally {
      setLoadingHierarchies(false);
    }
  };

  const handleCreateHierarchy = async () => {
    if (!hierarchyType.trim()) {
      setError('Hierarchy type name is required');
      return;
    }

    const validLevels = hierarchyLevels.filter(l => l.trim());
    if (validLevels.length < 2) {
      setError('At least 2 hierarchy levels are required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const newHierarchy = await boundaryService.createHierarchyFromLevels(
        state.tenant,
        hierarchyType,
        validLevels
      );

      setSelectedHierarchy(newHierarchy);
      setExistingHierarchies(prev => [...prev, newHierarchy]);
      addUndo('create_hierarchy', `Created hierarchy: ${hierarchyType}`);
      setStep('template');
    } catch (err) {
      console.error('Hierarchy creation error:', err);
      if (err instanceof ApiClientError) {
        setError(err.firstError);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create hierarchy. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectHierarchy = () => {
    if (!selectedHierarchy) {
      setError('Please select a hierarchy');
      return;
    }
    setStep('template');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setLoading(true);

    try {
      const workbook = await parseExcelFile(file);
      const result = parseBoundaryExcel(workbook);

      if (result.validation.valid) {
        setUploadedFile(file);
        setParsedBoundaries(result.data);
        setParsedLevels(result.hierarchyLevels);

        // Validate boundaries
        validateBoundaries(result.data);
        setStep('verify');
      } else {
        setError(result.validation.errors.map(e => e.message).join(', '));
      }
    } catch (err) {
      console.error('Excel parse error:', err);
      setError('Failed to parse Excel file. Please ensure it is a valid .xlsx file.');
    } finally {
      setLoading(false);
    }
  };

  const validateBoundaries = (boundaries: BoundaryExcelRow[]) => {
    const valid: BoundaryExcelRow[] = [];
    const invalid: { boundary: BoundaryExcelRow; error: string }[] = [];
    const existingCodes = new Set<string>();

    // Track codes for parent validation
    boundaries.forEach(b => existingCodes.add(b.code));

    for (const boundary of boundaries) {
      const errors: string[] = [];

      // Check for duplicate codes
      if (!boundary.code) {
        errors.push('Missing boundary code');
      }

      if (!boundary.name) {
        errors.push('Missing boundary name');
      }

      if (!boundary.boundaryType) {
        errors.push('Missing boundary type');
      }

      // Check if parent exists (for non-root boundaries)
      if (boundary.parentCode && !existingCodes.has(boundary.parentCode)) {
        errors.push(`Parent "${boundary.parentCode}" not found`);
      }

      if (errors.length > 0) {
        invalid.push({ boundary, error: errors.join('; ') });
      } else {
        valid.push(boundary);
      }
    }

    setValidBoundaries(valid);
    setInvalidBoundaries(invalid);
  };

  const handleUploadBoundaries = async () => {
    if (!selectedHierarchy || validBoundaries.length === 0) {
      setError('No valid boundaries to upload');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Convert Excel rows to Boundary objects
      const boundariesToCreate: Boundary[] = validBoundaries.map(row => ({
        tenantId: state.tenant,
        code: row.code,
        name: row.name,
        boundaryType: row.boundaryType,
        parent: row.parentCode,
        hierarchyType: selectedHierarchy.hierarchyType,
        latitude: row.latitude,
        longitude: row.longitude,
      }));

      // Create boundaries
      const result = await boundaryService.createBoundaries(boundariesToCreate, (created, total) => {
        // Progress callback
        console.log(`Created ${created}/${total} boundaries`);
      });

      // Track counts by level
      const counts: Record<string, number> = {};
      result.success.forEach(b => {
        counts[b.boundaryType] = (counts[b.boundaryType] || 0) + 1;
      });

      setCreatedCounts(counts);
      setTotalCreated(result.success.length);

      // Create localizations for boundaries
      const boundaryData = result.success.map(b => ({
        code: b.code,
        name: b.name,
      }));

      await localizationService.uploadBoundaryLocalizations(
        state.tenant,
        boundaryData,
        selectedHierarchy.hierarchyType,
        'en_IN'
      );

      addUndo('create_boundaries', `Created ${result.success.length} boundaries`);
      setStep('complete');

      if (result.failed.length > 0) {
        setError(`${result.failed.length} boundaries failed to create`);
      }
    } catch (err) {
      console.error('Boundary upload error:', err);
      if (err instanceof ApiClientError) {
        setError(err.firstError);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to upload boundaries. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    completePhase(2);
    navigate('/phase/3');
  };

  const handleDownloadTemplate = () => {
    // For now, just show an alert about the template
    alert('Template download would start here.');
  };

  const getHierarchyLevels = (hierarchy: BoundaryHierarchy): string[] => {
    if (!hierarchy.boundaryHierarchy) return [];
    return hierarchy.boundaryHierarchy.map(level => level.boundaryType);
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
              disabled={loadingHierarchies}
              className="p-4 sm:p-6 border-2 border-border rounded hover:border-primary hover:bg-primary/5 transition-all text-left group disabled:opacity-50"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 rounded flex items-center justify-center mb-3 sm:mb-4 group-hover:bg-primary/20">
                {loadingHierarchies ? (
                  <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 text-primary animate-spin" />
                ) : (
                  <FolderOpen className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                )}
              </div>
              <h4 className="font-condensed font-semibold text-foreground mb-2 text-sm sm:text-base">Option 2: Use Existing Hierarchy</h4>
              <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
                {existingHierarchies.length > 0
                  ? `${existingHierarchies.length} hierarchy(s) found for this tenant.`
                  : 'Check if hierarchy already exists in DIGIT.'}
              </p>
              <span className="text-primary font-medium text-xs sm:text-sm flex items-center gap-1">
                {loadingHierarchies ? 'Loading...' : 'Select Existing'} <ChevronRight className="w-4 h-4" />
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
                    {hierarchyLevels.length > 2 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHierarchyLevels(hierarchyLevels.filter((_, i) => i !== idx))}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
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
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <div>
              <SubHeader>Select Existing Hierarchy</SubHeader>
              <p className="text-xs sm:text-sm text-muted-foreground">Available hierarchies for tenant: <span className="text-primary font-medium">{state.tenant.toUpperCase()}</span></p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchHierarchies}
              disabled={loadingHierarchies}
              className="text-primary"
            >
              <RefreshCw className={`w-4 h-4 ${loadingHierarchies ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {existingHierarchies.length === 0 ? (
            <div className="text-center py-8">
              <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">No hierarchies found for this tenant.</p>
              <Button
                variant="outline"
                onClick={() => setStep('create-hierarchy')}
                className="border-primary text-primary"
              >
                <Plus className="w-4 h-4 mr-2" /> Create New Hierarchy
              </Button>
            </div>
          ) : (
            <div className="space-y-3 mb-4 sm:mb-6">
              {existingHierarchies.map((hierarchy) => (
                <button
                  key={hierarchy.hierarchyType}
                  onClick={() => setSelectedHierarchy(hierarchy)}
                  className={`w-full p-3 sm:p-4 border-2 rounded text-left transition-all ${
                    selectedHierarchy?.hierarchyType === hierarchy.hierarchyType
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      selectedHierarchy?.hierarchyType === hierarchy.hierarchyType ? 'border-primary bg-primary' : 'border-muted-foreground'
                    }`}>
                      {selectedHierarchy?.hierarchyType === hierarchy.hierarchyType && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-condensed font-medium text-foreground text-sm sm:text-base">{hierarchy.hierarchyType}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground truncate">
                        Levels: <span className="text-primary">{getHierarchyLevels(hierarchy).join(' → ')}</span>
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('landing')} className="text-muted-foreground hover:text-primary">← Back</Button>
            <SubmitBar
              label="Use Selected Hierarchy"
              onSubmit={handleSelectHierarchy}
              disabled={!selectedHierarchy}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Template */}
      {step === 'template' && selectedHierarchy && (
        <DigitCard>
          <SubHeader>Boundary Data Upload</SubHeader>
          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
            Hierarchy: <span className="text-primary font-medium">{selectedHierarchy.hierarchyType}</span> •
            Levels: <span className="text-primary">{getHierarchyLevels(selectedHierarchy).join(' → ')}</span>
          </p>

          <div className="p-4 bg-primary/5 border border-primary/20 rounded mb-4 sm:mb-6">
            <div className="flex items-center gap-2 text-primary mb-2">
              <Download className="w-5 h-5" />
              <strong className="text-sm font-condensed">Download Template</strong>
            </div>
            <p className="text-xs sm:text-sm mb-2 text-foreground">Boundary_Template_{selectedHierarchy.hierarchyType}.xlsx</p>
            <p className="text-xs sm:text-sm mb-2 text-muted-foreground">Required columns:</p>
            <ul className="text-xs sm:text-sm space-y-1 mb-3 sm:mb-4 text-muted-foreground">
              <li>• <strong>code</strong> - Unique boundary code</li>
              <li>• <strong>name</strong> - Display name</li>
              <li>• <strong>boundaryType</strong> - Level type ({getHierarchyLevels(selectedHierarchy).join(', ')})</li>
              <li>• <strong>parentCode</strong> - Parent boundary code (optional for root)</li>
            </ul>
            <Button size="sm" className="bg-primary hover:bg-primary/90 text-white" onClick={handleDownloadTemplate}>
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>

          <div
            className="border-2 border-dashed border-primary/30 rounded p-6 sm:p-8 text-center hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer mb-4"
            onClick={() => document.getElementById('boundary-file-upload')?.click()}
          >
            {loading ? (
              <>
                <Loader2 className="w-8 h-8 text-primary mx-auto mb-3 animate-spin" />
                <p className="text-sm font-condensed font-medium text-foreground">Parsing Excel file...</p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-primary mx-auto mb-3" />
                <p className="text-sm font-condensed font-medium text-foreground mb-2">
                  Drop your filled boundary template here
                </p>
                <p className="text-xs text-muted-foreground">or click to browse</p>
              </>
            )}
            <input
              id="boundary-file-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
              disabled={loading}
            />
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
          </div>
        </DigitCard>
      )}

      {/* Verify */}
      {step === 'verify' && selectedHierarchy && (
        <DigitCard>
          <SubHeader>Verify Boundary Data</SubHeader>

          <div className="flex items-center gap-2 text-primary mb-3 sm:mb-4">
            <Check className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-sm sm:text-base truncate">File: {uploadedFile?.name}</span>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0 mb-3 sm:mb-4">
            <div className="px-4 sm:px-0">
              <Tabs defaultValue="all">
                <TabsList className="w-full sm:w-auto flex-wrap h-auto gap-1 p-1 bg-muted">
                  <TabsTrigger value="all" className="text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-white">
                    All ({parsedBoundaries.length})
                  </TabsTrigger>
                  <TabsTrigger value="valid" className="text-xs sm:text-sm data-[state=active]:bg-success data-[state=active]:text-white">
                    Valid ({validBoundaries.length})
                  </TabsTrigger>
                  <TabsTrigger value="errors" className="text-xs sm:text-sm data-[state=active]:bg-destructive data-[state=active]:text-white">
                    Errors ({invalidBoundaries.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="all" className="mt-4">
                  <BoundaryTable boundaries={parsedBoundaries} invalidBoundaries={invalidBoundaries} />
                </TabsContent>

                <TabsContent value="valid" className="mt-4">
                  <BoundaryTable boundaries={validBoundaries} invalidBoundaries={[]} />
                </TabsContent>

                <TabsContent value="errors" className="mt-4">
                  {invalidBoundaries.length > 0 ? (
                    <BoundaryTable
                      boundaries={invalidBoundaries.map(i => i.boundary)}
                      invalidBoundaries={invalidBoundaries}
                    />
                  ) : (
                    <p className="text-muted-foreground text-center py-4">No errors found</p>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
            Summary: {parsedBoundaries.length} total |
            <span className="text-success"> {validBoundaries.length} valid</span> |
            <span className="text-destructive"> {invalidBoundaries.length} errors</span>
          </p>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('template')} className="text-muted-foreground hover:text-primary">← Back</Button>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              {invalidBoundaries.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('boundary-file-upload')?.click()}
                  className="border-primary text-primary hover:bg-primary/10"
                >
                  Re-upload Fixed File
                </Button>
              )}
              <SubmitBar
                label={loading ? 'Uploading...' : `Upload ${validBoundaries.length} Boundaries`}
                onSubmit={handleUploadBoundaries}
                disabled={loading || validBoundaries.length === 0}
                icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
              />
            </div>
          </div>
        </DigitCard>
      )}

      {/* Complete */}
      {step === 'complete' && selectedHierarchy && (
        <DigitCard>
          <Banner
            successful={true}
            message="Boundaries Created Successfully!"
            info={`Hierarchy: ${selectedHierarchy.hierarchyType} • Tenant: ${state.tenant.toUpperCase()}`}
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
                {getHierarchyLevels(selectedHierarchy).map((level) => (
                  <TableRow key={level}>
                    <TableCell className="text-xs sm:text-sm">{level}</TableCell>
                    <TableCell className="text-xs sm:text-sm">{createdCounts[level] || 0}</TableCell>
                    <TableCell className="text-success text-xs sm:text-sm">✓ Created</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-sm sm:text-base text-muted-foreground mt-4 text-center">
            Total: <span className="text-primary font-medium">{totalCreated} boundaries</span> created
          </p>

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

// Helper component for boundary table
function BoundaryTable({
  boundaries,
  invalidBoundaries,
}: {
  boundaries: BoundaryExcelRow[];
  invalidBoundaries: { boundary: BoundaryExcelRow; error: string }[];
}) {
  const getError = (code: string) => {
    const invalid = invalidBoundaries.find(i => i.boundary.code === code);
    return invalid?.error;
  };

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="text-xs sm:text-sm font-condensed">Status</TableHead>
            <TableHead className="text-xs sm:text-sm font-condensed">Code</TableHead>
            <TableHead className="text-xs sm:text-sm font-condensed">Name</TableHead>
            <TableHead className="text-xs sm:text-sm font-condensed">Type</TableHead>
            <TableHead className="text-xs sm:text-sm font-condensed">Parent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {boundaries.slice(0, 20).map((row) => {
            const error = getError(row.code);
            return (
              <TableRow key={row.code} className={error ? 'bg-destructive/10' : ''}>
                <TableCell>
                  {error ? (
                    <Badge variant="destructive" className="gap-1 text-xs">
                      <AlertTriangle className="w-3 h-3" /> Error
                    </Badge>
                  ) : (
                    <Badge className="gap-1 text-xs bg-success text-white">
                      <Check className="w-3 h-3" /> Valid
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs sm:text-sm">{row.code}</TableCell>
                <TableCell className="text-xs sm:text-sm">{row.name}</TableCell>
                <TableCell className="text-xs sm:text-sm">{row.boundaryType}</TableCell>
                <TableCell className="font-mono text-xs sm:text-sm">
                  {row.parentCode || '-'}
                  {error && <span className="text-destructive block text-xs">{error}</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {boundaries.length > 20 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Showing first 20 of {boundaries.length} rows
        </p>
      )}
    </div>
  );
}
