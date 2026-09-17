// "Channels" card on the Notification Providers screen: the EFFECTIVE delivery state of
// each channel for this tenant, and why. Composes four reads the screen already has access
// to — the MDMS NotificationChannel policy (read at the STATE tenant, exactly where
// novu-bridge reads it), the Novu integrations list, the Novu workflow list, and the
// session tenant — so an operator no longer has to guess which of the switches is off.
//
// Writes go through the generic `notification-channel` MDMS resource. Because MDMS writes
// land in the SESSION tenant while the bridge reads at the STATE tenant, the toggles are
// disabled (with an explanation) when the session is scoped to a city.
import { useEffect, useMemo, useState } from 'react';
import { useCreate, useGetList, useRefresh, useUpdate } from 'ra-core';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { digitClient } from '@/providers/bridge';
import { useApp } from '../../App';
import { pullTemplates, rowChannel } from './providerApi';
import { CHANNELS, deriveChannelStatus, type ChannelRow, type ChannelStatus } from './channelStatus';

const RESOURCE = 'notification-channel';

export function ChannelStatusCard() {
  const { state } = useApp();
  const sessionTenant = String(state?.tenant ?? '');
  const stateTenant = String(digitClient.stateTenantId || sessionTenant.split('.')[0] || '');
  const scopedToCity = !!stateTenant && !!sessionTenant && sessionTenant !== stateTenant;
  const refresh = useRefresh();
  const [update] = useUpdate();
  const [create] = useCreate();
  const [busy, setBusy] = useState<string | null>(null);
  const [workflowIds, setWorkflowIds] = useState<string[] | null>(null);

  const { data: rows, isLoading: rowsLoading } = useGetList(RESOURCE, {
    pagination: { page: 1, perPage: 20 },
    sort: { field: 'code', order: 'ASC' },
    filter: stateTenant ? { __tenantId: stateTenant } : {},
  });
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

  const statuses = useMemo<ChannelStatus[]>(() => {
    const byCode = new Map<string, ChannelRow>();
    for (const r of (rows ?? []) as ChannelRow[]) byCode.set(String(r.code ?? '').toUpperCase(), r);
    return CHANNELS.map((ch) =>
      deriveChannelStatus(ch, byCode.get(ch), (integrations ?? []) as Array<Record<string, unknown>>, workflowIds, rowChannel),
    );
  }, [rows, integrations, workflowIds]);

  const toggle = async (s: ChannelStatus) => {
    setBusy(s.channel);
    try {
      if (s.row?.id) {
        const data = {
          code: s.channel,
          enabled: !s.enabled,
          gateway: s.row.gateway || 'novu',
          senderId: s.row.senderId ?? null,
          active: true,
        };
        await update(RESOURCE, { id: s.row.id, data, previousData: s.row }, { returnPromise: true });
      } else {
        await create(RESOURCE, { data: { code: s.channel, enabled: true, gateway: 'novu', senderId: null, active: true } }, { returnPromise: true });
      }
      refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Channels</CardTitle>
        <CardDescription>
          Effective delivery state per channel for <span className="font-mono">{stateTenant || '—'}</span>.
          Enabled here (MDMS <span className="font-mono">NotificationChannel</span>) <em>and</em> a working gateway
          = messages go out; otherwise every event on the channel is recorded SKIPPED / NB_NO_PROVIDER.
          SMS also carries login OTPs (and other DIGIT-core SMS) — disabling it disables OTP login.
          {scopedToCity && (
            <span className="block mt-1 text-amber-700">
              You are scoped to <span className="font-mono">{sessionTenant}</span>; channel policy is read at{' '}
              <span className="font-mono">{stateTenant}</span>. Switch to the state tenant to change it.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rowsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : (
          <div className="grid gap-2">
            {statuses.map((s) => (
              <div key={s.channel} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {s.effective ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : s.enabled ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                    ) : (
                      <XCircle className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">{s.channel}</span>
                    <Badge variant="outline" className="text-[10px]">{s.gateway}</Badge>
                    <Badge variant={s.effective ? 'success' : s.enabled ? 'warning' : 'outline'} className="text-[10px]">
                      {s.effective ? 'delivering' : s.enabled ? 'enabled, not deliverable' : 'off'}
                    </Badge>
                  </div>
                  {s.reasons.length > 0 && (
                    <ul className="mt-1 text-xs text-muted-foreground list-disc pl-5">
                      {s.reasons.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={s.enabled ? 'outline' : 'default'}
                  className="h-7 text-xs shrink-0"
                  disabled={scopedToCity || busy !== null}
                  onClick={() => toggle(s)}
                  title={scopedToCity ? 'Switch to the state tenant to change channel policy' : undefined}
                >
                  {busy === s.channel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : s.row ? (s.enabled ? 'Disable' : 'Enable') : 'Enable'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
