import React from "react";
import useDashboardT from "../i18n/useDashboardT";
import { dimensionLabel } from "../i18n/dimensionLabel";
import PopoverMenu from "./ui/PopoverMenu";
import { ComplaintTypeTreePanel } from "./ComplaintTypeTreeFilter";
import { ALL, ancestorsOf, nodeOf } from "../utils/complaintTypeTree";
import {
  clearedGeographySelection,
  geographySelectionFromCode,
  humanizeBoundaryCode,
} from "../utils/boundaryTree";

/**
 * The geography (ward) filter as a boundary drill-down — Província →
 * Distrito → Município — instead of the flat ward list (CCSD-2171,
 * "similar to complaint type dropdown"). Chip + traversal panel are the
 * ComplaintTypeTreePanel verbatim (hierarchy-agnostic via labelFor/allLabel
 * props); this wrapper owns only geography-specific labeling and the
 * persisted-selection contract:
 *
 *   leaf (ward)          → { code, path, leaf:true }  → params.ward
 *   interior ("All in")  → { code, path, leaf:false } → params.boundaryPath
 *   "All wards" reset    → cleared trio
 *
 * Labels resolve through the same dimensionLabel("boundary") seam the flat
 * select uses (localized boundary names), with a humanized last-segment
 * fallback so a raw "municipio_maputo_katembe" never reaches the chip.
 */

export function boundaryDisplayLabel(tree, code) {
  const node = nodeOf(tree, code);
  const resolved = dimensionLabel(code, "boundary", node?.label);
  return resolved === String(code) ? humanizeBoundaryCode(code) : resolved;
}

/** Chip content for the applied code: trailing segments + elision marker. */
function chipModel(tree, code, allWardsLabel) {
  const node = nodeOf(tree, code);
  if (!node) return { segments: [allWardsLabel], elided: false, title: allWardsLabel };
  const chain = [...ancestorsOf(tree, code), code].map((c) => boundaryDisplayLabel(tree, c));
  const segments = chain.slice(-2);
  return {
    segments,
    elided: chain.length > 2,
    title: chain.join(" › "),
  };
}

const GeographyTreeFilter = ({ tree, filters, onFilterChange, t: tProp }) => {
  const { t: tHook } = useDashboardT();
  const t = tProp || tHook;

  const code = filters?.geography ?? ALL;
  const allWardsLabel = t("DASHBOARD_FILTERS_ALL_WARDS", "All wards");
  const { segments, elided, title } = chipModel(tree, code, allWardsLabel);

  // Applies emit the selection trio through onFilterChange (leaf → ward,
  // interior → boundaryPath); the flat fallback select's bare-string contract
  // is untouched for tenants/failures without a tree.
  const apply = (nextCode) => {
    onFilterChange(
      "geography",
      nextCode === ALL ? clearedGeographySelection() : geographySelectionFromCode(tree, nextCode)
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
      ariaLabel={t("DASHBOARD_FILTERS_WARD_FILTER", "Ward filter")}
      chipTitle={title}
      chip={chip}
      panelWidth={288}
    >
      {({ close }) => (
        <ComplaintTypeTreePanel
          tree={tree}
          appliedCode={code}
          t={t}
          labelFor={boundaryDisplayLabel}
          allLabel={allWardsLabel}
          allInLabel={t("DASHBOARD_GEO_FILTER_ALL_IN", "All in")}
          onApply={(nextCode) => {
            apply(nextCode);
            close();
          }}
        />
      )}
    </PopoverMenu>
  );
};

export default GeographyTreeFilter;
