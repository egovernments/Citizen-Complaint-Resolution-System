import { useState, useRef } from 'react';
import { useGetList } from 'ra-core';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/primitives/select';
import { Loader2 } from 'lucide-react';

export interface ReferenceSelectProps {
  /** The react-admin resource to fetch choices from (e.g. 'departments', 'roles') */
  reference: string;
  /** Current value (the ID/code of the selected record) */
  value: string;
  /** Called when user selects a new value */
  onSave: (value: string) => Promise<void> | void;
  /** Field on the referenced record to display as label. Default: 'name' */
  displayField?: string;
  /** Open the dropdown immediately on mount */
  initialOpen?: boolean;
  /** Called when the dropdown closes without saving */
  onCancel?: () => void;
}

export function ReferenceSelect({
  reference,
  value,
  onSave,
  displayField = 'name',
  initialOpen = false,
  onCancel,
}: ReferenceSelectProps) {
  const [open, setOpen] = useState(initialOpen);
  const [saving, setSaving] = useState(false);
  const hasInteracted = useRef(false);

  const { data, isPending } = useGetList(reference, {
    pagination: { page: 1, perPage: 200 },
    sort: { field: displayField, order: 'ASC' },
  });

  const handleValueChange = async (newValue: string) => {
    if (newValue === value) {
      setOpen(false);
      onCancel?.();
      return;
    }
    setSaving(true);
    try {
      await onSave(newValue);
    } catch {
      // Error handling is done by the parent (DigitDatagrid shows toast/error)
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen && hasInteracted.current) {
      // Dropdown closed without selection — treat as cancel
      onCancel?.();
    }
    hasInteracted.current = true;
  };

  if (isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <Select
      value={value}
      onValueChange={handleValueChange}
      open={open}
      onOpenChange={handleOpenChange}
      disabled={saving}
    >
      <SelectTrigger className="h-8 text-sm">
        <SelectValue placeholder="Select..." />
      </SelectTrigger>
      <SelectContent>
        {data?.map((record) => {
          const id = String(record.id);
          const label = String((record as Record<string, unknown>)[displayField] ?? id);
          return (
            <SelectItem key={id} value={id}>
              {label}
            </SelectItem>
          );
        })}
        {(!data || data.length === 0) && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No options</div>
        )}
      </SelectContent>
    </Select>
  );
}
