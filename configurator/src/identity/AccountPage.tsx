import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authMethods, logout, session, type AuthMethod, type Session } from '@/api/onboarding';
import { signOutThisDevice } from '@/lib/session';
import { accountAction, unlinkProvider } from './api';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuthResult } from '@/hooks/useAuthResult';

export default function AccountPage() {
  const [current, setCurrent] = useState<Session | null>(null);
  const [methods, setMethods] = useState<AuthMethod[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const result = useAuthResult();
  const load = useCallback(async () => {
    const value = await session(undefined, true);
    setCurrent(value);
    if (value.authenticated) setMethods((await authMethods('signin')).methods);
  }, []);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Account action failed.'); }
    finally { setBusy(false); }
  };
  const signOut = async (scope: 'others' | 'all') => {
    if (scope === 'others') { await logout(scope); return; }
    // This device is signed out locally either way; only a confirmed BFF
    // sign-out means the other devices are too.
    if (!await signOutThisDevice(scope)) throw new Error('Signing out everywhere could not be confirmed. Other devices may still be signed in. Try again.');
    window.location.assign('/configurator/login');
  };
  const actions = current?.account?.actions ?? [];
  return <main className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
    <Link to="/">Back to workspace</Link><h1 className="text-2xl font-semibold">Your account</h1>
    {(error || result.error || result.result?.message) && <Alert><AlertDescription>{error || result.error || result.result?.message}</AlertDescription></Alert>}
    {!current ? <p>Loading account…</p> : !current.authenticated ? <Link to="/login">Sign in to manage your account</Link> : <>
      <p>{current.user?.email}</p>
      <section aria-label="Sign-in methods" className="flex flex-col gap-3">
        {([['UPDATE_PASSWORD', 'Set or change password'], ['CONFIGURE_TOTP', 'Set up authenticator'], ['UPDATE_EMAIL', 'Change email']] as const).map(([action, label]) =>
          actions.includes(action) && <Button key={action} variant="outline" onClick={() => accountAction(action)}>{label}</Button>)}
        {actions.includes('delete_credential') && current.account?.credentials.filter(c => ['otp', 'webauthn'].includes(c.type)).map(c =>
          <Button key={c.id} variant="outline" onClick={() => accountAction('delete_credential', { credentialId: c.id })}>Remove second factor: {c.label || c.type}</Button>)}
        {actions.includes('idp_link') && methods.filter(m => m.type === 'idp' && m.idpHint && !current.account?.providers.some(p => p.alias === m.idpHint)).map(m =>
          <Button key={m.id} variant="outline" onClick={() => accountAction('idp_link', { provider: m.idpHint })}>Link {m.label}</Button>)}
        {current.account?.providers.map(p => <Button key={p.alias} disabled={busy} variant="outline" onClick={() => void run(() => unlinkProvider(p.alias))}>Unlink {p.alias}</Button>)}
      </section>
      <section aria-label="Signed-in sessions" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Signed-in sessions</h2>
        <ul>{current.sessions?.map(s => <li key={s.id}>{s.surface}{s.current ? ' (this session)' : ''} — last used {new Date(s.lastSeenAt).toLocaleString()}</li>)}</ul>
        <Button disabled={busy} variant="outline" onClick={() => void run(() => signOut('others'))}>Sign out other sessions</Button>
        <Button disabled={busy} variant="destructive" onClick={() => void run(() => signOut('all'))}>Sign out everywhere</Button>
      </section>
    </>}
  </main>;
}
