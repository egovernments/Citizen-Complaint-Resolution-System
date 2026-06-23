import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { MessageSquare, Smartphone, Mail, Loader2, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { DigitCard } from '@/components/digit/DigitCard';
import { Header, SubHeader } from '@/components/digit/Header';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { configService, ApiClientError, type NotificationChannelConfig } from '@/api';
import { useToast } from '@/hooks/use-toast';

/** Channels we let an operator toggle. Credentials + templates are seeded out-of-band
 *  (Twilio/SendGrid side); here we only flip the per-tenant enable switch. The notes set
 *  expectations because SMS/Email may not be fully wired for delivery in every deployment. */
const CHANNELS: {
  code: string;
  name: string;
  providerName: string;
  icon: typeof MessageSquare;
  note?: string;
}[] = [
  { code: 'WHATSAPP', name: 'WhatsApp', providerName: 'twilio', icon: MessageSquare },
  {
    code: 'SMS',
    name: 'SMS',
    providerName: 'twilio',
    icon: Smartphone,
    note: 'Requires an active provider and may be globally paused pending Twilio approval.',
  },
  {
    code: 'EMAIL',
    name: 'Email',
    providerName: 'sendgrid',
    icon: Mail,
    note: 'Delivery may not yet be available in this deployment.',
  },
];

function Toggle({
  enabled,
  onChange,
  label,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        enabled ? 'bg-primary' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function CommunicationsPage() {
  const { completePhase, state } = useApp();
  const targetTenant = state.targetTenant || state.tenant;
  const navigate = useNavigate();
  const { toast } = useToast();

  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-populate toggles from any existing NotificationChannel config for this tenant.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await configService.getNotificationChannels(targetTenant);
        if (cancelled) return;
        const map: Record<string, boolean> = {};
        for (const ch of existing) map[ch.code] = !!ch.enabled;
        setEnabledMap(map);
      } catch {
        // Non-fatal: default everything to off if we cannot read current state.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetTenant]);

  const finish = () => {
    completePhase(5);
    navigate('/complete');
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const channels: NotificationChannelConfig[] = CHANNELS.map((c) => ({
        code: c.code,
        name: c.name,
        enabled: !!enabledMap[c.code],
        providerName: c.providerName,
        priority: 1,
      }));
      await configService.saveNotificationChannels(targetTenant, channels);
      const on = channels.filter((c) => c.enabled).map((c) => c.name);
      toast({
        title: 'Communication channels saved',
        description: on.length ? `Enabled: ${on.join(', ')}` : 'All channels left disabled.',
      });
      finish();
    } catch (err) {
      const msg =
        err instanceof ApiClientError ? err.firstError : err instanceof Error ? err.message : 'Failed to save channels';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Header>Communications Setup</Header>

      <DigitCard>
        <SubHeader>Notification channels</SubHeader>
        <Alert variant="default" className="mb-4 sm:mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Choose which channels send complaint notifications for this tenant. All channels are{' '}
            <strong>off by default</strong> — enable a channel only when its provider credentials and
            templates have been set up. You can skip this step and configure it later.
          </AlertDescription>
        </Alert>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading current settings…
          </div>
        ) : (
          <div className="divide-y">
            {CHANNELS.map((c) => {
              const Icon = c.icon;
              const enabled = !!enabledMap[c.code];
              return (
                <div key={c.code} className="flex items-start justify-between gap-4 py-4">
                  <div className="flex items-start gap-3">
                    <Icon className="h-5 w-5 mt-0.5 text-muted-foreground" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        <Badge variant="outline">{c.providerName}</Badge>
                      </div>
                      {c.note && <p className="text-sm text-muted-foreground mt-1">{c.note}</p>}
                    </div>
                  </div>
                  <Toggle
                    enabled={enabled}
                    label={`Enable ${c.name}`}
                    onChange={(v) => setEnabledMap((m) => ({ ...m, [c.code]: v }))}
                  />
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-6">
          <Button variant="ghost" onClick={finish} disabled={saving}>
            Skip for now
          </Button>
          <SubmitBar
            label={saving ? 'Saving…' : 'Save & Continue'}
            onSubmit={handleSave}
            disabled={saving || loading}
            icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          />
        </div>
      </DigitCard>
    </div>
  );
}
