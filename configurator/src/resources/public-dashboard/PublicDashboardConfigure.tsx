import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Check, CheckCircle2, Copy, ExternalLink, Gauge, Globe2, Loader2, MapPin, XCircle,
} from 'lucide-react';
import { useApp } from '@/App';
import { getConfiguredRootTenant } from '@/api';
import { mdmsService } from '@/api/services/mdms';
import {
  buildPublicDashboardUrl,
  describeDisabledBy,
  formatPublishedDate,
  type DashboardConfigData,
} from '@/api/publicDashboardConfig';
import {
  PUBLIC_DASHBOARD_KPIS,
  PUBLIC_DASHBOARD_PREVIEW_TILES,
  type PreviewTile,
} from './kpiCatalog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/** Which pane of the access dialog is showing (CCRS#1883). */
type AccessDialogStage = 'status' | 'confirmDisable';

const SPAN_CLASS: Record<PreviewTile['span'], string> = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'sm:col-span-3',
  4: 'sm:col-span-4',
};

/**
 * One tile of the static preview. Renders the tile's frame and label only — the
 * bars are inert placeholders, not data. Product scoped this pass to "preview
 * the dashboard as it appears to its users"; wiring real values needs the public
 * catalog read and is parked for a later release.
 */
function PreviewTileCard({ tile }: { tile: PreviewTile }) {
  return (
    <div className={`rounded-lg border bg-card p-3 ${SPAN_CLASS[tile.span]}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        {/* Icon tracks the tile's shape, as in the prototype: gauge for a single
            measure, bars for a chart, pin for the map. */}
        {tile.kind === 'metric' && <Gauge className="h-4 w-4 text-muted-foreground" />}
        {tile.kind === 'chart' && <BarChart3 className="h-4 w-4 text-muted-foreground" />}
        {tile.kind === 'map' && <MapPin className="h-4 w-4 text-muted-foreground" />}
        {tile.label}
      </div>
      {tile.kind === 'metric' && (
        <div className="mt-3 space-y-2" aria-hidden="true">
          <div className="h-3 w-16 rounded bg-muted" />
          <div className="h-2 w-10 rounded bg-muted/70" />
        </div>
      )}
      {tile.kind === 'chart' && (
        <div className="mt-3 flex h-24 items-end gap-1.5" aria-hidden="true">
          {[45, 70, 35, 85, 55, 75, 40, 90].map((h, i) => (
            <div key={i} className="flex-1 rounded-sm bg-primary/20" style={{ height: `${h}%` }} />
          ))}
        </div>
      )}
      {tile.kind === 'map' && (
        <div
          className="mt-3 flex h-24 items-center justify-center rounded bg-muted/50 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          Map region
        </div>
      )}
    </div>
  );
}

export default function PublicDashboardConfigure() {
  const { state } = useApp();
  const tenantId = getConfiguredRootTenant() || state.tenant.split('.')[0];
  const dashboardUrl = useMemo(
    () => buildPublicDashboardUrl(state.environment),
    [state.environment],
  );

  // The whole record, not just the switch: the Last published tile and the
  // disabled-by attribution both read fields that live alongside it.
  const [config, setConfig] = useState<Partial<DashboardConfigData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogStage, setDialogStage] = useState<AccessDialogStage>('status');

  const enabled = config?.publicDashboardEnabled === true;
  const lastPublished = formatPublishedDate(config?.lastPublishedAt);
  const disabledNotice = describeDisabledBy(config);

  useEffect(() => {
    let cancelled = false;
    mdmsService.getDashboardConfig(tenantId)
      .then((record) => {
        if (!cancelled) setConfig((record?.data as Partial<DashboardConfigData>) ?? {});
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load DashboardConfig.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  const setPublicAccess = useCallback(async (nextEnabled: boolean) => {
    setSaving(true);
    setError(null);
    setWarning(null);
    setSavedMessage(null);

    // Stamp who/when on the transition itself. Turning it back ON clears the
    // disabled attribution so the notice can never outlive the state it
    // describes; turning it OFF records the actor for that notice.
    const actor = (state.user?.name || state.user?.email || '').trim();
    const now = Date.now();
    const patch: Partial<DashboardConfigData> = nextEnabled
      ? { publicDashboardEnabled: true, lastPublishedAt: now, disabledBy: '', disabledAt: 0 }
      : { publicDashboardEnabled: false, disabledBy: actor, disabledAt: now };

    try {
      await mdmsService.upsertDashboardConfig(tenantId, patch);
      setConfig((prev) => ({ ...(prev ?? {}), ...patch }));
      try {
        const applied = await mdmsService.refreshDashboardConfig(tenantId);
        if (applied !== nextEnabled) {
          throw new Error('pgr-services returned a different switch state.');
        }
        setSavedMessage(
          nextEnabled
            ? 'Public dashboard enabled and available at the URL above.'
            : 'Public dashboard disabled. Anonymous queries are now blocked.',
        );
      } catch (refreshCause: unknown) {
        const detail = refreshCause instanceof Error ? refreshCause.message : 'cache refresh failed';
        setWarning(`DashboardConfig was saved, but immediate refresh failed (${detail}). The change will apply within the normal five-minute cache window.`);
      }
      setDialogOpen(false);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not update DashboardConfig.');
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }, [state.user?.name, state.user?.email, tenantId]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(dashboardUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the URL. Select it and copy it manually.');
    }
  };

  const openAccessDialog = () => {
    setDialogStage('status');
    setDialogOpen(true);
  };

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading public dashboard settings…
      </div>
    );
  }

  /** URL + access controls; rendered under both tabs, as in the prototype. */
  const publicAccessCard = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe2 className="h-5 w-5 text-muted-foreground" /> Public access
        </CardTitle>
        <CardDescription>
          {enabled ? 'Publicly available.' : 'Not publicly available.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Public URL
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={dashboardUrl} readOnly aria-label="Public dashboard URL" />
            <Button variant="outline" onClick={copyUrl} className="shrink-0">
              {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button
              variant="outline"
              disabled={!enabled}
              onClick={() => window.open(dashboardUrl, '_blank', 'noopener,noreferrer')}
              className="shrink-0"
            >
              <ExternalLink /> Open public dashboard
            </Button>
          </div>
          {disabledNotice && (
            <p className="mt-2 text-sm text-muted-foreground" data-testid="disabled-attribution">
              {disabledNotice}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={openAccessDialog}
          className="text-sm text-primary underline underline-offset-4 hover:text-primary/80"
        >
          Manage public access
        </button>
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <Globe2 className="h-7 w-7 text-primary" />
          <h1 className="font-condensed text-2xl font-bold text-foreground sm:text-3xl">
            Public dashboard
          </h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Control credential-free access for the <strong>{tenantId}</strong> state tenant.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Unable to update public dashboard</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {savedMessage && (
        <Alert variant="success" aria-live="polite">
          <Check className="h-4 w-4" />
          <AlertTitle>DashboardConfig saved</AlertTitle>
          <AlertDescription>{savedMessage}</AlertDescription>
        </Alert>
      )}
      {warning && (
        <Alert variant="warning" aria-live="polite">
          <AlertTitle>DashboardConfig saved with delayed propagation</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}

      {/* Status strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Assigned role
            </p>
            <p className="mt-1 text-lg font-medium text-foreground">Public</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </p>
            <div className="mt-2">
              <Badge variant={enabled ? 'default' : 'secondary'} className="gap-1">
                {enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {enabled ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Last published
            </p>
            {/* Deployments that were switched on before this shipped have no
                recorded timestamp; an em dash is honest, a guess would not be. */}
            <p className="mt-1 text-lg font-medium text-foreground">{lastPublished ?? '—'}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-6">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="kpis">KPIs</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Dashboard preview</CardTitle>
              <CardDescription>Preview the dashboard as it appears to its users.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-4">
                {PUBLIC_DASHBOARD_PREVIEW_TILES.map((tile) => (
                  <PreviewTileCard key={tile.label} tile={tile} />
                ))}
              </div>
            </CardContent>
          </Card>
          {publicAccessCard}
        </TabsContent>

        <TabsContent value="kpis" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>KPIs</CardTitle>
              <CardDescription>
                Review the measures used in this dashboard and their definitions.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>KPI</TableHead>
                    <TableHead>What it measures</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Refresh</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PUBLIC_DASHBOARD_KPIS.map((kpi) => (
                    <TableRow key={kpi.name}>
                      <TableCell className="font-medium text-foreground">{kpi.name}</TableCell>
                      <TableCell className="text-muted-foreground">{kpi.measures}</TableCell>
                      <TableCell className="text-muted-foreground">{kpi.source}</TableCell>
                      <TableCell className="text-muted-foreground">{kpi.refresh}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {publicAccessCard}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saving) setDialogOpen(open); }}>
        <DialogContent className="sm:max-w-lg">
          {dialogStage === 'status' ? (
            <>
              <DialogHeader>
                <DialogTitle>Public dashboard status</DialogTitle>
                <DialogDescription>
                  Anyone with this link can view the dashboard without signing in.
                </DialogDescription>
              </DialogHeader>
              <div>
                <Badge variant={enabled ? 'default' : 'secondary'} className="gap-1">
                  {enabled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {enabled ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <DialogFooter>
                {enabled ? (
                  // Destructive direction gets a confirmation step.
                  <Button
                    variant="outline"
                    disabled={saving}
                    onClick={() => setDialogStage('confirmDisable')}
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    Turn off public dashboard
                  </Button>
                ) : (
                  // Re-enabling is one click by design — it is the safe direction.
                  <Button disabled={saving} onClick={() => void setPublicAccess(true)}>
                    {saving ? <Loader2 className="animate-spin" /> : null}
                    {saving ? 'Saving…' : 'Turn on public dashboard'}
                  </Button>
                )}
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Turn off public dashboard?</DialogTitle>
                <DialogDescription>
                  The Citizen Dashboard will no longer be accessible through its public URL.
                  Existing links will stop working until public access is enabled again.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                {/* Safe choice is the primary action, per the approved prototype. */}
                <Button disabled={saving} onClick={() => setDialogStage('status')}>
                  Keep dashboard active
                </Button>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => void setPublicAccess(false)}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  {saving ? <Loader2 className="animate-spin" /> : null}
                  {saving ? 'Saving…' : 'Turn off public dashboard'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
