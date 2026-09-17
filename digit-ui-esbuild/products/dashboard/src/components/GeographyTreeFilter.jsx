import React from "react";
import useDashboardT from "../i18n/useDashboardT";
import { dimensionLabel } from "../i18n/dimensionLabel";
import HierarchyMultiSelectFilter from "./HierarchyMultiSelectFilter";
import { nodeOf } from "../utils/complaintTypeTree";
import {
  geographyMultiSelectionFromCode,
  humanizeBoundaryCode,
} from "../utils/boundaryTree";

/** Geography hierarchy multi-select filter (CCSD-2171 / #1455). */


export function boundaryDisplayLabel(tree, code) {
  const node = nodeOf(tree, code);
  const resolved = dimensionLabel(code, "boundary", node?.label);
  return resolved === String(code) ? humanizeBoundaryCode(code) : resolved;
}

const GeographyTreeFilter = ({ tree, filters, onFilterChange, t: tProp }) => {
  const { t: tHook } = useDashboardT();
  const t = tProp || tHook;
  return (
    <HierarchyMultiSelectFilter
      tree={tree}
      selections={filters?.geographies ?? []}
      label={t("DASHBOARD_FILTERS_WARDS", "Wards")}
      allLabel={t("DASHBOARD_FILTERS_ALL_WARDS", "All wards")}
      ariaLabel={t("DASHBOARD_FILTERS_WARD_FILTER", "Ward filter")}
      labelFor={boundaryDisplayLabel}
      selectionFromCode={geographyMultiSelectionFromCode}
      allInLabel={t("DASHBOARD_GEO_FILTER_ALL_IN", "All in")}
      searchable
      searchPlaceholder={t("DASHBOARD_FILTERS_SEARCH_WARDS", "Search wards")}
      applyLabel={t("DASHBOARD_FILTERS_APPLY", "Apply")}
      cancelLabel={t("DASHBOARD_FILTERS_CANCEL", "Cancel")}
      emptyLabel={t("DASHBOARD_FILTERS_NO_MATCHES", "No matching options")}
      onChange={(selections) => onFilterChange("geographies", selections)}
    />
  );
};

export default GeographyTreeFilter;
