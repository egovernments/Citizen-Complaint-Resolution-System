import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DigitCard } from '@/components/digit/DigitCard';
import { Header, SubHeader } from '@/components/digit/Header';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { ChannelToggleList } from '@/components/communications/ChannelToggleList';
import { useNotificationChannels } from '@/hooks/useNotificationChannels';
import { useToast } from '@/hooks/use-toast';

export default function CommunicationsPage() {
  const { completePhase, state } = useApp();
  const targetTenant = state.targetTenant || state.tenant;
  const navigate = useNavigate();
  const { toast } = useToast();

  const { enabledMap, setEnabled, loading, saving, error, loadError, save } = useNotificationChannels(targetTenant);

  const finish = () => {
    completePhase(5);
    navigate('/complete');
  };

  const handleSave = async () => {
    const { ok, enabledNames } = await save();
    if (!ok) return;
    toast({
      title: 'Communication channels saved',
      description: enabledNames.length ? `Enabled: ${enabledNames.join(', ')}` : 'All channels left disabled.',
    });
    finish();
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
            templates have been set up. You can skip this step and change it any time from{' '}
            <strong>Management → Communications</strong>.
          </AlertDescription>
        </Alert>

        <ChannelToggleList enabledMap={enabledMap} onToggle={setEnabled} loading={loading} disabled={saving} />

        {loadError && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
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
            disabled={saving || loading || !!loadError}
            icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          />
        </div>
      </DigitCard>
    </div>
  );
}
