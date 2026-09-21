// "Channels" card on the Notification Providers screen: the EFFECTIVE delivery state of
// each channel for this tenant, said in words, plus the one decision that drives it —
// which provider is active for the channel.
//
// It composes four reads the screen already has — the MDMS NotificationChannel policy
// (read at the STATE tenant, exactly where novu-bridge reads it), the provider catalog,
// the integrations list and the Novu workflow list — so an operator no longer has to
// guess which of the switches is off.
//
// The active provider is the `provider` field on the channel row: the integration's
// identifier. Exactly one per channel per state tenant, no automatic failover. `gateway`
// stays visible for legacy rows (a direct gateway such as smscountry bypasses Novu and
// takes no provider) but is no longer how a provider is chosen.
//
// Writes go through the generic `notification-channel` MDMS resource. Because MDMS writes
// land in the SESSION tenant while the bridge reads at the STATE tenant, the controls are
// disabled (with an explanation) when the session is scoped to a city.
import { useEffect, useMemo, useState } from 'react';
import { useCreate, useGetList, useRefresh, useTranslate, useUpdate } from 'ra-core';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { pullTemplates } from './providerApi';
import {
  integrationChannel, providerChoicesForChannel, type IntegrationRow,
} from './providerCatalog';
import { CHANNELS, deriveChannelStatus, type ChannelRow, type ChannelStatus } from './channelStatus';
import { CHANNEL_RESOURCE, useChannelRows } from './useChannelRows';
import type { ProviderCatalogState } from './useProviderCatalog';
import { notify } from './providerToast';

/** Sentinel for "no provider selected" — Radix Select rejects an empty string value. */
const NONE = '__none__';

export function ChannelStatusCard({ catalogState }: { catalogState: ProviderCatalogState }) {
  const t = useTranslate();
  // The catalog is loaded once by the Providers screen and handed down, so the
  // card and the Add dialog never hit /providers/catalog twice.
  const { catalog } = catalogState;

  const { rows, isLoading: rowsLoading, sessionTenant, stateTenant, scopedToCity, decision, readOnly: sourceReadOnly } = useChannelRows();
  // Two independent reasons this card may be read-only, and they mean different
  // things to the operator: `scopedToCity` is "you, here, cannot write the state
  // tenant", `sourceReadOnly` is "this tenant's policy still lives in the legacy
  // master and must be copied first". Both disable the controls; both say why.
  const locked = scopedToCity || sourceReadOnly;
  const refresh = useRefresh();
  const [update] = useUpdate();
  const [create] = useCreate();
  const [busy, setBusy] = useState<string | null>(null);
  const [workflowIds, setWorkflowIds] = useState<string[] | null>(null);

  const { data: integrations } = useGetList('notification-provider', {
    pagination: { page: 1, perPage: 100 },
    sort: { field: 'channel', order: 'ASC' },
  });

  useEffect(() => {
    let alive = true;
    pullTemplates('', '')
      .then((r) => { if (alive) setWorkflowIds(r.data.map((w) => w.workflowId)); })
      .catch(() => { if (alive) setWorkflowIds([]); });
    return () => { alive = false; };
  }, []);

  const integrationRows = useMemo(() => (integrations ?? []) as unknown as IntegrationRow[], [integrations]);

  const statuses = useMemo<ChannelStatus[]>(() => {
    const byCode = new Map<string, ChannelRow>();
    for (const r of rows) byCode.set(String(r.code ?? '').toUpperCase(), r);
    const channelOf = (i: Record<string, unknown>) => integrationChannel(i as IntegrationRow, catalog);
    return CHANNELS.map((ch) =>
      deriveChannelStatus(ch, byCode.get(ch), integrationRows as unknown as Array<Record<string, unknown>>, workflowIds, channelOf),
    );
  }, [rows, integrationRows, workflowIds, catalog]);

  /** Persist a channel row, creating it if the tenant has none yet. */
  const save = async (s: ChannelStatus, patch: Partial<ChannelRow>) => {
    // Belt as well as braces: the controls are disabled, but a stale render or a
    // keyboard path must not slip a write into the legacy master or into a
    // tenant this session may not write.
    if (locked) {
      notify(
        t('app.channels.msg_read_only', { _: 'Channel policy is read-only here.' }),
        decision.message || undefined,
        'destructive',
      );
      return;
    }
    setBusy(s.channel);
    try {
      const data: Record<string, unknown> = {
        code: s.channel,
        enabled: s.enabled,
        gateway: s.row?.gateway || 'novu',
        senderId: s.row?.senderId ?? null,
        provider: s.row?.provider ?? null,
        active: true,
        ...patch,
      };
      if (s.row?.id) {
        await update(CHANNEL_RESOURCE, { id: s.row.id, data, previousData: s.row }, { returnPromise: true });
      } else {
        await create(CHANNEL_RESOURCE, { data }, { returnPromise: true });
      }
      refresh();
    } catch (err) {
      notify(
        t('app.channels.msg_save_failed', { _: 'Could not save the channel policy.' }),
        (err as Error)?.message,
        'destructive',
      );
    } finally {
      setBusy(null);
    }
  };

  const toggle = (s: ChannelStatus) => save(s, { enabled: s.row ? !s.enabled : true });
  const selectProvider = (s: ChannelStatus, value: string) =>
    save(s, { provider: value === NONE ? null : value });

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('app.channels.title', { _: 'Channels' })}</CardTitle>
        <CardDescription>
          {t('app.channels.hint', {
            _: 'One active provider per channel. A channel delivers when it is switched on here AND its selected provider is enabled; otherwise every event on it is recorded SKIPPED / NB_NO_PROVIDER.',
          })}{' '}
          {t('app.channels.sms_otp_note', {
            _: 'SMS also carries login OTPs — switching it off disables OTP login.',
          })}{' '}
          <span className="block mt-1">
            {t('app.channels.read_at', { _: 'Policy is read at' })}{' '}
            <span className="font-mono">{stateTenant || '—'}</span>.
          </span>
          {sourceReadOnly && (
            <span className="block mt-1 text-amber-700">{decision.message}</span>
          )}
          {scopedToCity && (
            <span className="block mt-1 text-amber-700">
              {t('app.channels.scoped_warning', { _: 'You are scoped to' })}{' '}
              <span className="font-mono">{sessionTenant}</span>;{' '}
              {t('app.channels.scoped_warning_2', { _: 'switch to the state tenant to change channel policy.' })}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rowsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> {t('app.list.loading', { _: 'Loading...' })}
          </div>
        ) : (
          <div className="grid gap-2">
            {statuses.map((s) => {
              const choices = providerChoicesForChannel(integrationRows, s.channel, catalog);
              const selectable = s.providerState !== 'not-applicable';
              // A selection pointing at a deleted/disabled integration is not in `choices`;
              // keep it in the list so the operator sees what is currently stored.
              const orphan = s.provider && !choices.some((c) => c.value.toLowerCase() === s.provider.toLowerCase());
              return (
                <div key={s.channel} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {s.effective ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : s.enabled ? (
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium">{s.channel}</span>
                      {s.gateway !== 'novu' && (
                        <Badge variant="outline" className="text-[10px]" title={t('app.channels.legacy_gateway', { _: 'Legacy direct gateway — bypasses the notification service' })}>
                          {s.gateway}
                        </Badge>
                      )}
                      <Badge variant={s.effective ? 'success' : s.enabled ? 'warning' : 'outline'} className="text-[10px]">
                        {s.effective
                          ? t('app.channels.state_delivering', { _: 'delivering' })
                          : s.enabled
                            ? t('app.channels.state_not_deliverable', { _: 'on, not deliverable' })
                            : t('app.channels.state_off', { _: 'off' })}
                      </Badge>
                    </div>
                    {/* The state in plain words — the card's whole point. The verdict is a
                        stable id, so a locale can override the sentence; the English one
                        derived in channelStatus.ts is the default. */}
                    <p className="text-xs text-muted-foreground">
                      {t(`app.channels.verdict.${s.verdict.replace(/-/g, '_')}`, { _: s.summary, channel: s.channel, provider: s.provider })}
                    </p>
                    {s.reasons.length > 0 && (
                      <ul className="text-xs text-muted-foreground list-disc pl-5">
                        {s.reasons.map((r) => <li key={r}>{r}</li>)}
                      </ul>
                    )}
                    {selectable && (
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-xs text-muted-foreground">
                          {t('app.channels.active_provider', { _: 'Active provider' })}
                        </span>
                        <Select
                          value={s.provider || NONE}
                          onValueChange={(v) => selectProvider(s, v)}
                          disabled={locked || busy !== null}
                        >
                          <SelectTrigger className="h-7 w-[260px] text-xs">
                            <SelectValue placeholder={t('app.channels.no_provider', { _: 'None selected' })} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>{t('app.channels.no_provider', { _: 'None selected' })}</SelectItem>
                            {choices.map((c) => (
                              <SelectItem key={c.value} value={c.value}>
                                {c.label}{c.typeLabel ? ` · ${c.typeLabel}` : ''}
                              </SelectItem>
                            ))}
                            {orphan && (
                              <SelectItem value={s.provider}>
                                {s.provider} · {t('app.channels.provider_unavailable', { _: 'unavailable' })}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        {choices.length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            {t('app.channels.no_providers_for_channel', { _: 'No enabled provider for this channel yet — add one above.' })}
                          </span>
                        )}
                      </div>
                    )}
                    {!selectable && (
                      <p className="text-xs text-muted-foreground">
                        {t('app.channels.direct_gateway_note', {
                          _: 'This channel uses a direct gateway configured by sender ID, so no provider is selected for it.',
                        })}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={s.enabled ? 'outline' : 'default'}
                    className="h-7 text-xs shrink-0"
                    disabled={locked || busy !== null}
                    onClick={() => toggle(s)}
                    title={
                      sourceReadOnly
                        ? t('app.channels.legacy_tooltip', { _: 'This tenant\'s channel policy is still in the legacy master — run the notification seed step to copy it' })
                        : scopedToCity
                          ? t('app.channels.scoped_tooltip', { _: 'Switch to the state tenant to change channel policy' })
                          : undefined
                    }
                  >
                    {busy === s.channel
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : s.enabled
                        ? t('app.channels.disable', { _: 'Disable' })
                        : t('app.channels.enable', { _: 'Enable' })}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
