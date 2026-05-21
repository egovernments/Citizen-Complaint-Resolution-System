import React, { useCallback } from 'react';
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../primitives/select';

const ALL_VALUE = '__all__';

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

  const handleChange = useCallback(
    (value: string) => {
      field.onChange(value === ALL_VALUE ? '' : value);
    },
    [field.onChange]
  );

  return (
    <Select value={field.value || ''} onValueChange={handleChange}>
      <SelectTrigger id={id} className="h-8 text-sm w-40">
        <SelectValue placeholder={label || source} />
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
