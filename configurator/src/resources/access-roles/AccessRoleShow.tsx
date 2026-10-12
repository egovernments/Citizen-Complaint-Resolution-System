import { DigitShow, MASTER_SCREEN_META } from '@/admin';
import { FieldSection, FieldRow, StatusChip } from '@/admin/fields';
import { useShowController } from 'ra-core';
import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { useMastersCapability } from '@/hooks/useMastersCapability';

export function AccessRoleShow() {
  const { record } = useShowController({ queryOptions: { meta: MASTER_SCREEN_META } });
  const { canEditResource } = useMastersCapability();

  return (
    <DigitShow
      title={record ? `Role: ${record.name ?? record.id}` : 'Access Role'}
      hasEdit={canEditResource('access-roles')}
    >
      {(rec: Record<string, unknown>) => (
        <div className="space-y-6">
          <Link to={`/manage/access/roles/${encodeURIComponent(String(rec.code ?? ''))}`} className={buttonVariants({ variant: 'default' })} data-testid="open-role-editor">
            <Shield className="mr-2 h-4 w-4" />What it may do and see (Role editor)
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
