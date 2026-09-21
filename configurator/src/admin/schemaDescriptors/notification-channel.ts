// Schema is `additionalProperties: false`; keep this descriptor in sync with
// utilities/default-data-handler/.../schema/RAINMAKER-PGR.json (NotificationChannel).

import type { SchemaDescriptor } from './types';

/**
 * Descriptor for `RAINMAKER-PGR.NotificationChannel` — the per-tenant channel policy
 * novu-bridge reads on every dispatch (at the STATE tenant, cached 60 s). One row per
 * channel. This is the single switch that decides whether a channel delivers; routing
 * rows on a disabled channel are recorded SKIPPED/NB_NO_PROVIDER.
 */
export const notificationChannelDescriptor: SchemaDescriptor = {
  schema: 'RAINMAKER-PGR.NotificationChannel',
  groups: [
    { title: 'Channel', fields: ['code', 'enabled', 'provider', 'active'] },
    { title: 'Legacy gateway', fields: ['gateway', 'senderId'] },
  ],
  fields: [
    { path: 'code', required: true, label: 'Channel', help: 'SMS, WHATSAPP or EMAIL — one row per channel.' },
    { path: 'enabled', widget: 'boolean', required: true, label: 'Enabled', help: 'Off = every event on this channel is recorded SKIPPED / NB_NO_PROVIDER and never delivered.' },
    { path: 'provider', label: 'Active provider', help: 'Identifier of the configured provider that serves this channel — exactly one, no automatic failover. Pick it on Notifications → Providers → Channels rather than typing it here.' },
    { path: 'gateway', label: 'Gateway (legacy)', help: 'Kept for existing rows: novu (default) delivers through the selected provider; smscountry (SMS only) posts straight to SMSCountry\'s bulk API and takes no provider. New setups choose a provider instead.' },
    { path: 'senderId', label: 'Sender ID', help: 'Registered sender id / DLT header for a direct SMS gateway. Ignored when a provider is selected.' },
    { path: 'active', widget: 'boolean', label: 'Active' },
  ],
};
