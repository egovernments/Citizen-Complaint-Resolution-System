import { useTranslate } from 'ra-core';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { NotificationAccount } from './providerApi';
import { accountNotice } from './useNotificationAccount';

/**
 * #2203: says whose notification account the Providers / Channels screens act on — the
 * workspace's own Novu organization, or that the workspace has none yet. Renders nothing on
 * a deployment without per-tenant accounts, so those screens look exactly as before.
 */
export function NotificationAccountBanner({ account }: { account: NotificationAccount | null }) {
  const t = useTranslate();
  const notice = accountNotice(account);
  if (!notice) return null;
  return (
    <Alert variant={notice.tone} data-testid="notification-account-banner" className="mb-3">
      <AlertDescription>{t(notice.key, { _: notice.english })}</AlertDescription>
    </Alert>
  );
}
