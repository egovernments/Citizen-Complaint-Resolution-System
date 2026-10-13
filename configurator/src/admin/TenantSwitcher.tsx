import { useEffect, useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import { useApp } from '../App';
import { digitClient } from '@/providers/bridge';
import { tenants as identityTenants } from '@/api/onboarding';
import { enterWorkspace } from '@/identity/entry';
import { adminHome, homeTenant, optionText, subtreeOptions, tenantLabel, type TenantRow } from './tenantSwitcher';

/**
 * ours (cfgreview F04, #1551): the header says which tenant you are working at (name and code) and lets an admin switch
 * to any active tenant below their home tenant.
 *  - Home: from the identity session's memberships (the highest tenant where they hold ACCOUNT_ADMIN / SUPERUSER);
 *    without an identity session, the tenant this browser first worked at.
 *  - Switch: with an identity session, contexts/_select (enterWorkspace) moves the server-side context and the token,
 *    then reloads; otherwise (or if the identity service refuses) the local session moves and /manage reloads.
 */
export function TenantSwitcher() {
  const { state, switchTenant } = useApp();
  const current = state.tenant;
  const user = state.user?.uuid || state.user?.email || state.user?.name || 'anonymous';
  const fallbackHome = useMemo(() => homeTenant(user, current), [user, current]);
  const [identity, setIdentity] = useState<{ home: string } | null>(null);
  const home = identity?.home ?? fallbackHome;
  const [rows, setRows] = useState<TenantRow[]>([]);

  useEffect(() => {
    let live = true;
    identityTenants()
      .then((r) => { const h = adminHome(r.tenants ?? []); if (live && h && (current === h || current.startsWith(`${h}.`))) setIdentity({ home: h }); })
      .catch(() => { /* no identity session (form / token sign-in): the local fallback applies */ });
    return () => { live = false; };
  }, [current]);

  useEffect(() => {
    let live = true;
    const root = home.split('.')[0];
    (async () => {
      const all: TenantRow[] = [];
      for (let offset = 0; offset < 20_000; offset += 500) {
        const page = await digitClient.mdmsSearch(root, 'tenant.tenants', { limit: 500, offset, isActive: true });
        all.push(...page.map((r) => r.data as TenantRow));
        if (page.length < 500) break;
      }
      if (live) setRows(all);
    })().catch(() => { /* the header still shows the code */ });
    return () => { live = false; };
  }, [home]);

  const options = useMemo(() => subtreeOptions(rows, home), [rows, home]);
  const name = tenantLabel(options, current);
  const go = (code: string) => {
    if (code === current) return;
    if (identity) enterWorkspace(code).catch(() => switchTenant(code));
    else switchTenant(code);
  };

  return (
    <label className="flex min-w-0 items-center gap-1.5 text-sm" data-testid="tenant-switcher">
      <Building2 className="hidden h-4 w-4 flex-shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
      <span className="sr-only">Working at</span>
      {options.length > 1 ? (
        <select
          aria-label="Working at tenant"
          className="w-[8.5rem] min-w-0 truncate rounded-md border bg-background px-2 py-1 text-sm sm:w-auto sm:max-w-[16rem]"
          value={current}
          onChange={(e) => go(e.target.value)}
        >
          {options.map((o) => <option key={o.code} value={o.code}>{optionText(o)}</option>)}
        </select>
      ) : (
        <span className="max-w-[8.5rem] truncate sm:max-w-[16rem]" title={current}>
          <span className="font-medium">{name}</span>
          <span className="ml-1 hidden font-mono text-xs text-muted-foreground sm:inline">{current}</span>
        </span>
      )}
    </label>
  );
}
