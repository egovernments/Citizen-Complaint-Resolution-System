// "Add provider" — driven entirely by the bridge's provider catalog.
//
// The operator picks a provider type (grouped by channel), fills the credential
// fields that type declares, names it, and saves. Nothing about Twilio, SMTP,
// SMSCountry or Ozeki is hardcoded here: if the bridge adds a provider type it
// appears in this dialog with its own fields.
//
// Credentials live only in this form's local state and are dropped the moment the
// dialog closes; they are sent once, on submit, straight to the bridge over TLS
// and are never echoed back or persisted on the client.
import { useMemo, useState } from 'react';
import { useRefresh, useTranslate } from 'ra-core';
import { Loader2, Plus, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { createProvider, verifyProvider } from './providerApi';
import {
  buildCredentials,
  createProviderBody,
  findProviderType,
  groupCatalogByChannel,
  missingRequiredFields,
  providerTypeLabelKey,
  type CredentialValues,
  type ProviderType,
} from './providerCatalog';
import { ProviderCredentialFields } from './ProviderCredentialFields';
import { TestSendDialog } from './ProviderTestDialogs';
import { notify } from './providerToast';
import type { ProviderCatalogState } from './useProviderCatalog';

export function AddProviderDialog({ catalogState }: { catalogState: ProviderCatalogState }) {
  const t = useTranslate();
  const refresh = useRefresh();
  const { catalog, loading, source, error } = catalogState;

  const [open, setOpen] = useState(false);
  const [type, setType] = useState('');
  const [name, setName] = useState('');
  const [creds, setCreds] = useState<CredentialValues>({});
  const [saving, setSaving] = useState(false);
  // Post-create step: the operator can immediately verify / test the new provider.
  const [created, setCreated] = useState<{ id: string; name: string; providerType: ProviderType } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  const groups = useMemo(() => groupCatalogByChannel(catalog), [catalog]);
  const selected = findProviderType(catalog, type);
  const fields = selected?.credentialFields ?? [];
  const missing = selected ? missingRequiredFields(fields, creds) : [];
  const canSave = !!selected && !!name.trim() && missing.length === 0 && !saving;

  const reset = () => {
    setType('');
    setName('');
    setCreds({});
    setSaving(false);
    setCreated(null);
    setVerifying(false);
  };

  const onTypeChange = (value: string) => {
    setType(value);
    setCreds({}); // the credential shape changes with the provider type
    const pt = findProviderType(catalog, value);
    // Seed a sensible default name the operator can overwrite.
    if (pt && !name.trim()) setName(pt.label);
  };

  const submit = async () => {
    if (!selected || !canSave) {
      notify(
        t('app.providers.msg_missing', { _: 'Fill in the name and all required credential fields.' }),
        undefined,
        'destructive',
      );
      return;
    }
    setSaving(true);
    try {
      const body = createProviderBody(selected, name, buildCredentials(fields, creds), {
        legacy: source === 'fallback',
        active: true,
      });
      const integration = await createProvider(body);
      notify(
        t('app.providers.msg_created', { _: 'Provider created.' }),
        `${t(providerTypeLabelKey(selected.type), { _: selected.label })} · ${selected.channel}`,
      );
      refresh();
      setCreated({
        id: String(integration?._id ?? ''),
        name: name.trim(),
        providerType: selected,
      });
    } catch (err) {
      notify(
        t('app.providers.msg_create_failed', { _: 'Could not create provider.' }),
        (err as Error)?.message,
        'destructive',
      );
    } finally {
      setSaving(false);
    }
  };

  const runVerify = async () => {
    if (!created) return;
    if (!created.id) {
      notify(t('app.providers.msg_no_id', { _: 'This provider has no integration id to verify.' }), undefined, 'destructive');
      return;
    }
    setVerifying(true);
    try {
      const res = await verifyProvider(created.id, created.providerType.type);
      const ok = res.ok && res.active;
      notify(
        ok
          ? t('app.providers.msg_verify_ok', { _: 'Provider is set up and switched on.' })
          : t('app.providers.msg_verify_fail', { _: 'Provider not found, or switched off.' }),
        res.detail,
        ok ? 'default' : 'destructive',
      );
    } catch (err) {
      notify(t('app.providers.msg_verify_fail', { _: 'Provider not found, or switched off.' }), (err as Error)?.message, 'destructive');
    } finally {
      setVerifying(false);
    }
  };

  const close = () => { setOpen(false); reset(); };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="w-4 h-4" />
        {t('app.providers.add', { _: 'Add Provider' })}
      </Button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('app.providers.add', { _: 'Add Provider' })}</DialogTitle>
          <DialogDescription>
            {t('app.providers.add_hint', {
              _: 'Credentials are sent straight to the notification service over TLS and are never stored or echoed back. No environment edits or redeploy are needed.',
            })}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {t('app.providers.created_next', {
                _: 'Provider saved. Check it now, then select it for its channel under Channels.',
              })}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{created.name}</span>
              <Badge variant="outline" className="text-[10px]">{created.providerType.channel}</Badge>
              <Badge variant="outline" className="text-[10px]">
                {t(providerTypeLabelKey(created.providerType.type), { _: created.providerType.label })}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {created.providerType.supportsVerify && (
                <Button
                  variant="outline" size="sm" className="gap-1.5" onClick={runVerify} disabled={verifying}
                  title={t('app.providers.verify_hint', { _: 'Confirms the provider exists and is switched on. It does not prove the credentials — send a test for that.' })}
                >
                  {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  {t('app.providers.verify', { _: 'Check status' })}
                </Button>
              )}
              {created.providerType.supportsTestSend && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setTestOpen(true)}>
                  <Send className="w-3.5 h-3.5" />
                  {t('app.providers.test', { _: 'Test' })}
                </Button>
              )}
              {!created.providerType.supportsVerify && !created.providerType.supportsTestSend && (
                <p className="text-sm text-muted-foreground">
                  {t('app.providers.no_checks', { _: 'This provider type offers no connectivity check.' })}
                </p>
              )}
            </div>
            <TestSendDialog
              open={testOpen}
              onOpenChange={setTestOpen}
              defaultChannel={created.providerType.channel}
              integrationId={created.id || undefined}
              providerType={created.providerType.type}
            />
          </div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label>{t('app.providers.field_type', { _: 'Provider type' })}</Label>
              <Select value={type} onValueChange={onTypeChange} disabled={loading}>
                <SelectTrigger>
                  <SelectValue placeholder={
                    loading
                      ? t('app.list.loading', { _: 'Loading...' })
                      : t('app.providers.pick_type', { _: 'Pick a provider type' })
                  } />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectGroup key={g.channel}>
                      <SelectLabel>{g.channel}</SelectLabel>
                      {g.types.map((pt) => (
                        <SelectItem key={pt.type} value={pt.type}>
                          {t(providerTypeLabelKey(pt.type), { _: pt.label })}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              {source === 'fallback' && !loading && (
                <p className="text-xs text-amber-700">
                  {t('app.providers.catalog_fallback', {
                    _: 'The notification service did not return its provider catalog, so only the built-in provider types are offered.',
                  })}
                  {error ? ` (${error})` : ''}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="provider-name">{t('app.providers.field_name', { _: 'Name' })}</Label>
              <Input
                id="provider-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('app.providers.name_placeholder', { _: 'A name you will recognise later' })}
              />
            </div>

            {selected && (
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('app.providers.credentials', { _: 'Credentials' })}
                </p>
                <ProviderCredentialFields fields={fields} values={creds} onChange={(k, v) => setCreds((p) => ({ ...p, [k]: v }))} />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {created ? (
            <Button onClick={close}>{t('ra.action.close', { _: 'Close' })}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={saving}>
                {t('ra.action.cancel', { _: 'Cancel' })}
              </Button>
              <Button onClick={submit} disabled={!canSave}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('app.providers.create', { _: 'Create Provider' })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
