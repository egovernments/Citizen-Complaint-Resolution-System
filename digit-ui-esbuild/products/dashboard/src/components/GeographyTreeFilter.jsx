import useDashboardT from "../i18n/useDashboardT";
import { dimensionLabel } from "../i18n/dimensionLabel";
import HierarchyMultiSelectFilter from "./HierarchyMultiSelectFilter";
import { nodeOf } from "../utils/complaintTypeTree";
import {
  geographyMultiSelectionFromCode,
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
