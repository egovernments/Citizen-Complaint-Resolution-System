import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SearchableSelectProps {
  /** Currently selected value. Must be present in `options` (or treated as the only extra option). */
  value: string;
  /** Full list of option strings. Caller is responsible for any ordering and for ensuring the
   *  current `value` is always included so it is never shown as blank. */
  options: string[];
  /** Called when the user commits a new selection. */
  onChange: (value: string) => void;
  /** When true the trigger is read-only and the dropdown cannot be opened. */
  disabled?: boolean;
  /** aria-label forwarded to the combobox input so screen readers announce it correctly. */
  ariaLabel?: string;
  /** Placeholder shown in the input while the dropdown is open and the query is empty. */
  placeholder?: string;
  /** Additional className applied to the outermost container div. */
  className?: string;
}

/**
 * Generic searchable single-select combobox.
 *
 * Follows the accessibility and visual pattern of the design system:
 * - Smart auto-positioning: opens upwards if near the bottom of the viewport
 * - Auto-scrolls to the currently selected option upon opening
 * - Resets scroll position to top when typing to keep top search results in view
 * - Auto-scrolls the active highlighted item into view on ArrowUp/ArrowDown navigation
 * - Visual checkmark and highlight for current selection
 * - Capped height (`max-h-60`) with smooth scrolling and high z-index (`z-50`)
 * - Clear button when searching, toggle button on chevron click, reopens on click
 * - Full keyboard navigation (ArrowDown/Up, Enter, Escape, Tab to close)
 */
export function SearchableSelect({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  placeholder = 'Search…',
  className,
}: SearchableSelectProps) {
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxRef = useRef<HTMLUListElement | null>(null);

  /** Options that match the current query (case-insensitive substring). */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [options, query]);

  // Clamp activeIdx whenever the filtered list shrinks (typing) or grows (clearing query).
  const safeActiveIdx = Math.min(activeIdx, Math.max(0, filtered.length - 1));

  // Determine whether to open upward or downward based on viewport space
  const updatePlacement = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dropdownHeight = 250;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
      setPlacement('top');
    } else {
      setPlacement('bottom');
    }
  }, []);

  // Scroll a specific option index into view
  const scrollToOption = useCallback(
    (idx: number) => {
      requestAnimationFrame(() => {
        const optElem = document.getElementById(`${listboxId}-opt-${idx}`);
        if (typeof optElem?.scrollIntoView === 'function') {
          optElem.scrollIntoView({ block: 'nearest' });
        }
      });
    },
    [listboxId],
  );

  // Helper to open dropdown and initialize highlight/scroll to the currently selected value
  const openDropdown = useCallback(() => {
    const selectedIdx = filtered.indexOf(value);
    const initialIdx = selectedIdx >= 0 ? selectedIdx : 0;
    setActiveIdx(initialIdx);
    setOpen(true);
    updatePlacement();
    scrollToOption(initialIdx);
  }, [filtered, value, updatePlacement, scrollToOption]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const pick = (option: string) => {
    onChange(option);
    setQuery('');
    setOpen(false);
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        setOpen(true);
        const nextIdx = Math.min(filtered.length - 1, activeIdx + 1);
        setActiveIdx(nextIdx);
        scrollToOption(nextIdx);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const nextIdx = Math.max(0, activeIdx - 1);
        setActiveIdx(nextIdx);
        scrollToOption(nextIdx);
        break;
      }
      case 'Enter':
        if (open && filtered.length > 0) {
          e.preventDefault();
          const opt = filtered[safeActiveIdx] ?? filtered[0];
          if (opt !== undefined) pick(opt);
        }
        break;
      case 'Escape':
      case 'Tab':
        setOpen(false);
        setQuery('');
        break;
      default:
        // Only open on printable characters or deletion keys (not modifier keys like Shift, Ctrl, Alt)
        if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
          setOpen(true);
        }
        break;
    }
  };

  const inputValue = open ? query : value;

  return (
    <div ref={containerRef} className={cn('relative w-full max-w-sm', className)}>
      {/* Trigger */}
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && filtered.length > 0 ? `${listboxId}-opt-${safeActiveIdx}` : undefined
          }
          placeholder={open ? placeholder : undefined}
          disabled={disabled}
          value={inputValue}
          onChange={(e) => {
            const nextQuery = e.target.value;
            setQuery(nextQuery);
            setOpen(true);
            setActiveIdx(0);
            if (listboxRef.current) {
              listboxRef.current.scrollTop = 0;
            }
          }}
          onFocus={() => {
            setQuery('');
            openDropdown();
          }}
          onClick={() => {
            if (!open) {
              openDropdown();
            }
          }}
          onBlur={(e) => {
            if (!containerRef.current?.contains(e.relatedTarget as Node)) {
              setOpen(false);
              setQuery('');
            }
          }}
          onKeyDown={handleKey}
          className="pr-14"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {query && open && (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                setQuery('');
                setActiveIdx(0);
                if (listboxRef.current) {
                  listboxRef.current.scrollTop = 0;
                }
                inputRef.current?.focus();
              }}
              aria-label="Clear search query"
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (!disabled) {
                if (open) {
                  setOpen(false);
                  setQuery('');
                } else {
                  openDropdown();
                  inputRef.current?.focus();
                }
              }
            }}
            aria-label={open ? 'Close dropdown' : 'Open dropdown'}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'h-4 w-4 transition-transform duration-200',
                open && 'rotate-180',
              )}
            />
          </button>
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            'absolute z-50 max-h-60 w-full overflow-y-auto overflow-x-hidden rounded-md border border-input bg-popover p-1 text-popover-foreground shadow-lg',
            placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          )}
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">No matches found</li>
          ) : (
            filtered.map((opt, idx) => {
              const isSelected = opt === value;
              const isActive = idx === safeActiveIdx;
              return (
                <li
                  key={opt}
                  id={`${listboxId}-opt-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(opt);
                  }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={cn(
                    'relative flex cursor-pointer select-none items-center justify-between rounded-sm px-2.5 py-1.5 text-sm outline-none transition-colors',
                    isActive && 'bg-accent text-accent-foreground',
                    isSelected && 'font-medium',
                  )}
                >
                  <span className="truncate">{opt}</span>
                  {isSelected && (
                    <Check className="ml-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
