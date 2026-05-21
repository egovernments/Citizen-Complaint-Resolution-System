// src/components/ui/EntityLink.tsx
import { useGetOne } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import { Badge } from './badge';
import { getResourceConfig } from '@/providers/bridge';

interface EntityLinkProps {
  /** react-admin resource name (e.g. "departments") */
  resource: string;
  /** The ID value to look up (e.g. "DEPT_5") */
  id: string;
  /** Optional: override the display label */
  label?: string;
}

export function EntityLink({ resource, id, label }: EntityLinkProps) {
  const navigate = useNavigate();
  const config = getResourceConfig(resource);
  const nameField = config?.nameField ?? 'name';

  const { data, isPending, error } = useGetOne(
    resource,
    { id },
    { enabled: !!id && !!resource }
  );

  if (!id) return <span className="text-muted-foreground">--</span>;

  const displayName = label
    ?? (data ? String((data as Record<string, unknown>)[nameField] ?? id) : undefined);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/manage/${resource}/${encodeURIComponent(id)}`);
  };

  return (
    <Badge
      variant="outline"
      className="cursor-pointer hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors text-xs font-medium"
      onClick={handleClick}
    >
      {isPending ? (
        <span className="animate-pulse">{id}</span>
      ) : error ? (
        <span>{id}</span>
      ) : (
        <span>{displayName}</span>
      )}
    </Badge>
  );
}
