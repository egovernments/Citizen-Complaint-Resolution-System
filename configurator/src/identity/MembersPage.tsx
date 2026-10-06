import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '@/App';
import { members, linkMember, updateMemberEmail, type Member } from './api';
import { requiredEmail } from './memberActions';
import { hrmsService } from '@/api/services/hrms';
import type { Employee } from '@/api/types';
import { removeEmployee } from '@/onboarding/employees/employeesApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function MembersPage() {
  const { state } = useApp();
  const [rows, setRows] = useState<Member[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Member | null>(null);
  const [emailMember, setEmailMember] = useState<Member | null>(null);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [linkEmployee, setLinkEmployee] = useState<Employee | null>(null);
  const [linkEmail, setLinkEmail] = useState('');
  const admin = state.user?.roles.includes('ACCOUNT_ADMIN');
  const load = useCallback(async () => {
    if (!admin) return;
    const [bindings, staff] = await Promise.all([members(state.tenant), hrmsService.searchEmployees(state.tenant, { limit: 500 })]);
    setRows(bindings); setEmployees(staff);
  }, [state.tenant, admin]);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); setConfirm(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Member action failed.'); }
    finally { setBusy(false); }
  };
  return <main className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
    <Link to="/">Back to workspace</Link><h1 className="text-2xl font-semibold">Members</h1>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
    {!admin ? <p>Workspace administrator access is required.</p> : <>
      <Link to="/manage/employees/create">Create and invite an employee</Link>
      <Button variant="outline" disabled={busy} onClick={() => void run(load)}>Refresh members</Button>
      {employees.filter(e => e.isActive !== false && !rows.some(row => row.digitUuid === (e.user.uuid || e.uuid))).map(e => <section key={e.uuid || e.code} className="flex flex-col gap-2">
        <p>{e.user.name} — invitation not linked</p>
        <Button variant="outline" disabled={busy || (e.user.uuid || e.uuid) === state.user?.uuid} onClick={() => { setLinkEmployee(e); setLinkEmail(e.user.emailId || ''); }}>Complete invitation for {e.code}</Button>
      </section>)}
      {linkEmployee && <form className="flex flex-col gap-3" onSubmit={event => {
        event.preventDefault(); void run(async () => {
          await linkMember(state.tenant, linkEmployee.user.uuid || linkEmployee.uuid!, requiredEmail(linkEmail));
          setLinkEmployee(null);
        });
      }}>
        <Label htmlFor="link-email">Invitation email for {linkEmployee.code}</Label>
        <Input id="link-email" type="email" required value={linkEmail} onChange={e => setLinkEmail(e.target.value)} />
        <Button disabled={busy} type="submit">Send invitation</Button>
        <Button disabled={busy} type="button" variant="outline" onClick={() => setLinkEmployee(null)}>Cancel</Button>
      </form>}
      {rows.map(row => <section key={row.digitUuid} className="flex flex-col gap-2" aria-label={row.name || row.email}>
        <h2 className="font-semibold">{row.name || row.email}</h2><p>{row.email} — {row.state}{row.missing ? ' (employee record missing)' : ''}</p>
        {row.expiresAt && <p>Invitation expires {new Date(row.expiresAt).toLocaleString()}</p>}
        <div className="flex gap-2">
          {row.state === 'pending' && <Button variant="outline" disabled={busy} onClick={() => void run(() => linkMember(state.tenant, row.digitUuid, row.email, true))}>Reinvite</Button>}
          <Button variant="outline" disabled={busy || row.digitUuid === state.user?.uuid} onClick={() => setConfirm(row)}>Remove member</Button>
          {row.state === 'active' && <Button variant="outline" disabled={busy} onClick={() => { setEmailMember(row); setEmail(''); }}>Change email</Button>}
        </div>
      </section>)}
      {emailMember && <form className="flex flex-col gap-3" onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          await updateMemberEmail(state.tenant, emailMember.digitUuid, requiredEmail(email));
          setNotice('Verification sent. The employee must verify the new address before their HRMS email changes.');
          setEmailMember(null); setEmail('');
        });
      }}>
        <Label htmlFor="member-email">New email for {emailMember.name || emailMember.email}</Label>
        <Input id="member-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        <Button disabled={busy} type="submit">Send verification</Button>
        <Button disabled={busy} type="button" variant="outline" onClick={() => setEmailMember(null)}>Cancel</Button>
      </form>}
      {confirm && <Alert><AlertDescription>
        <p>Deactivate {confirm.name || confirm.email} and remove their workspace access?</p>
        <div className="mt-3 flex gap-2"><Button variant="destructive" disabled={busy} onClick={() => void run(async () => {
          const employees = await hrmsService.searchEmployees(state.tenant, { uuids: [confirm.digitUuid] });
          const employee = employees.find(e => (e.user.uuid || e.uuid) === confirm.digitUuid);
          if (!employee) throw new Error('Employee record not found. An administrator must resolve the missing HRMS record.');
          await removeEmployee(employee);
        })}>Confirm removal</Button><Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button></div>
      </AlertDescription></Alert>}
    </>}
  </main>;
}
