import * as React from "react";
import { cn } from "../../lib/cn";
import { Check, ChevronDown, Search } from "lucide-react";

export interface SelectOption<TValue extends string = string> {
  value: TValue;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<TValue extends string = string> {
  id?: string;
  value?: TValue;
  onValueChange?: (value: TValue) => void;
  options: SelectOption<TValue>[];
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  /**
   * Show a type-to-filter search box at the top of the popover. When left
   * undefined it auto-enables for longer lists (more than SEARCH_THRESHOLD
   * options) so big pickers — e.g. the complaint type/sub-type levels — become
   * searchable while short lists (Yes/No, a couple of boundaries) stay plain.
   * Pass `true`/`false` to force it on or off. (CCRS#941)
   */
  searchable?: boolean;
  /** Placeholder for the search box (defaults to "Search"). */
  searchPlaceholder?: string;
  /** Optional aria-describedby for hint/error text. */
  "aria-describedby"?: string;
}

/** Lists longer than this auto-show the search box unless `searchable` is set. */
const SEARCH_THRESHOLD = 7;

/**
 * Custom-rendered dropdown — no native <select>. Trigger button + popover list,
 * keyboard navigable (Arrow keys, Enter, Escape, Home/End, type-ahead), click
 * outside to close. Long lists also get a search box to filter options. Styled
 * entirely by Tailwind tokens so the v2 chrome stays coherent across the rest
 * of the form.
 */
export function Select<TValue extends string = string>({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  invalid,
  disabled,
  className,
  searchable,
  searchPlaceholder,
  "aria-describedby": ariaDescribedBy,
}: SelectProps<TValue>) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [query, setQuery] = React.useState("");
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  const enableSearch =
    searchable === true || (searchable !== false && options.length > SEARCH_THRESHOLD);

  // The list the user actually sees and navigates — filtered by the search box
  // when one is shown. All keyboard nav / commit indexing is against THIS list.
  const visibleOptions = React.useMemo(() => {
    if (!enableSearch || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label?.toLowerCase().includes(q));
  }, [options, query, enableSearch]);

  // Selected label always reads from the full list (it may be filtered out).
  const selected = React.useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

  const visibleSelectedIndex = React.useMemo(
    () => visibleOptions.findIndex((o) => o.value === value),
    [visibleOptions, value]
  );

  // Click-outside.
  React.useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // Reset state when opening; clear the query when closing so the next open
  // starts from the full list.
  React.useEffect(() => {
    if (open) {
      setActiveIndex(visibleSelectedIndex >= 0 ? visibleSelectedIndex : 0);
      if (enableSearch) {
        // Focus the search box on open so the user can type immediately.
        // rAF so it runs after the popover paints.
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    } else {
      setQuery("");
    }
    // visibleSelectedIndex intentionally omitted — only run on open/close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Typing in the search box re-filters; keep the highlight on the first match.
  React.useEffect(() => {
    if (open) setActiveIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Scroll active option into view.
  React.useEffect(() => {
    if (!open || activeIndex < 0 || !listRef.current) return;
    const list = listRef.current;
    const item = list.children[activeIndex] as HTMLElement | undefined;
    if (item) {
      const itemTop = item.offsetTop;
      const itemBottom = itemTop + item.offsetHeight;
      if (itemTop < list.scrollTop) list.scrollTop = itemTop;
      else if (itemBottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = itemBottom - list.clientHeight;
      }
    }
  }, [activeIndex, open]);

  function commit(index: number) {
    const opt = visibleOptions[index];
    if (!opt || opt.disabled) return;
    onValueChange?.(opt.value);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function moveActive(delta: number) {
    if (visibleOptions.length === 0) return;
    let next = activeIndex < 0 ? 0 : activeIndex + delta;
    // Skip disabled
    let safety = visibleOptions.length;
    while (safety-- > 0) {
      if (next < 0) next = visibleOptions.length - 1;
      if (next >= visibleOptions.length) next = 0;
      if (!visibleOptions[next]?.disabled) break;
      next += delta > 0 ? 1 : -1;
    }
    setActiveIndex(next);
  }

  // Shared list-navigation keys, used by both the trigger (no search box) and
  // the search input (when shown).
  function onListNavKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveActive(1);
        return true;
      case "ArrowUp":
        e.preventDefault();
        moveActive(-1);
        return true;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        return true;
      case "End":
        e.preventDefault();
        setActiveIndex(visibleOptions.length - 1);
        return true;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0) commit(activeIndex);
        return true;
      case "Escape":
      case "Tab":
        setOpen(false);
        return true;
      default:
        return false;
    }
  }

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    // When a search box is shown it owns keyboard handling (focus moves there
    // on open); the trigger only needs the no-search type-ahead path.
    if (enableSearch) {
      onListNavKeyDown(e);
      return;
    }
    if (onListNavKeyDown(e)) return;
    if (e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) commit(activeIndex);
      return;
    }
    // Type-ahead — find the next option whose label starts with the key.
    if (e.key.length === 1) {
      const ch = e.key.toLowerCase();
      const start = activeIndex + 1;
      for (let i = 0; i < visibleOptions.length; i++) {
        const idx = (start + i) % visibleOptions.length;
        const o = visibleOptions[idx];
        if (!o.disabled && o.label.toLowerCase().startsWith(ch)) {
          setActiveIndex(idx);
          break;
        }
      }
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm transition-colors text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:border-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          invalid && "border-destructive focus-visible:ring-destructive"
        )}
      >
        <span
          className="truncate"
          style={{
            // Inline placeholder color so the unselected trigger reads at the
            // same tone as <input>'s ::placeholder (which the rest of the
            // form already shows lighter via Tailwind utilities). Without
            // this, the trigger inherits the page's near-black body color
            // and the "Select a …" text reads heavier than every <input>
            // placeholder on the same form. Resolved value matches a typical
            // muted-foreground (~slate-500).
            color: selected
              ? "var(--color-text-primary, #0B0C0C)"
              : "var(--color-text-secondary, #6B7280)",
          }}
        >
          {selected ? selected.label : placeholder ?? ""}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          // Inline width / bg / max-height / z-index as safety net so this
          // works even when Tailwind utilities haven't recompiled and so the
          // popover always sits above legacy buttons (NEXT/SUBMIT) which can
          // have higher z-index from vendor CSS. bg uses theme vars so a
          // tenant can retint the popover surface without forking this file.
          style={{
            position: "absolute",
            left: 0,
            width: "100%",
            backgroundColor: "var(--v2-surface-color, var(--color-surface, #ffffff))",
            zIndex: 9999,
          }}
          className={cn("mt-1 rounded-md border border-border shadow-lg animate-fade-in")}
        >
          {enableSearch ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.75rem",
                borderBottom: "1px solid var(--color-border, #E5E7EB)",
              }}
            >
              <Search
                aria-hidden
                style={{ width: "0.875rem", height: "0.875rem", flex: "0 0 auto", opacity: 0.6 }}
              />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Let the list keys drive navigation; everything else (typing)
                  // falls through to the input's onChange.
                  onListNavKeyDown(e);
                }}
                placeholder={searchPlaceholder ?? "Search"}
                aria-label={searchPlaceholder ?? "Search"}
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontSize: "0.875rem",
                  color: "var(--color-text-primary, #0B0C0C)",
                }}
              />
            </div>
          ) : null}

          <ul
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            // The padding/margin/list-style reset is critical: browsers
            // default `<ul>` to `padding-inline-start: 40px` for bullet
            // markers, which on this listbox manifested as a fat left gap
            // before every option. List markers are also hidden so the row
            // contains only the tick + label.
            style={{
              maxHeight: "16rem",
              overflowY: "auto",
              margin: 0,
              padding: "0.25rem 0",
              listStyle: "none",
            }}
          >
            {visibleOptions.map((opt, i) => {
              const isSelected = opt.value === value;
              const isActive = i === activeIndex;
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  onMouseEnter={() => !opt.disabled && setActiveIndex(i)}
                  onMouseDown={(e) => {
                    // Prevent the trigger blur/scroll dance — commit selection
                    // before the click fires.
                    e.preventDefault();
                    commit(i);
                  }}
                  style={{
                    paddingLeft: "0.75rem",
                    paddingRight: "0.75rem",
                    paddingTop: "0.5rem",
                    paddingBottom: "0.5rem",
                    // Theme-aware hover/keyboard-active tint. Routes through
                    // the same `--color-primary-selected-bg` the sidebar uses
                    // for selected nav rows — kenya-yellow (#FFF4D7) on
                    // naipepea, peach on the orange default tenant. The
                    // selected option also takes this tint so the tick row
                    // reads as the "current pick" without changing the text
                    // color.
                    backgroundColor:
                      isActive && !opt.disabled
                        ? "var(--color-primary-selected-bg, #FFF4D7)"
                        : isSelected
                        ? "var(--color-primary-selected-bg, #FFF4D7)"
                        : "transparent",
                  }}
                  className={cn(
                    "relative flex cursor-pointer items-center text-sm",
                    isSelected && "font-medium",
                    opt.disabled && "cursor-not-allowed opacity-50"
                  )}
                >
                  {/* Tick floats at the start of the row's text padding — when
                      not selected the slot is empty and the label sits where it
                      naturally would, keeping the left edge tight. */}
                  {isSelected ? (
                    <Check
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: "0.5rem",
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: "0.875rem",
                        height: "0.875rem",
                        flex: "0 0 auto",
                      }}
                    />
                  ) : null}
                  <span className="truncate flex-1" style={{ paddingLeft: "1.25rem" }}>
                    {opt.label}
                  </span>
                </li>
              );
            })}
            {visibleOptions.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                {query.trim() ? "No matches" : "No options"}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
