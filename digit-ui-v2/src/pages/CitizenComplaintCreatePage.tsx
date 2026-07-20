/**
 * Citizen "File a complaint" — 4-step wizard.
 *
 * Step 1 — Type:        parent group (derived from the ComplaintHierarchy
 *                       master's parentCode) — see useServiceDefs
 * Step 2 — Details:     sub-type (leaf serviceCode, if the group has children)
 *                       + description + landmark
 * Step 3 — Location:    map pick (Leaflet) + locality + photo upload (filestore)
 * Step 4 — Review:      readonly summary + submit to /pgr-services/v2/request/_create
 *
 * Form state is owned by a single react-hook-form instance at the root;
 * each step component reads/writes via useFormContext.
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormProvider, useForm, useFormContext, Controller } from 'react-hook-form';
import { useCreate } from 'ra-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Stepper } from '@/components/digit/Stepper';
import ComplaintMap from '@/components/digit/ComplaintMap';
import { useServiceDefs, type ServiceDefNode } from '@/hooks/useServiceDefs';
import { apiClient, getApiBaseUrl } from '@/api';
import { Upload, X, AlertCircle } from 'lucide-react';

interface FormValues {
  parentCode: string;
  serviceCode: string;
  description: string;
  landmark: string;
  locality: string;
  latitude: number | null;
  longitude: number | null;
  photos: string[];   // fileStoreIds
  photoNames: string[]; // parallel array for UI display
}

const STEPS = ['Type', 'Details', 'Location & photos', 'Review'] as const;
const FIELDS_PER_STEP: Array<Array<keyof FormValues>> = [
  ['parentCode'],
  // Step 2 requires a real serviceCode (a leaf) — the category id from step 1
  // is just for grouping and never gets submitted.
  ['serviceCode', 'description'],
  // lat/lng default to Nairobi's centroid when the citizen leaves them alone,
  // so we don't gate the step on geolocation. The submit handler still sends
  // whatever's in the form to /pgr-services/v2/request/_create.
  [],
  [],
];

// ── Step 1 ─────────────────────────────────────────────────────────────

function TypeStep({ tree, isLoading }: { tree: ServiceDefNode[]; isLoading: boolean }) {
  const { control, formState, watch, setValue } = useFormContext<FormValues>();
  const error = formState.errors.parentCode;
  const selected = watch('parentCode');

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading complaint types…</p>;
  }
  if (tree.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>No complaint types available — please contact support.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Pick the category that best fits.</p>
      <Controller
        name="parentCode"
        control={control}
        rules={{
          required: 'Pick a category to continue',
          // Reject the synthetic placeholder if it somehow leaks through.
          validate: (v) => (v?.startsWith('__cat:') ? true : 'Pick a category'),
        }}
        render={() => (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {tree.map((node) => (
              <button
                type="button"
                key={node.serviceCode}
                onClick={() => {
                  setValue('parentCode', node.serviceCode, { shouldValidate: true });
                  // Categories carry synthetic serviceCodes — the citizen
                  // must pick a leaf in step 2. Reset any prior leaf choice.
                  setValue('serviceCode', '');
                }}
                className={
                  'text-left rounded-md border p-3 transition-colors ' +
                  (selected === node.serviceCode
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-input hover:bg-muted/50')
                }
              >
                <div className="font-medium text-sm">{node.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {node.children.length} option{node.children.length === 1 ? '' : 's'}
                </div>
              </button>
            ))}
          </div>
        )}
      />
      {error && <p className="text-sm text-destructive">{error.message}</p>}
    </div>
  );
}

// ── Step 2 ─────────────────────────────────────────────────────────────

function DetailsStep({ tree }: { tree: ServiceDefNode[] }) {
  const { register, watch, setValue, formState, control } = useFormContext<FormValues>();
  const parentCode = watch('parentCode');
  const parent = tree.find((n) => n.serviceCode === parentCode);
  const selectedSub = watch('serviceCode');

  return (
    <div className="space-y-4">
      {/* Hidden registration so trigger(['serviceCode']) actually validates;
          the button group below sets the value via setValue. */}
      <Controller
        name="serviceCode"
        control={control}
        rules={{
          required: 'Pick a specific complaint to continue',
          validate: (v) =>
            !v || v.startsWith('__cat:') ? 'Pick a specific complaint' : true,
        }}
        render={() => <input type="hidden" value={selectedSub ?? ''} readOnly />}
      />

      {parent && parent.children.length > 0 && (
        <div className="space-y-2">
          <Label>Specific complaint</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {parent.children.map((c) => (
              <button
                type="button"
                key={c.serviceCode}
                onClick={() => setValue('serviceCode', c.serviceCode, { shouldValidate: true })}
                className={
                  'text-left rounded-md border p-3 text-sm transition-colors ' +
                  (selectedSub === c.serviceCode
                    ? 'border-primary bg-primary/5'
                    : 'border-input hover:bg-muted/50')
                }
              >
                {c.name}
              </button>
            ))}
          </div>
          {formState.errors.serviceCode && (
            <p className="text-sm text-destructive">Pick a specific complaint.</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Describe the issue. Be specific (e.g. 'water leaking from broken pipe near house no. 14')."
          {...register('description', {
            required: 'Please describe the complaint',
            minLength: { value: 10, message: 'A few more details, please (min 10 chars)' },
          })}
        />
        {formState.errors.description && (
          <p className="text-sm text-destructive">{formState.errors.description.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="landmark">Landmark <span className="text-muted-foreground">(optional)</span></Label>
        <Input
          id="landmark"
          placeholder="e.g. Next to All Saints church"
          {...register('landmark')}
        />
      </div>
    </div>
  );
}

// ── Step 3 ─────────────────────────────────────────────────────────────

function LocationStep() {
  const { register, setValue, watch, formState } = useFormContext<FormValues>();
  const lat = watch('latitude');
  const lng = watch('longitude');
  const photos = watch('photos');
  const photoNames = watch('photoNames');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const newIds: string[] = [...photos];
      const newNames: string[] = [...photoNames];
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('tenantId', (import.meta.env.VITE_CITIZEN_TENANT as string) || 'ke.nairobi');
        fd.append('module', 'pgr');
        const { token } = apiClient.getAuth();
        const res = await fetch(`${getApiBaseUrl()}/filestore/v1/files`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { Errors?: Array<{ message: string }> }).Errors?.[0]?.message ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        const id = data.files?.[0]?.fileStoreId;
        if (id) {
          newIds.push(id);
          newNames.push(f.name);
        }
      }
      setValue('photos', newIds);
      setValue('photoNames', newNames);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (idx: number) => {
    setValue('photos', photos.filter((_, i) => i !== idx));
    setValue('photoNames', photoNames.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Pin the complaint location</Label>
        <p className="text-xs text-muted-foreground">
          Drag the marker to the exact spot, or hit "Use my GPS" to start from where you are.
        </p>
        <ComplaintMap
          mode="pick"
          lat={lat}
          lng={lng}
          onChange={(newLat, newLng, locality) => {
            setValue('latitude', newLat);
            setValue('longitude', newLng);
            if (locality) setValue('locality', locality);
          }}
        />
        {formState.errors.latitude && (
          <p className="text-sm text-destructive">Please pick a location on the map.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="locality">Locality / area name</Label>
        <Input
          id="locality"
          placeholder="e.g. Westlands"
          {...register('locality')}
        />
        <p className="text-xs text-muted-foreground">
          Auto-filled from the map when you drop the pin — feel free to edit.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Photos <span className="text-muted-foreground">(optional)</span></Label>
        <label className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
          <Upload className="h-4 w-4" />
          <span>{uploading ? 'Uploading…' : 'Add photos'}</span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
        {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
        {photoNames.length > 0 && (
          <ul className="space-y-1">
            {photoNames.map((name, i) => (
              <li
                key={photos[i]}
                className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-sm"
              >
                <span className="truncate">{name}</span>
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Step 4 ─────────────────────────────────────────────────────────────

function ReviewStep({ tree }: { tree: ServiceDefNode[] }) {
  const { watch } = useFormContext<FormValues>();
  const v = watch();
  const parentName = tree.find((n) => n.serviceCode === v.parentCode)?.name ?? v.parentCode;
  const subName =
    tree
      .find((n) => n.serviceCode === v.parentCode)
      ?.children.find((c) => c.serviceCode === v.serviceCode)?.name ?? null;

  const row = (k: string, val: string | number | null | undefined) => (
    <div className="grid grid-cols-3 gap-3 text-sm">
      <div className="text-muted-foreground">{k}</div>
      <div className="col-span-2 break-words">
        {val === null || val === undefined || val === '' ? <span className="text-muted-foreground/60">—</span> : val}
      </div>
    </div>
  );

  return (
    <Card>
      <CardContent className="p-4 space-y-3 divide-y divide-border [&>div]:pt-3 first:[&>div]:pt-0">
        {row('Complaint type', parentName)}
        {subName && row('Sub-type', subName)}
        {row('Description', v.description)}
        {row('Locality', v.locality)}
        {row('Landmark', v.landmark)}
        {row('Coordinates', v.latitude != null ? `${v.latitude.toFixed(5)}, ${v.longitude?.toFixed(5)}` : null)}
        {row('Photos', v.photoNames.length > 0 ? v.photoNames.join(', ') : null)}
      </CardContent>
    </Card>
  );
}

// ── Wizard root ────────────────────────────────────────────────────────

export default function CitizenComplaintCreatePage() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const [create, { isPending }] = useCreate();
  const { tree, isLoading: defsLoading } = useServiceDefs();

  const form = useForm<FormValues>({
    defaultValues: {
      parentCode: '',
      serviceCode: '',
      description: '',
      landmark: '',
      locality: '',
      latitude: null,
      longitude: null,
      photos: [],
      photoNames: [],
    },
    mode: 'onBlur',
  });

  const submitErr = useMemo(() => form.formState.errors.root?.message ?? null, [form.formState.errors.root]);

  async function handleNext() {
    const fields = FIELDS_PER_STEP[step];
    const ok = fields.length === 0 ? true : await form.trigger(fields);
    if (!ok) return;

    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
      return;
    }

    // Final step — submit.
    form.clearErrors('root');
    const v = form.getValues();
    create(
      'complaints',
      {
        data: {
          serviceCode: v.serviceCode || v.parentCode,
          description: v.description,
          landmark: v.landmark,
          city: 'Nairobi',
          locality: v.locality,
          latitude: v.latitude,
          longitude: v.longitude,
          photos: v.photos,
        },
      },
      {
        onSuccess: (data) => {
          const id = (data as { id: string }).id;
          navigate(`/complaints/${encodeURIComponent(id)}/show`, { replace: true });
        },
        onError: (err) => {
          form.setError('root', { message: err instanceof Error ? err.message : 'Failed to file complaint.' });
        },
      },
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">File a complaint</h1>
        <p className="text-sm text-muted-foreground mt-1">Tell us what's wrong — we'll route it to the right team.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent>
          <FormProvider {...form}>
            <Stepper
              steps={[...STEPS]}
              current={step}
              onNext={handleNext}
              onBack={() => setStep((s) => Math.max(0, s - 1))}
              finalLabel="Submit complaint"
              isSubmitting={isPending}
            >
              {step === 0 && <TypeStep tree={tree} isLoading={defsLoading} />}
              {step === 1 && <DetailsStep tree={tree} />}
              {step === 2 && <LocationStep />}
              {step === 3 && <ReviewStep tree={tree} />}
            </Stepper>
            {submitErr && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{submitErr}</AlertDescription>
              </Alert>
            )}
          </FormProvider>
        </CardContent>
      </Card>

      <div className="mt-3 text-right">
        <Button variant="ghost" size="sm" onClick={() => navigate('/complaints')}>Cancel</Button>
      </div>
    </div>
  );
}
