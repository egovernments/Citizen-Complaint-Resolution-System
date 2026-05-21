import * as React from "react";
import { cn } from "../../lib/cn";
import { Check, ChevronDown } from "lucide-react";

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
  /** Optional aria-describedby for hint/error text. */
  "aria-describedby"?: string;
}

/**
 * Custom-rendered dropdown — no native <select>. Trigger button + popover list,
 * keyboard navigable (Arrow keys, Enter, Escape, Home/End, type-ahead), click
 * outside to close. Styled entirely by Tailwind tokens so the v2 chrome stays
 * coherent across the rest of the form.
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
  "aria-describedby": ariaDescribedBy,
}: SelectProps<TValue>) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  const selected = React.useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );

  const selectedIndex = React.useMemo(
    () => options.findIndex((o) => o.value === value),
    [options, value]
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

  // Reset active index when opening.
  React.useEffect(() => {
    if (open) {
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  }, [open, selectedIndex]);

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
    const opt = options[index];
    if (!opt || opt.disabled) return;
    onValueChange?.(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveActive(delta: number) {
    if (options.length === 0) return;
    let next = activeIndex < 0 ? 0 : activeIndex + delta;
    // Skip disabled
    let safety = options.length;
    while (safety-- > 0) {
      if (next < 0) next = options.length - 1;
      if (next >= options.length) next = 0;
      if (!options[next]?.disabled) break;
      next += delta > 0 ? 1 : -1;
    }
    setActiveIndex(next);
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
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (activeIndex >= 0) commit(activeIndex);
        break;
      case "Escape":
      case "Tab":
        setOpen(false);
        break;
      default:
        // Type-ahead — find the next option whose label starts with the key.
        if (e.key.length === 1) {
          const ch = e.key.toLowerCase();
          const start = activeIndex + 1;
          for (let i = 0; i < options.length; i++) {
            const idx = (start + i) % options.length;
            const o = options[idx];
            if (!o.disabled && o.label.toLowerCase().startsWith(ch)) {
              setActiveIndex(idx);
              break;
            }
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
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          // Inline width / bg / max-height / z-index as safety net so this
          // works even when Tailwind utilities haven't recompiled and so the
          // popover always sits above legacy buttons (NEXT/SUBMIT) which can
          // have higher z-index from vendor CSS. bg uses theme vars so a
          // tenant can retint the popover surface without forking this file.
          //
          // The padding/margin/list-style reset is critical: browsers
          // default `<ul>` to `padding-inline-start: 40px` for bullet
          // markers, which on this listbox manifested as a fat left gap
          // before every option. List markers are also hidden so the row
          // contains only the tick + label.
          style={{
            width: "100%",
            backgroundColor: "var(--v2-surface-color, var(--color-surface, #ffffff))",
            maxHeight: "16rem",
            overflowY: "auto",
            zIndex: 9999,
            margin: 0,
            padding: "0.25rem 0",
            listStyle: "none",
          }}
          className={cn(
            "absolute left-0 mt-1 rounded-md border border-border shadow-lg",
            "animate-fade-in"
          )}
        >
          {options.map((opt, i) => {
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
                <span
                  className="truncate flex-1"
                  style={{ paddingLeft: "1.25rem" }}
                >
                  {opt.label}
                </span>
              </li>
            );
          })}
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No options</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
