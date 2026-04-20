interface DateFieldProps {
  value: unknown;
  showTime?: boolean;
}

export function DateField({ value, showTime = true }: DateFieldProps) {
  if (value == null) return <span className="text-muted-foreground">--</span>;
  const timestamp = typeof value === 'number' ? value : Number(value);
  if (isNaN(timestamp)) return <span className="text-muted-foreground">{String(value)}</span>;
  const date = new Date(timestamp);
  const formatted = showTime
    ? date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : date.toLocaleDateString('en-IN', { dateStyle: 'medium' });
  return <span className="text-sm">{formatted}</span>;
}
