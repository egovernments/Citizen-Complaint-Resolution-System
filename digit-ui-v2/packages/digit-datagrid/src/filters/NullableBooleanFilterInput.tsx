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

export interface NullableBooleanFilterInputProps extends InputProps {
  label?: string;
  trueLabel?: string;
  falseLabel?: string;
  nullLabel?: string;
}

export function NullableBooleanFilterInput({
  source,
  label,
  trueLabel = 'Yes',
  falseLabel = 'No',
  nullLabel = 'Any',
  ...rest
}: NullableBooleanFilterInputProps) {
  const { field, id } = useInput({ source, ...rest });

  const handleChange = (val: string) => {
    if (val === '__null__') {
      field.onChange(undefined);
    } else {
      field.onChange(val === 'true');
    }
  };

  const selectValue =
    field.value === true ? 'true' : field.value === false ? 'false' : '__null__';

  return (
    <Select value={selectValue} onValueChange={handleChange}>
      <SelectTrigger id={id} className="h-8 text-sm w-32">
        <SelectValue placeholder={label || source} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__null__">{nullLabel}</SelectItem>
        <SelectItem value="true">{trueLabel}</SelectItem>
        <SelectItem value="false">{falseLabel}</SelectItem>
      </SelectContent>
    </Select>
  );
}
