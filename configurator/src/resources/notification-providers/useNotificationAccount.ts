// Whose notification account the Providers and Channels screens act on (#2203), and what
// to tell the operator about it. A workspace with its own Novu organization manages its
// own providers; any other tenant shows the deployment's shared account as before.
import { useEffect, useState } from 'react';
import { fetchNotificationAccount, type NotificationAccount } from './providerApi';

export interface NotificationAccountState {
  account: NotificationAccount | null;
  loading: boolean;
}

export function useNotificationAccount(): NotificationAccountState {
  const [state, setState] = useState<NotificationAccountState>({ account: null, loading: true });
  useEffect(() => {
    let alive = true;
    fetchNotificationAccount()
      .then((account) => { if (alive) setState({ account, loading: false }); })
      // A bridge without the account block, or one that is down: say nothing, keep today's screen.
      .catch(() => { if (alive) setState({ account: null, loading: false }); });
    return () => { alive = false; };
  }, []);
  return state;
}

export type AccountNoticeTone = 'info' | 'warning';

export interface AccountNotice {
  tone: AccountNoticeTone;
  /** i18n key and its English fallback. */
  key: string;
  english: string;
}

/**
 * The one-line notice above the provider list, or null when there is nothing worth saying
 * (a bridge without per-tenant accounts, or the feature off: the screen is what it was).
 */
export function accountNotice(account: NotificationAccount | null): AccountNotice | null {
  if (!account || !account.tenantAccountsEnabled) return null;
  if (account.mode === 'TENANT') {
    return account.manageable
      ? { tone: 'info', key: 'app.providers.account_own',
          english: 'This workspace has its own notification account. The providers below are yours alone: add your own SMS, WhatsApp and email accounts here.' }
      : { tone: 'info', key: 'app.providers.account_own_readonly',
          english: "This workspace has its own notification account. Managing its providers needs an admin role in this workspace." };
  }
  switch (account.status) {
    case 'PROVISIONING':
      return { tone: 'info', key: 'app.providers.account_provisioning',
        english: "This workspace's notification account is being set up. Reload in a minute." };
    case 'FAILED':
    case 'NOT_PROVISIONED':
    case 'DEPROVISIONED':
      return account.manageable ? null : { tone: 'warning', key: 'app.providers.account_missing',
        english: 'This workspace does not have its own notification account yet, so it cannot add providers. Ask the platform operator to set one up.' };
    default:
      return null;
  }
}

/** Whether the provider controls are offered: the role check, narrowed by what the bridge says. */
export function canManageProviders(hasAdminRole: boolean, account: NotificationAccount | null): boolean {
  return hasAdminRole && (account ? account.manageable : true);
}
