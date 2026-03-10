import React from 'react';
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import { Switch } from '../primitives/switch';
import { Label } from '../primitives/label';

export interface BooleanFilterInputProps extends InputProps {
  label?: string;
}

export function BooleanFilterInput({ source, label, ...rest }: BooleanFilterInputProps) {
  const { field, id } = useInput({ source, ...rest });

  return (
    <div className="flex items-center gap-2">
      <Switch
        id={id}
        checked={!!field.value}
        onCheckedChange={(checked) => field.onChange(checked)}
      />
      {label && (
        <Label htmlFor={id} className="text-sm cursor-pointer">
          {label}
        </Label>
      )}
    </div>
  );
}
