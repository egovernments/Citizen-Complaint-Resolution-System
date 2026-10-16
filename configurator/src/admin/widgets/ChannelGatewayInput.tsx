import { useMemo } from 'react';
import { useWatch } from 'react-hook-form';
import { DigitFormSelect } from '../DigitFormSelect';
import { DIRECT_GATEWAY_CHANNELS } from '@/resources/workflow-services/validateNotifications';

export interface ChannelGatewayInputProps {
  source: string;
  label: string;
  help?: string;
}

/** The default transport: whatever provider the channel has selected. */
const NOVU = 'novu';

/**
 * Descriptor widget for a channel-policy row's `gateway`.
 *
 * A direct gateway bypasses the notification service and posts straight to a
 * vendor API, so the transport fixes the channel: `smscountry` is a bulk SMS
 * endpoint and cannot carry EMAIL or WHATSAPP. This dropdown therefore offers a
 * direct gateway ONLY for the channels DIRECT_GATEWAY_CHANNELS says it carries
 * — the same table the `channel-gateway-mismatch` rule rejects a save on, so
 * what is offered and what is accepted cannot drift apart.
 *
 * Two behaviours borrowed from ReferenceSelectInput, for the same reasons:
 * the row's CURRENT value is always a choice (an already-broken row must be
 * visible and fixable, not an empty dropdown), and it is labelled as the
 * mismatch it is rather than shown as if it were fine.
 */
export function ChannelGatewayInput({ source, label, help }: ChannelGatewayInputProps) {
  // The channel this row is for. It is edited on the same form, so the offer
  // has to follow it live rather than read the saved record once.
  const code = String(useWatch({ name: 'code' }) ?? '').trim().toUpperCase();
  const current = String(useWatch({ name: source }) ?? '').trim();

  const choices = useMemo(() => {
    const out = [{ value: NOVU, label: 'novu — deliver through the channel\'s selected provider' }];
    for (const [gateway, carries] of Object.entries(DIRECT_GATEWAY_CHANNELS)) {
      const value = gateway.toLowerCase();
      if (carries.includes(code)) {
        out.push({ value, label: `${value} — direct gateway (${carries.join(', ')} only)` });
      } else if (current.toLowerCase() === value) {
        // Already stored on a channel it cannot carry: keep it visible and say
        // so, instead of silently dropping the value the operator can see saved.
        out.push({ value, label: `${value} — not valid for ${code || 'this channel'} (${carries.join(', ')} only)` });
      }
    }
    if (current && !out.some((c) => c.value === current.toLowerCase())) {
      out.push({ value: current, label: `${current} (not a known gateway)` });
    }
    return out;
  }, [code, current]);

  return (
    <DigitFormSelect
      source={source}
      label={label}
      help={help}
      choices={choices}
      placeholder="novu"
    />
  );
}
