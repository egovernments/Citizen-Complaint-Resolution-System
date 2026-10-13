import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMastersCapability } from '@/hooks/useMastersCapability';
import { digitClient } from '@/providers/bridge';
import { useApp } from '../../App';
import { ACTIONS, ROLEACTIONS, searchAll } from '@/access/roleEditorData';
import { canDoByRole } from '@/access/canDo';

/** The role list's "Can do" summary: role-actions and actions read once at the root (cfgreview 2026-10-13). */
function useCanDo(): Map<string, string[]> | null | 'error' {
  const { state } = useApp();
  const root = state.tenant.split('.')[0];
  const [m, setM] = useState<Map<string, string[]> | null | 'error'>(null);
  useEffect(() => {
    let live = true;
    Promise.all([searchAll(digitClient as never, root, ACTIONS), searchAll(digitClient as never, root, ROLEACTIONS)])
      .then(([acts, grants]) => {
        const actions = acts.map((r) => ({ id: Number(r.data.id), url: String(r.data.url ?? '') })).filter((a) => Number.isFinite(a.id));
        if (live) setM(canDoByRole(actions, grants.filter((g) => g.isActive !== false).map((g) => g.data as never)));
      })
      .catch(() => live && setM('error'));
    return () => { live = false; };
  }, [root]);
  return m;
}

export function AccessRoleList() {
  const { canEditResource } = useMastersCapability();
  const navigate = useNavigate();
  const canDo = useCanDo();
  const columns: DigitColumn[] = useMemo(() => [
    { source: 'code', label: 'app.fields.code' },
    { source: 'name', label: 'app.fields.name' },
    {
      source: 'canDo', label: 'Can do', sortable: false,
      render: (r) => {
        if (canDo === null) return <span className="text-muted-foreground">...</span>;
        if (canDo === 'error') return <span className="text-muted-foreground">-</span>;
        const caps = canDo.get(String(r.code ?? r.id)) ?? [];
        return caps.length ? <span data-testid="role-can-do">{caps.join(' / ')}</span> : <span className="text-muted-foreground">No complaint access</span>;
      },
    },
    { source: 'description', label: 'app.fields.description' },
  ], [canDo]);
  return (
    <DigitList
      title="app.resources.access_roles"
      hasCreate={canEditResource('access-roles')}
      // a new role is made in the Role editor: name, grants, scope and field rules together
      onCreate={() => navigate('/manage/access/roles/new')}
      sort={{ field: 'code', order: 'ASC' }}
    >
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
