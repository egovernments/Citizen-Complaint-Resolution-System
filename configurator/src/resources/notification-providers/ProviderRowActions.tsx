// Per-row actions on the Providers screen.
//
//   Verify / Test        — offered only where the catalog says the type supports them.
//   Edit name            — rename only; credentials are untouched.
//   Rotate credentials   — the same catalog-driven form as "Add provider". Stored
//                          credentials are NEVER shown (the bridge does not return
//                          them), so rotation means entering a full new set.
//   Enable / Disable     — flips the integration's `active` flag.
//   Delete               — confirmed, and refuses with a plain-English message while
//                          a channel still selects this provider (NB_PROVIDER_IN_USE).
//   Delivery workflows   — read-only Novu workflow discovery: the plumbing Novu
//                          triggers, NOT message templates. Named that way on
//                          purpose — "Templates" here collided with the message
//                          Templates screen and with Provider Templates
//                          (WhatsApp), three different things under one word.
import { useState } from 'react';
import { useRefresh, useTranslate } from 'ra-core';
import {
  ListChecks, Loader2, Pencil, Power, RotateCcw, Send, ShieldCheck, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  deleteProvider, updateProvider, verifyProvider, bridgeErrorCode, PROVIDER_IN_USE,
} from './providerApi';
import {
  buildCredentials,
  findProviderType,
  integrationChannel,
  integrationLabel,
  missingRequiredFields,
  type CredentialValues,
  type IntegrationRow,
  type ProviderType,
} from './providerCatalog';
import { ProviderCredentialFields } from './ProviderCredentialFields';
import { PullTemplatesDialog, TestSendDialog } from './ProviderTestDialogs';
import { notify } from './providerToast';

type VerifyState = { status: 'idle' | 'loading' | 'ok' | 'fail'; detail?: string };

function idOf(row: IntegrationRow): string {
  return String(row._id ?? row.id ?? '');
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------
function RenameDialog({
  open, onOpenChange, row, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: IntegrationRow;
  onDone: () => void;
}) {
  const t = useTranslate();
  const [name, setName] = useState(String(row.name ?? ''));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await updateProvider({ id: idOf(row), name: name.trim() });
      notify(t('app.providers.msg_renamed', { _: 'Provider renamed.' }));
      onOpenChange(false);
      onDone();
    } catch (err) {
      notify(t('app.providers.msg_update_failed', { _: 'Could not update provider.' }), (err as Error)?.message, 'destructive');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('app.providers.rename_title', { _: 'Rename provider' })}</DialogTitle>
          <DialogDescription>
            {t('app.providers.rename_hint', { _: 'Only the display name changes. Credentials and the channel selection are untouched.' })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rename-provider">{t('app.providers.field_name', { _: 'Name' })}</Label>
          <Input id="rename-provider" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('ra.action.cancel', { _: 'Cancel' })}
          </Button>
          <Button onClick={submit} disabled={!name.trim() || saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('ra.action.save', { _: 'Save' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Rotate credentials
// ---------------------------------------------------------------------------
function RotateDialog({
  open, onOpenChange, row, providerType, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: IntegrationRow;
  providerType?: ProviderType;
  onDone: () => void;
}) {
  const t = useTranslate();
  const [creds, setCreds] = useState<CredentialValues>({});
  const [saving, setSaving] = useState(false);
  const fields = providerType?.credentialFields ?? [];
  const missing = missingRequiredFields(fields, creds);

  const close = (o: boolean) => { onOpenChange(o); if (!o) setCreds({}); };

  const submit = async () => {
    if (!providerType || missing.length > 0) return;
    setSaving(true);
    try {
      await updateProvider({ id: idOf(row), credentials: buildCredentials(fields, creds) });
      notify(t('app.providers.msg_rotated', { _: 'Credentials replaced.' }));
      close(false);
      onDone();
    } catch (err) {
      notify(t('app.providers.msg_update_failed', { _: 'Could not update provider.' }), (err as Error)?.message, 'destructive');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('app.providers.rotate_title', { _: 'Rotate credentials' })}</DialogTitle>
          <DialogDescription>
            {t('app.providers.rotate_hint', {
              _: 'Stored credentials are never shown — they cannot be read back once saved. Enter a COMPLETE new set; it replaces the old one for this provider.',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
          {providerType ? (
            <ProviderCredentialFields fields={fields} values={creds} onChange={(k, v) => setCreds((p) => ({ ...p, [k]: v }))} />
          ) : (
            <p className="text-sm text-destructive">
              {t('app.providers.rotate_unknown_type', {
                _: 'This provider was created before provider types existed, so its credential fields are unknown. Add a replacement provider and select it for the channel instead.',
              })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={saving}>
            {t('ra.action.cancel', { _: 'Cancel' })}
          </Button>
          <Button onClick={submit} disabled={!providerType || missing.length > 0 || saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('app.providers.rotate_save', { _: 'Replace credentials' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
function DeleteDialog({
  open, onOpenChange, row, label, selectedForChannel, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: IntegrationRow;
  label: string;
  /** Channel that currently selects this provider, if any — a local pre-check. */
  selectedForChannel?: string;
  onDone: () => void;
}) {
  const t = useTranslate();
  const [busy, setBusy] = useState(false);
  const [inUse, setInUse] = useState<string | null>(null);

  const inUseMessage = t('app.providers.delete_in_use', {
    _: 'This provider is still selected as the active provider for a channel. Open Channels, pick another provider for that channel, then delete this one.',
  });

  const submit = async () => {
    setBusy(true);
    setInUse(null);
    try {
      await deleteProvider({ id: idOf(row) });
      notify(t('app.providers.msg_deleted', { _: 'Provider deleted.' }), label);
      onOpenChange(false);
      onDone();
    } catch (err) {
      if (bridgeErrorCode(err) === PROVIDER_IN_USE) {
        // Keep the dialog open and explain the fix rather than dumping the raw code.
        setInUse(inUseMessage);
      } else {
        notify(t('app.providers.msg_delete_failed', { _: 'Could not delete provider.' }), (err as Error)?.message, 'destructive');
        onOpenChange(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setInUse(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('app.providers.delete_title', { _: 'Delete this provider?' })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('app.providers.delete_hint', {
              _: 'The integration and its stored credentials are removed. This cannot be undone — re-adding it means entering the credentials again.',
            })}
            {' '}
            <span className="font-medium">{label}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {(inUse || selectedForChannel) && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {inUse ?? `${t('app.providers.delete_selected_for', { _: 'This provider is currently selected for channel' })} ${selectedForChannel}. ${inUseMessage}`}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('ra.action.cancel', { _: 'Cancel' })}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); void submit(); }}
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('ra.action.delete', { _: 'Delete' })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Row action bar
// ---------------------------------------------------------------------------
export function ProviderRowActions({
  record, catalog, selectedForChannel,
}: {
  record: IntegrationRow;
  catalog: ProviderType[];
  /** Channel whose NotificationChannel row selects this provider, if any. */
  selectedForChannel?: string;
}) {
  const t = useTranslate();
  const refresh = useRefresh();
  const integrationId = idOf(record);
  const providerType = findProviderType(catalog, record.type);
  // Non-deliverable integrations never reach this row (the list filters them
  // out), so the fallback is only there to keep the dialogs' Channel type total.
  const channel = integrationChannel(record, catalog) ?? 'SMS';
  const label = integrationLabel(record, catalog);
  const isActive = record.active !== false;

  const [verify, setVerify] = useState<VerifyState>({ status: 'idle' });
  const [testOpen, setTestOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toggling, setToggling] = useState(false);

  // An integration with no catalog type predates the catalog; it can still be
  // verified/tested/renamed, we just cannot render its credential form.
  const canVerify = providerType ? providerType.supportsVerify : true;
  const canTest = providerType ? providerType.supportsTestSend : true;

  const runVerify = async () => {
    if (!integrationId) {
      notify(t('app.providers.msg_no_id', { _: 'This provider has no integration id to verify.' }), undefined, 'destructive');
      return;
    }
    setVerify({ status: 'loading' });
    try {
      const res = await verifyProvider(integrationId, providerType?.type);
      const ok = res.ok && res.active;
      setVerify({ status: ok ? 'ok' : 'fail', detail: res.detail });
      notify(
        ok
          ? t('app.providers.msg_verify_ok', { _: 'Provider verified.' })
          : t('app.providers.msg_verify_fail', { _: 'Provider not active.' }),
        res.detail,
        ok ? 'default' : 'destructive',
      );
    } catch (err) {
      setVerify({ status: 'fail', detail: (err as Error)?.message });
      notify(t('app.providers.msg_verify_fail', { _: 'Provider not active.' }), (err as Error)?.message, 'destructive');
    }
  };

  const toggleActive = async () => {
    setToggling(true);
    try {
      await updateProvider({ id: integrationId, active: !isActive });
      notify(
        isActive
          ? t('app.providers.msg_disabled', { _: 'Provider disabled.' })
          : t('app.providers.msg_enabled', { _: 'Provider enabled.' }),
        // Disabling one that a channel still points at breaks that channel — say so now.
        isActive && selectedForChannel
          ? t('app.providers.msg_disabled_selected', {
            _: 'It is still the selected provider for a channel, which can no longer deliver until you pick another.',
          })
          : undefined,
        isActive && selectedForChannel ? 'destructive' : 'default',
      );
      refresh();
    } catch (err) {
      notify(t('app.providers.msg_update_failed', { _: 'Could not update provider.' }), (err as Error)?.message, 'destructive');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 justify-end flex-wrap">
      {verify.status === 'ok' && (
        <Badge variant="success" className="text-[10px]" title={verify.detail}>
          {t('app.providers.verified', { _: 'Verified' })}
        </Badge>
      )}
      {verify.status === 'fail' && (
        <Badge variant="destructive" className="text-[10px]" title={verify.detail}>
          {t('app.providers.failed', { _: 'Failed' })}
        </Badge>
      )}
      {canVerify && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={runVerify}
          disabled={verify.status === 'loading'}
          title={t('app.providers.verify', { _: 'Verify' })}
        >
          {verify.status === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
          {t('app.providers.verify', { _: 'Verify' })}
        </Button>
      )}
      {canTest && (
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setTestOpen(true)} title={t('app.providers.test', { _: 'Test' })}>
          <Send className="w-3.5 h-3.5" />
          {t('app.providers.test', { _: 'Test' })}
        </Button>
      )}
      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setRenameOpen(true)} title={t('app.providers.rename', { _: 'Rename' })}>
        <Pencil className="w-3.5 h-3.5" />
        {t('app.providers.rename', { _: 'Rename' })}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={() => setRotateOpen(true)}
        title={t('app.providers.rotate', { _: 'Rotate credentials' })}
      >
        <RotateCcw className="w-3.5 h-3.5" />
        {t('app.providers.rotate', { _: 'Rotate credentials' })}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={toggleActive}
        disabled={toggling}
        title={isActive ? t('app.providers.disable', { _: 'Disable' }) : t('app.providers.enable', { _: 'Enable' })}
      >
        {toggling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
        {isActive ? t('app.providers.disable', { _: 'Disable' }) : t('app.providers.enable', { _: 'Enable' })}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs text-destructive"
        onClick={() => setDeleteOpen(true)}
        title={t('ra.action.delete', { _: 'Delete' })}
      >
        <Trash2 className="w-3.5 h-3.5" />
        {t('ra.action.delete', { _: 'Delete' })}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={() => setTemplatesOpen(true)}
        title={t('app.providers.delivery_workflows', { _: 'Delivery workflows' })}
      >
        <ListChecks className="w-3.5 h-3.5" />
        {t('app.providers.delivery_workflows', { _: 'Delivery workflows' })}
      </Button>

      <TestSendDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        defaultChannel={channel}
        integrationId={integrationId || undefined}
        providerType={providerType?.type}
      />
      <PullTemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        channel={channel}
        providerId={String(record.providerId ?? providerType?.novuProviderId ?? '')}
      />
      {renameOpen && (
        <RenameDialog open={renameOpen} onOpenChange={setRenameOpen} row={record} onDone={refresh} />
      )}
      <RotateDialog open={rotateOpen} onOpenChange={setRotateOpen} row={record} providerType={providerType} onDone={refresh} />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        row={record}
        label={label}
        selectedForChannel={selectedForChannel}
        onDone={refresh}
      />
    </div>
  );
}
