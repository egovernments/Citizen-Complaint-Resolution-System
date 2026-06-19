import { useNavigate } from 'react-router-dom';
import { StatusChip } from '@/admin/fields';
import type { SubTypeRecord } from './groupComplaintTypes';

interface SubTypeTableProps {
  subTypes: SubTypeRecord[];
}

export function SubTypeTable({ subTypes }: SubTypeTableProps) {
  const navigate = useNavigate();

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-muted-foreground">
          <th className="px-3 py-2 font-medium">Sub-Type</th>
          <th className="px-3 py-2 font-medium">Service Code</th>
          <th className="px-3 py-2 font-medium">Department</th>
          <th className="px-3 py-2 font-medium">SLA</th>
          <th className="px-3 py-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {subTypes.map((s) => (
          <tr
            key={String(s.id)}
            onClick={() =>
              navigate(
                `/manage/complaint-types/${encodeURIComponent(String(s.id))}/show`,
              )
            }
            className="cursor-pointer border-t border-border hover:bg-muted/40"
          >
            <td className="px-3 py-2">{s.name ?? '--'}</td>
            <td className="px-3 py-2 font-mono text-xs text-primary">
              {s.serviceCode}
            </td>
            <td className="px-3 py-2">{s.department ?? '--'}</td>
            <td className="px-3 py-2">
              {s.slaHours != null ? `${s.slaHours}h` : '--'}
            </td>
            <td className="px-3 py-2">
              <StatusChip
                value={s.active}
                labels={{ true: 'Active', false: 'Inactive' }}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
