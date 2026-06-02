import { useEffect, useRef, useState } from 'react';
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
  Image,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DigitCard, DigitCardText } from '@/components/digit/DigitCard';
import { Header, SubHeader } from '@/components/digit/Header';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { Banner } from '@/components/digit/Banner';
import { parseExcelFile, parseTenantExcel } from '@/utils/excelParser';
import * as XLSX from 'xlsx';
import { mdmsService, localizationService, apiClient, ApiClientError } from '@/api';
import { bootstrapStateRoot, bootstrapLocalization, stateNeedsBootstrap, type BootstrapProgress } from '@/api/services/tenantBootstrap';
import type { TenantExcelRow, Tenant, ValidationResult } from '@/api/types';

type Step = 'landing' | 'upload' | 'preview' | 'branding' | 'complete' | 'select-existing';

interface BrandingData {
  bannerUrl?: string;
  logoUrl?: string;
  logoUrlWhite?: string;
  stateLogo?: string;
}

// User-facing copy for each branding asset. Keys mirror BrandingData so the
// row renderer can iterate this list directly. Labels and descriptions are
// what the user sees — the camelCase keys above are the wire / MDMS field
// names and never appear in the UI now.
const BRANDING_FIELDS: ReadonlyArray<{
  key: keyof BrandingData;
  label: string;
  description: string;
}> = [
  {
    key: 'logoUrl',
    label: 'Header logo',
    description: 'Top-left logo on every employee and citizen screen. Recommended: PNG with transparent background, at least 300 px wide.',
  },
  {
    key: 'logoUrlWhite',
    label: 'Header logo — dark mode',
    description: 'Same logo, but light/white pixels for use on dark headers (e.g. dashboard mode). Same dimensions as the header logo.',
  },
  {
    key: 'bannerUrl',
    label: 'Citizen-portal banner',
    description: 'Hero image at the top of the citizen-facing home page. Recommended: 1920 × 480 JPG.',
  },
  {
    key: 'stateLogo',
    label: 'County / state emblem',
    description: 'Appears on PDF receipts and printed correspondence. SVG preferred so it scales cleanly.',
  },
];

export default function Phase1Page() {
  const { completePhase, addUndo, state, setTargetTenant } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('landing');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  // Bootstrap progress (only set when we detect a brand-new state root).
  // The new tenant.tenants record will be written at parentState (derived from the
  // tenant code), never at state.tenant — the latter is a localStorage value whose
  // meaning is "whichever tenant the operator's chrome was last pointing at" and
  // doesn't belong in any write decision.
  const [bootstrapProgress, setBootstrapProgress] = useState<BootstrapProgress | null>(null);

  // Parsed data
  const [tenantData, setTenantData] = useState<TenantExcelRow | null>(null);
  const [brandingData, setBrandingData] = useState<BrandingData>({});
  // Per-row error so a bad upload surfaces inline next to the failed row,
  // not at the top of the page where users miss it.
  const [brandingErrors, setBrandingErrors] = useState<Partial<Record<keyof BrandingData, string>>>({});
  // Object URLs of the uploaded branding files, kept local so the Preview
  // button works without a filestore round-trip. Revoked when a row is
  // replaced or the page unmounts.
  const [brandingPreviews, setBrandingPreviews] = useState<Partial<Record<keyof BrandingData, string>>>({});
  const brandingPreviewsRef = useRef(brandingPreviews);
  brandingPreviewsRef.current = brandingPreviews;
  const [previewingKey, setPreviewingKey] = useState<keyof BrandingData | null>(null);

  useEffect(() => {
    return () => {
      Object.values(brandingPreviewsRef.current).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, []);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  // Created tenant
  const [createdTenant, setCreatedTenant] = useState<Tenant | null>(null);

  // Existing-tenant picker — for the common case where the playbook
  // already created the tenant (state_root: mz + auto-bootstrap) and
  // running Phase 1 fresh would just hit "Duplicate record". State root
  // is derived from the login tenant: `mz.maputo` → `mz`, `mz` → `mz`.
  const stateRoot = state.tenant.includes('.') ? state.tenant.split('.')[0] : state.tenant;
  const [existingTenants, setExistingTenants] = useState<Tenant[] | null>(null);
  const [existingTenantsLoading, setExistingTenantsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setExistingTenantsLoading(true);
    mdmsService.getTenants(stateRoot)
      .then((tenants) => { if (!cancelled) setExistingTenants(tenants); })
      .catch((err) => {
        if (!cancelled) {
          console.warn('Failed to list existing tenants:', err);
          setExistingTenants([]);
        }
      })
      .finally(() => { if (!cancelled) setExistingTenantsLoading(false); });
    return () => { cancelled = true; };
  }, [stateRoot]);

  const handleUseExistingTenant = (tenant: Tenant) => {
    setTargetTenant(tenant.code);
    completePhase(1);
    navigate('/phase/2');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setLoading(true);

    try {
      const workbook = await parseExcelFile(file);
      const result = parseTenantExcel(workbook);

      if (result.validation.valid && result.data) {
        setTenantData(result.data.tenant);
        setBrandingData(result.data.branding);
        setValidation(result.validation);
        setUploadedFile(file);
        setStep('preview');
      } else {
        setValidation(result.validation);
        setError(result.validation.errors.map(e => e.message).join(', '));
      }
    } catch (err) {
      console.error('Excel parse error:', err);
      setError('Failed to parse Excel file. Please ensure it is a valid .xlsx file.');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadToDigit = async () => {
    if (!tenantData) return;

    setLoading(true);
    setError(null);

    try {
      // Build tenant object for MDMS
      const tenant: Tenant = {
        code: tenantData.tenantCode,
        name: tenantData.tenantName,
        description: tenantData.displayName,
        logoId: tenantData.logoPath || brandingData.logoUrl,
        city: {
          name: tenantData.cityName || tenantData.tenantName,
          code: tenantData.tenantCode,
          districtName: tenantData.districtName,
          latitude: tenantData.latitude,
          longitude: tenantData.longitude,
          ulbGrade: tenantData.tenantType || 'Municipal Corporation',
        },
      };

      // Derive the parent state from the new tenant code. "kd.test" -> "kd";
      // "ke.testzone" -> "ke". For a single-segment code like "kd" the parent
      // is the code itself (it's already a state root).
      const parentState = tenant.code.includes('.') ? tenant.code.split('.')[0] : tenant.code;

      // If the parent state has no schemas registered, bootstrap it: register
      // the canonical schema set + essential master data + an ADMIN user. The
      // wizard's subsequent Phase 2-4 writes target the new tenant and rely on
      // schema inheritance from this parent, so bootstrap must complete first.
      if (await stateNeedsBootstrap(parentState)) {
        setBootstrapProgress({ step: 'schemas', current: 0, total: 1 });
        await bootstrapStateRoot(parentState, {
          source: 'pg',
          onProgress: setBootstrapProgress,
        });
        setBootstrapProgress(null);
      }

      // Create the new tenant.tenants record at the parent state (which now
      // definitely has the tenant.tenants schema, either pre-existing or just
      // registered by bootstrap). This replaces the previous `state.tenant`
      // target — that was a localStorage value, not a deliberate write target.
      try {
        await mdmsService.createTenant(parentState, tenant);
      } catch (err) {
        const msg = err instanceof ApiClientError ? err.firstError : (err instanceof Error ? err.message : '');
        if (!/duplicate|already exists|unique|NON_UNIQUE/i.test(msg)) throw err;
      }

      // Create localization for tenant name, also at the parent state.
      await localizationService.upsertMessages(parentState, 'en_IN',
        localizationService.buildTenantLocalizations(tenant.code, tenant.name, 'en_IN')
      );
      await localizationService.cacheBust().catch(e => console.warn('cache-bust failed', e));

      // Copy base localization from the parent state → new city tenant so
      // the DIGIT-UI doesn't show raw keys for common labels, PGR messages,
      // and UI strings. Mirrors what MCP bootstrap does. Skipped for bare
      // state roots (no dot in code) — bootstrapStateRoot already ran Step 6.
      if (tenant.code.includes('.')) {
        setBootstrapProgress({ step: 'localization', current: 0, total: 1 });
        await bootstrapLocalization(parentState, tenant.code);
        setBootstrapProgress(null);
        await localizationService.cacheBust().catch(e => console.warn('cache-bust failed', e));
      }

      setCreatedTenant(tenant);
      // Retarget subsequent phases at the freshly-created child tenant so
      // Phases 2–4 write to (and read from) it instead of the session root.
      setTargetTenant(tenant.code);
      addUndo('create_tenant', `Created tenant: ${tenant.code}`);
      setStep('branding');
    } catch (err) {
      console.error('Tenant creation error:', err);
      if (err instanceof ApiClientError) {
        setError(err.firstError);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create tenant. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBrandingUpload = async () => {
    if (!createdTenant) return;

    setLoading(true);
    setError(null);

    try {
      // Upload branding files if URLs are provided
      // For now, we'll just store the URLs in MDMS/config
      // In a real implementation, you'd upload files to filestore

      // If branding URLs are provided, we could upload them
      // For now, just mark as complete since branding is optional

      addUndo('create_branding', 'Configured branding assets');
      setStep('complete');
    } catch (err) {
      console.error('Branding upload error:', err);
      if (err instanceof ApiClientError) {
        setError(err.firstError);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to upload branding. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBrandingFileUpload = async (type: keyof BrandingData, file: File) => {
    // Clear any prior error for this row before retrying.
    setBrandingErrors(prev => ({ ...prev, [type]: undefined }));
    setLoading(true);
    setError(null);

    // Mirror egov-filestore's ALLOWED_FORMATS_MAP for image uploads so users
    // see the obvious cases instantly instead of waiting for a 400.
    // Browser-reported MIME (file.type) is set when the file was saved with a
    // matching extension, but is not authoritative — the backend re-detects
    // via Tika and rejects extension/content mismatches with a separate 400.
    const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'svg'];
    const ALLOWED_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'];
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTS.includes(ext) || (file.type && !ALLOWED_MIMES.includes(file.type))) {
      setBrandingErrors(prev => ({
        ...prev,
        [type]: `Use JPG, PNG, or SVG (got "${file.name}"${file.type ? `, ${file.type}` : ''}). Many phone-camera images are HEIC/WebP — re-export as JPG.`,
      }));
      setLoading(false);
      return;
    }

    try {
      const result = await apiClient.uploadFile(file, 'branding');
      setBrandingData(prev => ({ ...prev, [type]: result.fileStoreId }));
      setBrandingPreviews(prev => {
        if (prev[type]) URL.revokeObjectURL(prev[type]!);
        return { ...prev, [type]: URL.createObjectURL(file) };
      });
    } catch (err) {
      console.error('File upload error:', err);
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setBrandingErrors(prev => ({ ...prev, [type]: msg }));
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    completePhase(1);
    navigate('/phase/2');
  };

  const handleDownloadTemplate = () => {
    // Create a workbook with template sheets
    const wb = XLSX.utils.book_new();

    // Tenant Info sheet
    const tenantHeaders = [
      'Tenant Display Name*',
      'Tenant Code*',
      'Tenant Type*',
      'Logo File Path*',
      'Latitude',
      'Longitude',
      'City Name',
      'District Name',
    ];
    const tenantSample = [
      'My City Council',                       // Tenant Display Name*
      'ke.mycity',                             // Tenant Code* — convention: <root>.<city>, lowercase
      'City',                                  // Tenant Type*
      '',                                      // Logo File Path* — leave blank to upload in Step 1.2
      '-1.2921',                               // Latitude — example: Nairobi
      '36.8219',                               // Longitude
      'My City',                               // City Name
      'My District',                           // District Name
    ];
    const tenantData = [tenantHeaders, tenantSample];
    const tenantSheet = XLSX.utils.aoa_to_sheet(tenantData);

    // Set column widths
    tenantSheet['!cols'] = [
      { wch: 25 }, { wch: 20 }, { wch: 15 }, { wch: 35 },
      { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 15 },
    ];
    XLSX.utils.book_append_sheet(wb, tenantSheet, 'Tenant Info');

    // Tenant Branding Details sheet — kept for back-compat. The recommended
    // path now is to upload images in Step 1.2 (filestore IDs are auto-filled).
    // Leaving these blank in the template is fine; only fill in if you have
    // pre-existing public URLs you want to reuse.
    const brandingHeaders = ['Banner URL', 'Logo URL', 'Logo URL (White)', 'State Logo'];
    const brandingSample = ['', '', '', ''];
    const brandingData = [brandingHeaders, brandingSample];
    const brandingSheet = XLSX.utils.aoa_to_sheet(brandingData);
    brandingSheet['!cols'] = [{ wch: 35 }, { wch: 35 }, { wch: 35 }, { wch: 35 }];
    XLSX.utils.book_append_sheet(wb, brandingSheet, 'Tenant Branding Details');

    // Download the file
    XLSX.writeFile(wb, 'Tenant And Branding Master.xlsx');
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
          {/* Existing-tenant banner — surfaces upfront when the tenant is
              already in MDMS (deploy auto-bootstrap, prior wizard run,
              second operator joining). Skips the duplicate-record cliff
              the create-new path would otherwise hit. */}
          {existingTenants && existingTenants.length > 0 && (
            <Alert variant="info" className="mb-4 sm:mb-6">
              <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <span className="text-xs sm:text-sm">
                  <strong>{existingTenants.length} existing tenant{existingTenants.length === 1 ? '' : 's'}</strong> already configured under <code className="text-primary">{stateRoot}</code>.
                  Skip Phase 1 by selecting one.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-primary text-primary hover:bg-primary/10 shrink-0"
                  onClick={() => setStep('select-existing')}
                >
                  Use existing tenant →
                </Button>
              </AlertDescription>
            </Alert>
          )}

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

          <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row justify-end gap-2">
            {existingTenants && existingTenants.length > 0 && (
              <Button
                variant="outline"
                onClick={() => setStep('select-existing')}
                className="border-primary text-primary hover:bg-primary/10"
              >
                Use existing tenant
              </Button>
            )}
            <SubmitBar
              label="Start Setup"
              onSubmit={() => setStep('upload')}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Use Existing Tenant — picker shown when tenants already exist at the
          chosen state root (deploy auto-bootstrap, prior wizard runs, etc.) */}
      {step === 'select-existing' && (
        <DigitCard>
          <SubHeader>Use Existing Tenant</SubHeader>
          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
            These tenants are already configured under <code className="text-primary">{stateRoot}</code> (created via deploy bootstrap, MCP, or a previous wizard run).
            Pick one to skip tenant creation and jump straight to Phase 2.
          </p>

          {existingTenantsLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading existing tenants…
            </div>
          )}

          {!existingTenantsLoading && (!existingTenants || existingTenants.length === 0) && (
            <Alert variant="info" className="mb-4">
              <AlertDescription className="text-xs sm:text-sm">
                No tenants found under <code className="text-primary">{stateRoot}</code>. Use the Create New flow on the landing page.
              </AlertDescription>
            </Alert>
          )}

          {existingTenants && existingTenants.length > 0 && (
            <div className="overflow-x-auto -mx-4 sm:mx-0 mb-4 sm:mb-6">
              <div className="px-4 sm:px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden sm:table-cell">Description</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {existingTenants.map((t) => (
                      <TableRow key={t.code}>
                        <TableCell><code className="text-primary text-xs">{t.code}</code></TableCell>
                        <TableCell className="font-medium text-sm">{t.name}</TableCell>
                        <TableCell className="hidden sm:table-cell text-xs text-muted-foreground truncate max-w-xs">{t.description || '—'}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            className="bg-primary hover:bg-primary/90 text-white"
                            onClick={() => handleUseExistingTenant(t)}
                          >
                            Use this <ChevronRight className="w-4 h-4 ml-1" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setStep('landing')} className="text-muted-foreground hover:text-primary">
              ← Back
            </Button>
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
                  Drop Tenant And Branding Master.xlsx here
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">or click to browse</p>
              </>
            )}
            <input
              id="file-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
              disabled={loading}
            />
            <Button
              variant="outline"
              size="sm"
              className="border-primary text-primary hover:bg-primary/10"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadTemplate();
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>

          {/* Validation errors */}
          {validation && validation.errors.length > 0 && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Validation Errors:</strong>
                <ul className="list-disc list-inside mt-2">
                  {validation.errors.map((err, i) => (
                    <li key={i} className="text-xs sm:text-sm">
                      {err.row ? `Row ${err.row}: ` : ''}{err.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="mt-4 sm:mt-6 flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => setStep('landing')} className="text-muted-foreground hover:text-primary">
              ← Back
            </Button>
          </div>
        </DigitCard>
      )}

      {/* Preview Step */}
      {step === 'preview' && tenantData && (
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
                        <TableCell className="font-medium text-xs sm:text-sm">{tenantData.displayName}</TableCell>
                        <TableCell className="text-xs sm:text-sm">{tenantData.tenantCode}</TableCell>
                        <TableCell className="text-xs sm:text-sm">{tenantData.tenantType}</TableCell>
                        <TableCell className="text-xs sm:text-sm">{tenantData.cityName || '-'}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Additional details */}
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">District:</span>
                  <span className="ml-2 font-medium">{tenantData.districtName || 'Not specified'}</span>
                </div>
                {tenantData.latitude && tenantData.longitude && (
                  <div>
                    <span className="text-muted-foreground">Coordinates:</span>
                    <span className="ml-2 font-medium">{tenantData.latitude}, {tenantData.longitude}</span>
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="branding">
              {BRANDING_FIELDS.some(({ key }) => brandingData[key]) ? (
                <div className="space-y-2">
                  {BRANDING_FIELDS.map(({ key, label }) => brandingData[key] && (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      <Image className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">{label}:</span>
                      <span className="font-medium truncate">{brandingData[key]}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <DigitCardText className="py-4">No branding details found in Excel. You can configure branding in the next step.</DigitCardText>
              )}
            </TabsContent>
          </Tabs>

          {/* Validation warnings */}
          {validation && validation.warnings.length > 0 && (
            <Alert variant="warning" className="mt-3">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Warnings:</strong>
                <ul className="list-disc list-inside mt-1">
                  {validation.warnings.map((warn, i) => (
                    <li key={i} className="text-xs sm:text-sm">{warn.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Alert variant="info" className="mt-3 sm:mt-4">
            <AlertDescription>
              <strong className="text-sm">This will create:</strong>
              <ul className="text-xs sm:text-sm mt-1 space-y-1">
                <li>• New tenant: {tenantData.tenantCode} ({tenantData.displayName})</li>
                <li>• City module configuration</li>
                <li>• MDMS entries for tenant</li>
                <li>• Localization entries</li>
              </ul>
            </AlertDescription>
          </Alert>

          {bootstrapProgress && (
            <Alert className="mt-4 border-primary/30 bg-primary/5">
              <Loader2 className="w-4 h-4 animate-spin" />
              <AlertDescription>
                Bootstrapping new state root — {bootstrapProgress.step}{' '}
                ({bootstrapProgress.current}/{bootstrapProgress.total})
                {bootstrapProgress.detail ? `: ${bootstrapProgress.detail}` : ''}
              </AlertDescription>
            </Alert>
          )}

          <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('upload')} className="text-muted-foreground hover:text-primary">
              ← Change File
            </Button>
            <SubmitBar
              label={loading ? (bootstrapProgress ? 'Bootstrapping…' : 'Uploading...') : 'Upload to DIGIT'}
              onSubmit={handleUploadToDigit}
              disabled={loading}
              icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Branding Step */}
      {step === 'branding' && createdTenant && (
        <DigitCard>
          <div className="text-center mb-4 sm:mb-6">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-success/10 border-2 border-success rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <Check className="w-6 h-6 sm:w-8 sm:h-8 text-success" />
            </div>
            <h2 className="text-lg sm:text-xl font-condensed font-semibold text-foreground">Tenant Master Uploaded!</h2>
            <p className="text-sm sm:text-base text-muted-foreground">Created: {createdTenant.code} ({createdTenant.name})</p>
          </div>

          <SubHeader>Step 1.2: Branding assets</SubHeader>
          <p className="text-xs sm:text-sm text-muted-foreground -mt-2 mb-4">
            Upload the images that appear on the citizen and employee portals for this tenant. All four are optional — leave any blank to fall back to DIGIT defaults.
          </p>

          <div className="grid gap-3 sm:gap-4">
            {BRANDING_FIELDS.map(({ key, label, description }) => {
              const uploaded = brandingData[key];
              const rowError = brandingErrors[key];
              return (
                <div key={key} className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 border border-border rounded bg-card">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-muted rounded flex items-center justify-center flex-shrink-0">
                    {uploaded ? (
                      <Check className="w-5 h-5 sm:w-6 sm:h-6 text-success" />
                    ) : (
                      <Image className="w-5 h-5 sm:w-6 sm:h-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm sm:text-base">{label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1 truncate">
                      {uploaded ? <>Uploaded ✓ <span className="font-mono text-[11px]">(filestore id: {uploaded})</span></> : 'Not uploaded'}
                    </p>
                    {rowError && (
                      <p className="text-xs text-destructive mt-1 flex items-start gap-1">
                        <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span>{rowError}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {uploaded && brandingPreviews[key] && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="hidden sm:flex border-primary text-primary hover:bg-primary/10"
                        onClick={() => setPreviewingKey(key)}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        Preview
                      </Button>
                    )}
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleBrandingFileUpload(key, file);
                        }}
                      />
                      <Button variant="outline" size="sm" asChild className="border-primary text-primary hover:bg-primary/10">
                        <span>
                          <Upload className="w-4 h-4 mr-1" />
                          {uploaded ? 'Replace' : 'Upload'}
                        </span>
                      </Button>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          <Alert variant="info" className="mt-4">
            <AlertDescription className="text-xs sm:text-sm">
              Branding is optional. You can skip any row and configure these later from Management → Tenants.
            </AlertDescription>
          </Alert>

          <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('preview')} className="text-muted-foreground hover:text-primary">
              ← Back
            </Button>
            <SubmitBar
              label={loading ? 'Uploading...' : 'Continue'}
              onSubmit={handleBrandingUpload}
              disabled={loading}
              icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Complete Step */}
      {step === 'complete' && createdTenant && (
        <DigitCard>
          <Banner
            successful={true}
            message="Phase 1 Complete!"
            info="Tenant and branding have been configured"
          />

          <div className="mt-6 p-4 bg-muted rounded">
            <p className="font-condensed font-medium text-foreground mb-2 text-sm sm:text-base">Created:</p>
            <ul className="text-xs sm:text-sm text-muted-foreground space-y-1">
              <li>✓ Tenant: {createdTenant.code} ({createdTenant.name})</li>
              <li>✓ Localization entries created</li>
              {Object.values(brandingData).some(Boolean) && <li>✓ Branding assets configured</li>}
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

      {/* Branding preview modal */}
      <Dialog open={previewingKey !== null} onOpenChange={(open) => !open && setPreviewingKey(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {previewingKey && BRANDING_FIELDS.find((f) => f.key === previewingKey)?.label}
            </DialogTitle>
          </DialogHeader>
          {previewingKey && brandingPreviews[previewingKey] && (
            <div className="flex items-center justify-center bg-muted/30 rounded p-4">
              <img
                src={brandingPreviews[previewingKey]}
                alt={BRANDING_FIELDS.find((f) => f.key === previewingKey)?.label}
                className="max-h-[70vh] max-w-full object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
