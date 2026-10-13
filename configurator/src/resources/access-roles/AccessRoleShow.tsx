import { DigitShow, MASTER_SCREEN_META } from '@/admin';
import { FieldSection, FieldRow, StatusChip } from '@/admin/fields';
import { useShowController } from 'ra-core';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Pencil, Shield } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { useMastersCapability } from '@/hooks/useMastersCapability';

/** Owner decision 2026-10-13: roles are edited in ONE place, the Role editor; the generic create / edit routes go there. */
export function RoleCreateRedirect() {
  return <Navigate to="/manage/access/roles/new" replace />;
}

export function RoleEditRedirect() {
  const { id } = useParams();
  return <Navigate to={`/manage/access/roles/${encodeURIComponent(id ?? '')}`} replace />;
}

export function AccessRoleShow() {
  const { record } = useShowController({ queryOptions: { meta: MASTER_SCREEN_META } });
  const { canEditResource } = useMastersCapability();

  return (
    <DigitShow
      title={record ? `Role: ${record.name ?? record.id}` : 'Access Role'}
      hasEdit={false /* one edit path: the Role editor (owner decision 2026-10-13) */}
    >
      {(rec: Record<string, unknown>) => (
        <div className="space-y-6">
          <Link to={`/manage/access/roles/${encodeURIComponent(String(rec.code ?? ''))}`} className={buttonVariants({ variant: 'default' })} data-testid="open-role-editor">
            {canEditResource('access-roles')
              ? <><Pencil className="mr-2 h-4 w-4" />Edit</>
              : <><Shield className="mr-2 h-4 w-4" />What it may do and see</>}
          </Link>
          <FieldSection title="Details">
            <FieldRow label="Code">{String(rec.code ?? '')}</FieldRow>
            <FieldRow label="Name">{String(rec.name ?? '')}</FieldRow>
            <FieldRow label="Description">{String(rec.description ?? '--')}</FieldRow>
            <FieldRow label="Status">
              <StatusChip value={rec._isActive} labels={{ true: 'Active', false: 'Inactive' }} />
            </FieldRow>
          </FieldSection>
        </div>
      )}
    </DigitShow>
  );
}
