import { useGetManyReference } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronRight } from 'lucide-react';

interface ReverseReferenceListProps {
  resource: string;
  target: string;
  id: string;
  label: string;
  displayField?: string;
  limit?: number;
}

export function ReverseReferenceList({ resource, target, id, label, displayField = 'name', limit = 5 }: ReverseReferenceListProps) {
  const navigate = useNavigate();
  const { data, total, isPending } = useGetManyReference(
    resource,
    { target, id, pagination: { page: 1, perPage: limit }, sort: { field: displayField, order: 'ASC' }, filter: {} },
    { enabled: !!id }
  );

  if (isPending) return <div className="text-sm text-muted-foreground animate-pulse">Loading {label}...</div>;
  if (!data || data.length === 0) return <div className="text-sm text-muted-foreground">No {label.toLowerCase()} found</div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <Badge variant="secondary" className="text-xs">{total}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {data.map((record) => (
          <Badge
            key={record.id}
            variant="outline"
            className="cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors text-xs"
            onClick={() => navigate(`/manage/${resource}/${encodeURIComponent(record.id)}`)}
          >
            {String((record as Record<string, unknown>)[displayField] ?? record.id)}
          </Badge>
        ))}
        {total != null && total > limit && (
          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground"
            onClick={() => navigate(`/manage/${resource}`)}>
            +{total - limit} more <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
