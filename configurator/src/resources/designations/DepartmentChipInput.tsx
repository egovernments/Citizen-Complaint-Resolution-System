import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useGetList, useInput } from 'ra-core';
import { ChevronDown, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface DepartmentChipInputProps {
  source?: string;
  label?: string;
  help?: string;
}

interface DeptRecord {
  id: string | number;
  code?: string;
  name?: string;
}

/** Multi-select combobox backed by the `departments` resource. Writes a
 *  `string[]` of department codes — the shape `common-masters.Designation`'s
 *  MDMS schema declares for `department` (`type: array, items: string`).
 *  Legacy records that stored a single string are coerced to a one-element
 *  array on load so edit round-trips don't lose data. */
export function DepartmentChipInput({
  source = 'department',
  label = 'Departments',
  help,
}: DepartmentChipInputProps) {
  const { id, field, fieldState, isRequired } = useInput({ source });

  const { data, isLoading } = useGetList<DeptRecord>('departments', {
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'name', order: 'ASC' },
  });

  const codes: string[] = useMemo(() => {
    const v = field.value;
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string') as string[];
    if (typeof v === 'string' && v) return [v];
    return [];
  }, [field.value]);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = `${id}-listbox`;

  const byCode = useMemo(() => {
    const m = new Map<string, DeptRecord>();
    for (const d of data ?? []) {
      const code = d.code ?? String(d.id);
      if (code) m.set(code, d);
    }
    return m;
  }, [data]);

  const selectedSet = useMemo(() => new Set(codes), [codes]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? [])
      .filter((d) => {
        const code = d.code ?? String(d.id);
        return !selectedSet.has(code);
      })
      .filter((d) => {
        if (!q) return true;
        const code = (d.code ?? '').toLowerCase();
        const name = (d.name ?? '').toLowerCase();
        return code.includes(q) || name.includes(q);
      });
  }, [data, selectedSet, query]);

  useEffect(() => setActiveIdx(0), [query, options.length]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const addCode = (code: string) => {
    if (!code || selectedSet.has(code)) return;
    field.onChange([...codes, code]);
    setQuery('');
  };

  const removeCode = (code: string) => {
    field.onChange(codes.filter((c) => c !== code));
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && open && options.length > 0) {
      e.preventDefault();
      const pick = options[activeIdx] ?? options[0];
      if (pick) addCode(pick.code ?? String(pick.id));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && !query && codes.length > 0) {
      removeCode(codes[codes.length - 1]);
    }
  };

  const hasError = fieldState.invalid && fieldState.isTouched;
  const errorMessage = fieldState.error?.message;

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {isRequired && <span className="text-destructive ml-0.5" aria-label="required">*</span>}
        </Label>
      )}

      <div className="flex flex-wrap gap-1.5 mb-1.5" aria-live="polite">
        {codes.map((code) => {
          const d = byCode.get(code);
          return (
            <span
              key={code}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium"
            >
              <span className="font-semibold">{code}</span>
              {d?.name ? <span className="opacity-80">{d.name}</span> : null}
              <button
                type="button"
                onClick={() => removeCode(code)}
                aria-label={`remove ${code}`}
                className="hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}
      </div>

      <div className="relative">
        <Input
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-invalid={hasError || undefined}
          placeholder={isLoading ? 'Loading departments…' : 'Search departments…'}
          disabled={isLoading}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          onBlur={field.onBlur}
          className={'pr-8 ' + (hasError ? 'border-destructive focus-visible:ring-destructive' : '')}
        />
        <ChevronDown
          aria-hidden
          className={
            'pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-transform ' +
            (open ? 'rotate-180' : '')
          }
        />
      </div>

      {open && !isLoading && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-input bg-popover text-popover-foreground shadow-md"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {(data ?? []).length === 0 ? 'No departments available' : 'No matches'}
            </li>
          ) : (
            options.map((opt, idx) => {
              const code = opt.code ?? String(opt.id);
              return (
                <li
                  key={code}
                  role="option"
                  aria-selected={idx === activeIdx}
                  onMouseDown={(e) => { e.preventDefault(); addCode(code); }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={
                    'cursor-pointer px-3 py-1.5 text-sm ' +
                    (idx === activeIdx ? 'bg-accent text-accent-foreground' : '')
                  }
                >
                  <span className="font-medium">{code}</span>
                  {opt.name ? <span className="ml-2 text-muted-foreground">{opt.name}</span> : null}
                </li>
              );
            })
          )}
        </ul>
      )}

      {hasError && errorMessage && (
        <p className="mt-1 text-xs text-destructive" role="alert">{errorMessage}</p>
      )}
      {!hasError && help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
