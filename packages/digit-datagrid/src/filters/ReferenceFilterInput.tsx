import React, { useCallback, useMemo } from 'react';
import { useInput, useGetList } from 'ra-core';
import type { InputProps } from 'ra-core';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../primitives/select';

const ALL_VALUE = '__all__';

export interface ReferenceFilterInputProps extends InputProps {
  label?: string;
  reference: string;
  displayField?: string;
}

export function ReferenceFilterInput({
  source,
  label,
  reference,
  displayField = 'name',
  ...rest
}: ReferenceFilterInputProps) {
  const { field, id } = useInput({ source, ...rest });

  const pagination = useMemo(() => ({ page: 1, perPage: 100 }), []);
  const sort = useMemo(
    () => ({ field: displayField, order: 'ASC' as const }),
    [displayField]
  );
  const { data, isPending } = useGetList(reference, { pagination, sort });

  const handleChange = useCallback(
    (value: string) => {
      field.onChange(value === ALL_VALUE ? '' : value);
    },
    [field.onChange]
  );

  const choices = (data ?? []).map((record: Record<string, unknown>) => ({
    id: String(record.id),
    name: String(record[displayField] ?? record.id),
  }));

  return (
    <Select value={field.value || ''} onValueChange={handleChange}>
      <SelectTrigger id={id} className="h-8 text-sm w-44">
        <SelectValue placeholder={isPending ? 'Loading...' : label || source} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE} className="text-muted-foreground">
          All
        </SelectItem>
        {choices.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            {choice.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
