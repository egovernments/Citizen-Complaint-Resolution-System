// Pure derivation of a channel's EFFECTIVE delivery state from the four inputs the
// Providers screen already has. No app imports on purpose: unit-testable in isolation.

export type Channel = 'SMS' | 'EMAIL' | 'WHATSAPP';
export const CHANNELS: Channel[] = ['SMS', 'EMAIL', 'WHATSAPP'];

export interface ChannelRow {
  id?: string;
  code?: string;
  enabled?: boolean;
  gateway?: string;
  senderId?: string | null;
  active?: boolean;
}

export interface ChannelStatus {
  channel: Channel;
  row?: ChannelRow;
  enabled: boolean;
  gateway: 'novu' | 'smscountry' | string;
  hasIntegration: boolean;
  hasWorkflow: boolean;
  /** Will an event on this channel actually be delivered? */
  effective: boolean;
  reasons: string[];
}

/**
 * @param channelOf classifies a Novu integration row into a DIGIT channel (the Providers
 *                  screen passes `rowChannel`, which knows the WhatsApp identifier marker).
 * @param workflowIds Novu workflow ids, or null while unknown (treated as present).
 */
export function deriveChannelStatus(
  channel: Channel,
  row: ChannelRow | undefined,
  integrations: Array<Record<string, unknown>>,
  workflowIds: string[] | null,
  channelOf: (integration: Record<string, unknown>) => Channel,
): ChannelStatus {
  const enabled = !!row?.enabled && row?.active !== false;
  const gateway = String(row?.gateway || 'novu').toLowerCase();
  const hasIntegration = integrations.some((i) => channelOf(i) === channel && i.active !== false);
  const hasWorkflow = workflowIds === null ? true : workflowIds.includes(`complaints-${channel.toLowerCase()}`);
  const reasons: string[] = [];
  if (!row) reasons.push('no NotificationChannel row — bridge falls back to its env allowlist');
  else if (!enabled) reasons.push('disabled in NotificationChannel');
  if (gateway === 'smscountry') {
    if (channel !== 'SMS') reasons.push('smscountry gateway carries SMS only');
    if (row && !row.senderId) reasons.push('no senderId for the SMSCountry gateway');
  } else {
    if (!hasIntegration) reasons.push('no active Novu integration for this channel');
    if (!hasWorkflow) reasons.push(`Novu workflow complaints-${channel.toLowerCase()} not found`);
  }
  const effective = enabled && (gateway === 'smscountry' ? channel === 'SMS' : hasIntegration && hasWorkflow);
  return { channel, row, enabled, gateway, hasIntegration, hasWorkflow, effective, reasons };
}
