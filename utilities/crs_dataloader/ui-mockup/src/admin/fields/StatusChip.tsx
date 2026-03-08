import { Badge } from '@/components/ui/badge';

const STATUS_COLORS: Record<string, string> = {
  PENDINGFORASSIGNMENT: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  PENDINGATLME: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  PENDINGFORREASSIGNMENT: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  RESOLVED: 'bg-green-100 text-green-800 border-green-200',
  REJECTED: 'bg-red-100 text-red-800 border-red-200',
  CLOSEDAFTERRESOLUTION: 'bg-blue-100 text-blue-800 border-blue-200',
  EMPLOYED: 'bg-green-100 text-green-800 border-green-200',
  INACTIVE: 'bg-gray-100 text-gray-600 border-gray-200',
  true: 'bg-green-100 text-green-800 border-green-200',
  false: 'bg-gray-100 text-gray-600 border-gray-200',
  Active: 'bg-green-100 text-green-800 border-green-200',
  Inactive: 'bg-gray-100 text-gray-600 border-gray-200',
};

interface StatusChipProps {
  value: unknown;
  labels?: Record<string, string>;
}

export function StatusChip({ value, labels }: StatusChipProps) {
  if (value == null) return <span className="text-muted-foreground">--</span>;
  const strValue = String(value);
  const displayText = labels?.[strValue] ?? strValue;
  const colorClass = STATUS_COLORS[strValue] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <Badge variant="outline" className={`text-xs ${colorClass}`}>
      {displayText}
    </Badge>
  );
}
