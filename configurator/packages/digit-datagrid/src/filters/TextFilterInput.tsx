import React from 'react';
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import { Input } from '../primitives/input';

export interface TextFilterInputProps extends InputProps {
  label?: string;
}

export function TextFilterInput({ source, label, ...rest }: TextFilterInputProps) {
  const { field, id } = useInput({ source, ...rest });

  return (
    <Input
      id={id}
      {...field}
      placeholder={label || source}
      className="h-8 text-sm w-40"
    />
  );
}
