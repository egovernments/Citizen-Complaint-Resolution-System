import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Globe2, Loader2, ShieldCheck } from 'lucide-react';
import { useApp } from '@/App';
import { getConfiguredRootTenant } from '@/api';
import { mdmsService } from '@/api/services/mdms';
import { buildPublicDashboardUrl } from '@/api/publicDashboardConfig';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function PublicDashboardConfigure() {
  const { state } = useApp();
  const tenantId = getConfiguredRootTenant() || state.tenant.split('.')[0];
  const dashboardUrl = useMemo(
    () => buildPublicDashboardUrl(state.environment),
    [state.environment],
  );
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    mdmsService.getDashboardConfig(tenantId)
      .then((record) => {
        if (!cancelled) setEnabled(record?.data.publicDashboardEnabled === true);
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

  const setPublicAccess = async (nextEnabled: boolean) => {
    setSaving(true);
    setError(null);
    setWarning(null);
    setSavedMessage(null);
    try {
      await mdmsService.upsertDashboardConfig(tenantId, {
        publicDashboardEnabled: nextEnabled,
      });
      setEnabled(nextEnabled);
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
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not update DashboardConfig.');
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(dashboardUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the URL. Select it and copy it manually.');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading public dashboard settings…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
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

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Public URL</CardTitle>
              <CardDescription className="mt-2">
                Share this stable URL when public access is enabled.
              </CardDescription>
            </div>
            <Badge variant={enabled ? 'default' : 'secondary'}>
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={dashboardUrl} readOnly aria-label="Public dashboard URL" />
            <Button variant="outline" onClick={copyUrl}>
              {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              variant="outline"
              disabled={!enabled}
              onClick={() => window.open(dashboardUrl, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink /> Open
            </Button>
          </div>

          <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-foreground">
                {enabled ? 'Anonymous access is enabled' : 'Anonymous access is disabled'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                The switch is enforced by pgr-services before any public KPI catalog or query data is read.
              </p>
            </div>
            <Button
              variant={enabled ? 'destructive' : 'default'}
              disabled={saving}
              onClick={() => void setPublicAccess(!enabled)}
              className="shrink-0"
            >
              {saving ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              {saving ? 'Saving…' : enabled ? 'Disable public dashboard' : 'Enable public dashboard'}
            </Button>
          </div>

          <p className="text-xs leading-5 text-muted-foreground">
            Saving refreshes pgr-services immediately; the normal cache TTL is only a fallback.
            Missing or invalid configuration never enables anonymous data access.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
