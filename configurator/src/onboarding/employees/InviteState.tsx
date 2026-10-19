import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { InviteStatus } from './inviteStatus';
import { useOnboardingT, type OnboardingT } from '../i18n';

type Label = { text: string; variant: 'success' | 'warning' | 'outline'; action: string };

function labelFor(kind: InviteStatus['kind'], t: OnboardingT): Label {
  const resend = t('invite.resend', 'Resend email');
  const again = t('invite.again', 'Invite again');
  switch (kind) {
    case 'active':
      return { text: t('invite.active', 'Active'), variant: 'success', action: resend };
    case 'invited':
      return { text: t('invite.invited', 'Invited'), variant: 'warning', action: resend };
    case 'expired':
      return { text: t('invite.expired', 'Invite expired'), variant: 'warning', action: again };
    case 'removed':
      return { text: t('invite.no_access', 'No access'), variant: 'outline', action: again };
    case 'none':
      return { text: t('invite.not_invited', 'Not invited'), variant: 'outline', action: t('invite.send', 'Send invite') };
  }
}

/** An employee's sign-in state in the Employees list, with the one email action it allows. */
export function InviteState({ status, name, busy, onAction }: { status: InviteStatus; name: string; busy: boolean; onAction: () => void }) {
  const t = useOnboardingT();
  const label = labelFor(status.kind, t);
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
      {until && <span className="text-xs text-muted-foreground">{t('invite.until', 'until %{date}', { date: until })}</span>}
      <Button
        variant="link"
        size="sm"
        disabled={busy}
        onClick={onAction}
        className="h-auto p-0 text-xs"
        aria-label={t('invite.action_for', '%{action} for %{name}', { action: label.action, name })}
      >
        {busy ? t('invite.sending', 'Sending…') : label.action}
      </Button>
    </span>
  );
}
