import { MessageSquare, Smartphone, Mail } from 'lucide-react';
import type { NotificationChannelConfig } from '@/api';

/** Channels an operator can toggle. Credentials + templates are seeded out-of-band
 *  (Twilio/SendGrid side); here we only flip the per-tenant enable switch. The notes set
 *  expectations because SMS/Email may not be fully wired for delivery in every deployment. */
export interface ChannelDef {
  code: string;
  name: string;
  providerName: string;
  icon: typeof MessageSquare;
  note?: string;
}

export const CHANNELS: ChannelDef[] = [
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

/** Map the toggle state into the NotificationChannel payload the config-service expects. */
export function buildChannelPayload(enabledMap: Record<string, boolean>): NotificationChannelConfig[] {
  return CHANNELS.map((c) => ({
    code: c.code,
    name: c.name,
    enabled: !!enabledMap[c.code],
    providerName: c.providerName,
    priority: 1,
  }));
}
