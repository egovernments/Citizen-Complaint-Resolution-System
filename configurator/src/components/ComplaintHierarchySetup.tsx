import { useState } from 'react';
import { Plus, Download, Upload, Check, ChevronRight, Loader2, AlertTriangle, X, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SubHeader } from '@/components/digit/Header';
import { LabelFieldPair, CardLabel, Field } from '@/components/digit/LabelFieldPair';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { mdmsService, localizationService } from '@/api';
import {
  COMPLAINT_DEPARTMENT_HEADER,
  levelLabel,
  parseExcelFile,
  parseComplaintHierarchyExcel,
  type ComplaintHierarchyRow,
} from '@/utils/excelParser';
import { downloadComplaintHierarchyTemplate } from '@/utils/templateBuilder';
import { labelLocales } from '@/onboarding/labelLocales';
import { useOnboardingT } from '@/onboarding/i18n';
import { writeSheetHierarchy } from '@/onboarding/complaints/complaintsApi';
import type { DepartmentChoice } from '@/onboarding/complaints/sheetDepartments';

type Step = 'define' | 'template' | 'verify';

// 2-master complaint hierarchy: just the Definition (levels) + the single
// ComplaintHierarchy adjacency list (interior nodes AND leaf complaint types).
// RAINMAKER-PGR.ServiceDefs / .ClassificationNode are gone.
const HDEF_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchyDefinition';
const HIERARCHY_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchy';

export interface ComplaintHierarchySetupProps {
  /** City/onboarding tenant the citizen UI reads from. */
  targetTenant: string;
  /** State-root tenant pgr-services validates serviceCode against. */
  stateTenant: string;
  /** Called after the definition + hierarchy rows are ingested. */
  onDone: (summary: { nodes: number; defs: number }) => void;
  /** Optional error sink so the host phase can surface failures. */
  onError?: (message: string) => void;
  /**
   * The workspace's departments. The sheet's department cells must name one of them, by code or
   * name, and the template's sample rows and Departments sheet use them.
   */
  departments?: DepartmentChoice[];
}

/**
 * Self-contained "define configurable levels → generate dynamic Excel template
 * → upload → ingest" flow for the complaint classification hierarchy. Mounted
 * inside Phase 3 (Common Masters) as the complaint-type setup step — the
 * hierarchy-aware replacement for the old flat ComplaintType sheet. Mirrors the
 * boundary define-levels pattern from Phase 2.
 */
export function ComplaintHierarchySetup({ targetTenant, stateTenant, onDone, onError, departments }: ComplaintHierarchySetupProps) {
  // Only for the sheet's row messages, which onboarding translates; this panel's own copy is English.
  const t = useOnboardingT();
  const [step, setStep] = useState<Step>('define');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hierarchyType, setHierarchyType] = useState('PGR');
  const [levels, setLevels] = useState<string[]>(['AUTHORITY_TYPE', 'MAIN_CATEGORY', 'SECTOR', 'SUB_TYPE']);

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  // The single adjacency list (interior nodes AND leaves) + a leaf-only view
  // for the verify table / counts.
  const [nodes, setNodes] = useState<ComplaintHierarchyRow[]>([]);
  const [leaves, setLeaves] = useState<ComplaintHierarchyRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Rows to fix in the sheet before anything can be created (a blank or unknown department, a missing level).
  const [rowErrors, setRowErrors] = useState<string[]>([]);

  const fail = (m: string) => {
    setError(m);
    onError?.(m);
  };

  const validLevels = () => levels.map((l) => l.trim()).filter(Boolean);

  /** A department by its name, with the code kept as small print; '-' when the row has none. */
  const departmentLabel = (code?: string) => {
    if (!code) return '-';
    const name = departments?.find((d) => d.code === code)?.name;
    return name && name !== code ? `${name} (${code})` : code;
  };

  // Interior (non-leaf) nodes for the verify table — `nodes` holds the whole
  // adjacency list (interior + leaves) since both share the one master.
  const interiorNodes = nodes.filter((n) => !n.isLeaf);

  const buildDefinitionLevels = () =>
    validLevels().map((lc, i, arr) => ({
      levelCode: lc,
      order: i + 1,
      parentLevel: i === 0 ? null : arr[i - 1],
      isFreeText: false,
      isLeafServiceCode: i === arr.length - 1,
      label: levelLabel(lc),
    }));

  const handleDefine = () => {
    if (!hierarchyType.trim()) return fail('Hierarchy type is required');
    if (validLevels().length < 2) {
      return fail('Add at least 2 levels. The last one is the complaint subcategory people report.');
    }
    setError(null);
    setStep('template');
  };

  const handleDownloadTemplate = () => downloadComplaintHierarchyTemplate(hierarchyType, validLevels(), departments);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const workbook = await parseExcelFile(file);
      const result = parseComplaintHierarchyExcel(workbook, hierarchyType, validLevels(), { departments, t });
      // A sheet-level problem (no sheet at all) has no rows to preview.
      const sheetErrors = result.validation.errors.filter((er) => !er.row);
      if (sheetErrors.length > 0) {
        fail(sheetErrors.map((er) => er.message).join('; '));
        return;
      }
      if (result.leaves.length === 0 && result.validation.errors.length === 0) {
        fail('No complaint subcategories found in the sheet. Fill at least one row.');
        return;
      }
      // Row problems show in the preview, beside the rows, and keep Create switched off until fixed.
      setUploadedFile(file);
      setNodes(result.nodes);
      setLeaves(result.leaves);
      setWarnings(result.validation.warnings.map((w) => w.message));
      setRowErrors(result.validation.errors.map((er) => er.message));
      setStep('verify');
    } catch (err) {
      console.error('Excel parse error:', err);
      fail('Failed to parse the file. Ensure it is the downloaded .xlsx template.');
    } finally {
      setLoading(false);
    }
  };

  const definitionData = () => ({ hierarchyType, active: true, levels: buildDefinitionLevels() });

  // Write the single ComplaintHierarchy adjacency list: interior nodes AND
  // leaf rows go to the SAME master. Leaf rows carry the leaf fields
  // (department/departments/slaHours/keywords) which is also what marks them
  // as leaves on read. `menuPath` is gone — grouping is carried by parentCode.
  // A leaf always has a department: the sheet is refused without one (#2806).
  const rowsData = () =>
    nodes.map((n) => {
      const data: Record<string, unknown> = {
        hierarchyType: n.hierarchyType,
        levelCode: n.levelCode,
        code: n.code,
        parentCode: n.parentCode,
        name: n.name,
        order: n.order,
        active: true,
        path: n.path,
      };
      if (n.isLeaf) {
        data.department = n.department;
        if (n.departments) data.departments = n.departments;
        data.slaHours = n.slaHours;
        data.keywords = n.keywords;
      }
      return { code: n.code, data };
    });

  // The state root keeps every city's copy: only add what is missing there, never change another city's.
  const writeToStateRoot = async (tenant: string) => {
    const swallow = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch {
        /* duplicate / already-exists is fine on re-run */
      }
    };
    await swallow(mdmsService.create(tenant, HDEF_SCHEMA, hierarchyType, definitionData()));
    for (const row of rowsData()) await swallow(mdmsService.create(tenant, HIERARCHY_SCHEMA, row.code, row.data));
  };

  const handleIngest = async () => {
    if (rowErrors.length > 0 || leaves.some((leaf) => !leaf.department)) return;
    setLoading(true);
    setError(null);
    try {
      // The workspace's own copy: created, restored after a "Remove and upload again", or updated.
      await writeSheetHierarchy(targetTenant, hierarchyType, definitionData(), rowsData());
      if (stateTenant && stateTenant !== targetTenant) {
        await writeToStateRoot(stateTenant).catch((e) =>
          console.warn('[ComplaintHierarchy] state-root dual-write failed (non-fatal):', e)
        );
      }
      // Seed COMPLAINT_HIERARCHY.<code> for EVERY node — interior nodes
      // (category / sector) too, not just leaves — since a leaf-less branch is
      // filed against an interior node directly and would render the raw key.
      // Written under every workspace language, as the typed-in route does;
      // non-English languages only get keys they lack (no overwrite).
      const labels = nodes.map((s) => ({
        serviceCode: s.code,
        name: s.name,
        department: s.isLeaf ? s.department : undefined,
      }));
      await localizationService.uploadComplaintTypeLocalizationsForLocales(
        targetTenant,
        labels,
        await labelLocales(targetTenant)
      );
      await localizationService.cacheBust().catch(() => undefined);
      onDone({ nodes: nodes.length, defs: leaves.length });
    } catch (err) {
      console.error('Ingest error:', err);
      fail(err instanceof Error ? err.message : 'Failed to ingest the complaint hierarchy.');
    } finally {
      setLoading(false);
    }
  };

  return (
    // data-step lets tests wait for a step without matching its heading copy
    // (#ch-file-upload is rendered in every step, so it can't tell them apart).
    <div data-testid="complaint-hierarchy-setup" data-step={step}>
      <input id="ch-file-upload" type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" disabled={loading} />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-6 w-6 p-0">
              <X className="h-4 w-4" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {step === 'define' && (
        <div>
          <SubHeader>Choose your complaint levels</SubHeader>
          <p className="text-xs sm:text-sm text-muted-foreground mb-4">
            Add as many levels as you need. People pick from the first level down, and the last level is the
            complaint subcategory they report.
          </p>
          <div className="space-y-6">
            <LabelFieldPair>
              <CardLabel required>Hierarchy Type</CardLabel>
              <Field>
                <Input value={hierarchyType} onChange={(e) => setHierarchyType(e.target.value)} placeholder="PGR" className="border-input-border focus:border-primary" />
                <p className="text-xs text-muted-foreground mt-1">Short uppercase id, one per tenant. e.g. PGR</p>
              </Field>
            </LabelFieldPair>
            <div>
              <CardLabel className="mb-2">Levels (top → leaf)</CardLabel>
              <div className="border border-border rounded p-3 sm:p-4 mt-2 bg-muted/30">
                {levels.map((level, idx) => (
                  <div key={idx} className="flex items-center gap-2 sm:gap-3 mb-3 last:mb-0">
                    <span className="text-xs sm:text-sm text-muted-foreground w-14 sm:w-16 flex-shrink-0 font-condensed">Level {idx + 1}:</span>
                    <Input
                      value={level}
                      onChange={(e) => {
                        const next = [...levels];
                        next[idx] = e.target.value;
                        setLevels(next);
                      }}
                      placeholder="e.g. SECTOR"
                      className="flex-1 border-input-border focus:border-primary"
                    />
                    {idx === 0 && <span className="text-xs text-primary hidden sm:inline">[Root]</span>}
                    {idx === levels.length - 1 && <span className="text-xs text-primary hidden sm:inline">[Leaf · subcategory]</span>}
                    {levels.length > 2 && (
                      <Button variant="ghost" size="sm" onClick={() => setLevels(levels.filter((_, i) => i !== idx))} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setLevels([...levels, ''])} className="mt-3 border-primary text-primary hover:bg-primary/10">
                  <Plus className="w-4 h-4 mr-1" /> Add Level
                </Button>
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-6">
            <SubmitBar label="Next: Template" onSubmit={handleDefine} icon={<ChevronRight className="w-4 h-4" />} data-testid="ch-next-template" />
          </div>
        </div>
      )}

      {step === 'template' && (
        <div>
          <SubHeader>Download and upload the template</SubHeader>
          <p className="text-xs sm:text-sm text-muted-foreground mb-4">
            Hierarchy: <span className="text-primary font-medium">{hierarchyType}</span> • Levels:{' '}
            <span className="text-primary">{validLevels().join(' → ')}</span>
          </p>
          <div className="p-4 bg-primary/5 border border-primary/20 rounded mb-4">
            <div className="flex items-center gap-2 text-primary mb-2">
              <Download className="w-5 h-5" />
              <strong className="text-sm font-condensed">Download Template</strong>
            </div>
            <p className="text-xs sm:text-sm mb-2 text-muted-foreground">
              One column per level, then {COMPLAINT_DEPARTMENT_HEADER}, Resolution Time (Hours)* and Search Words*. One
              row per subcategory: repeat the levels above it to group subcategories together. For the department, use
              its code or its name, as listed on the template's Departments sheet.
            </p>
            <Button size="sm" className="bg-primary hover:bg-primary/90 text-white" onClick={handleDownloadTemplate}>
              <Download className="w-4 h-4 mr-2" /> Download Template
            </Button>
          </div>
          <div
            className="border-2 border-dashed border-primary/30 rounded p-6 sm:p-8 text-center hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer mb-4"
            onClick={() => document.getElementById('ch-file-upload')?.click()}
          >
            {loading ? (
              <>
                <Loader2 className="w-8 h-8 text-primary mx-auto mb-3 animate-spin" />
                <p className="text-sm font-condensed font-medium text-foreground">Parsing…</p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-primary mx-auto mb-3" />
                <p className="text-sm font-condensed font-medium text-foreground mb-2">Drop your filled complaint-hierarchy template here</p>
                <p className="text-xs text-muted-foreground">or click to browse</p>
              </>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setStep('define')} className="gap-1.5 text-primary hover:text-primary"><ArrowLeft className="w-4 h-4" />Back to levels</Button>
        </div>
      )}

      {step === 'verify' && (
        <div>
          <SubHeader>Check and create</SubHeader>
          <div className="flex items-center gap-2 text-primary mb-3"><Check className="w-4 h-4" /><span className="text-sm truncate">File: {uploadedFile?.name}</span></div>
          {rowErrors.length > 0 && (
            <Alert variant="destructive" className="mb-4" data-testid="ch-row-errors">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription className="space-y-2">
                <p className="text-sm font-medium">Fix these rows in your sheet, then upload it again. Nothing is created until then.</p>
                <ul className="text-xs space-y-1">
                  {rowErrors.slice(0, 10).map((m, i) => <li key={i}>• {m}</li>)}
                </ul>
                {rowErrors.length > 10 && (
                  <p className="text-xs">And {rowErrors.length - 10} more.</p>
                )}
                <Button variant="outline" size="sm" onClick={() => document.getElementById('ch-file-upload')?.click()} disabled={loading}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload the fixed sheet
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {warnings.length > 0 && (
            <Alert variant="warning" className="mb-4">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription><ul className="text-xs space-y-1">{warnings.slice(0, 6).map((w, i) => <li key={i}>• {w}</li>)}</ul></AlertDescription>
            </Alert>
          )}
          <Tabs defaultValue="leaves">
            <TabsList className="bg-muted">
              <TabsTrigger value="leaves" className="text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-white">Subcategories ({leaves.length})</TabsTrigger>
              <TabsTrigger value="nodes" className="text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-white">Hierarchy nodes ({interiorNodes.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="leaves" className="mt-4 overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="bg-muted/50">
                  <TableHead className="text-xs font-condensed">Code</TableHead>
                  <TableHead className="text-xs font-condensed">Name</TableHead>
                  <TableHead className="text-xs font-condensed">Parent</TableHead>
                  <TableHead className="text-xs font-condensed">Dept</TableHead>
                  <TableHead className="text-xs font-condensed">SLA</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {leaves.slice(0, 25).map((s) => (
                    <TableRow key={s.code}>
                      <TableCell className="font-mono text-xs">{s.code}</TableCell>
                      <TableCell className="text-xs">{s.name}</TableCell>
                      <TableCell className="font-mono text-xs">{s.parentCode || '-'}</TableCell>
                      <TableCell className="text-xs">{departmentLabel(s.department)}</TableCell>
                      <TableCell className="text-xs">{s.slaHours}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="nodes" className="mt-4 overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="bg-muted/50">
                  <TableHead className="text-xs font-condensed">Level</TableHead>
                  <TableHead className="text-xs font-condensed">Code</TableHead>
                  <TableHead className="text-xs font-condensed">Name</TableHead>
                  <TableHead className="text-xs font-condensed">Parent</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {interiorNodes.slice(0, 25).map((n) => (
                    <TableRow key={`${n.levelCode}-${n.code}`}>
                      <TableCell className="text-xs">{n.levelCode}</TableCell>
                      <TableCell className="font-mono text-xs">{n.code}</TableCell>
                      <TableCell className="text-xs">{n.name}</TableCell>
                      <TableCell className="font-mono text-xs">{n.parentCode || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
          <p className="text-xs sm:text-sm text-muted-foreground my-4">
            Will create 1 hierarchy definition and <span className="text-primary">{nodes.length}</span> hierarchy rows
            (<span className="text-primary">{interiorNodes.length}</span> nodes +{' '}
            <span className="text-primary">{leaves.length}</span> complaint subcategories)
            {stateTenant !== targetTenant ? ` (on ${targetTenant} and ${stateTenant})` : ''}.
          </p>
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setStep('template')} className="gap-1.5 text-primary hover:text-primary"><ArrowLeft className="w-4 h-4" />Back</Button>
            {/* data-testid is for the integration suite to click instead of the label,
                which is copy: "Sub-types" → "Subcategories" (#2243) stalled the
                onboarding tests until their timeout. */}
            <SubmitBar
              label={loading ? 'Creating…' : `Create ${leaves.length} Subcategories`}
              onSubmit={handleIngest}
              disabled={loading || leaves.length === 0 || rowErrors.length > 0}
              icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
              data-testid="ch-create"
            />
          </div>
        </div>
      )}
    </div>
  );
}
