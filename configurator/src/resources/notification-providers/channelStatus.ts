// Pure derivation of a channel's EFFECTIVE delivery state from the inputs the
// Providers screen already has. No app imports on purpose: unit-testable in isolation.
//
// Since the provider catalog landed, the per-channel policy row carries an explicit
// `provider` (the Novu integration's `identifier`): exactly ONE provider is active per
// channel per state tenant, chosen here rather than inferred. `gateway` stays readable
// for legacy rows — a direct gateway such as `smscountry` bypasses Novu entirely and
// therefore takes no provider selection — but for the default `novu` gateway the
// `provider` field is what decides, and an unselected one is a real misconfiguration.

export type Channel = 'SMS' | 'EMAIL' | 'WHATSAPP';
export const CHANNELS: Channel[] = ['SMS', 'EMAIL', 'WHATSAPP'];

export interface ChannelRow {
  id?: string;
  code?: string;
  enabled?: boolean;
  gateway?: string;
  senderId?: string | null;
  /** Identifier of the Novu integration that serves this channel. Empty on legacy rows. */
  provider?: string | null;
  active?: boolean;
}

/** How the channel's `provider` selection resolves against the live integrations. */
export type ProviderSelectionState =
  /** Direct gateway (e.g. smscountry): provider selection does not apply. */
  | 'not-applicable'
  /** Selected, found, active and serving this channel. */
  | 'ok'
  /** Selected, but no integration with that identifier exists any more. */
  | 'missing'
  /** Selected and found, but the integration is disabled. */
  | 'inactive'
  /** Selected and found, but it serves a different channel. */
  | 'mismatch'
  /** Nothing selected, though active integrations for this channel exist. */
  | 'unselected'
  /** Nothing selected and nothing configured for this channel at all. */
  | 'none';

/** One-word verdict behind the card's plain-English summary. */
export type ChannelVerdict =
  | 'no-row'
  | 'off'
  | 'gateway-incomplete'
  | 'provider-missing'
  | 'provider-inactive'
  | 'provider-mismatch'
  | 'no-provider'
  | 'provider-unselected'
  | 'no-workflow'
  | 'ok';

export interface ChannelStatus {
  channel: Channel;
  row?: ChannelRow;
  enabled: boolean;
  gateway: 'novu' | 'smscountry' | string;
  /** The row's `provider` value, trimmed ('' when unset). */
  provider: string;
  providerState: ProviderSelectionState;
  /** The integration `provider` resolves to, when there is one. */
  selectedIntegration?: Record<string, unknown>;
  hasIntegration: boolean;
  hasWorkflow: boolean;
  /** Will an event on this channel actually be delivered? */
  effective: boolean;
  verdict: ChannelVerdict;
  /** The state in words, for the effective-state card. */
  summary: string;
  reasons: string[];
}

/**
 * Map of `provider` selection value (lower-cased) -> the channel code that selected it.
 * Lets a provider row on the Providers screen say "currently selected for SMS" without
 * a second lookup, and is how the delete pre-check knows a provider is still in use.
 */
export function selectionsByProvider(rows: ChannelRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const provider = String(row.provider ?? '').trim().toLowerCase();
    const code = String(row.code ?? '').trim().toUpperCase();
    if (provider && code) out.set(provider, code);
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

/** Does a NotificationChannel.provider selection point at this integration row? */
function pointsAt(integration: Record<string, unknown>, selection: string): boolean {
  const wanted = selection.toLowerCase();
  if (!wanted) return false;
  return [integration.identifier, integration._id, integration.id]
    .map((v) => text(v).toLowerCase())
    .some((v) => !!v && v === wanted);
}

/** Display name for the selected integration, for the summary sentence. */
function nameOf(integration: Record<string, unknown> | undefined, fallback: string): string {
  if (!integration) return fallback;
  return text(integration.name) || text(integration.identifier) || text(integration.providerId) || fallback;
}

/**
 * @param channelOf classifies a Novu integration row into a DIGIT channel (the Providers
 *                  screen passes a catalog-aware classifier; `rowChannel` is the legacy one).
 *                  `null` means the row sits on a Novu channel we do not deliver on at all
 *                  (in_app / push / chat) — it is NOT a provider for any channel, so a
 *                  selection pointing at one is a mismatch, never "delivering".
 * @param workflowIds Novu workflow ids, or null while unknown (treated as present).
 */
export function deriveChannelStatus(
  channel: Channel,
  row: ChannelRow | undefined,
  integrations: Array<Record<string, unknown>>,
  workflowIds: string[] | null,
  channelOf: (integration: Record<string, unknown>) => Channel | null,
): ChannelStatus {
  const enabled = !!row?.enabled && row?.active !== false;
  const gateway = String(row?.gateway || 'novu').toLowerCase();
  const direct = gateway === 'smscountry';
  const provider = text(row?.provider);
  const hasWorkflow = workflowIds === null ? true : workflowIds.includes(`complaints-${channel.toLowerCase()}`);

  const selectedIntegration = provider
    ? integrations.find((i) => pointsAt(i, provider))
    : undefined;
  const activeForChannel = integrations.filter(
    (i) => channelOf(i) === channel && i.active !== false,
  );
  // The selection points at something that serves NO DIGIT channel (a Novu
  // in_app / push / chat integration). It reads differently from "serves the
  // wrong channel", so the reason says which of the two it is.
  const notAProvider = !!selectedIntegration && channelOf(selectedIntegration) === null;

  let providerState: ProviderSelectionState;
  if (direct) providerState = 'not-applicable';
  else if (provider && !selectedIntegration) providerState = 'missing';
  else if (selectedIntegration && selectedIntegration.active === false) providerState = 'inactive';
  else if (selectedIntegration && channelOf(selectedIntegration) !== channel) providerState = 'mismatch';
  else if (selectedIntegration) providerState = 'ok';
  else if (activeForChannel.length > 0) providerState = 'unselected';
  else providerState = 'none';

  // A channel delivers through Novu when its selected provider is usable, or —
  // for a legacy row with no selection — when any active integration of the
  // channel exists, which is what the bridge falls back to.
  const hasIntegration = providerState === 'ok' || providerState === 'unselected';

  const reasons: string[] = [];
  if (!row) reasons.push('no NotificationChannel row — bridge falls back to its env allowlist');
  else if (!enabled) reasons.push('disabled in NotificationChannel');
  if (direct) {
    if (channel !== 'SMS') reasons.push('smscountry gateway carries SMS only');
    if (row && !row.senderId) reasons.push('no senderId for the SMSCountry gateway');
  } else {
    // Provider complaints only matter while the channel is on; a channel that is
    // switched off should not also nag about its provider selection.
    if (enabled) {
      if (providerState === 'missing') {
        reasons.push(`selected provider "${provider}" no longer exists — pick another provider for this channel`);
      } else if (providerState === 'inactive') {
        reasons.push(`selected provider "${provider}" is disabled — enable it or select another`);
      } else if (providerState === 'mismatch') {
        reasons.push(
          notAProvider
            ? `selected provider "${provider}" is not a ${channel} provider`
            : `selected provider "${provider}" does not serve ${channel}`,
        );
      } else if (providerState === 'none') {
        reasons.push('no active Novu integration for this channel');
      } else if (providerState === 'unselected') {
        reasons.push('no provider selected — delivery falls back to the deployment-wide settings; select one so this tenant decides');
      }
    } else if (providerState === 'none') {
      reasons.push('no active Novu integration for this channel');
    }
    if (!hasWorkflow) reasons.push(`Novu workflow complaints-${channel.toLowerCase()} not found`);
  }

  const effective = enabled && (direct ? channel === 'SMS' : hasIntegration && hasWorkflow);

  let verdict: ChannelVerdict;
  let summary: string;
  if (!row) {
    verdict = 'no-row';
    summary = `No channel policy row for ${channel}. The bridge falls back to its environment allowlist (usually off) — enable the channel to make the policy explicit.`;
  } else if (!enabled) {
    verdict = 'off';
    summary = `${channel} is off. Every event on this channel is recorded SKIPPED / NB_NO_PROVIDER and nothing is delivered.`;
  } else if (direct) {
    if (channel !== 'SMS') {
      verdict = 'gateway-incomplete';
      summary = `${channel} is on but points at the SMSCountry gateway, which carries SMS only.`;
    } else if (!row.senderId) {
      verdict = 'gateway-incomplete';
      summary = `${channel} is on through the direct SMSCountry gateway but has no sender ID, so the gateway will reject every message.`;
    } else {
      verdict = 'ok';
      summary = `${channel} is on and delivering through the direct SMSCountry gateway (sender ${row.senderId}). This legacy gateway bypasses Novu, so no provider is selected.`;
    }
  } else if (providerState === 'missing') {
    verdict = 'provider-missing';
    summary = `${channel} is on but its selected provider "${provider}" no longer exists, so every event on it is recorded SKIPPED / NB_PROVIDER_UNAVAILABLE and nothing is delivered. Pick another provider for this channel.`;
  } else if (providerState === 'inactive') {
    verdict = 'provider-inactive';
    summary = `${channel} is on but its selected provider "${nameOf(selectedIntegration, provider)}" is disabled, so every event on it is recorded SKIPPED / NB_PROVIDER_UNAVAILABLE and nothing is delivered. Enable that provider or select another one.`;
  } else if (providerState === 'mismatch') {
    verdict = 'provider-mismatch';
    summary = notAProvider
      ? `${channel} is on but its selected provider "${nameOf(selectedIntegration, provider)}" is not a ${channel} provider — it is a notification-service integration we do not deliver on — so every event on it is recorded SKIPPED / NB_PROVIDER_UNAVAILABLE. Select a ${channel} provider.`
      : `${channel} is on but its selected provider "${nameOf(selectedIntegration, provider)}" does not serve ${channel}, so every event on it is recorded SKIPPED / NB_PROVIDER_UNAVAILABLE. Select a ${channel} provider.`;
  } else if (providerState === 'none') {
    verdict = 'no-provider';
    summary = `${channel} is on but no provider is configured for it. Add one on the Providers screen, then select it here.`;
  } else if (providerState === 'unselected') {
    verdict = 'provider-unselected';
    summary = `${channel} is on but no provider is selected. Delivery currently falls back to the deployment-wide settings rather than this tenant's own choice — select a provider so it is explicit.`;
  } else if (!hasWorkflow) {
    verdict = 'no-workflow';
    summary = `${channel} is on with a working provider, but the Novu workflow complaints-${channel.toLowerCase()} is missing, so nothing can be dispatched.`;
  } else {
    verdict = 'ok';
    summary = `${channel} is on and delivering through ${nameOf(selectedIntegration, provider)}.`;
  }

  return {
    channel,
    row,
    enabled,
    gateway,
    provider,
    providerState,
    selectedIntegration,
    hasIntegration,
    hasWorkflow,
    effective,
    verdict,
    summary,
    reasons,
  };
}
