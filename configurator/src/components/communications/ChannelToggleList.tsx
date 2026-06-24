import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CHANNELS } from './channels';

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

/** Presentational list of channel rows with on/off toggles. Shared by the onboarding step and the
 *  management settings page. */
export function ChannelToggleList({
  enabledMap,
  onToggle,
  loading,
  disabled,
}: {
  enabledMap: Record<string, boolean>;
  onToggle: (code: string, value: boolean) => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading current settings…
      </div>
    );
  }
  return (
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
              onChange={(v) => !disabled && onToggle(c.code, v)}
            />
          </div>
        );
      })}
    </div>
  );
}
