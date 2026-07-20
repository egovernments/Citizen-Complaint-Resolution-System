import { useMemo, useRef, useState, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import { useInput } from 'ra-core';
import { ChevronDown, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Role } from '@/api/types';
import { useRolesLookup } from '@/admin/hrms/useRolesLookup';

export interface RolesEditorProps {
  source?: string;
  label?: string;
  tenantId: string;
  help?: string;
}

export function RolesEditor({
  source = 'user.roles',
  label = 'Roles',
  tenantId,
  help,
}: RolesEditorProps) {
  const { id, field, fieldState, isRequired } = useInput({ source });
  const { roles: available, isLoading, buildRole } = useRolesLookup();

  const value: Role[] = useMemo(() => {
    if (!Array.isArray(field.value)) return [];
    const seen = new Set<string>();
    const out: Role[] = [];
    for (const entry of field.value as unknown[]) {
      if (!entry || typeof entry !== 'object') continue;
      const r = entry as Record<string, unknown>;
      const code = typeof r.code === 'string' ? r.code : undefined;
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out.push({
        code,
        name: typeof r.name === 'string' ? r.name : code,
        tenantId: typeof r.tenantId === 'string' ? r.tenantId : tenantId,
      });
    }
    return out;
  }, [field.value, tenantId]);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = `${id}-listbox`;

  const selectedCodes = useMemo(() => new Set(value.map((r) => r.code)), [value]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return available
      .filter((r) => !selectedCodes.has(r.code))
      .filter((r) => {
        if (!q) return true;
        return r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
      });
  }, [available, selectedCodes, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const addRole = (code: string) => {
    if (selectedCodes.has(code)) return;
    const role = buildRole(code, tenantId);
    field.onChange([...value, role]);
    setQuery('');
  };

  const removeRole = (code: string) => {
    field.onChange(value.filter((r) => r.code !== code));
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
      if (options.length > 0 && open) {
        e.preventDefault();
        const pick = options[activeIdx] ?? options[0];
        if (pick) addRole(pick.code);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && !query && value.length > 0) {
      removeRole(value[value.length - 1].code);
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
        {value.map((role) => (
          <span
            key={role.code}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium"
          >
            <span className="font-semibold">{role.code}</span>
            <span className="opacity-80">{role.name}</span>
            <button
              type="button"
              onClick={() => removeRole(role.code)}
              aria-label={`remove ${role.code}`}
              className="hover:text-destructive"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
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
          aria-describedby={hasError ? `${id}-error` : undefined}
          placeholder={isLoading ? 'Loading roles…' : 'Search roles…'}
          disabled={isLoading}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          onBlur={field.onBlur}
          className={
            'pr-8 ' + (hasError ? 'border-destructive focus-visible:ring-destructive' : '')
          }
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
              {available.length === 0 ? 'No roles available' : 'No matches'}
            </li>
          ) : (
            options.map((opt, idx) => (
              <li
                key={opt.code}
                role="option"
                aria-selected={idx === activeIdx}
                onMouseDown={(e) => { e.preventDefault(); addRole(opt.code); }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={
                  'cursor-pointer px-3 py-1.5 text-sm ' +
                  (idx === activeIdx ? 'bg-accent text-accent-foreground' : '')
                }
              >
                <span className="font-medium">{opt.code}</span>
                <span className="ml-2 text-muted-foreground">{opt.name}</span>
              </li>
            ))
          )}
        </ul>
      )}

      {hasError && errorMessage && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-destructive">
          {errorMessage}
        </p>
      )}
      {help && !hasError && (
        <p className="mt-1 text-xs text-muted-foreground">{help}</p>
      )}
    </div>
  );
}
