import { useState } from 'react';
import { Plus, Download, Upload, Check, ChevronRight, Loader2, AlertTriangle, X } from 'lucide-react';
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
  parseExcelFile,
  parseComplaintHierarchyExcel,
  type ClassificationNodeRow,
  type HierarchyServiceDefRow,
} from '@/utils/excelParser';
import { downloadComplaintHierarchyTemplate } from '@/utils/templateBuilder';

type Step = 'define' | 'template' | 'verify';

const HDEF_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchyDefinition';
const NODE_SCHEMA = 'RAINMAKER-PGR.ClassificationNode';
const SERVICEDEF_SCHEMA = 'RAINMAKER-PGR.ServiceDefs';

export interface ComplaintHierarchySetupProps {
  /** City/onboarding tenant the citizen UI reads from. */
  targetTenant: string;
  /** State-root tenant pgr-services validates serviceCode against. */
  stateTenant: string;
  /** Called after the hierarchy + nodes + serviceDefs are ingested. */
  onDone: (summary: { nodes: number; defs: number }) => void;
  /** Optional error sink so the host phase can surface failures. */
  onError?: (message: string) => void;
}

/**
 * Self-contained "define configurable levels → generate dynamic Excel template
 * → upload → ingest" flow for the complaint classification hierarchy. Mounted
 * inside Phase 3 (Common Masters) as the complaint-type setup step — the
 * hierarchy-aware replacement for the old flat ComplaintType sheet. Mirrors the
 * boundary define-levels pattern from Phase 2.
 */
export function ComplaintHierarchySetup({ targetTenant, stateTenant, onDone, onError }: ComplaintHierarchySetupProps) {
  const [step, setStep] = useState<Step>('define');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hierarchyType, setHierarchyType] = useState('PGR');
  const [levels, setLevels] = useState<string[]>(['AUTHORITY_TYPE', 'MAIN_CATEGORY', 'SECTOR', 'SUB_TYPE']);

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [nodes, setNodes] = useState<ClassificationNodeRow[]>([]);
  const [serviceDefs, setServiceDefs] = useState<HierarchyServiceDefRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const fail = (m: string) => {
    setError(m);
    onError?.(m);
  };

  const validLevels = () => levels.map((l) => l.trim()).filter(Boolean);

  const buildDefinitionLevels = () =>
    validLevels().map((lc, i, arr) => ({
      levelCode: lc,
      order: i + 1,
      parentLevel: i === 0 ? null : arr[i - 1],
      isFreeText: false,
      isLeafServiceCode: i === arr.length - 1,
      label: lc,
    }));

  const handleDefine = () => {
    if (!hierarchyType.trim()) return fail('Hierarchy type is required');
    if (validLevels().length < 2) return fail('At least 2 levels are required (the last is the sub-type / serviceCode)');
    setError(null);
    setStep('template');
  };

  const handleDownloadTemplate = () => downloadComplaintHierarchyTemplate(hierarchyType, validLevels());

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const workbook = await parseExcelFile(file);
      const result = parseComplaintHierarchyExcel(workbook, hierarchyType, validLevels());
      if (!result.validation.valid) {
        fail(result.validation.errors.map((er) => er.message).join('; '));
        return;
      }
      if (result.serviceDefs.length === 0) {
        fail('No complaint sub-types found in the sheet. Fill at least one row.');
        return;
      }
      setUploadedFile(file);
      setNodes(result.classificationNodes);
      setServiceDefs(result.serviceDefs);
      setWarnings(result.validation.warnings.map((w) => w.message));
      setStep('verify');
    } catch (err) {
      console.error('Excel parse error:', err);
      fail('Failed to parse the file. Ensure it is the downloaded .xlsx template.');
    } finally {
      setLoading(false);
    }
  };

  const writeToTenant = async (tenant: string) => {
    const swallow = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch {
        /* duplicate / already-exists is fine on re-run */
      }
    };
    await swallow(
      mdmsService.create(tenant, HDEF_SCHEMA, hierarchyType, {
        hierarchyType,
        active: true,
        levels: buildDefinitionLevels(),
      })
    );
    for (const n of nodes) {
      await swallow(
        mdmsService.create(tenant, NODE_SCHEMA, n.code, {
          hierarchyType: n.hierarchyType,
          levelCode: n.levelCode,
          code: n.code,
          parentCode: n.parentCode,
          name: n.name,
          order: n.order,
          active: true,
          path: n.path,
        })
      );
    }
    // Leaf ServiceDefs: only base fields + menuPath (= sector code) so the live
    // additionalProperties:false ServiceDefs schema accepts them; the citizen
    // renderer links leaves to their sector via menuPath.
    for (const s of serviceDefs) {
      await swallow(
        mdmsService.create(tenant, SERVICEDEF_SCHEMA, s.serviceCode, {
          serviceCode: s.serviceCode,
          name: s.name,
          keywords: s.keywords,
          department: s.department || 'NA',
          slaHours: s.slaHours,
          active: true,
          order: s.order,
          menuPath: s.menuPath,
        })
      );
    }
  };

  const handleIngest = async () => {
    setLoading(true);
    setError(null);
    try {
      await writeToTenant(targetTenant);
      if (stateTenant && stateTenant !== targetTenant) {
        await writeToTenant(stateTenant).catch((e) =>
          console.warn('[ComplaintHierarchy] state-root dual-write failed (non-fatal):', e)
        );
      }
      await localizationService
        .uploadComplaintTypeLocalizations(
          targetTenant,
          serviceDefs.map((s) => ({ serviceCode: s.serviceCode, name: s.name, department: s.department, menuPath: s.menuPath })),
          'en_IN'
        )
        .catch((e) => console.warn('[ComplaintHierarchy] localization failed (non-fatal):', e));
      await localizationService.cacheBust().catch(() => undefined);
      onDone({ nodes: nodes.length, defs: serviceDefs.length });
    } catch (err) {
      console.error('Ingest error:', err);
      fail(err instanceof Error ? err.message : 'Failed to ingest the complaint hierarchy.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
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
          <SubHeader>Step 3.2: Define Complaint Hierarchy</SubHeader>
          <p className="text-xs sm:text-sm text-muted-foreground mb-4">
            Add as many levels as you need — the count is the depth. The last level is the complaint sub-type
            (its values become serviceCodes). Replaces the old flat complaint-type sheet.
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
                    {idx === levels.length - 1 && <span className="text-xs text-primary hidden sm:inline">[Leaf · sub-type]</span>}
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
            <SubmitBar label="Next: Template" onSubmit={handleDefine} icon={<ChevronRight className="w-4 h-4" />} />
          </div>
        </div>
      )}

      {step === 'template' && (
        <div>
          <SubHeader>Step 3.2: Download &amp; Upload Template</SubHeader>
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
              One column per level + Department Name*, Resolution Time (Hours)*, Search Words*. One row per
              sub-type — repeat the ancestor columns to group sub-types under the same path.
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
          <Button variant="ghost" size="sm" onClick={() => setStep('define')} className="text-muted-foreground hover:text-primary">← Back to levels</Button>
        </div>
      )}

      {step === 'verify' && (
        <div>
          <SubHeader>Step 3.2: Verify &amp; Create</SubHeader>
          <div className="flex items-center gap-2 text-primary mb-3"><Check className="w-4 h-4" /><span className="text-sm truncate">File: {uploadedFile?.name}</span></div>
          {warnings.length > 0 && (
            <Alert variant="warning" className="mb-4">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription><ul className="text-xs space-y-1">{warnings.slice(0, 6).map((w, i) => <li key={i}>• {w}</li>)}</ul></AlertDescription>
            </Alert>
          )}
          <Tabs defaultValue="leaves">
            <TabsList className="bg-muted">
              <TabsTrigger value="leaves" className="text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-white">Sub-types ({serviceDefs.length})</TabsTrigger>
              <TabsTrigger value="nodes" className="text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-white">Hierarchy nodes ({nodes.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="leaves" className="mt-4 overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="bg-muted/50">
                  <TableHead className="text-xs font-condensed">serviceCode</TableHead>
                  <TableHead className="text-xs font-condensed">Name</TableHead>
                  <TableHead className="text-xs font-condensed">Sector</TableHead>
                  <TableHead className="text-xs font-condensed">Dept</TableHead>
                  <TableHead className="text-xs font-condensed">SLA</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {serviceDefs.slice(0, 25).map((s) => (
                    <TableRow key={s.serviceCode}>
                      <TableCell className="font-mono text-xs">{s.serviceCode}</TableCell>
                      <TableCell className="text-xs">{s.name}</TableCell>
                      <TableCell className="font-mono text-xs">{s.menuPath}</TableCell>
                      <TableCell className="text-xs">{s.department || '-'}</TableCell>
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
                  {nodes.slice(0, 25).map((n) => (
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
            Will create 1 hierarchy definition, <span className="text-primary">{nodes.length}</span> nodes,{' '}
            <span className="text-primary">{serviceDefs.length}</span> complaint sub-types
            {stateTenant !== targetTenant ? ` (on ${targetTenant} and ${stateTenant})` : ''}.
          </p>
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setStep('template')} className="text-muted-foreground hover:text-primary">← Back</Button>
            <SubmitBar
              label={loading ? 'Creating…' : `Create ${serviceDefs.length} Sub-types`}
              onSubmit={handleIngest}
              disabled={loading || serviceDefs.length === 0}
              icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
            />
          </div>
        </div>
      )}
    </div>
  );
}
