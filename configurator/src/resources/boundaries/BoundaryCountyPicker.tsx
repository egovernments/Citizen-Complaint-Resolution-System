import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useApp } from '../../App';
import { digitClient } from '@/providers/bridge';
import { countiesOf } from '@digit-mcp/data-provider';
import { tenants as identityTenants } from '@/api/onboarding';
import { openAtTenant } from '@/admin/afterSwitch';
import { asksForCounty, enterableCounties, type County } from './countyPicker';

/**
 * ours (#1954, owner 2026-10-15): at a state whose boundaries live in its counties, "Which county's boundaries?".
 * Choosing a county enters it (that county's own session context, as the header switcher does) and opens its
 * Boundaries, where list, create and edit work on its own tree. Only the counties the admin can enter are listed.
 * Returns null (the screen as before) below the state or at a state without counties.
 */
export function useStateCounties(): { asks: boolean; counties: County[]; loading: boolean } {
  const { state } = useApp();
  const tenant = state.tenant;
  const [all, setAll] = useState<County[] | null>(null);
  const [memberships, setMemberships] = useState<unknown[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!tenant || tenant.includes('.')) { setAll([]); return; }
    countiesOf(digitClient, tenant).then((c) => { if (live) setAll(c); }).catch(() => { if (live) setAll([]); });
    identityTenants()
      .then((r) => { if (live) setMemberships(r.tenants ?? []); })
      .catch(() => { if (live) setMemberships(null); });
    return () => { live = false; };
  }, [tenant]);
  const loading = all === null || memberships === undefined;
  const counties = loading ? [] : enterableCounties(all!, memberships as never);
  return { asks: !loading && asksForCounty(tenant, all ?? []), counties, loading };
}

export function BoundaryCountyPicker({ counties }: { counties: County[] }) {
  const { switchTenant } = useApp();
  return (
    <div className="rounded-lg border bg-white p-4" data-testid="boundary-county-picker">
      <h2 className="text-base font-semibold">Which county&apos;s boundaries?</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Each county keeps its own boundary tree, and its apps use only that one. Choose a county to add or change its
        boundaries.
      </p>
      {counties.length ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {counties.map((c) => (
            <li key={c.code}>
              <button type="button" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                data-testid="boundary-county-option" data-tenant={c.code}
                onClick={() => openAtTenant(c.code, '/manage/boundaries', switchTenant)}>
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm">You cannot work in any county here. Ask an administrator for a role in one.</p>
      )}
    </div>
  );
}
