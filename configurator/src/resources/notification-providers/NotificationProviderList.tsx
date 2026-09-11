import { useEffect, useState } from 'react';
import { useRefresh, useTranslate } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import {
  Plus, ShieldCheck, Send, ListChecks, Copy, Check, Loader2, ExternalLink, RefreshCw,
} from 'lucide-react';
import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import {
  createProvider, verifyProvider, testSend, pullTemplates,
  CHANNELS, DEFAULT_PROVIDER, credFields, rowChannel,
  type Channel, type CredField, type TemplatesResponse,
} from './providerApi';
import { SyncTwilioTemplatesDialog } from './SyncTwilioTemplatesDialog';

/** Render a boolean flag as a compact yes/no chip. */
function flag(value: unknown) {
  return <StatusChip value={value ? 'YES' : 'NO'} />;
}

/** Shadcn toast wrapper — the app mounts <Toaster/> at its root. */
function notify(title: string, description?: string, variant?: 'default' | 'destructive') {
  toast({ title, description, variant });
}

const columns: DigitColumn[] = [
  {
    source: 'channel',
    label: 'app.providers.col_channel',
    sortable: false,
    // Novu stores WhatsApp as a Twilio `sms` integration; rowChannel derives
    // the WHATSAPP designation back from the identifier/name marker so the
    // row doesn't silently morph into a second SMS entry after a refetch.
    render: (record) => <span>{rowChannel(record as Record<string, unknown>)}</span>,
  },
  {
    source: 'providerId',
    label: 'app.providers.col_provider',
    sortable: false,
    render: (record) => {
      const id = String(record.providerId ?? record.name ?? '');
      return id ? (
        <span className="font-mono text-xs">{id}</span>
      ) : (
        <span className="text-muted-foreground">--</span>
      );
    },
  },
  {
    source: 'name',
    label: 'app.providers.col_name',
    sortable: false,
    render: (record) => <span>{String(record.name ?? '--')}</span>,
  },
  {
    source: 'active',
    label: 'app.providers.col_active',
    sortable: false,
    render: (record) => flag(record.active),
  },
  {
    source: 'primary',
    label: 'app.providers.col_primary',
    sortable: false,
    render: (record) => flag(record.primary),
  },
];

// ---------------------------------------------------------------------------
// Add Provider dialog — channel + providerId + name + per-provider creds.
// Credentials live only in this form's local state and are dropped the moment
// the dialog closes; nothing is written to localStorage or persistent state.
// ---------------------------------------------------------------------------
function AddProviderAction() {
  const t = useTranslate();
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>('SMS');
  const [providerId, setProviderId] = useState<string>(DEFAULT_PROVIDER.SMS);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [creds, setCreds] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);

  const fields = credFields(channel, providerId);

  const reset = () => {
    setChannel('SMS');
    setProviderId(DEFAULT_PROVIDER.SMS);
    setName('');
    setIdentifier('');
    setCreds({});
    setSaving(false);
  };

  const onChannelChange = (c: Channel) => {
    setChannel(c);
    setProviderId(DEFAULT_PROVIDER[c]);
    setCreds({}); // credential shape changes with the channel/provider
  };

  const setCred = (key: string, value: string | boolean) =>
    setCreds((prev) => ({ ...prev, [key]: value }));

  const missingRequired = fields.some(
    (f) => f.required && !String(creds[f.key] ?? '').trim(),
  );
  const canSave = !!name.trim() && !!providerId.trim() && !missingRequired && !saving;

  const submit = async () => {
    if (!canSave) {
      notify(
        t('app.providers.msg_missing', { _: 'Fill in the name and all required credential fields.' }),
        undefined,
        'destructive',
      );
      return;
    }
    setSaving(true);
    try {
      const credentials: Record<string, unknown> = {};
      for (const f of fields) {
        const v = creds[f.key];
        if (f.type === 'checkbox') credentials[f.key] = v === true;
        else if (String(v ?? '').trim()) credentials[f.key] = String(v).trim();
      }
      await createProvider({
        channel,
        providerId: providerId.trim(),
        name: name.trim(),
        identifier: identifier.trim() || undefined,
        credentials,
      });
      notify(
        t('app.providers.msg_created', { _: 'Provider created.' }),
        // WhatsApp rides the Twilio SMS integration in Novu — say so, or the
        // operator reads the refetched `sms` row as their WHATSAPP entry vanishing.
        channel === 'WHATSAPP'
          ? `${channel} · ${providerId} (stored as Novu sms integration)`
          : `${channel} · ${providerId}`,
      );
      setOpen(false);
      reset();
      refresh();
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
              _: 'Credentials are sent straight to Novu over TLS and are never stored or echoed back.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('app.providers.field_channel', { _: 'Channel' })}</Label>
              <Select value={channel} onValueChange={(v) => onChannelChange(v as Channel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('app.providers.field_provider_id', { _: 'Provider ID' })}</Label>
              <Input
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                placeholder={DEFAULT_PROVIDER[channel]}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('app.providers.field_name', { _: 'Name' })}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Twilio SMS (prod)" />
          </div>

          <div className="space-y-1.5">
            <Label>{t('app.providers.field_identifier', { _: 'Identifier (optional)' })}</Label>
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="unique-integration-key" />
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('app.providers.credentials', { _: 'Credentials' })}
            </p>
            {fields.map((f: CredField) => (
              <div key={f.key} className="space-y-1.5">
                {f.type === 'checkbox' ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={creds[f.key] === true}
                      onChange={(e) => setCred(f.key, e.target.checked)}
                    />
                    {t(f.labelKey, { _: f.labelDefault })}
                  </label>
                ) : (
                  <>
                    <Label>
                      {t(f.labelKey, { _: f.labelDefault })}
                      {f.required && <span className="text-destructive"> *</span>}
                    </Label>
                    <Input
                      type={f.type}
                      autoComplete="off"
                      value={String(creds[f.key] ?? '')}
                      onChange={(e) => setCred(f.key, e.target.value)}
                      placeholder={f.placeholder}
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={saving}>
            {t('ra.action.cancel', { _: 'Cancel' })}
          </Button>
          <Button onClick={submit} disabled={!canSave}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('app.providers.create', { _: 'Create Provider' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// "Sync WhatsApp templates" — opens the map-and-confirm dialog that pulls the
// operator's approved Twilio Content templates from the bridge and persists the
// selected routing rows into MDMS NotificationProviderTemplate. Sits beside Add
// Provider so it's discoverable right where operators manage their Twilio setup.
// ---------------------------------------------------------------------------
function SyncTemplatesAction() {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <RefreshCw className="w-4 h-4" />
        {t('app.providers.sync_action', { _: 'Sync WhatsApp templates' })}
      </Button>
      <SyncTwilioTemplatesDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Test delivery dialog — recipient + body (SMS/Email) OR contentSid+variables
// (WhatsApp). Recipient is operator-entered and only sent on submit.
// ---------------------------------------------------------------------------
function TestSendDialog({
  open, onOpenChange, defaultChannel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultChannel: Channel;
}) {
  const t = useTranslate();
  const navigate = useNavigate();
  // A Twilio `sms` integration can send both SMS and WhatsApp, so let the
  // operator confirm/switch the channel for the test.
  const [channel, setChannel] = useState<Channel>(defaultChannel);
  const [recipient, setRecipient] = useState('');
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [contentSid, setContentSid] = useState('');
  const [variables, setVariables] = useState('');
  const [sending, setSending] = useState(false);

  const isEmail = channel === 'EMAIL';
  const isWhatsApp = channel === 'WHATSAPP';

  const canSend =
    !!recipient.trim() &&
    (isWhatsApp ? !!contentSid.trim() : !!body.trim()) &&
    !sending;

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const res = await testSend({
        channel,
        to: isEmail ? { email: recipient.trim() } : { phone: recipient.trim() },
        body: isWhatsApp ? undefined : body.trim(),
        subject: isEmail ? (subject.trim() || undefined) : undefined,
        contentSid: isWhatsApp ? contentSid.trim() : undefined,
        variables: isWhatsApp
          ? variables.split(',').map((v) => v.trim()).filter(Boolean)
          : undefined,
      });
      const status = res.novuStatus ?? (res.ok ? 'accepted' : 'unknown');
      notify(
        t('app.providers.msg_test_sent', { _: 'Test dispatched via Novu.' }),
        `${t('app.providers.status', { _: 'Status' })}: ${status}${res.transactionId ? ` · txn ${res.transactionId}` : ''}`,
        res.ok ? 'default' : 'destructive',
      );
    } catch (err) {
      notify(
        t('app.providers.msg_test_failed', { _: 'Test delivery failed.' }),
        (err as Error)?.message,
        'destructive',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('app.providers.test_title', { _: 'Send Test Message' })}</DialogTitle>
          <DialogDescription>
            {t('app.providers.test_hint', {
              _: 'Sends one live message through Novu. Use owner-authorized recipients only — each test is logged.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('app.providers.field_channel', { _: 'Channel' })}</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>
              {isEmail
                ? t('app.providers.field_email', { _: 'Recipient email' })
                : t('app.providers.field_phone', { _: 'Recipient phone' })}
            </Label>
            <Input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={isEmail ? 'user@example.com' : isWhatsApp ? 'whatsapp:+15551234567' : '+15551234567'}
            />
          </div>

          {isWhatsApp ? (
            <>
              <div className="space-y-1.5">
                <Label>{t('app.providers.field_content_sid', { _: 'Content SID' })}</Label>
                <Input
                  value={contentSid}
                  onChange={(e) => setContentSid(e.target.value)}
                  placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('app.providers.field_variables', { _: 'Variables (comma-separated)' })}</Label>
                <Input
                  value={variables}
                  onChange={(e) => setVariables(e.target.value)}
                  placeholder="value1, value2"
                />
                <p className="text-xs text-muted-foreground">
                  {t('app.providers.whatsapp_sid_hint', {
                    _: 'Approved WhatsApp ContentSids are listed on the Provider Templates screen.',
                  })}
                </p>
              </div>
            </>
          ) : (
            <>
              {isEmail && (
                <div className="space-y-1.5">
                  <Label>{t('app.providers.field_subject', { _: 'Subject (optional)' })}</Label>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>{t('app.providers.field_body', { _: 'Message body' })}</Label>
                <textarea
                  className="flex min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t('app.providers.body_placeholder', { _: 'Test message text' })}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="link"
            className="px-0 gap-1.5"
            onClick={() => { onOpenChange(false); navigate('/manage/notification-log'); }}
          >
            {t('app.providers.view_logs', { _: 'View Notification Logs' })}
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
              {t('ra.action.cancel', { _: 'Cancel' })}
            </Button>
            <Button onClick={submit} disabled={!canSend}>
              {sending && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('app.providers.send_test', { _: 'Send Test' })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Pull templates modal — read-only Novu workflow discovery, copy workflowId.
// ---------------------------------------------------------------------------
function PullTemplatesDialog({
  open, onOpenChange, channel, providerId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  channel: Channel;
  providerId: string;
}) {
  const t = useTranslate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TemplatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Fetch when opened (fresh each time — no caching of discovery results).
  const load = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await pullTemplates(channel, providerId));
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  // The dialog is opened by the PARENT flipping the `open` prop, so Radix's
  // onOpenChange never fires for the open transition — an effect on `open` is
  // the only reliable trigger for the fetch. handleOpenChange below only ever
  // runs for the close path (Esc/overlay/Close button).
  useEffect(() => {
    if (open) { void load(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel, providerId]);

  const handleOpenChange = (o: boolean) => {
    onOpenChange(o);
    if (!o) { setResult(null); setError(null); setCopied(null); }
  };

  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      notify(t('app.providers.copy_failed', { _: 'Could not copy to clipboard.' }), undefined, 'destructive');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('app.providers.templates_title', { _: 'Novu Workflows' })}</DialogTitle>
          <DialogDescription>
            {t('app.providers.templates_hint', {
              _: 'Delivery workflows configured in Novu for this channel — not provider templates '
                + '(Twilio has no SMS template registry). SMS/Email message text is managed under '
                + 'Notification Templates. Copy a workflow ID to reference it.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[55vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('app.list.loading', { _: 'Loading...' })}
            </div>
          )}
          {error && !loading && <p className="text-sm text-destructive py-4">{error}</p>}
          {!loading && !error && result && result.data.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">
              {t('app.providers.templates_empty', { _: 'No Novu workflows found for this channel.' })}
            </p>
          )}
          {!loading && !error && result && result.data.map((w) => (
            <div key={w.workflowId} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {w.name}
                  {(w.channels ?? []).length > 0 && (
                    <span className="ml-2 font-mono text-[10px] uppercase text-muted-foreground">
                      {(w.channels ?? []).join(', ')}
                    </span>
                  )}
                </div>
                <div className="font-mono text-xs text-muted-foreground truncate">{w.workflowId}</div>
              </div>
              <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => copy(w.workflowId)}>
                {copied === w.workflowId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied === w.workflowId ? t('app.providers.copied', { _: 'Copied' }) : t('app.providers.copy', { _: 'Copy' })}
              </Button>
            </div>
          ))}
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('app.providers.whatsapp_sid_note', {
            _: 'WhatsApp ContentSids are managed on the Provider Templates screen, not here.',
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            {t('ra.action.close', { _: 'Close' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Per-row actions: Verify (inline badge) + Test + Pull templates.
// ---------------------------------------------------------------------------
type VerifyState = { status: 'idle' | 'loading' | 'ok' | 'fail'; detail?: string };

function ProviderRowActions({ record }: { record: Record<string, unknown> }) {
  const t = useTranslate();
  const integrationId = String(record._id ?? record.id ?? '');
  const providerId = String(record.providerId ?? DEFAULT_PROVIDER.SMS);
  const channel = rowChannel(record);

  const [verify, setVerify] = useState<VerifyState>({ status: 'idle' });
  const [testOpen, setTestOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const runVerify = async () => {
    if (!integrationId) {
      notify(t('app.providers.msg_no_id', { _: 'This provider has no integration id to verify.' }), undefined, 'destructive');
      return;
    }
    setVerify({ status: 'loading' });
    try {
      const res = await verifyProvider(integrationId);
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

  return (
    <div className="flex items-center gap-1.5 justify-end">
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
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={() => setTestOpen(true)}
        title={t('app.providers.test', { _: 'Test' })}
      >
        <Send className="w-3.5 h-3.5" />
        {t('app.providers.test', { _: 'Test' })}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={() => setTemplatesOpen(true)}
        title={t('app.providers.templates', { _: 'Templates' })}
      >
        <ListChecks className="w-3.5 h-3.5" />
        {t('app.providers.templates', { _: 'Templates' })}
      </Button>

      <TestSendDialog open={testOpen} onOpenChange={setTestOpen} defaultChannel={channel} />
      <PullTemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        channel={channel}
        providerId={providerId}
      />
    </div>
  );
}

/**
 * Notification provider integrations served by the novu-bridge proxy
 * (`GET /novu-bridge/novu-adapter/v1/integrations`). The proxy calls Novu
 * server-side with its ApiKey (never exposed to this keyless SPA) and redacts
 * every credential value to "***" before returning. Beyond the read-only view,
 * this screen offers self-service actions — Add Provider, Verify, Test delivery,
 * and Pull templates — each mapping to a novu-bridge `/providers*` endpoint.
 * Credentials are only ever sent on an explicit submit and are never persisted.
 */
export function NotificationProviderList() {
  return (
    <DigitList
      title="app.nav.notification_providers"
      subtitle="Novu integrations — credentials redacted server-side"
      sort={{ field: 'channel', order: 'ASC' }}
      actions={
        <div className="flex items-center gap-2">
          <SyncTemplatesAction />
          <AddProviderAction />
        </div>
      }
    >
      <DigitDatagrid
        columns={columns}
        rowActions={(record) => <ProviderRowActions record={record as Record<string, unknown>} />}
      />
    </DigitList>
  );
}
