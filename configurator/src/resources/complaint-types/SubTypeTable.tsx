import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { StatusChip } from '@/admin/fields';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import type { SubTypeRecord } from './groupComplaintTypes';

interface SubTypeTableProps {
  subTypes: SubTypeRecord[];
  /** Soft-deletes the sub-type. Rejecting surfaces the error inside the dialog. */
  onDelete: (record: SubTypeRecord) => Promise<void>;
}

export function SubTypeTable({ subTypes, onDelete }: SubTypeTableProps) {
  const navigate = useNavigate();
  // Deleting the only remaining sub-type empties (and thus removes) the type.
  const isLastSubType = subTypes.length === 1;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-muted-foreground">
          <th className="px-3 py-2 font-medium">Sub-Type</th>
          <th className="px-3 py-2 font-medium">Service Code</th>
          <th className="px-3 py-2 font-medium">Department</th>
          <th className="px-3 py-2 font-medium">SLA</th>
          <th className="px-3 py-2 font-medium">Status</th>
          <th className="px-3 py-2 font-medium text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {subTypes.map((s) => {
          const label = s.name ?? s.serviceName ?? '--';
          const id = encodeURIComponent(String(s.id));
          return (
            <tr
              key={String(s.id)}
              onClick={() => navigate(`/manage/complaint-types/${id}/show`)}
              className="cursor-pointer border-t border-border hover:bg-muted/40"
            >
              <td className="px-3 py-2">{label}</td>
              <td className="px-3 py-2 font-mono text-xs text-primary">{s.serviceCode}</td>
              <td className="px-3 py-2">{s.department ?? '--'}</td>
              <td className="px-3 py-2">{s.slaHours != null ? `${s.slaHours}h` : '--'}</td>
              <td className="px-3 py-2">
                <StatusChip value={s.active} labels={{ true: 'Active', false: 'Inactive' }} />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/manage/complaint-types/${id}`);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <DeleteConfirmDialog
                    title="Delete Sub-Type"
                    itemName={label}
                    description={
                      isLastSubType
                        ? `"${label}" is the last sub-type of this complaint type. Deleting it will remove the entire complaint type. This action cannot be undone.`
                        : undefined
                    }
                    onConfirm={() => onDelete(s)}
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${label}`}
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    }
                  />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
