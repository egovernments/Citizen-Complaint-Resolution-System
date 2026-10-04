import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '@/App';
import { ApiClientError } from '@/api/client';
import { clearTranslationCache } from '@/providers/i18nProvider';
import { announceOrganisation, useOrganisation } from '@/onboarding/organisation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { invitationPolicy, renameWorkspace, saveInvitationPolicy, searchWorkspace, type RenameRequest, type WorkspaceView } from './workspace';

function restoreRequest(key: string, tenantId: string): RenameRequest | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    return value?.tenantId === tenantId && typeof value.name === 'string' && Number.isInteger(value.version) ? value : null;
  } catch { return null; }
}

export default function WorkspacePage() {
  const { state } = useApp();
  const tenantId = state.tenant;
  const org = useOrganisation(tenantId);
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [name, setName] = useState('');
  const [hours, setHours] = useState('336');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [poll, setPoll] = useState(0);
  const requestKey = `configurator:rename:${state.user?.uuid}:${tenantId}`;
  const request = useRef<RenameRequest | null>(restoreRequest(requestKey, tenantId));
  const acceptedId = useRef<string | null>(null);
  const [retry, setRetry] = useState(!!request.current);
  const clearRequest = () => {
    request.current = null; acceptedId.current = null; setRetry(false);
    try { sessionStorage.removeItem(requestKey); } catch { /* memory still works */ }
  };
  const canAdmin = state.user?.roles.includes('ACCOUNT_ADMIN');
  const canEditPolicy = state.user?.roles.includes('MDMS_ADMIN');

  useEffect(() => {
    if (!canAdmin) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await searchWorkspace(tenantId);
        if (!live) return;
        setView(next);
        if (next.Rename?.status === 'PENDING') timer = setTimeout(refresh, 2000);
        else if (next.Rename?.status === 'DONE') {
          // Rename.version is historical; only Workspace.version drives new writes.
          setNotice(`Workspace name updated to ${next.Rename.name}.`);
          clearTranslationCache();
          announceOrganisation({ name: next.Rename.name, logoUrl: org.logoUrl });
          // An older completed operation must not discard an ambiguous new request.
          // After a reload, replay the saved original body to recover its operation id.
          if (acceptedId.current === next.Rename.id) clearRequest();
        }
      } catch (e) {
        if (live) { setError(e instanceof Error ? e.message : 'Could not load workspace.'); timer = setTimeout(refresh, 5000); }
      }
    };
    void refresh();
    return () => { live = false; clearTimeout(timer); };
    // Logo is display metadata, not a reason to restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, canAdmin, poll]);
  useEffect(() => {
    if (!canEditPolicy) return;
    let live = true;
    void invitationPolicy(tenantId).then(row => {
      if (live && row) setHours(String(row.data.invitationExpiryHours ?? 336));
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [tenantId, canEditPolicy]);

  const rename = async () => {
    if (!view || (!request.current && !name.trim())) return;
    setBusy(true); setError(null); setNotice(null);
    request.current ??= { tenantId, name: name.trim(), version: view.Workspace.version };
    try { sessionStorage.setItem(requestKey, JSON.stringify(request.current)); } catch { /* memory still works */ }
    try {
      const operation = await renameWorkspace(request.current);
      acceptedId.current = operation.id;
      if (operation.status === 'DONE') clearRequest();
      setView(value => value ? { ...value, Rename: operation } : value);
      setRetry(false); setPoll(value => value + 1);
      setNotice(operation.status === 'PENDING' ? 'Name change accepted. Waiting for publication…' : `Workspace name updated to ${operation.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not request name change.');
      // Deterministic refusals did not accept this request. Network/503 failures
      // may have committed; retain the original body for an exact replay.
      const rejected = e instanceof ApiClientError && [400, 401, 403, 409].includes(e.statusCode);
      if (rejected) { clearRequest(); setPoll(value => value + 1); }
      else setRetry(true);
    } finally { setBusy(false); }
  };
  return <main className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
    <Link to="/">Back to workspace</Link><h1 className="text-2xl font-semibold">Workspace settings</h1>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
    {canAdmin && <section className="flex flex-col gap-3" aria-label="Workspace name">
      <Label htmlFor="workspace-name">Workspace name</Label>
      <p>Current name: {org.name}</p>
      <Input id="workspace-name" value={name} placeholder={org.name} disabled={busy || retry || view?.Rename?.status === 'PENDING'} onChange={e => setName(e.target.value)} />
      <Button disabled={busy || !view || (!retry && (!name.trim() || view.Rename?.status === 'PENDING'))} onClick={() => void rename()}>{retry ? 'Retry name change' : 'Change workspace name'}</Button>
      {view?.Rename?.status === 'PENDING' && <p role="status">Publishing {view.Rename.name}…{view.Rename.lastErrorCode ? ' Publication is delayed; it will retry automatically.' : ''}</p>}
    </section>}
    {canEditPolicy && <form className="flex flex-col gap-3" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(null);
      try { await saveInvitationPolicy(tenantId, Number(hours)); setNotice('Invitation expiry saved. New invitations will use this duration.'); }
      catch (e) { setError(e instanceof Error ? e.message : 'Could not save invitation expiry.'); }
      finally { setBusy(false); }
    }}>
      <Label htmlFor="invitation-hours">Invitation expiry (hours)</Label>
      <Input id="invitation-hours" type="number" min={1} max={2160} step={1} required value={hours} onChange={e => setHours(e.target.value)} />
      <p className="text-sm text-muted-foreground">1 hour to 90 days. Default: 336 hours (14 days).</p>
      <Button disabled={busy} type="submit">Save invitation expiry</Button>
    </form>}
    {!canAdmin && !canEditPolicy && <p>Your role cannot change workspace settings.</p>}
  </main>;
}
