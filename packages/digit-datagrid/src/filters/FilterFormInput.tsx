import React from 'react';
import { X } from 'lucide-react';

export interface FilterFormInputProps {
  filterElement: React.ReactElement;
  hideFilter: (name: string) => void;
}

export function FilterFormInput({ filterElement, hideFilter }: FilterFormInputProps) {
  const source = filterElement.props.source as string;

  return (
    <div className="flex items-center gap-1">
      {filterElement}
      <button
        type="button"
        onClick={() => hideFilter(source)}
        className="p-0.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label={`Remove ${source} filter`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
