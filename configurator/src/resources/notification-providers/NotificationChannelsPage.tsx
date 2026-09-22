import { useTranslate } from 'ra-core';
import { Link } from 'react-router-dom';
import { ChannelStatusCard } from './ChannelStatusCard';
import { useProviderCatalog } from './useProviderCatalog';

/**
 * Notifications → Channels. The three channels (SMS, WhatsApp, Email), each with its
 * on/off switch and the ONE provider it delivers through.
 *
 * This replaces the generic MDMS list of `NOTIFICATIONS.Channel` that used to live
 * here, which duplicated the Channels card on the Providers screen with a second,
 * rawer editor for the same three rows. The card is the one place a channel is set up
 * now; Providers is where the accounts behind it are added.
 *
 * There is no Create. The channel set is closed — the bridge, the templates and the
 * routing are all keyed on SMS / WHATSAPP / EMAIL, and the schema enum rejects anything
 * else — and all three rows are seeded. What an operator actually chooses is the
 * provider for a channel, and that list is already narrowed to providers that carry it.
 * The row's legacy fields (gateway, senderId) stay editable at
 * /manage/notifications-channel/:id for tenants still on a direct gateway.
 */
export function NotificationChannelsPage() {
  const t = useTranslate();
  const catalogState = useProviderCatalog();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
          {t('app.channels.title', { _: 'Notification Channels' })}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('app.channels.subtitle_before', { _: 'Switch each channel on and choose the provider it sends through. Add or change the accounts themselves under' })}{' '}
          <Link to="/manage/notification-provider" className="underline underline-offset-2">
            {t('app.nav.notification_providers', { _: 'Providers' })}
          </Link>.
        </p>
      </div>
      <ChannelStatusCard catalogState={catalogState} />
    </div>
  );
}
