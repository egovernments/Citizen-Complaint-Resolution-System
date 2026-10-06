import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2 } from 'lucide-react';
import { useApp } from '../App';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ONBOARDING_STEPS } from './steps';
import { StepHeader } from './StepHeader';
import { BRAND_THEMES, DEFAULT_BRAND_THEME_ID } from './brandThemes';
import { loadBranding, saveBranding, ThemeSaveError, type Branding, type LogoChange } from './brandingApi';
import { announceOrganisation, initialsOf } from './organisation';
import { describeSaveError } from './errors';
import { reportStepError, trackStepAction } from './telemetry';

const STEP = ONBOARDING_STEPS.find((step) => step.id === 'branding')!;
const NEXT = ONBOARDING_STEPS.find((step) => step.number === STEP.number + 1)!;

// What egov-filestore accepts for images, so a wrong file fails here rather than
// as a 400. It takes no SVG, and serving an uploaded SVG from our own origin
// would open a stored-XSS path anyway.
const LOGO_TYPES = ['image/png', 'image/jpeg'];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MIN_PX = 128;
const NAME_MAX = 100;

/** The logo's pixel size, or null when the image can't be read. */
function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export default function BrandingStep() {
  const { state, completePhase } = useApp();
  const navigate = useNavigate();
  const nameId = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  const [branding, setBranding] = useState<Branding | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [logo, setLogo] = useState<LogoChange>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [themeId, setThemeId] = useState(DEFAULT_BRAND_THEME_ID);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const done = state.completedPhases.includes(STEP.number);

  useEffect(() => {
    let cancelled = false;
    loadBranding(state.tenant)
      .then((loaded) => {
        if (cancelled) return;
        setBranding(loaded);
        setName(loaded.name);
        setThemeId(loaded.themeId ?? DEFAULT_BRAND_THEME_ID);
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [state.tenant, reloadKey]);

  // A picked file previews from memory until it is saved.
  const logoPreview = useMemo(() => (logo?.kind === 'upload' ? URL.createObjectURL(logo.file) : null), [logo]);
  useEffect(
    () => () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    },
    [logoPreview],
  );

  const shownLogo = logo?.kind === 'remove' ? null : logoPreview ?? branding?.logoUrl ?? null;

  const pickLogo = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    setLogoError(null);
    if (!LOGO_TYPES.includes(file.type)) {
      setLogoError('Use a PNG or JPG image.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError('That image is over 2 MB. Use a smaller file.');
      return;
    }
    const size = await imageSize(file);
    if (size && (size.width < LOGO_MIN_PX || size.height < LOGO_MIN_PX)) {
      setLogoError(`That image is ${size.width}×${size.height}px. Use one at least ${LOGO_MIN_PX}px on each side.`);
      return;
    }
    setLogo({ kind: 'upload', file });
  };

  const removeLogo = () => {
    setLogoError(null);
    // A logo picked but never saved just goes; a saved one is removed on save.
    setLogo(branding?.logoUrl ? { kind: 'remove' } : null);
  };

  const save = async () => {
    if (!branding) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Enter your organisation’s name.');
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setNameError(`Keep the name under ${NAME_MAX} characters.`);
      return;
    }
    setNameError(null);
    setSaveError(null);
    setSaving(true);
    try {
      const theme = BRAND_THEMES.find((candidate) => candidate.id === themeId) ?? null;
      const saved = await saveBranding(branding, { name: trimmed, logo, theme });
      trackStepAction('branding', 'entity_update', 'branding', {
        tenant: state.tenant,
        theme: theme?.id ?? 'none',
        logo: logo?.kind ?? 'unchanged',
        renamed: trimmed !== branding.name,
      });
      setBranding(saved);
      setLogo(null);
      announceOrganisation({ name: saved.name, logoUrl: saved.logoUrl });
      if (!await completePhase(STEP.number)) return;
      navigate(NEXT.path);
    } catch (err) {
      if (err instanceof ThemeSaveError) reportStepError('branding', 'save_theme', err.cause, state.tenant);
      else reportStepError('branding', 'save', err, state.tenant);
      if (err instanceof ThemeSaveError) {
        // What did save stays saved; only the theme is left to retry.
        setBranding(err.saved);
        setLogo(null);
        announceOrganisation({ name: err.saved.name, logoUrl: err.saved.logoUrl });
        setSaveError(
          `Your name and logo are saved, but the theme isn’t. ${describeSaveError(err.cause, 'Try again.')}`,
        );
      } else {
        setSaveError(describeSaveError(err, 'Saving your branding failed. Try again.'));
      }
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-6">
        <StepHeader eyebrow="Organisation setup" title="Branding" done={done} />
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Couldn’t load your workspace’s branding. {loadError}</span>
            <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-8">
      <StepHeader eyebrow="Organisation setup" title="Branding" done={done}>
        Your logo, name and colour appear across your workspace and on the services citizens and employees
        experience.
      </StepHeader>

      {!branding ? (
        <div className="space-y-6" aria-busy="true" aria-label="Loading branding">
          <div className="h-24 rounded border border-dashed border-border bg-muted/40 animate-pulse" />
          <div className="h-10 rounded bg-muted/60 animate-pulse" />
          <div className="h-11 w-48 rounded bg-muted/60 animate-pulse" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Logo */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Organisation logo</p>
            <div className="flex items-center gap-4 rounded-md border border-dashed border-border bg-card p-4">
              <div className="w-14 h-14 rounded-md bg-primary/10 text-primary text-base font-semibold flex items-center justify-center flex-shrink-0 overflow-hidden">
                {shownLogo ? (
                  <img src={shownLogo} alt="Organisation logo" className="w-full h-full object-contain bg-card" />
                ) : (
                  initialsOf(name || branding.name)
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {shownLogo ? 'Logo uploaded.' : 'PNG or JPG, at least 128px square.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                    {shownLogo ? 'Replace' : 'Upload logo'}
                  </Button>
                  {shownLogo && (
                    <Button variant="ghost" size="sm" onClick={removeLogo}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept={LOGO_TYPES.join(',')}
                className="hidden"
                onChange={(event) => pickLogo(event.target.files?.[0])}
              />
            </div>
            {logoError && <p className="text-xs text-destructive">{logoError}</p>}
          </div>

          {/* Name */}
          <div className="space-y-2">
            <label htmlFor={nameId} className="block text-sm font-medium text-foreground">
              Organisation name
            </label>
            <Input
              id={nameId}
              readOnly
              value={name}
              maxLength={NAME_MAX + 20}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError(null);
              }}
              aria-invalid={!!nameError}
              aria-describedby={`${nameId}-hint`}
              className="h-11 bg-card text-base"
            />
            <p id={`${nameId}-hint`} className={`text-xs ${nameError ? 'text-destructive' : 'text-muted-foreground'}`}>
              {nameError ?? <>Change this name in <a className="underline" href="/configurator/workspace-settings">Workspace settings</a>.</>}
            </p>
          </div>

          {/* Theme */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Brand Theme</legend>
            <p className="text-xs text-muted-foreground">Applied across the services citizens and employees use.</p>
            <TooltipProvider delayDuration={150}>
              <div className="flex flex-wrap gap-3 pt-1">
                {BRAND_THEMES.map((theme) => {
                  const selected = theme.id === themeId;
                  return (
                    <Tooltip key={theme.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={theme.label}
                          aria-pressed={selected}
                          onClick={() => setThemeId(theme.id)}
                          className="w-11 h-11 rounded-md flex items-center justify-center text-white transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          style={{
                            backgroundColor: theme.swatch,
                            outline: selected ? `2px solid ${theme.swatch}` : undefined,
                            outlineOffset: selected ? 2 : undefined,
                          }}
                        >
                          {selected && <Check className="w-5 h-5" strokeWidth={3} />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{theme.label}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </TooltipProvider>
          </fieldset>

          {saveError && (
            <Alert variant="destructive">
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          <div className="pt-2">
            <Button onClick={save} disabled={saving} className="h-10 gap-2 px-5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save and continue
            </Button>
            <Button variant="ghost" disabled={saving} onClick={async () => {
              setSaving(true);
              try { if (await completePhase(STEP.number, true)) navigate(NEXT.path); }
              finally { setSaving(false); }
            }}>Skip branding</Button>
          </div>
        </div>
      )}
    </div>
  );
}
