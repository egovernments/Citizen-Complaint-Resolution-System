import React, { useEffect, useRef, useState } from "react";
import useDashboardT from "../i18n/useDashboardT";
import { dimensionLabel } from "../i18n/dimensionLabel";
import PopoverMenu, { PopoverMenuItem } from "./ui/PopoverMenu";
import {
  ALL,
  TRAIL_ELLIPSIS,
  ancestorsOf,
  browseBaseCode,
  childrenOf,
  clearedSelection,
  nodeOf,
  selectionFromCode,
  truncateTrail,
} from "../utils/complaintTypeTree";

/**
 * The complaint-type filter as ONE compact chip + ONE traversal panel (owner
 * design pass: "tree traversing clean widget", no native <select>).
 *
 * CHIP (filter bar anchor): shows the applied selection — "All types" at
 * root, the node's label at depth 1, "Parent › Node" deeper (prefixed with
 * "… ›" when more ancestors are elided). Clicking opens the panel.
 *
 * PANEL (the whole traversal, via the shared PopoverMenu primitive):
 *   - ancestor TRAIL across the top — clickable crumbs BROWSE to that level
 *     (middle-truncated with an ellipsis for deep trees, endpoints kept);
 *   - the current node's CHILDREN as a scrollable list — an interior child
 *     (chevron) DESCENDS within the panel, a leaf click APPLIES + closes;
 *   - an explicit "All in <current>" first row applies the subtree + closes;
 *   - an "All types" reset row pinned at the bottom.
 *
 * Interaction choice — BROWSE-THEN-APPLY for interior traversal: descending
 * is navigation-in-progress, and applying every intermediate hop would fire
 * a full dashboard refetch per step of a drill-down; the subtree apply stays
 * one deliberate click ("All in <X>"), leaves apply instantly. Persistence
 * is untouched: applies still emit the { code, path, leaf } trio through
 * onFilterChange (leaf → serviceCode, interior → complaintPath) and browse
 * state lives only inside the open panel (it resets to the applied node on
 * every open, leaf selections opening at their parent so sibling switching
 * stays one click — the old flat-select ergonomics at that level).
 *
 * Labels resolve through dimensionLabel (skips taxonomy-path i18n messages
 * like reclamações.categories.* and humanises the last segment).
 */

export function nodeDisplayLabel(tree, code) {
  const node = nodeOf(tree, code);
  // dimensionLabel already humanises taxonomy-path messages / name===code.
  return dimensionLabel(code, "complaintType", node?.label);
}

/** Max rendered trail entries (root + ellipsis + 2 nearest) — ke's PGR_TEST
 *  4-level tree browses at depth 4 as: All types › … › <parent> › <node>. */
const TRAIL_MAX = 4;

/**
 * The panel body. Exported (also for the ReactDOMServer render smoke): pure
 * React against the tree + applied code, owns only the transient browse
 * location. Mounted fresh on every open, so browse state self-resets.
 */
export function ComplaintTypeTreePanel({ tree, appliedCode, onApply, t }) {
  const [browseCode, setBrowseCode] = useState(() => browseBaseCode(tree, appliedCode));
  const rootRef = useRef(null);
  const mountedRef = useRef(false);

  // After an in-panel browse hop the clicked row unmounts and DOM focus dies
  // on <body>; hand it to the new level's first LIST row (not the trail's
  // root crumb, which is first in document order) so arrow keys keep
  // working. Initial focus on open is the primitive's job, not ours.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const root = rootRef.current;
    const target =
      root?.querySelector(".dashboard-popover-list [data-menu-item]:not(:disabled)") ||
      root?.querySelector("[data-menu-item]:not(:disabled)");
    target?.focus();
  }, [browseCode]);

  const allTypesLabel = t("DASHBOARD_FILTERS_ALL_TYPES", "All types");
  const label = (c) => (c === ALL ? allTypesLabel : nodeDisplayLabel(tree, c));

  const atRoot = browseCode === ALL || !nodeOf(tree, browseCode);
  const browse = atRoot ? ALL : browseCode;
  const children = childrenOf(tree, browse);
  const trailCodes = atRoot ? [ALL] : [ALL, ...ancestorsOf(tree, browse), browse];
  const trail = truncateTrail(trailCodes, TRAIL_MAX);
  const elided =
    trail === trailCodes ? [] : trailCodes.filter((c) => !trail.includes(c));

  return (
    <div ref={rootRef} className="dashboard-popover-tree">
      <div className="dashboard-popover-trail" role="presentation">
        {trail.map((crumb, index) => {
          const isCurrent = index === trail.length - 1;
          if (crumb === TRAIL_ELLIPSIS) {
            return (
              <React.Fragment key={TRAIL_ELLIPSIS}>
                <span
                  className="dashboard-popover-trail-ellipsis"
                  title={elided.map(label).join(" › ")}
                  aria-hidden
                >
                  …
                </span>
                <span className="dashboard-popover-trail-sep" aria-hidden>
                  ›
                </span>
              </React.Fragment>
            );
          }
          if (isCurrent) {
            return (
              <span key={crumb} className="dashboard-popover-trail-current" title={label(crumb)}>
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
                title={label(crumb)}
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

      <div className="dashboard-popover-list">
        {!atRoot && (
          <PopoverMenuItem
            selected={appliedCode === browse}
            title={`${t("DASHBOARD_TYPE_FILTER_ALL_IN", "All in")} ${label(browse)}`}
            onSelect={() => onApply(browse)}
          >
            {`${t("DASHBOARD_TYPE_FILTER_ALL_IN", "All in")} ${label(browse)}`}
          </PopoverMenuItem>
        )}
        {children.map((child) => (
          <PopoverMenuItem
            key={child.code}
            selected={appliedCode === child.code ? true : child.isLeaf ? false : undefined}
            descend={!child.isLeaf}
            title={label(child.code)}
            onSelect={() =>
              child.isLeaf ? onApply(child.code) : setBrowseCode(child.code)
            }
          >
            {label(child.code)}
          </PopoverMenuItem>
        ))}
      </div>

      <div className="dashboard-popover-footer">
        <PopoverMenuItem
          muted
          selected={appliedCode === ALL || !nodeOf(tree, appliedCode)}
          onSelect={() => onApply(ALL)}
        >
          {allTypesLabel}
        </PopoverMenuItem>
      </div>
    </div>
  );
}

/** Chip content for the applied code: trailing segments + elision marker. */
function chipModel(tree, code, allTypesLabel) {
  const node = nodeOf(tree, code);
  if (!node) return { segments: [allTypesLabel], elided: false, title: allTypesLabel };
  const chain = [...ancestorsOf(tree, code), code].map((c) => nodeDisplayLabel(tree, c));
  const segments = chain.slice(-2);
  return {
    segments,
    elided: chain.length > 2,
    title: chain.join(" › "),
  };
}

const ComplaintTypeTreeFilter = ({ tree, filters, onFilterChange, t: tProp }) => {
  const { t: tHook } = useDashboardT();
  const t = tProp || tHook;

  const code = filters?.complaintType ?? ALL;
  const allTypesLabel = t("DASHBOARD_FILTERS_ALL_TYPES", "All types");
  const { segments, elided, title } = chipModel(tree, code, allTypesLabel);

  // UNCHANGED wire/persistence contract: applies emit the selection trio
  // (leaf → serviceCode, interior → complaintPath) through onFilterChange.
  const apply = (nextCode) => {
    onFilterChange(
      "complaintType",
      nextCode === ALL ? clearedSelection() : selectionFromCode(tree, nextCode)
    );
  };

  const chip = (
    <span className="dashboard-popover-trigger-trail">
      {elided && (
        <>
          <span className="dashboard-popover-trigger-seg dashboard-popover-trigger-seg--muted" aria-hidden>
            …
          </span>
          <span className="dashboard-popover-trigger-sep" aria-hidden>
            ›
          </span>
        </>
      )}
      {segments.map((segment, index) => (
        <React.Fragment key={`${index}-${segment}`}>
          {index > 0 && (
            <span className="dashboard-popover-trigger-sep" aria-hidden>
              ›
            </span>
          )}
          <span
            className={`dashboard-popover-trigger-seg${
              index < segments.length - 1 ? " dashboard-popover-trigger-seg--muted" : ""
            }`}
          >
            {segment}
          </span>
        </React.Fragment>
      ))}
    </span>
  );

  return (
    <PopoverMenu
      ariaLabel={t("DASHBOARD_FILTERS_COMPLAINT_TYPE_FILTER", "Complaint type filter")}
      chipTitle={title}
      chip={chip}
      panelWidth={288}
    >
      {({ close }) => (
        <ComplaintTypeTreePanel
          tree={tree}
          appliedCode={code}
          t={t}
          onApply={(nextCode) => {
            apply(nextCode);
            close();
          }}
        />
      )}
    </PopoverMenu>
  );
};

export default ComplaintTypeTreeFilter;
