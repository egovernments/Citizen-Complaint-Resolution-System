import React from 'react';
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import { Label } from '../primitives/label';

export interface DateFilterInputProps extends InputProps {
  label?: string;
}

export function DateFilterInput({ source, label, ...rest }: DateFilterInputProps) {
  const { field, id } = useInput({ source, ...rest });

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </Label>
      )}
      <input
        id={id}
        type="date"
        {...field}
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  );
}
