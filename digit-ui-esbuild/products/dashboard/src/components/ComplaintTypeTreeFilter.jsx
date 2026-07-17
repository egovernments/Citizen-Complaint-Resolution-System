import React from "react";
import useDashboardT from "../i18n/useDashboardT";
import { dimensionLabel } from "../i18n/dimensionLabel";
import {
  ALL,
  ancestorsOf,
  childrenOf,
  humanizeTypeCode,
  nodeOf,
  parentOf,
  selectionFromCode,
  clearedSelection,
} from "../utils/complaintTypeTree";

/**
 * ONE compact tree-traversal widget for the complaint-type filter — replaces
 * the flat leaf <select> in the filter bar (owner design; the exhumed July
 * demo's growing chain-of-selects is deliberately NOT reproduced).
 *
 * From the current node:
 *   - breadcrumb-ish label: clickable ancestors ("All types" at root) — a
 *     click applies the filter AT that level (the up/back affordance),
 *   - one dropdown listing the CHILDREN of the current node — selecting a
 *     child descends AND applies (interior child → subtree filter, leaf
 *     child → exact type filter),
 *   - an up-chevron that applies the parent level (root clears).
 *
 * APPLY-ON-SELECT everywhere (validation required-change #3): traversal IS
 * application; there is no staged state and no Apply button — consistent with
 * the instant date/geography controls beside it.
 *
 * When a LEAF is applied, the dropdown shows the parent's children with the
 * leaf selected (a leaf has no children), so switching between sibling leaves
 * stays a one-click operation — exactly the old flat-select ergonomics at
 * that level. The dropdown's first option re-applies the current interior
 * level itself ("All types" at root / "All in <node>"), which is also how a
 * leaf selection steps back up without hunting for the chevron.
 *
 * Labels resolve through the dimensionLabel seam (COMPLAINT_HIERARCHY.<code>
 * first, then the master's data-owned name); interior nodes whose MDMS name
 * is just the code fall back to a humanised last-segment — never a raw
 * dotted code in the breadcrumb (validation risk #3ii).
 */

export function nodeDisplayLabel(tree, code) {
  const node = nodeOf(tree, code);
  const resolved = dimensionLabel(code, "complaintType", node?.label);
  return resolved === String(code) ? humanizeTypeCode(code) : resolved;
}

const UpIcon = () => (
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
    <path d="m18 15-6-6-6 6" />
  </svg>
);

const CRUMB_STYLE = {
  maxWidth: "9rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const ComplaintTypeTreeFilter = ({ tree, filters, onFilterChange, t: tProp }) => {
  const { t: tHook } = useDashboardT();
  const t = tProp || tHook;

  const code = filters?.complaintType ?? ALL;
  const current = nodeOf(tree, code); // null at root (or stale code pre-repair)
  const atRoot = !current;

  // The level the dropdown lists: the current node when it can be descended
  // into (root/interior), else the applied leaf's parent (sibling switching).
  const baseCode = atRoot || !current.isLeaf ? (atRoot ? ALL : code) : parentOf(tree, code);
  const children = childrenOf(tree, baseCode);

  const allTypesLabel = t("DASHBOARD_FILTERS_ALL_TYPES", "All types");
  const label = (c) => nodeDisplayLabel(tree, c);

  const apply = (nextCode) => {
    onFilterChange(
      "complaintType",
      nextCode === ALL ? clearedSelection() : selectionFromCode(tree, nextCode)
    );
  };

  // Breadcrumb trail: root sentinel + ancestors (clickable = applies at that
  // level), then the current node as plain text. At root only the sentinel
  // shows (as text — nothing to go back to).
  const trail = atRoot ? [] : [ALL, ...ancestorsOf(tree, code)];

  return (
    <div
      className="dashboard-type-tree-filter"
      role="group"
      aria-label={t("DASHBOARD_FILTERS_COMPLAINT_TYPE_FILTER", "Complaint type filter")}
    >
      <button
        type="button"
        className="dashboard-filters-clear-inline dashboard-type-tree-up"
        onClick={() => apply(atRoot ? ALL : parentOf(tree, code))}
        disabled={atRoot}
        aria-disabled={atRoot}
        title={t("DASHBOARD_TYPE_FILTER_UP", "Up one level")}
        aria-label={t("DASHBOARD_TYPE_FILTER_UP", "Up one level")}
      >
        <UpIcon />
      </button>

      <span className="dashboard-type-tree-crumbs">
        {trail.map((crumbCode) => (
          <React.Fragment key={crumbCode}>
            <button
              type="button"
              className="dashboard-type-tree-crumb"
              style={CRUMB_STYLE}
              onClick={() => apply(crumbCode)}
              title={crumbCode === ALL ? allTypesLabel : label(crumbCode)}
            >
              {crumbCode === ALL ? allTypesLabel : label(crumbCode)}
            </button>
            <span className="dashboard-type-tree-sep" aria-hidden>
              ›
            </span>
          </React.Fragment>
        ))}
        <span
          className="dashboard-type-tree-current"
          style={CRUMB_STYLE}
          title={atRoot ? allTypesLabel : label(code)}
        >
          {atRoot ? allTypesLabel : label(code)}
        </span>
      </span>

      {children.length > 0 && (
        <span className="dashboard-filter-inline-select-wrap">
          <select
            className="dashboard-filter-inline-select"
            // Leaf applied → the leaf (a sibling pick); else the base level itself.
            value={current?.isLeaf ? code : baseCode}
            onChange={(e) => apply(e.target.value)}
            aria-label={t("DASHBOARD_FILTERS_COMPLAINT_TYPE_FILTER", "Complaint type filter")}
          >
            <option value={baseCode}>
              {baseCode === ALL
                ? allTypesLabel
                : `${t("DASHBOARD_TYPE_FILTER_ALL_IN", "All in")} ${label(baseCode)}`}
            </option>
            {children.map((child) => (
              <option key={child.code} value={child.code}>
                {label(child.code)}
                {!child.isLeaf ? " ›" : ""}
              </option>
            ))}
          </select>
        </span>
      )}
    </div>
  );
};

export default ComplaintTypeTreeFilter;
