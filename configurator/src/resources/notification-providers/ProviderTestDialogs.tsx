// The two read/probe dialogs of the Providers screen, split out of
// NotificationProviderList so the list, the row actions and the Add dialog can all
// open them without a circular import:
//
//   TestSendDialog     — one live message through a chosen provider.
//   PullTemplatesDialog — read-only Novu workflow discovery (copy a workflowId).
//
// Recipients are operator-entered and only leave the browser on an explicit submit.
import { useEffect, useState } from 'react';
import { useTranslate } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { pullTemplates, testSend, CHANNELS, type Channel, type TemplatesResponse } from './providerApi';
import { notify } from './providerToast';
import { useApp } from '../../App';

export function TestSendDialog({
  open, onOpenChange, defaultChannel, integrationId, providerType,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultChannel: Channel;
  /** Send through this integration specifically; omit to let the bridge choose. */
  integrationId?: string;
  /** Catalog type of that integration, when known. */
  providerType?: string;
}) {
  const t = useTranslate();
  const navigate = useNavigate();
  // A Twilio `sms` integration can send both SMS and WhatsApp, so let the
  // operator confirm/switch the channel for the test. Held as an override rather
  // than copied state, so reopening the dialog for a different provider picks up
  // that provider's channel without an effect syncing the two.
  const [channelOverride, setChannelOverride] = useState<Channel | null>(null);
  const channel = channelOverride ?? defaultChannel;
  const [recipient, setRecipient] = useState('');
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [contentSid, setContentSid] = useState('');
  const [variables, setVariables] = useState('');
  const [sending, setSending] = useState(false);

  const handleOpenChange = (o: boolean) => {
    onOpenChange(o);
    if (!o) setChannelOverride(null);
  };

  const isEmail = channel === 'EMAIL';
  const isWhatsApp = channel === 'WHATSAPP';

  const canSend =
    !!recipient.trim() &&
    (isWhatsApp ? !!contentSid.trim() : !!body.trim()) &&
    !sending;

  const { state: appState } = useApp();
  const sessionTenant = String(appState?.tenant ?? '');
  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const res = await testSend({
        tenantId: sessionTenant || undefined,
        id: integrationId || undefined,
        type: providerType || undefined,
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
        res.ok ? t('app.providers.msg_test_sent', { _: 'Test dispatched.' }) : `${t('app.providers.msg_test_failed', { _: 'Test failed' })}: ${res.errorCode ?? ''} ${res.errorMessage ?? ''}`.trim(),
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
            <Select value={channel} onValueChange={(v) => setChannelOverride(v as Channel)}>
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
            onClick={() => { handleOpenChange(false); navigate(`/manage/notification-log?filter=${encodeURIComponent(JSON.stringify({ includeTest: 'true' }))}`); }}
          >
            {t('app.providers.view_logs', { _: 'View Notification Logs' })}
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={sending}>
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

export function PullTemplatesDialog({
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
