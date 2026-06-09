/**
 * /admin/login — platform-admin login (KC master realm).
 *
 * Two personas land here:
 *   - The god admin (preferred_username=admin or PLATFORM_ADMIN role) →
 *     /admin/dashboard for sending invites.
 *   - A scoped admin (bootstrap:<tenantId> role), typically arriving from
 *     an email invite with ?invited=true&email=… → /admin/bootstrap for
 *     their tenant.
 *
 * Auth: KC master realm password grant via admin-cli client (the only
 * built-in client that allows direct grants on master).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { adminLogin, loadAdminSession } from '@/api/platformAdmin';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const invited = params.get('invited') === 'true';
  const emailHint = params.get('email') || '';

  const [username, setUsername] = useState(emailHint);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already logged in, fast-forward
  useEffect(() => {
    const s = loadAdminSession();
    if (!s) return;
    navigate(s.scope.kind === 'god' ? '/admin/dashboard' : '/admin/bootstrap', {
      replace: true,
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username || !password) {
      setError('Username and password are required.');
      return;
    }
    setPending(true);
    try {
      const { scope } = await adminLogin(username.trim(), password);
      navigate(scope.kind === 'god' ? '/admin/dashboard' : '/admin/bootstrap', {
        replace: true,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Platform admin</CardTitle>
          <CardDescription>
            {invited
              ? "Welcome — you've just been invited to administer a tenant. Sign in with the password you just set to continue to your bootstrap wizard."
              : 'Sign in to send tenant-admin invites or to bootstrap a tenant.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Email or username</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin or you@example.com"
                disabled={pending}
                autoFocus={!emailHint}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={pending}
                autoFocus={!!emailHint}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
