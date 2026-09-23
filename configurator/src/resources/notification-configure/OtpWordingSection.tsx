// "Login and registration OTP (SMS)" block on the Configure tab.
//
// A Configurator UI over three localization messages, nothing more: the OTP is
// generated, formatted and published by DIGIT core's user-otp service and only
// delivered by novu-bridge, so delivery, provider and on/off stay on Channels.
// Every rule about what is sent and what a save may write lives in
// otpWording.ts; this file is loading, permission and plumbing.
//
// WHY IT IS ITS OWN BLOCK, NOT AN ENTRY IN THE MODULE PICKER: the picker lists
// modules from NOTIFICATIONS.EventCatalogue, and everything under it is MDMS
// routing + templates governed by the namespace decision (legacy tenants are
// read-only there). The OTP wording has no event, audience, channel or routing
// row and is stored in localization, so it stays editable on every tenant and
// is never mixed into the Validate panel.
//
// DATA PATH: the same DigitApiClient localization calls the Localization
// screens' data provider makes (localizationSearch / localizationUpsert /
// localizationDelete). Called directly rather than through the `localization`
// resource because the provider is bound to the session tenant, while user-otp
// reads at the stripped state tenant, and because the three codes must be
// written in ONE upsert (a partial write would break an OTP type).

import { useMemo, useState } from 'react';
import { useNotify, useTranslate } from 'ra-core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info } from 'lucide-react';
import { digitClient } from '@/providers/bridge';
import { localizationService } from '@/api';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { useMastersCapability } from '@/hooks/useMastersCapability';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FindingList, GuardBanner } from './NotificationFindings';
import {
  LOCALIZATION_UPSERT_ACTION_URL,
  OTP_DEFAULT_LOCALE,
  OTP_LOCALIZATION_MODULE,
  localizationParentTenant,
  measureOtpSms,
  otpLocales,
  otpLookupTenant,
  planOtpReset,
  planOtpSave,
  renderOtpSms,
  resolveOtpLocale,
  validateOtpWording,
  type OtpEffectiveText,
  type OtpLocaleRead,
  type OtpLocaleState,
  type OtpPurpose,
} from './otpWording';

const OTP_QUERY_KEY = 'otp-wording';
const K = 'app.otp_wording';

/** The two searches the effective text depends on — the same one user-otp makes, plus the level above. */
async function readOtpLocale(lookupTenant: string, parentTenant: string | null, locale: string): Promise<OtpLocaleRead> {
  const [effective, parent] = await Promise.all([
    digitClient.localizationSearch(lookupTenant, locale, OTP_LOCALIZATION_MODULE),
    parentTenant
      ? digitClient.localizationSearch(parentTenant, locale, OTP_LOCALIZATION_MODULE)
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);
  return { locale, effective, parent };
}

/**
 * Whether the signed-in user's roles carry the localization write action — the
 * action the gateway checks on every Localization-screen save. Unknown (no
 * tenant, no roles, access-control unreachable) reads as not allowed.
 */
function useLocalizationWritePermission(tenantId: string): { allowed: boolean; checking: boolean; failed: boolean } {
  const roles = (digitClient.getAuthInfo().user?.roles ?? []).map((r) => r.code).filter(Boolean);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['otp-wording-permission', tenantId, roles.join(',')],
    queryFn: async () =>
      (await digitClient.accessActionsSearch(tenantId, roles)).some((a) => a?.url === LOCALIZATION_UPSERT_ACTION_URL),
    enabled: !!tenantId && roles.length > 0,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  return { allowed: data === true, checking: isLoading && !!tenantId && roles.length > 0, failed: isError };
}

function errorText(err: unknown): string {
  return (err as Error)?.message ?? String(err);
}

const PURPOSE_LABEL: Record<OtpPurpose, string> = {
  login: 'Login',
  register: 'Registration',
  passwordreset: 'Password reset',
};

function purposeLabel(t: ReturnType<typeof useTranslate>, purpose: OtpPurpose): string {
  return t(`${K}.purpose_${purpose}`, { _: PURPOSE_LABEL[purpose] });
}

// ---------------------------------------------------------------------------
// One OTP message: current text, and an inline editor.
// ---------------------------------------------------------------------------
function OtpMessageRow({
  msg,
  locale,
  tenantLocales,
  lookupTenant,
  parentTenant,
  inherited,
  readOnly,
  canReset,
  onSave,
  onReset,
}: {
  msg: OtpEffectiveText;
  locale: string;
  tenantLocales: string[];
  lookupTenant: string;
  parentTenant: string | null;
  inherited: boolean;
  readOnly: boolean;
  /** True when Reset would change anything (planOtpReset is not 'none'). */
  canReset: boolean;
  onSave: (code: string, text: string) => Promise<void>;
  onReset: (msg: OtpEffectiveText) => Promise<void>;
}) {
  const t = useTranslate();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const purpose = purposeLabel(t, msg.purpose);

  let badge: { variant: 'secondary' | 'success' | 'destructive' | 'outline'; label: string };
  if (msg.source === 'built-in') {
    badge = { variant: 'secondary', label: t(`${K}.source_builtin`, { _: 'Default (built into the OTP service)' }) };
  } else if (msg.source === 'missing') {
    badge = { variant: 'destructive', label: t(`${K}.source_missing`, { _: 'Missing: OTPs of this type fail' }) };
  } else if (inherited && parentTenant) {
    badge = { variant: 'outline', label: t(`${K}.source_inherited`, { _: 'Inherited from tenant %{tenant}', tenant: parentTenant }) };
  } else if (msg.matchesBuiltIn) {
    badge = { variant: 'outline', label: t(`${K}.source_stored_default`, { _: 'Default wording, stored in localization' }) };
  } else {
    badge = { variant: 'success', label: t(`${K}.source_custom`, { _: 'Custom' }) };
  }

  // What is stored today can itself be broken (e.g. edited on the Localization
  // screen); show its errors so the operator knows before a citizen does.
  const currentErrors = msg.text != null
    ? validateOtpWording(msg.text, { locale, tenantLocales }).filter((f) => f.level === 'error')
    : [];

  const editing = draft !== null;
  const findings = editing ? validateOtpWording(draft, { locale, tenantLocales }) : [];
  const blocking = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level === 'warn');
  const unchanged = editing && msg.source !== 'missing' && draft === msg.text;
  const measurement = editing && blocking.length === 0 ? measureOtpSms(draft) : null;

  const save = async () => {
    if (draft === null || blocking.length > 0) return;
    setBusy(true);
    try {
      await onSave(msg.code, draft);
      setDraft(null);
    } catch {
      /* onSave reported it; keep the draft so nothing typed is lost */
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await onReset(msg);
      setDraft(null);
    } catch {
      /* onReset reported it */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-3 border-b border-border/60 last:border-b-0 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <span className="text-sm font-medium">{purpose}</span>
          <div className="font-mono text-[11px] text-muted-foreground">
            {msg.code} · {lookupTenant} · {locale}
          </div>
        </div>
        <Badge variant={badge.variant} className="text-[10px] shrink-0">{badge.label}</Badge>
      </div>

      {!editing && (
        <>
          <p className={`text-sm rounded-md border border-border bg-muted/30 px-3 py-2 whitespace-pre-wrap ${msg.text == null ? 'italic text-muted-foreground' : ''}`}>
            {msg.text ?? t(`${K}.missing_hint`, {
              _: 'No message for this code, while this language holds other egov-user messages: the OTP service cannot build the SMS and the request fails. Save a wording to fix it.',
            })}
          </p>
          <FindingList findings={currentErrors} />
          {!readOnly && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => setDraft(msg.text ?? msg.builtInDefault)}
              >
                {t(`${K}.edit`, { _: 'Edit wording' })}
              </Button>
              {canReset && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={reset}>
                  {t(`${K}.reset`, { _: 'Reset to default' })}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {editing && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <textarea
            aria-label={t(`${K}.textarea_label`, { _: '%{purpose} OTP wording', purpose })}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-[11px] text-muted-foreground">
            {t(`${K}.code_hint`, { _: 'Put %s exactly once where the code goes. Write %% for a literal percent sign.' })}
          </p>
          {measurement && (
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              <div>
                <span className="font-medium">{t(`${K}.preview`, { _: 'Preview with a 6-digit code:' })}</span>{' '}
                <span className="text-foreground">{renderOtpSms(draft)}</span>
              </div>
              <div>
                {t(`${K}.segments`, {
                  _: '%{segments} SMS segment(s) · %{encoding} · %{units} characters',
                  segments: measurement.segments,
                  encoding: measurement.encoding,
                  units: measurement.units,
                })}
              </div>
            </div>
          )}
          <GuardBanner blocking={blocking} advisory={[]} />
          <FindingList findings={warnings} />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={busy || blocking.length > 0 || unchanged}>
              {busy ? t(`${K}.saving`, { _: 'Saving…' }) : t(`${K}.save`, { _: 'Save wording' })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
              {t(`${K}.cancel`, { _: 'Cancel' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The block.
// ---------------------------------------------------------------------------
export function OtpWordingSection() {
  const t = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { canEditResource } = useMastersCapability();

  const stateTenant = String(digitClient.stateTenantId || '');
  const lookupTenant = stateTenant ? otpLookupTenant(stateTenant) : '';
  const parentTenant = lookupTenant ? localizationParentTenant(lookupTenant) : null;

  const { locales: localeOptions } = useAvailableLocales();
  const tenantLocales = useMemo(
    () => localeOptions.map((l) => l.value).filter((v) => v !== 'default'),
    [localeOptions],
  );
  const locales = useMemo(() => otpLocales(tenantLocales), [tenantLocales]);
  const [picked, setPicked] = useState(OTP_DEFAULT_LOCALE);
  const locale = locales.includes(picked) ? picked : OTP_DEFAULT_LOCALE;

  const permission = useLocalizationWritePermission(stateTenant);
  // Same gate as the Localization screens, plus the gateway's own action check.
  const readOnly = !(canEditResource('localization') && permission.allowed);

  const { data, isLoading, error } = useQuery({
    queryKey: [OTP_QUERY_KEY, lookupTenant, parentTenant, locales],
    queryFn: async () => {
      const reads = await Promise.all(locales.map((l) => readOtpLocale(lookupTenant, parentTenant, l)));
      return Object.fromEntries(reads.map((r) => [r.locale, resolveOtpLocale(r)])) as Record<string, OtpLocaleState>;
    },
    enabled: !!lookupTenant,
    retry: false,
  });
  const state = data?.[locale];

  const fresh = async (): Promise<OtpLocaleState> =>
    resolveOtpLocale(await readOtpLocale(lookupTenant, parentTenant, locale));
  const refetch = () => queryClient.invalidateQueries({ queryKey: [OTP_QUERY_KEY, lookupTenant] });
  // The upsert alone is not enough the first time: localization had cached this module's
  // EMPTY answer, and it kept serving that (verified live), so the OTP service stayed on its
  // built-in text. Best-effort, as the onboarding pages do after their localization writes.
  const bustCache = () => localizationService.cacheBust().catch(() => undefined);

  const onSave = async (code: string, text: string) => {
    // Enforced here as well as by the disabled button.
    const blocking = validateOtpWording(text, { locale, tenantLocales }).filter((f) => f.level === 'error');
    if (blocking.length > 0) {
      notify(t(`${K}.blocked`, { _: 'This wording cannot be saved: %{reason}', reason: blocking[0].message }), { type: 'error' });
      throw new Error(blocking[0].message);
    }
    try {
      // Re-read first so the other two messages are written as they are NOW.
      const writes = planOtpSave(await fresh(), code, text);
      await digitClient.localizationUpsert(lookupTenant, locale, writes);
      await bustCache();
      notify(t(`${K}.saved`, { _: 'OTP wording saved. The next OTP sent in %{locale} uses it.', locale }), { type: 'success' });
    } catch (err) {
      notify(t(`${K}.save_failed`, { _: 'Save failed: %{error}', error: errorText(err) }), { type: 'error' });
      throw err;
    } finally {
      await refetch();
    }
  };

  const onReset = async (msg: OtpEffectiveText) => {
    const purpose = purposeLabel(t, msg.purpose);
    if (!window.confirm(t(`${K}.confirm_reset`, {
      _: 'Replace the %{purpose} OTP wording for %{locale} with the built-in default?',
      purpose,
      locale,
    }))) {
      return;
    }
    try {
      const plan = planOtpReset(await fresh(), msg.code);
      if (plan.kind === 'delete') {
        const ok = await digitClient.localizationDelete(
          lookupTenant,
          locale,
          plan.codes.map((code) => ({ code, module: OTP_LOCALIZATION_MODULE })),
        );
        if (!ok) throw new Error('the localization service did not confirm the delete');
        await bustCache();
        notify(t(`${K}.reset_deleted`, {
          _: 'Stored OTP wording for %{locale} removed; the OTP service is back on its built-in text.',
          locale,
        }), { type: 'success' });
      } else if (plan.kind === 'upsert') {
        await digitClient.localizationUpsert(lookupTenant, locale, plan.writes);
        await bustCache();
        notify(t(`${K}.reset_written`, {
          _: 'Default wording restored as a stored message. It is not deleted because other egov-user messages exist in %{locale}, and the OTP service would then fail this OTP type.',
          locale,
        }), { type: 'success' });
      } else {
        notify(t(`${K}.reset_none`, { _: 'Already the built-in wording.' }), { type: 'info' });
      }
    } catch (err) {
      notify(t(`${K}.save_failed`, { _: 'Save failed: %{error}', error: errorText(err) }), { type: 'error' });
      throw err;
    } finally {
      await refetch();
    }
  };

  const brokenLocales = data ? locales.filter((l) => data[l]?.broken) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t(`${K}.title`, { _: 'Login and registration OTP (SMS)' })}</CardTitle>
        <CardDescription>
          {t(`${K}.subtitle`, {
            _: 'The text of the one-time-password SMS sent for login, registration and password reset. The OTP service writes this SMS itself; it is not an event and has no routing.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <ul className="space-y-1 leading-relaxed">
            <li>
              {t(`${K}.wording_only`, {
                _: 'Only the wording is changed here. Whether OTPs are sent, and through which provider, is set on Channels (SMS): OTPs use the same SMS channel, provider and log as every other SMS.',
              })}
            </li>
            <li>
              {t(`${K}.timing`, {
                _: 'A saved change is used by the next OTP. The OTP service reads the wording from localization for every OTP and keeps no copy, and saving clears localization\'s cache.',
              })}
            </li>
            <li>
              {t(`${K}.languages`, {
                _: 'Citizens get the wording in the language their app is set to; a request with no language gets en_IN. A language with no OTP wording stored gets the built-in English text.',
              })}
            </li>
            <li className="font-mono text-[11px]">
              {t(`${K}.stored_at`, {
                _: 'Stored as localization messages: tenant %{tenant}, module %{module}.',
                tenant: lookupTenant || '—',
                module: OTP_LOCALIZATION_MODULE,
              })}
            </li>
          </ul>
        </div>

        {readOnly && !permission.checking && (
          <div role="status" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {permission.failed
                ? t(`${K}.readonly_unknown`, {
                  _: 'Read-only: your permission to change localization could not be checked.',
                })
                : t(`${K}.readonly_role`, {
                  _: 'Read-only: changing this wording needs a role with the localization write action (%{action}), the same permission the Localization screens need.',
                  action: LOCALIZATION_UPSERT_ACTION_URL,
                })}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={t(`${K}.language`, { _: 'Language' })}>
          <span className="text-xs font-medium text-muted-foreground">{t(`${K}.language`, { _: 'Language' })}:</span>
          {locales.map((l) => (
            <Button
              key={l}
              size="sm"
              variant={l === locale ? 'default' : 'outline'}
              className="h-7 text-xs"
              aria-pressed={l === locale}
              onClick={() => setPicked(l)}
            >
              {l}
              {data?.[l]?.broken && <AlertTriangle className="ml-1 h-3 w-3" aria-hidden="true" />}
            </Button>
          ))}
        </div>

        {brokenLocales.length > 0 && (
          <FindingList
            findings={brokenLocales.map((l) => ({
              level: 'error' as const,
              rule: 'otp-message-missing',
              message: t(`${K}.broken`, {
                _: 'In %{locale}, egov-user holds messages but not all three OTP codes, so the OTP types marked Missing fail today. Saving any one of them writes all three.',
                locale: l,
              }),
              ref: l,
            }))}
          />
        )}

        {!lookupTenant && (
          <p className="text-xs text-muted-foreground">{t(`${K}.no_tenant`, { _: 'No tenant selected.' })}</p>
        )}
        {lookupTenant && isLoading && (
          <p className="text-xs text-muted-foreground">{t(`${K}.loading`, { _: 'Loading…' })}</p>
        )}
        {error && (
          <p className="text-xs text-red-700">
            {t(`${K}.load_failed`, { _: 'Could not read the OTP wording from localization: %{error}', error: errorText(error) })}
          </p>
        )}

        {state && (
          <div>
            {state.inherited && parentTenant && (
              <p className="text-[11px] text-muted-foreground mb-1">
                {t(`${K}.inherited_note`, {
                  _: 'In %{locale}, tenant %{tenant} serves the same egov-user messages as %{parent} (usually inherited from it). A save writes that whole set at %{tenant}, so none of it is lost.',
                  tenant: lookupTenant,
                  parent: parentTenant,
                  locale,
                })}
              </p>
            )}
            {state.messages.map((m) => (
              <OtpMessageRow
                key={`${locale}-${m.code}`}
                msg={m}
                locale={locale}
                tenantLocales={tenantLocales}
                lookupTenant={lookupTenant}
                parentTenant={parentTenant}
                inherited={state.inherited}
                readOnly={readOnly}
                canReset={planOtpReset(state, m.code).kind !== 'none'}
                onSave={onSave}
                onReset={onReset}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default OtpWordingSection;
