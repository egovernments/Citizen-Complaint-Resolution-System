import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { useApp } from '../../App';
import { digitClient, getResourceConfig } from '@/providers/bridge';
import { countyOverrides, boundaryTreeOverrides, countyScopedKey, isCountyScoped } from '@digit-mcp/data-provider';
import { enterWorkspace } from '@/identity/entry';
import { listNotice, recordNotice, recordPath, rememberLanding, takeLanding, treeNotice, type OverrideTenant } from './overrideText';

/**
 * ours (#1945): at a STATE ROOT, a county-scoped master's row (or the boundary tree) that a county overrides with its
 * own is not what that county's apps use: an edit here reaches no one there. Say so, and link to the county's own
 * record (Working at = the county). Renders nothing below the state, for shared masters, and where nothing is
 * overridden (digit-3 today: the state root holds no rows of these masters).
 */
export function CountyOverrideNotice({ resource, record, rows }: { resource?: string; record?: Record<string, unknown>; rows?: Record<string, unknown>[] }) {
  const { state, switchTenant } = useApp();
  const tenant = state.tenant;
  const config = resource ? getResourceConfig(resource) : undefined;
  const schema = config?.schema;
  const atState = !!tenant && !tenant.includes('.');
  const isTree = config?.type === 'boundary';
  const wanted = atState && !!resource && (isTree || isCountyScoped(schema));
  const [byKey, setByKey] = useState<Map<string, OverrideTenant[]> | null>(null);
  const [tree, setTree] = useState<{ type: string; tenants: OverrideTenant[] }[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    (async () => {
      if (isTree) {
        const defs: Record<string, unknown>[] = await digitClient.boundaryHierarchySearch(tenant);
        const types: string[] = defs.map((h) => String(h.hierarchyType ?? '')).filter((t) => t !== '');
        const out: { type: string; tenants: OverrideTenant[] }[] = [];
        for (const t of [...new Set(types)]) {
          const tenants = await boundaryTreeOverrides(digitClient, tenant, t);
          if (tenants.length) out.push({ type: t, tenants });
        }
        if (live) setTree(out);
      } else if (schema) {
        const m = await countyOverrides(digitClient, tenant, schema);
        if (live) setByKey(m);
      }
    })().catch(() => { /* the notice is advisory: a failed read shows none */ });
    return () => { live = false; };
  }, [wanted, isTree, schema, tenant]);

  if (!wanted) return null;

  const open = (t: OverrideTenant) => {
    if (resource && t.uniqueIdentifier) rememberLanding(recordPath(resource, t));
    enterWorkspace(t.tenantId).catch(() => switchTenant(t.tenantId));
  };
  const box = (body: ReactNode) => (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
      role="status" data-testid="county-override-notice">
      <Layers className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0">{body}</div>
    </div>
  );
  const links = (tenants: OverrideTenant[], what: string) => (
    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
      {tenants.map((t) => (
        <button key={t.tenantId} type="button" className="font-medium underline underline-offset-2" data-testid="county-override-link"
          data-tenant={t.tenantId} onClick={() => open(t)}>
          Open {t.name}&apos;s {what}
        </button>
      ))}
    </span>
  );

  if (isTree) {
    if (!tree.length) return null;
    return box(tree.map((x) => (
      <p key={x.type}>{treeNotice(x.tenants, x.type)} {links(x.tenants, 'boundaries')}</p>
    )));
  }
  if (!byKey || !schema || byKey.size === 0) return null;

  if (record) {
    const key = countyScopedKey(schema, { uniqueIdentifier: record._uniqueIdentifier ?? record.id, data: record });
    const tenants = byKey.get(key);
    if (!tenants?.length) return null;
    return box(<><p>{recordNotice(tenants)}</p>{links(tenants, 'record')}</>);
  }

  const here = (rows ?? []).filter((r) => (r._tenantId ?? tenant) === tenant);
  const hit = here.filter((r) => byKey.has(countyScopedKey(schema, { uniqueIdentifier: r._uniqueIdentifier ?? r.id, data: r })));
  if (!hit.length) return null;
  return box(
    <>
      <p>{listNotice(hit.length, here.length)}</p>
      <ul className="mt-1 list-disc pl-5">
        {hit.slice(0, 8).map((r) => {
          const key = countyScopedKey(schema, { uniqueIdentifier: r._uniqueIdentifier ?? r.id, data: r });
          const tenants = byKey.get(key) ?? [];
          return (
            <li key={String(r.id)}>
              <button type="button" className="underline underline-offset-2" onClick={() => navigate(`/manage/${resource}/${encodeURIComponent(String(r.id))}/show`)}>{key}</button>
              {' '}&middot; overridden in {tenants.map((t) => t.name).join(', ')}
            </li>
          );
        })}
        {hit.length > 8 && <li>and {hit.length - 8} more</li>}
      </ul>
    </>,
  );
}

/** Mounted once in the layout: after a switch to a county from the notice, open the county's record. */
export function AfterSwitchLanding() {
  const navigate = useNavigate();
  useEffect(() => {
    const p = takeLanding();
    if (p) navigate(p, { replace: true });
  }, [navigate]);
  return null;
}
