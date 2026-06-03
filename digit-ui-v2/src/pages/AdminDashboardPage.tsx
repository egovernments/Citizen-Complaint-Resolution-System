/**
 * /admin/dashboard — god-only platform-admin home.
 *
 * Two surfaces:
 *   - "Invite a tenant admin" form: email + tenantId → POSTs to the
 *     overlay's /platform-admin/scoped-admins/_invite. KC sends the
 *     invitee an email with a magic link that lands them on
 *     /admin/login?invited=true&email=… after they set their password.
 *   - List of existing scoped admins (one row per bootstrap:<tenant>
 *     role assignment) so the operator can see who's been invited and
 *     whether they've completed onboarding (email verified, required
 *     actions pending).
 *
 * Scoped-only admins who land here are immediately redirected to their
 * /admin/bootstrap wizard — they have no business sending invites.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { adminFetch, adminLogout, loadAdminSession } from '@/api/platformAdmin';

// Local Badge — the citizen UI doesn't ship one and pulling in shadcn's
// just for these three pages would inflate the build pointlessly.
function Badge({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'secondary' | 'outline';
}) {
  const styles: Record<string, string> = {
    default: 'bg-primary text-primary-foreground',
    secondary: 'bg-secondary text-secondary-foreground',
    outline: 'border border-input text-foreground',
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  );
}

interface ScopedAdmin {
  username: string;
  email: string;
  tenantId: string;
  role: string;
  emailVerified: boolean;
  requiredActions: string[];
  createdTimestamp?: number;
}

interface InviteResponse {
  username: string;
  email: string;
  tenantId: string;
  role: string;
  inviteSent: boolean;
  inviteError?: string;
  hint?: string;
  expiresAt?: string;
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();

  // Auth gate — god only
  const session = loadAdminSession();
  useEffect(() => {
    if (!session) {
      navigate('/admin/login', { replace: true });
      return;
    }
    if (session.scope.kind !== 'god') {
      navigate('/admin/bootstrap', { replace: true });
    }
  }, [navigate, session]);

  // Invite form state
  const [email, setEmail] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<InviteResponse | null>(null);

  // Scoped-admins list state
  const [admins, setAdmins] = useState<ScopedAdmin[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  async function refreshList() {
    setListLoading(true);
    setListError(null);
    try {
      const data = await adminFetch<{ scopedAdmins: ScopedAdmin[] }>(
        '/scoped-admins',
      );
      setAdmins(data.scopedAdmins || []);
    } catch (err) {
      setListError((err as Error).message);
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    if (session?.scope.kind === 'god') refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.scope.kind]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteResult(null);
    if (!email || !tenantId) {
      setInviteError('Email and tenant ID are required.');
      return;
    }
    setInviting(true);
    try {
      const res = await adminFetch<InviteResponse>('/scoped-admins/_invite', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          tenantId: tenantId.trim(),
        }),
      });
      setInviteResult(res);
      if (res.inviteSent) {
        setEmail('');
        setTenantId('');
        refreshList();
      }
    } catch (err) {
      setInviteError((err as Error).message);
    } finally {
      setInviting(false);
    }
  }

  function handleLogout() {
    adminLogout();
    navigate('/admin/login', { replace: true });
  }

  if (!session || session.scope.kind !== 'god') return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Platform admin</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-mono">{session.scope.username}</span>
          </p>
        </div>
        <Button variant="outline" onClick={handleLogout}>
          Sign out
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invite a tenant admin</CardTitle>
          <CardDescription>
            Sends a Keycloak set-password email. After the invitee completes
            it, they can sign in at /admin/login and bootstrap their tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Invitee email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@kisumu.go.ke"
                disabled={inviting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-tenant">Tenant ID</Label>
              <Input
                id="invite-tenant"
                type="text"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="ke.kisumu"
                disabled={inviting}
              />
            </div>
            <div className="md:col-span-2">
              {inviteError && (
                <Alert variant="destructive" className="mb-3">
                  <AlertDescription>{inviteError}</AlertDescription>
                </Alert>
              )}
              {inviteResult && (
                <Alert variant={inviteResult.inviteSent ? 'default' : 'destructive'} className="mb-3">
                  <AlertDescription>
                    {inviteResult.inviteSent
                      ? `Invite sent to ${inviteResult.email}. They'll receive an email with a set-password link, valid until ${inviteResult.expiresAt}.`
                      : `User ${inviteResult.username} created with role ${inviteResult.role}, but email failed: ${inviteResult.inviteError}${inviteResult.hint ? ' — ' + inviteResult.hint : ''}`}
                  </AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={inviting}>
                {inviting ? 'Sending…' : 'Send invite'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Tenant admins</CardTitle>
            <CardDescription>
              Existing scoped admins (one row per tenant assignment).
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={refreshList} disabled={listLoading}>
            {listLoading ? 'Loading…' : 'Refresh'}
          </Button>
        </CardHeader>
        <CardContent>
          {listError && (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{listError}</AlertDescription>
            </Alert>
          )}
          {!listLoading && admins.length === 0 && (
            <p className="text-sm text-muted-foreground">No tenant admins yet — send an invite above.</p>
          )}
          {admins.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Email / Username</th>
                    <th className="py-2 pr-4">Tenant</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((a) => (
                    <tr key={`${a.username}-${a.tenantId}`} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <div className="font-mono text-xs">{a.email || a.username}</div>
                        {a.email && a.username !== a.email && (
                          <div className="text-xs text-muted-foreground">{a.username}</div>
                        )}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{a.tenantId}</td>
                      <td className="py-2 pr-4">
                        {a.requiredActions.includes('UPDATE_PASSWORD') ? (
                          <Badge variant="secondary">Pending invite</Badge>
                        ) : a.emailVerified ? (
                          <Badge>Active</Badge>
                        ) : (
                          <Badge variant="outline">Email unverified</Badge>
                        )}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {a.createdTimestamp
                          ? new Date(a.createdTimestamp).toLocaleString()
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
