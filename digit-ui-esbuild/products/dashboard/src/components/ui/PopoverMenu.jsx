import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Shared styled popover/menu primitive for the dashboard's compact controls
 * (the complaint-type tree filter in the filter bar, the per-widget settings
 * gear's "Group by" menu) — the design-pass replacement for the
 * browser-native <select>s.
 *
 * Anatomy:
 *   - anchor CHIP: a real <button> styled like the inline filter controls
 *     (.dashboard-popover-trigger — same h-7/rounded-sm/border-border/bg-surface
 *     language as .dashboard-filter-inline-select), with aria-haspopup/
 *     aria-expanded and a caret; OR, when `icon` is passed, an ICON-ONLY
 *     anchor (.dashboard-popover-iconbtn — the muted 1.5rem-square idiom of
 *     .dashboard-widget-remove-btn) for widget-header placement, where a
 *     text chip would make headers with options look different from headers
 *     without;
 *   - PANEL: a fixed-position, body-portaled surface mirroring
 *     .dashboard-add-kpi-panel (border-border, 6px radius, the same soft
 *     shadow), position-synced on scroll/resize, flipped above the anchor
 *     when the viewport below is too short, clamped horizontally. Because
 *     the portal target (document.body) sits OUTSIDE .dashboard-root — the
 *     element every dashboard design token (--border/--muted/--ring/…) and
 *     the Inter font stack hang off — the panel carries the dashboard-root
 *     class itself, so its contents resolve the exact same tokens as
 *     in-tree dashboard chrome instead of inheriting the host app's
 *     body-level styling.
 *
 * Behavior owned here so consumers stay declarative:
 *   - open/close state, click-outside close, Escape/Tab close (refocusing the
 *     anchor), body-portal + positioning;
 *   - keyboard navigation: ArrowUp/ArrowDown/Home/End rove DOM focus across
 *     every [data-menu-item] inside the panel (Enter/Space activate natively —
 *     items are real <button>s); ArrowDown/ArrowUp on the closed chip opens;
 *   - initial focus: the selected item when there is one (which also scrolls
 *     it into view in long lists), else the first item.
 *
 * Dependency-free and SSR-safe: the panel only portals when `document`
 * exists, and a closed chip renders fine under ReactDOMServer. RGL note: the
 * chip is a <button> (already in AdminDashboard's draggableCancel list) and
 * the panel is portaled to document.body — outside any grid item — so
 * opening/using a menu can never start a widget drag.
 *
 * Consumers render panel content via function-as-children ({ close }) using
 * PopoverMenuItem / PopoverMenuGroupLabel (or any elements carrying
 * data-menu-item for custom rows, e.g. the tree filter's trail crumbs).
 */

const GAP_PX = 6;
const VIEWPORT_PAD_PX = 8;
const MIN_PANEL_MAX_PX = 64;
const ITEM_SELECTOR = "[data-menu-item]:not(:disabled)";

const CaretIcon = () => (
  <svg
    className="dashboard-popover-trigger-caret"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const CheckIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);

/**
 * One menu row. `selected` (true/false) makes it a menuitemradio with a
 * trailing check when on; leave it undefined for plain action/navigation
 * rows. `descend` marks an interior tree row: trailing chevron, always a
 * plain menuitem (activating it navigates within the panel, it is not a
 * checkable option itself — but it still shows the selected treatment when
 * `selected` is passed, e.g. the applied subtree's own row, announced via
 * aria-current since menuitem carries no aria-checked).
 */
export const PopoverMenuItem = ({
  selected,
  descend = false,
  muted = false,
  title,
  className = "",
  onSelect,
  children,
}) => {
  const checkable = !descend && selected !== undefined;
  return (
    <button
      type="button"
      role={checkable ? "menuitemradio" : "menuitem"}
      aria-checked={checkable ? !!selected : undefined}
      aria-current={!checkable && selected ? "true" : undefined}
      data-menu-item=""
      data-selected={selected ? "true" : undefined}
      title={title}
      className={`dashboard-menu-item${muted ? " dashboard-menu-item--muted" : ""}${
        className ? ` ${className}` : ""
      }`}
      onClick={onSelect}
    >
      <span className="dashboard-menu-item-label">{children}</span>
      {selected ? (
        <span className="dashboard-menu-item-trailing dashboard-menu-item-check">
          <CheckIcon />
        </span>
      ) : null}
      {descend ? (
        <span className="dashboard-menu-item-trailing" aria-hidden>
          <ChevronRightIcon />
        </span>
      ) : null}
    </button>
  );
};

/** Non-interactive section label between runs of related items. */
export const PopoverMenuGroupLabel = ({ children }) => (
  <div role="presentation" className="dashboard-menu-group-label">
    {children}
  </div>
);

const PopoverMenu = ({
  chip,
  chipTitle,
  ariaLabel,
  icon = null,
  disabled = false,
  align = "start",
  panelWidth = 240,
  chipClassName = "",
  panelClassName = "",
  children,
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const anchorRef = useRef(null);
  const panelRef = useRef(null);

  const close = useCallback((opts = {}) => {
    setOpen(false);
    setPos(null);
    if (opts.refocus !== false) anchorRef.current?.focus();
  }, []);

  // Position: below the anchor (start- or end-aligned), clamped to the
  // viewport, flipped above when there is no room below but more above; when
  // NEITHER side fits (very short viewports) the roomier side wins and the
  // panel's max height is capped to that side's space so every option stays
  // reachable (the item list scrolls internally). Re-synced on scroll/resize
  // and (when supported) on panel size changes — the tree panel grows/shrinks
  // as the user descends.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const sync = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const panelEl = panelRef.current;
      const width = panelEl?.offsetWidth || panelWidth;
      const height = panelEl?.offsetHeight || 0;
      let left = align === "end" ? rect.right - width : rect.left;
      left = Math.max(
        VIEWPORT_PAD_PX,
        Math.min(left, window.innerWidth - width - VIEWPORT_PAD_PX)
      );
      // Floored so a sub-pixel space difference can't flip sides between
      // ResizeObserver passes (offsetHeight is integral).
      const spaceBelow = Math.floor(
        window.innerHeight - VIEWPORT_PAD_PX - (rect.bottom + GAP_PX)
      );
      const spaceAbove = Math.floor(rect.top - GAP_PX - VIEWPORT_PAD_PX);
      const above = !!height && height > spaceBelow && spaceAbove > spaceBelow;
      // Never below MIN_PANEL_MAX_PX: a degenerate viewport gets a slightly
      // anchor-overlapping panel rather than an unusably thin one.
      const maxHeight = Math.max(above ? spaceAbove : spaceBelow, MIN_PANEL_MAX_PX);
      const top = above
        ? Math.max(VIEWPORT_PAD_PX, rect.top - GAP_PX - Math.min(height, maxHeight))
        : rect.bottom + GAP_PX;
      setPos((prev) =>
        prev && prev.top === top && prev.left === left && prev.maxHeight === maxHeight
          ? prev
          : { top, left, maxHeight }
      );
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    let observer;
    if (typeof ResizeObserver !== "undefined" && panelRef.current) {
      observer = new ResizeObserver(sync);
      observer.observe(panelRef.current);
    }
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      observer?.disconnect();
    };
  }, [open, align, panelWidth]);

  // Click-outside close (mousedown, like AddKpiDropdown) — without stealing
  // focus back to the anchor. Clicks on the anchor itself are left to the
  // chip's own toggle handler.
  useEffect(() => {
    if (!open) return undefined;
    const handleMouseDown = (event) => {
      const insideAnchor = anchorRef.current && anchorRef.current.contains(event.target);
      const insidePanel = panelRef.current && panelRef.current.contains(event.target);
      if (insideAnchor || insidePanel) return;
      close({ refocus: false });
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, close]);

  // Initial focus: selected item (scrolled into view) else first item.
  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(() => {
      const root = panelRef.current;
      if (!root) return;
      const target =
        root.querySelector('[data-menu-item][data-selected="true"]') ||
        root.querySelector(ITEM_SELECTOR);
      target?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const handlePanelKeyDown = (event) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const root = panelRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll(ITEM_SELECTOR));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    let next = 0;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    else if (event.key === "End") next = items.length - 1;
    items[next].focus();
  };

  const handleAnchorKeyDown = (event) => {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setOpen(true);
    } else if (open && event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const canPortal = typeof document !== "undefined" && !!document.body;

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={chipTitle}
        className={`${icon ? "dashboard-popover-iconbtn" : "dashboard-popover-trigger"}${
          chipClassName ? ` ${chipClassName}` : ""
        }`}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={handleAnchorKeyDown}
      >
        {icon ?? (
          <>
            <span className="dashboard-popover-trigger-value">{chip}</span>
            <CaretIcon />
          </>
        )}
      </button>
      {open && canPortal
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              aria-label={ariaLabel}
              className={`dashboard-root dashboard-popover-panel${panelClassName ? ` ${panelClassName}` : ""}`}
              style={{
                position: "fixed",
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                width: panelWidth,
                maxHeight: pos ? `min(22rem, 70vh, ${pos.maxHeight}px)` : "min(22rem, 70vh)",
                zIndex: 9999,
                visibility: pos ? "visible" : "hidden",
              }}
              onKeyDown={handlePanelKeyDown}
            >
              {typeof children === "function" ? children({ close }) : children}
            </div>,
            document.body
          )
        : null}
    </>
  );
};

export default PopoverMenu;
