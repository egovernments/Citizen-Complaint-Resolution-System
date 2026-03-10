import React, { useCallback } from 'react';
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import { Search, X } from 'lucide-react';
import { Input } from '../primitives/input';

export type SearchFilterInputProps = Omit<InputProps, 'source'> & {
  source?: string;
};

export function SearchFilterInput({ source = 'q', alwaysOn = true, ...rest }: SearchFilterInputProps) {
  const { field, id } = useInput({ source, alwaysOn, ...rest });

  const handleClear = useCallback(() => {
    field.onChange('');
  }, [field.onChange]);

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        id={id}
        {...field}
        placeholder="Search..."
        className="pl-8 pr-8 h-8 text-sm w-48"
      />
      {field.value && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
