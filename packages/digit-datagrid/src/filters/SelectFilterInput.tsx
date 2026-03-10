import React from 'react';
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../primitives/select';

export interface SelectFilterInputProps extends InputProps {
  label?: string;
  choices: Array<{ id: string; name: string }>;
}

export function SelectFilterInput({
  source,
  label,
  choices,
  ...rest
}: SelectFilterInputProps) {
  const { field, id } = useInput({ source, ...rest });

  return (
    <Select value={field.value || ''} onValueChange={field.onChange}>
      <SelectTrigger id={id} className="h-8 text-sm w-40">
        <SelectValue placeholder={label || source} />
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
