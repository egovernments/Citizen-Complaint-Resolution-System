import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { loadBranding, saveBranding, ThemeSaveError, type Branding, type ImageChange, type LogoChange } from './brandingApi';
import { CITIZEN_BANNER_ENABLED } from '@/config/featureFlags';
import { announceOrganisation, initialsOf } from './organisation';
import { describeSaveError } from './errors';
import { reportStepError, trackRecordSave } from './telemetry';
import { useOnboardingT, type OnboardingT } from './i18n';
import { useMastersCapability } from '@/hooks/useMastersCapability';

const STEP = ONBOARDING_STEPS.find((step) => step.id === 'branding')!;
const NEXT = ONBOARDING_STEPS.find((step) => step.number === STEP.number + 1)!;

// What egov-filestore accepts for images, so a wrong file fails here rather than
// as a 400. It takes no SVG, and serving an uploaded SVG from our own origin
// would open a stored-XSS path anyway.
const LOGO_TYPES = ['image/png', 'image/jpeg'];
// Some JPEGs are saved as .jfif or .jpe; the picker should offer them too.
const IMAGE_ACCEPT = [...LOGO_TYPES, '.jfif', '.jpe'].join(',');
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MIN_PX = 128;

// The citizen home draws the banner full width behind its welcome, cropped to a
// wide strip (about 4:1 on a desktop). Below 1200px it goes soft on a laptop
// screen; a squarer image loses most of itself to the crop, so it must be at
// least half again as wide as it is tall. 5 MB covers a good 2400px JPEG with
// room to spare, while keeping the citizen home quick to load on mobile data.
const BANNER_MAX_BYTES = 5 * 1024 * 1024;
const BANNER_MIN_WIDTH = 1200;
const BANNER_MIN_RATIO = 1.5;

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

/**
 * The file as egov-filestore will take it, or null when its bytes aren't the PNG or
 * JPEG its name says. The picker's file.type comes from the name alone, while
 * egov-filestore checks the bytes against the extension and turns a mismatch (a
 * WebP saved as .png) away with its whole format list. Filestore knows JPEG only as
 * .jpg or .jpeg, so a .jfif or .jpe JPEG is renamed .jpg.
 */
function asUploadableImage(file: File): Promise<File | null> {
  const extension = /\.([a-z]+)$/i.exec(file.name)?.[1].toLowerCase() ?? '';
  const named = extension === 'png' ? 'png' : ['jpg', 'jpeg', 'jpe', 'jfif'].includes(extension) ? 'jpeg' : null;
  if (!named) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const head = new Uint8Array(reader.result as ArrayBuffer);
      const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
      const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      if (!(named === 'png' ? png : jpeg)) resolve(null);
      else if (extension === 'jpe' || extension === 'jfif') {
        resolve(new File([file], file.name.replace(/\.[a-z]+$/i, '.jpg'), { type: 'image/jpeg', lastModified: file.lastModified }));
      } else resolve(file);
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file.slice(0, 4));
  });
}

/** Onboarding's Branding step. */
export default function BrandingStep() {
  return <BrandingEditor mode="onboarding" />;
}

/**
 * The Branding screen. Onboarding shows it as a step: Save and continue records
 * the step and moves on. The management console shows the same screen as a page
 * of its own (`mode="console"`), so branding can still be changed once onboarding
 * is over: Save changes saves and stays, and a role without write access to the
 * tenant sees it read-only.
 */
export function BrandingEditor({ mode }: { mode: 'onboarding' | 'console' }) {
  const inConsole = mode === 'console';
  const { state, completePhase } = useApp();
  const { canEditResource } = useMastersCapability();
  // Onboarding's layout already says when a role is view-only; the console page says it here.
  const editable = !inConsole || canEditResource('tenants');
  const t = useOnboardingT();
  const navigate = useNavigate();
  const nameId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const [branding, setBranding] = useState<Branding | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [logo, setLogo] = useState<LogoChange>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [banner, setBanner] = useState<ImageChange>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [themeId, setThemeId] = useState(DEFAULT_BRAND_THEME_ID);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Once a save has failed, Continue anyway records the step skipped, so a save
  // that keeps failing never leaves onboarding stuck here.
  const [saveFailed, setSaveFailed] = useState(false);
  // The console's "Branding saved.", until the next change.
  const [justSaved, setJustSaved] = useState(false);
  // Only the latest pick counts: an earlier, slower file's checks must not replace it.
  const logoPick = useRef(0);
  const bannerPick = useRef(0);

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

  const bannerPreview = useMemo(() => (banner?.kind === 'upload' ? URL.createObjectURL(banner.file) : null), [banner]);
  useEffect(
    () => () => {
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    },
    [bannerPreview],
  );

  const shownBanner = banner?.kind === 'remove' ? null : bannerPreview ?? branding?.bannerUrl ?? null;

  const pickLogo = async (picked: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!picked) return;
    const pick = ++logoPick.current;
    setLogoError(null);
    const file = await asUploadableImage(picked);
    if (pick !== logoPick.current) return;
    if (!file) {
      setLogoError(t('branding.logo_type', 'Use a PNG or JPG image.'));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError(t('branding.logo_too_big', 'That image is over 2 MB. Use a smaller file.'));
      return;
    }
    const size = await imageSize(file);
    if (pick !== logoPick.current) return;
    if (size && (size.width < LOGO_MIN_PX || size.height < LOGO_MIN_PX)) {
      setLogoError(
        t('branding.logo_too_small', 'That image is %{width}×%{height}px. Use one at least %{min}px on each side.', {
          width: size.width,
          height: size.height,
          min: LOGO_MIN_PX,
        }),
      );
      return;
    }
    setLogo({ kind: 'upload', file });
    setJustSaved(false);
  };

  const removeLogo = () => {
    logoPick.current++;
    setLogoError(null);
    // A logo picked but never saved just goes; a saved one is removed on save.
    setLogo(branding?.logoUrl ? { kind: 'remove' } : null);
    setJustSaved(false);
  };

  const pickBanner = async (picked: File | undefined) => {
    if (bannerInput.current) bannerInput.current.value = '';
    if (!picked) return;
    const pick = ++bannerPick.current;
    setBannerError(null);
    const file = await asUploadableImage(picked);
    if (pick !== bannerPick.current) return;
    if (!file) {
      setBannerError(t('branding.logo_type', 'Use a PNG or JPG image.'));
      return;
    }
    if (file.size > BANNER_MAX_BYTES) {
      setBannerError(t('branding.banner_too_big', 'That image is over 5 MB. Use a smaller file.'));
      return;
    }
    const size = await imageSize(file);
    if (pick !== bannerPick.current) return;
    if (size && size.width < BANNER_MIN_WIDTH) {
      setBannerError(
        t('branding.banner_too_narrow', 'That image is %{width}px wide. Use one at least %{min}px wide.', {
          width: size.width,
          min: BANNER_MIN_WIDTH,
        }),
      );
      return;
    }
    if (size && size.width < size.height * BANNER_MIN_RATIO) {
      setBannerError(
        t('branding.banner_not_wide', 'That image is %{width}×%{height}px. Use a wide, landscape image.', {
          width: size.width,
          height: size.height,
        }),
      );
      return;
    }
    setBanner({ kind: 'upload', file });
    setJustSaved(false);
  };

  const removeBanner = () => {
    bannerPick.current++;
    setBannerError(null);
    setBanner(branding?.bannerUrl ? { kind: 'remove' } : null);
    setJustSaved(false);
  };

  // In the console there is nothing to save until something changes; the name is read-only.
  const savedThemeId = branding?.themeId ?? DEFAULT_BRAND_THEME_ID;
  const changed = logo !== null || banner !== null || themeId !== savedThemeId;

  const save = async () => {
    if (!branding) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t('branding.account_name_required', 'Enter your account’s name.'));
      return;
    }
    // No length check: the name is read-only here, and the server checks its length
    // when Workspace settings renames it (up to 200 characters).
    setNameError(null);
    setSaveError(null);
    setSaving(true);
    try {
      const theme = BRAND_THEMES.find((candidate) => candidate.id === themeId) ?? null;
      const bannerChange = CITIZEN_BANNER_ENABLED ? banner : null;
      const saved = await saveBranding(branding, { name: trimmed, logo, theme, banner: bannerChange });
      if (inConsole) {
        // The theme just written is the saved one, even if mdms-v2's re-read hasn't caught up yet.
        setBranding({ ...saved, themeId: theme?.id ?? saved.themeId });
        setLogo(null);
        setBanner(null);
        announceOrganisation({ name: saved.name, logoUrl: saved.logoUrl });
        setJustSaved(true);
        return;
      }
      trackRecordSave('branding', 'branding', 'update', {
        theme: theme?.id ?? 'none',
        logo: logo?.kind ?? 'unchanged',
        banner: bannerChange?.kind ?? 'unchanged',
        renamed: trimmed !== branding.name,
      });
      setBranding(saved);
      setLogo(null);
      setBanner(null);
      announceOrganisation({ name: saved.name, logoUrl: saved.logoUrl });
      // A saved theme is what makes Branding done; the logo is optional. Only a
      // save with no theme and no logo is recorded as skipped. A logo this save
      // uploaded or removed decides it rather than the re-read, which mdms-v2's
      // persister may not have caught up with yet.
      const hasLogo = logo ? logo.kind === 'upload' : !!saved.tenantRecord.data.imageId;
      const hasTheme = !!theme || !!saved.themeRecord;
      if (!await completePhase(STEP.number, !(hasTheme || hasLogo))) {
        setSaveFailed(true);
        return;
      }
      navigate(NEXT.path);
    } catch (err) {
      if (!inConsole) setSaveFailed(true);
      if (err instanceof ThemeSaveError) reportStepError('branding', 'save_theme', err.cause, state.tenant);
      else reportStepError('branding', 'save', err, state.tenant);
      if (err instanceof ThemeSaveError) {
        // What did save stays saved; only the theme is left to retry.
        setBranding(err.saved);
        setLogo(null);
        setBanner(null);
        announceOrganisation({ name: err.saved.name, logoUrl: err.saved.logoUrl });
        setSaveError(
          `${t('branding.theme_not_saved', 'Your name and logo are saved, but the theme isn’t.')} ${describeSaveError(err.cause, t('common.try_again_sentence', 'Try again.'), t)}`,
        );
      } else {
        setSaveError(describeSaveError(err, t('branding.save_failed', 'Saving your branding failed. Try again.'), t));
      }
    } finally {
      setSaving(false);
    }
  };

  // SKIPPED needs no logo and no server check, so it completes the step whatever failed.
  const continueAnyway = async () => {
    setSaving(true);
    try {
      if (await completePhase(STEP.number, true)) navigate(NEXT.path);
    } finally {
      setSaving(false);
    }
  };

  const header = (intro?: ReactNode) =>
    inConsole ? (
      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">{t('steps.branding', 'Branding')}</h1>
        {intro && <p className="text-sm leading-6 text-muted-foreground">{intro}</p>}
      </div>
    ) : (
      <StepHeader eyebrow={t('branding.account_eyebrow', 'Account setup')} title={t('steps.branding', 'Branding')} done={done}>
        {intro}
      </StepHeader>
    );

  if (loadError) {
    return (
      <div className="space-y-6">
        {header()}
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('branding.load_failed', 'Couldn’t load your workspace’s branding.')} {loadError}</span>
            <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
              {t('common.try_again', 'Try again')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-8">
      {header(t('branding.intro', 'Your logo, name and colour appear across your workspace and on the services citizens and employees experience.'))}

      {!editable && (
        <Alert>
          <AlertDescription>
            {t('branding.view_only', 'Your role can see the branding but not change it. Changing it needs write access, for example MDMS_ADMIN.')}
          </AlertDescription>
        </Alert>
      )}

      {!branding ? (
        <div className="space-y-6" aria-busy="true" aria-label={t('branding.loading', 'Loading branding')}>
          <div className="h-24 rounded border border-dashed border-border bg-muted/40 animate-pulse" />
          <div className="h-10 rounded bg-muted/60 animate-pulse" />
          <div className="h-11 w-48 rounded bg-muted/60 animate-pulse" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Logo */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{t('branding.account_logo', 'Account logo')}</p>
            <div className="flex items-center gap-4 rounded-md border border-dashed border-border bg-card p-4">
              <div className="w-14 h-14 rounded-md bg-primary/10 text-primary text-base font-semibold flex items-center justify-center flex-shrink-0 overflow-hidden">
                {shownLogo ? (
                  <img src={shownLogo} alt={t('branding.account_logo', 'Account logo')} className="w-full h-full object-contain bg-card" />
                ) : (
                  initialsOf(name || branding.name)
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {shownLogo
                    ? t('branding.logo_uploaded', 'Logo uploaded.')
                    : t('branding.logo_rules', 'PNG or JPG, at least %{min}px square.', { min: LOGO_MIN_PX })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={!editable} onClick={() => fileInput.current?.click()}>
                    {shownLogo ? t('branding.replace', 'Replace') : t('branding.upload_logo', 'Upload logo')}
                  </Button>
                  {shownLogo && editable && (
                    <Button variant="ghost" size="sm" onClick={removeLogo}>
                      {t('common.remove', 'Remove')}
                    </Button>
                  )}
                </div>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept={IMAGE_ACCEPT}
                className="hidden"
                data-testid="logo-input"
                onChange={(event) => pickLogo(event.target.files?.[0])}
              />
            </div>
            {logoError && <p className="text-xs text-destructive">{logoError}</p>}
          </div>

          {CITIZEN_BANNER_ENABLED && (
            <BannerField
              t={t}
              shown={shownBanner}
              available={!!branding.stateInfoRecord}
              editable={editable}
              error={bannerError}
              onPick={() => bannerInput.current?.click()}
              onRemove={removeBanner}
              input={
                <input
                  ref={bannerInput}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  className="hidden"
                  data-testid="banner-input"
                  onChange={(event) => pickBanner(event.target.files?.[0])}
                />
              }
            />
          )}

          {/* Name */}
          <div className="space-y-2">
            <label htmlFor={nameId} className="block text-sm font-medium text-foreground">
              {t('branding.account_name', 'Account name')}
            </label>
            <Input
              id={nameId}
              readOnly
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError(null);
              }}
              aria-invalid={!!nameError}
              aria-describedby={`${nameId}-hint`}
              className="h-11 bg-card text-base"
            />
            <p id={`${nameId}-hint`} className={`text-xs ${nameError ? 'text-destructive' : 'text-muted-foreground'}`}>
              {nameError ?? <NameHint t={t} />}
            </p>
          </div>

          {/* Theme */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">{t('branding.theme', 'Brand Theme')}</legend>
            <p className="text-xs text-muted-foreground">{t('branding.theme_hint', 'Applied across the services citizens and employees use.')}</p>
            <TooltipProvider delayDuration={150}>
              <div className="flex flex-wrap gap-3 pt-1">
                {BRAND_THEMES.map((theme) => {
                  const selected = theme.id === themeId;
                  return (
                    <Tooltip key={theme.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={t(`branding.themes.${theme.id}`, theme.label)}
                          aria-pressed={selected}
                          disabled={!editable}
                          onClick={() => {
                            setThemeId(theme.id);
                            setJustSaved(false);
                          }}
                          className="w-11 h-11 rounded-md flex items-center justify-center text-white transition-transform enabled:hover:scale-105 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          style={{
                            backgroundColor: theme.swatch,
                            outline: selected ? `2px solid ${theme.swatch}` : undefined,
                            outlineOffset: selected ? 2 : undefined,
                          }}
                        >
                          {selected && <Check className="w-5 h-5" strokeWidth={3} />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t(`branding.themes.${theme.id}`, theme.label)}</TooltipContent>
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

          {inConsole ? (
            editable && (
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button onClick={save} disabled={saving || !changed} className="h-10 gap-2 px-5">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {t('common.save_changes', 'Save changes')}
                </Button>
                {justSaved && (
                  <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-primary" />
                    {t('branding.saved', 'Branding saved.')}
                  </p>
                )}
              </div>
            )
          ) : (
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={save} disabled={saving} className="h-10 gap-2 px-5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {t('step.save_continue', 'Save and continue')}
            </Button>
            {saveFailed && (
              <Button variant="ghost" onClick={continueAnyway} disabled={saving} className="h-10">
                {t('branding.continue_anyway', 'Continue anyway')}
              </Button>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The citizen home's banner: a wide preview of what is saved or picked, and
 * upload, replace and remove. A workspace without a StateInfo record has
 * nowhere to keep one, so it says so instead of offering an upload.
 */
function BannerField({
  t,
  shown,
  available,
  editable,
  error,
  onPick,
  onRemove,
  input,
}: {
  t: OnboardingT;
  shown: string | null;
  available: boolean;
  editable: boolean;
  error: string | null;
  onPick: () => void;
  onRemove: () => void;
  input: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{t('branding.banner', 'Citizen home banner')}</p>
      <p className="text-xs text-muted-foreground">
        {t('branding.banner_hint', 'A wide photo shown at the top of the citizen home, behind the welcome.')}
      </p>
      <div className="overflow-hidden rounded-md border border-dashed border-border bg-card">
        <div className="relative aspect-[16/5] w-full bg-muted/40">
          {shown ? (
            <img src={shown} alt={t('branding.banner', 'Citizen home banner')} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
              {available
                ? t('branding.banner_none', 'No banner yet.')
                : t('branding.banner_unavailable', 'This workspace has no State Info record, so a banner can’t be saved here.')}
            </p>
          )}
        </div>
        {available && editable && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-border p-3">
            <p className="text-xs text-muted-foreground">
              {t('branding.banner_rules', 'PNG or JPG, at least %{min}px wide, up to 5 MB.', { min: BANNER_MIN_WIDTH })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onPick}>
                {shown ? t('branding.replace', 'Replace') : t('branding.upload_banner', 'Upload banner')}
              </Button>
              {shown && (
                <Button variant="ghost" size="sm" onClick={onRemove}>
                  {t('common.remove', 'Remove')}
                </Button>
              )}
            </div>
          </div>
        )}
        {input}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** "Change this name in Workspace settings.", with the link where the language puts it. */
function NameHint({ t }: { t: OnboardingT }) {
  const marker = '\u0000';
  const [before, after = ''] = t('branding.name_hint', 'Change this name in %{link}.', { link: marker }).split(marker);
  return (
    <>
      {before}
      <a className="underline" href="/configurator/workspace-settings">
        {t('branding.workspace_settings', 'Workspace settings')}
      </a>
      {after}
    </>
  );
}
