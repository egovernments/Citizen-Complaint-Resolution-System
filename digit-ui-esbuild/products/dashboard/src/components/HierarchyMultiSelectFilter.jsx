import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ALL,
  TRAIL_ELLIPSIS,
  ancestorsOf,
  browseBaseCode,
  childrenOf,
  nodeOf,
  truncateTrail,
} from "../utils/complaintTypeTree";
import {
  normalizeHierarchySelections,
  toggleHierarchySelection,
} from "../utils/multiSelectFilters";
import { MultiSelectChip } from "./MultiSelectFilter";
import PopoverMenu, { PopoverMenuItem } from "./ui/PopoverMenu";

const TRAIL_MAX = 4;
const normalizedSearch = (value) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase();

const HierarchyMultiSelectPanel = ({
  tree,
  selections,
  labelFor,
  selectionFromCode,
  allLabel,
  allInLabel,
  searchable,
  searchPlaceholder,
  applyLabel,
  cancelLabel,
  emptyLabel,
  onApply,
  close,
}) => {
  const initial = normalizeHierarchySelections(selections);
  const [draft, setDraft] = useState(initial);
  const [browseCode, setBrowseCode] = useState(() =>
    browseBaseCode(tree, initial[0]?.code ?? ALL)
  );
  const [search, setSearch] = useState("");
  const rootRef = useRef(null);
  const mountedRef = useRef(false);
  const query = normalizedSearch(search);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    rootRef.current
      ?.querySelector(".dashboard-popover-list [data-menu-item]")
      ?.focus();
  }, [browseCode]);

  const label = (code) => (code === ALL ? allLabel : labelFor(tree, code));
  const selectedCodes = new Set(draft.map((selection) => selection.code));
  const toggle = (code) => {
    const selection = selectionFromCode(tree, code);
    if (selection)
      setDraft((current) => toggleHierarchySelection(current, selection));
  };

  const searchResults = useMemo(() => {
    if (!query) return [];
    const candidates =
      tree?.scopedCodes instanceof Set
        ? [...tree.scopedCodes]
        : [...(tree?.byCode?.keys?.() ?? [])].filter(
            (code) => nodeOf(tree, code)?.isLeaf
          );
    return candidates
      .map((code) => ({
        code,
        label: labelFor(tree, code),
        trail: [...ancestorsOf(tree, code), code]
          .map((part) => labelFor(tree, part))
          .join(" › "),
      }))
      .filter((entry) =>
        normalizedSearch(
          `${entry.label} ${entry.trail} ${entry.code}`
        ).includes(query)
      )
      .slice(0, 100);
  }, [tree, query, labelFor]);

  const atRoot = browseCode === ALL || !nodeOf(tree, browseCode);
  const browse = atRoot ? ALL : browseCode;
  const children = childrenOf(tree, browse);
  const trailCodes = atRoot
    ? [ALL]
    : [ALL, ...ancestorsOf(tree, browse), browse];
  const trail = truncateTrail(trailCodes, TRAIL_MAX);

  return (
    <div
      ref={rootRef}
      className="dashboard-popover-tree dashboard-multiselect-panel"
    >
      {searchable && (
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (
              ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
              event.stopPropagation();
            }
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="dashboard-multiselect-search"
          data-popover-autofocus=""
          autoFocus
        />
      )}

      {!query && (
        <div className="dashboard-popover-trail" role="presentation">
          {trail.map((crumb, index) => {
            const current = index === trail.length - 1;
            if (crumb === TRAIL_ELLIPSIS) {
              return (
                <span
                  key={crumb}
                  className="dashboard-popover-trail-ellipsis"
                  aria-hidden
                >
                  …
                </span>
              );
            }
            if (current) {
              return (
                <span key={crumb} className="dashboard-popover-trail-current">
                  {label(crumb)}
                </span>
              );
            }
            return (
              <React.Fragment key={crumb}>
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item=""
                  className="dashboard-popover-trail-crumb"
                  onClick={() => setBrowseCode(crumb)}
                >
                  {label(crumb)}
                </button>
                <span className="dashboard-popover-trail-sep" aria-hidden>
                  ›
                </span>
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div className="dashboard-popover-list dashboard-multiselect-options">
        {query ? (
          searchResults.length ? (
            searchResults.map((entry) => (
              <PopoverMenuItem
                key={entry.code}
                selected={selectedCodes.has(entry.code)}
                multiple
                title={entry.trail}
                onSelect={() => toggle(entry.code)}
              >
                <span>{entry.label}</span>
                <span className="dashboard-multiselect-result-trail">
                  {entry.trail}
                </span>
              </PopoverMenuItem>
            ))
          ) : (
            <div className="dashboard-multiselect-empty">{emptyLabel}</div>
          )
        ) : (
          <>
            {!atRoot && (
              <PopoverMenuItem
                selected={selectedCodes.has(browse)}
                multiple
                title={`${allInLabel} ${label(browse)}`}
                onSelect={() => toggle(browse)}
              >
                {`${allInLabel} ${label(browse)}`}
              </PopoverMenuItem>
            )}
            {children.map((child) => (
              <PopoverMenuItem
                key={child.code}
                selected={
                  child.isLeaf ? selectedCodes.has(child.code) : undefined
                }
                multiple={child.isLeaf}
                descend={!child.isLeaf}
                title={label(child.code)}
                onSelect={() =>
                  child.isLeaf ? toggle(child.code) : setBrowseCode(child.code)
                }
              >
                {label(child.code)}
              </PopoverMenuItem>
            ))}
          </>
        )}
      </div>

      <div className="dashboard-multiselect-footer">
        <button
          type="button"
          className="dashboard-multiselect-clear"
          onClick={() => setDraft([])}
        >
          {allLabel}
        </button>
        <span className="dashboard-multiselect-footer-actions">
          <button
            type="button"
            className="dashboard-multiselect-cancel"
            onClick={() => close()}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="dashboard-multiselect-apply"
            onClick={() => {
              onApply(draft);
              close();
            }}
          >
            {applyLabel}
          </button>
        </span>
      </div>
    </div>
  );
};

const HierarchyMultiSelectFilter = ({
  tree,
  selections,
  label,
  allLabel,
  ariaLabel,
  labelFor,
  selectionFromCode,
  allInLabel,
  searchable = false,
  searchPlaceholder,
  applyLabel,
  cancelLabel,
  emptyLabel,
  onChange,
}) => {
  const count = normalizeHierarchySelections(selections).length;
  return (
    <PopoverMenu
      ariaLabel={ariaLabel}
      chip={<MultiSelectChip label={count ? label : allLabel} count={count} />}
      chipTitle={count ? `${label}: ${count}` : allLabel}
      panelWidth={320}
      chipClassName={count ? "dashboard-popover-trigger--active" : ""}
    >
      {({ close }) => (
        <HierarchyMultiSelectPanel
          tree={tree}
          selections={selections}
          labelFor={labelFor}
          selectionFromCode={selectionFromCode}
          allLabel={allLabel}
          allInLabel={allInLabel}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
          applyLabel={applyLabel}
          cancelLabel={cancelLabel}
          emptyLabel={emptyLabel}
          onApply={onChange}
          close={close}
        />
      )}
    </PopoverMenu>
  );
};

export default HierarchyMultiSelectFilter;
