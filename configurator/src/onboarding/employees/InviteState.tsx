import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { InviteStatus } from './inviteStatus';

const LABEL: Record<InviteStatus['kind'], { text: string; variant: 'success' | 'warning' | 'outline'; action: string }> = {
  active: { text: 'Active', variant: 'success', action: 'Resend email' },
  invited: { text: 'Invited', variant: 'warning', action: 'Resend email' },
  expired: { text: 'Invite expired', variant: 'warning', action: 'Invite again' },
  removed: { text: 'No access', variant: 'outline', action: 'Invite again' },
  none: { text: 'Not invited', variant: 'outline', action: 'Send invite' },
};

/** An employee's sign-in state in the Employees list, with the one email action it allows. */
export function InviteState({ status, name, busy, onAction }: { status: InviteStatus; name: string; busy: boolean; onAction: () => void }) {
  const label = LABEL[status.kind];
  const until =
    status.kind === 'invited' && status.expiresAt
      ? new Date(status.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      : null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge
        variant={label.variant}
        className={cn('px-2 py-0 text-[11px] font-medium', label.variant === 'outline' && 'border-border text-muted-foreground')}
      >
        {label.text}
      </Badge>
      {until && <span className="text-xs text-muted-foreground">until {until}</span>}
      <Button
        variant="link"
        size="sm"
        disabled={busy}
        onClick={onAction}
        className="h-auto p-0 text-xs"
        aria-label={`${label.action} for ${name}`}
      >
        {busy ? 'Sending…' : label.action}
      </Button>
    </span>
  );
}
