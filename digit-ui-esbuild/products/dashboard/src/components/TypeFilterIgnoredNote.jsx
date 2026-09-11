import React from "react";
import useDashboardT from "../i18n/useDashboardT";

/**
 * Subtle per-tile note shown when the backend reports it could NOT honour the
 * subtree complaint-type filter on this KPI's grain (response envelope
 * `paramsIgnored: ["complaintPath"]` — the daily grain has `service_code` but
 * no `complaint_node_path`, so interior-node filters silently no-op there,
 * #1282). Without this the tile would look filtered while showing unfiltered
 * numbers (validation risk #1). Leaf selections still filter everywhere via
 * `serviceCode`, so the note only ever appears for interior-node selections.
 *
 * Mirrors CardUpdatedStamp's chrome (bottom-LEFT, same type scale) so it
 * reads as tile metadata, not an error.
 */

/** True when this tile's base result reports the subtree filter was ignored. */
export function typeFilterIgnored(result) {
  return (
    Array.isArray(result?.paramsIgnored) &&
    result.paramsIgnored.includes("complaintPath")
  );
}

const TypeFilterIgnoredNote = () => {
  const { t } = useDashboardT();
  const text = t("DASHBOARD_TYPE_FILTER_NOT_APPLIED", "Type filter not applied");
  return (
    <span className="dashboard-type-filter-ignored" title={text}>
      {text}
    </span>
  );
};

export default TypeFilterIgnoredNote;
