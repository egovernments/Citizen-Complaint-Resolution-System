import React, { useState } from 'react';
import { ListFilter } from 'lucide-react';
import type { FilterElement } from './types';
import { Button } from '../primitives/button';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '../primitives/popover';

export interface AddFilterButtonProps {
  filters: FilterElement[];
  displayedFilters: Record<string, boolean>;
  showFilter: (name: string, defaultValue?: unknown) => void;
}

export function AddFilterButton({
  filters,
  displayedFilters,
  showFilter,
}: AddFilterButtonProps) {
  const [open, setOpen] = useState(false);

  const hiddenFilters = filters.filter((f) => {
    const { source, alwaysOn } = f.props;
    return !alwaysOn && !displayedFilters[source];
  });

  if (hiddenFilters.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-sm">
          <ListFilter className="w-3.5 h-3.5" />
          Add filter
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        <div className="space-y-0.5">
          {hiddenFilters.map((f) => {
            const { source, label } = f.props;
            return (
              <button
                key={source}
                type="button"
                onClick={() => {
                  showFilter(source, f.props.defaultValue);
                  setOpen(false);
                }}
                className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {label || source}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
