import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { EmployeeCandidate } from '@/admin/hrms/useEmployeeLookup';

export interface ReportingToSelectProps {
  id: string;
  value?: string;
  onChange: (uuid: string | undefined) => void;
  candidates: EmployeeCandidate[];
  isLoading?: boolean;
  disabled?: boolean;
  /** Own uuid, excluded so an employee can't be set as their own manager. */
  excludeUuid?: string;
}

/** Search-as-you-type single-select combobox for picking a reporting manager. */
export function ReportingToSelect({
  id,
  value,
  onChange,
  candidates,
  isLoading,
  disabled,
  excludeUuid,
}: ReportingToSelectProps) {
  const available = useMemo(
    () => candidates.filter((c) => c.uuid !== excludeUuid),
    [candidates, excludeUuid],
  );
  const selected = useMemo(() => available.find((c) => c.uuid === value), [available, value]);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = `${id}-listbox`;

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter(
      (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [available, query]);

  // Clamp rather than reset-via-effect: keeps a valid index whenever the
  // candidate list shrinks, whether that's from typing or from data loading.
  const safeActiveIdx = Math.min(activeIdx, Math.max(0, options.length - 1));

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const pick = (uuid: string) => {
    onChange(uuid);
    setQuery('');
    setOpen(false);
  };

  const clear = () => {
    onChange(undefined);
    setQuery('');
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (open && options.length > 0) {
        e.preventDefault();
        const opt = options[safeActiveIdx] ?? options[0];
        if (opt) pick(opt.uuid);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && !query && selected) {
      clear();
    }
  };

  const displayValue = open ? query : selected ? `${selected.name} (${selected.code})` : '';

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          placeholder={isLoading ? 'Loading employees…' : 'Search manager…'}
          disabled={isLoading || disabled}
          value={displayValue}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIdx(0); }}
          onFocus={() => { setQuery(''); setOpen(true); setActiveIdx(0); }}
          onKeyDown={handleKey}
          className="pr-14"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {selected && !isLoading && !disabled && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear reporting manager"
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown
            aria-hidden
            className={
              'pointer-events-none h-4 w-4 text-muted-foreground transition-transform ' +
              (open ? 'rotate-180' : '')
            }
          />
        </div>
      </div>

      {open && !isLoading && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-input bg-popover text-popover-foreground shadow-md"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {available.length === 0 ? 'No employees available' : 'No matches'}
            </li>
          ) : (
            options.map((opt, idx) => (
              <li
                key={opt.uuid}
                role="option"
                aria-selected={idx === safeActiveIdx}
                onMouseDown={(e) => { e.preventDefault(); pick(opt.uuid); }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={
                  'cursor-pointer px-3 py-1.5 text-sm ' +
                  (idx === safeActiveIdx ? 'bg-accent text-accent-foreground' : '')
                }
              >
                <span className="font-medium">{opt.name}</span>
                <span className="ml-2 text-muted-foreground">{opt.code}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
