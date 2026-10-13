import { useEffect, useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import { useApp } from '../App';
import { digitClient } from '@/providers/bridge';
import { homeTenant, subtreeOptions, tenantLabel, type TenantRow } from './tenantSwitcher';

/**
 * ours (cfgreview F04, #1551): the header says which tenant you are working at (name and code) and lets an admin switch
 * to any active tenant below their home tenant. Switching reloads /manage at the new tenant.
 */
export function TenantSwitcher() {
  const { state, switchTenant } = useApp();
  const current = state.tenant;
  const user = state.user?.uuid || state.user?.email || state.user?.name || 'anonymous';
  const home = useMemo(() => homeTenant(user, current), [user, current]);
  const [rows, setRows] = useState<TenantRow[]>([]);

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

  return (
    <label className="flex min-w-0 items-center gap-1.5 text-sm" data-testid="tenant-switcher">
      <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Working at</span>
      {options.length > 1 ? (
        <select
          aria-label="Working at tenant"
          className="max-w-[14rem] truncate rounded-md border bg-background px-2 py-1 text-sm"
          value={current}
          onChange={(e) => { if (e.target.value !== current) switchTenant(e.target.value); }}
        >
          {options.map((o) => (
            <option key={o.code} value={o.code}>{`${'  '.repeat(o.depth)}${o.name} (${o.code})`}</option>
          ))}
        </select>
      ) : (
        <span className="truncate" title={current}>
          <span className="font-medium">{name}</span>
          <span className="ml-1 hidden font-mono text-xs text-muted-foreground sm:inline">{current}</span>
        </span>
      )}
    </label>
  );
}
