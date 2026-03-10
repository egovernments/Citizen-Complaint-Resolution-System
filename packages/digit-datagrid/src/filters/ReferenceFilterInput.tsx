import React from 'react';
import { useInput, useGetList } from 'ra-core';
import type { InputProps } from 'ra-core';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../primitives/select';

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
  const { data, isPending } = useGetList(reference, {
    pagination: { page: 1, perPage: 100 },
    sort: { field: displayField, order: 'ASC' },
  });

  const choices = (data ?? []).map((record: Record<string, unknown>) => ({
    id: String(record.id),
    name: String(record[displayField] ?? record.id),
  }));

  return (
    <Select value={field.value || ''} onValueChange={field.onChange}>
      <SelectTrigger id={id} className="h-8 text-sm w-44">
        <SelectValue placeholder={isPending ? 'Loading...' : label || source} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            {choice.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
