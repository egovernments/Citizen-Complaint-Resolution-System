/**
 * /admin/bootstrap — scoped tenant-admin wizard.
 *
 * Landing page for invitees right after they complete the email
 * UPDATE_PASSWORD flow and sign in at /admin/login. Their JWT carries
 * a bootstrap:<tenantId> role; this page reads it, confirms the tenant,
 * and lets them bootstrap with one click.
 *
 * God admins are NOT redirected away — they may legitimately want to
 * use this wizard to bootstrap a tenant after granting themselves the
 * role. The wizard accepts both scopes and shows the active tenant.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { adminFetch, adminLogout, loadAdminSession } from '@/api/platformAdmin';

function Badge({
  children,
  variant = 'default',
  className = '',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'outline';
  className?: string;
}) {
  const styles: Record<string, string> = {
    default: 'bg-primary text-primary-foreground',
    outline: 'border border-input text-foreground',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${styles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

interface BootstrapSummary {
  schemas_copied: number;
  schemas_skipped: number;
  schemas_failed: number;
  data_copied: number;
  localizations_copied: number;
  admin_user_provisioned: boolean;
}

interface BootstrapResult {
  success: boolean;
  source: string;
  target: string;
  summary?: BootstrapSummary;
  adminUser?: { username?: string; password?: string; provisioned?: boolean; error?: string };
}

export default function AdminBootstrapPage() {
  const navigate = useNavigate();
  const session = loadAdminSession();

  useEffect(() => {
    if (!session) navigate('/admin/login', { replace: true });
  }, [navigate, session]);

  // Default source tenant — most deployments copy from "ke" (the live
  // root). Operators can override.
  const [sourceTenant, setSourceTenant] = useState('ke');

  // Scoped admins are locked to their tenant; god can pick anything.
  const isGod = session?.scope.kind === 'god';
  const lockedTenant = !isGod && session?.scope.kind === 'scoped' ? session.scope.tenantId : '';
  const [targetTenant, setTargetTenant] = useState(lockedTenant);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BootstrapResult | null>(null);

  function handleLogout() {
    adminLogout();
    navigate('/admin/login', { replace: true });
  }

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!targetTenant) {
      setError('Target tenant is required.');
      return;
    }
    setRunning(true);
    try {
      const res = await adminFetch<BootstrapResult>('/v1/tenant/bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          target_tenant: targetTenant.trim(),
          source_tenant: sourceTenant.trim(),
        }),
      });
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (!session) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Bootstrap your tenant</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-mono">{session.scope.username}</span>{' '}
            <Badge variant="outline" className="ml-1">
              {session.scope.kind === 'god' ? 'god' : `scoped: ${session.scope.tenantId}`}
            </Badge>
          </p>
        </div>
        <Button variant="outline" onClick={handleLogout}>
          Sign out
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provision a new tenant</CardTitle>
          <CardDescription>
            Copies schemas, MDMS data, localizations, and (when possible) an
            ADMIN user from the source tenant into your new tenant. Idempotent —
            safe to re-run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleBootstrap} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="target">Target tenant</Label>
              <Input
                id="target"
                type="text"
                value={targetTenant}
                onChange={(e) => setTargetTenant(e.target.value)}
                placeholder="ke.kisumu"
                disabled={!isGod || running}
                readOnly={!isGod}
              />
              {!isGod && (
                <p className="text-xs text-muted-foreground">
                  Your invite limits you to this tenant.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="source">Source tenant (template)</Label>
              <Input
                id="source"
                type="text"
                value={sourceTenant}
                onChange={(e) => setSourceTenant(e.target.value)}
                placeholder="ke"
                disabled={running}
              />
              <p className="text-xs text-muted-foreground">
                Schemas + reference data are copied from here. Default <span className="font-mono">ke</span>.
              </p>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={running || !targetTenant}>
              {running ? 'Bootstrapping… (up to 90s)' : 'Bootstrap tenant'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Bootstrap result</CardTitle>
            <CardDescription>
              Target: <span className="font-mono">{result.target}</span> from{' '}
              <span className="font-mono">{result.source}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result.summary && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Stat label="Schemas copied" value={result.summary.schemas_copied} />
                <Stat label="Schemas skipped" value={result.summary.schemas_skipped} />
                <Stat label="Schemas failed" value={result.summary.schemas_failed} warn={result.summary.schemas_failed > 0} />
                <Stat label="Data records" value={result.summary.data_copied} />
                <Stat label="Localizations" value={result.summary.localizations_copied} />
                <Stat
                  label="Admin user"
                  value={result.summary.admin_user_provisioned ? 'OK' : 'Failed'}
                  warn={!result.summary.admin_user_provisioned}
                />
              </div>
            )}
            {result.adminUser?.provisioned && result.adminUser.username && (
              <Alert className="mt-4">
                <AlertDescription>
                  ADMIN user <span className="font-mono">{result.adminUser.username}</span> created.
                  {result.adminUser.password && (
                    <>
                      {' '}Temporary password:{' '}
                      <span className="font-mono">{result.adminUser.password}</span>
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {result.adminUser?.error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>
                  Admin user not provisioned: {result.adminUser.error}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${warn ? 'text-destructive' : ''}`}>{value}</div>
    </div>
  );
}
