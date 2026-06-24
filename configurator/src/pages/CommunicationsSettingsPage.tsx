import { useApp } from '../App';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DigitCard } from '@/components/digit/DigitCard';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { ChannelToggleList } from '@/components/communications/ChannelToggleList';
import { useNotificationChannels } from '@/hooks/useNotificationChannels';
import { useToast } from '@/hooks/use-toast';

/**
 * Management-mode home for notification channel toggles — the "configure it later" counterpart to
 * the onboarding step (Phase 5). Operates on the logged-in tenant. Reuses the same toggle UI + hook.
 */
export default function CommunicationsSettingsPage() {
  const { state } = useApp();
  const tenant = state.tenant;
  const { toast } = useToast();

  const { enabledMap, setEnabled, loading, saving, error, save } = useNotificationChannels(tenant);

  const handleSave = async () => {
    const { ok, enabledNames } = await save();
    if (!ok) return;
    toast({
      title: 'Communication channels saved',
      description: enabledNames.length ? `Enabled: ${enabledNames.join(', ')}` : 'All channels disabled.',
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">Communications</h1>
        <p className="text-muted-foreground">
          Enable or disable notification channels for <span className="font-medium">{tenant}</span>.
        </p>
      </div>

      <DigitCard>
        <Alert variant="default" className="mb-4 sm:mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Turn a channel on only when its provider credentials and templates have been set up.
            Channels are off by default.
          </AlertDescription>
        </Alert>

        <ChannelToggleList enabledMap={enabledMap} onToggle={setEnabled} loading={loading} disabled={saving} />

        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end mt-6">
          <SubmitBar
            label={saving ? 'Saving…' : 'Save'}
            onSubmit={handleSave}
            disabled={saving || loading}
            icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          />
        </div>
      </DigitCard>
    </div>
  );
}
