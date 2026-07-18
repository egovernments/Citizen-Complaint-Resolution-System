import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { OrgNodeData } from './types';

function EmployeeNodeImpl({ data }: NodeProps) {
  const d = data as OrgNodeData;
  const navigate = useNavigate();
  const onOpen = () => {
    if (d.clickable) navigate(`/manage/employees/${d.id}/show`);
  };

  return (
    <div
      onClick={onOpen}
      className={cn(
        'w-[240px] rounded-md border bg-card p-3 shadow-sm text-left',
        d.clickable && 'cursor-pointer hover:border-primary',
        d.kind === 'unresolved' && 'border-dashed border-amber-500 bg-amber-50',
        d.kind === 'manager' && 'border-primary/40',
        d.inactive && 'opacity-60',
      )}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold truncate">{d.name}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {d.inactive && <Badge variant="secondary">Inactive</Badge>}
          {d.inCycle && <RefreshCw className="w-3.5 h-3.5 text-red-500" aria-label="in reporting cycle" />}
        </div>
      </div>
      {d.kind === 'unresolved' ? (
        <div className="mt-1 flex items-center gap-1 text-xs text-amber-700">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" /> user only — not an employee
        </div>
      ) : (
        <div className="mt-1 text-xs text-muted-foreground truncate">
          {[d.designation, d.department].filter(Boolean).join(' · ') || '—'}
          {d.code && <div className="text-[10px] mt-0.5 truncate">{d.code}</div>}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const EmployeeNode = memo(EmployeeNodeImpl);
