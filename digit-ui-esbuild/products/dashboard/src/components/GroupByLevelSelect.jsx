import React from "react";
import useDashboardT from "../i18n/useDashboardT";
import { translate as t, exists } from "../i18n/localeRuntime";
import PopoverMenu, { PopoverMenuItem } from "./ui/PopoverMenu";

/**
 * Per-widget "Group by" hierarchy-level control (#1111 PR2), design pass:
 * a small labeled chip ("Group: Category") in the widget header's title row
 * opening the level menu through the shared PopoverMenu primitive — no
 * native <select>. The compact chip keeps to one line (prefix fixed, value
 * truncates) so it never wraps narrow widgets, and end-aligns its panel so
 * the menu stays on-screen for tiles hugging the right edge.
 *
 * RGL: the chip is a <button> (already in AdminDashboard's draggableCancel
 * list) and the panel portals to document.body, outside the grid item — so
 * using the menu can never start a widget drag.
 *
 * This is deliberately NOT a dashboard filter: it changes the widget's own
 * aggregation dimension (which level the service_code buckets roll up to),
 * never which complaints qualify.
 */

/**
 * Localized display name for a hierarchy level. Resolution mirrors the
 * dashboard's key-wins-else-data-owned convention:
 *   1. dashboard-owned DASHBOARD_GROUPBY_LEVEL_<LEVELCODE> (seeded pack)
 *   2. the PGR pages' <HIERARCHYTYPE>_<LEVELCODE> convention (operator-seeded)
 *   3. the definition's data-owned label (when it isn't just the raw code)
 *   4. the raw levelCode — a visible localisation gap, not a humanised guess
 */
export function levelDisplayLabel(level, hierarchyType) {
  if (!level) return "";
  const code = String(level.levelCode || "");
  const own = `DASHBOARD_GROUPBY_LEVEL_${code.toUpperCase()}`;
  if (exists(own)) return t(own);
  if (hierarchyType) {
    const pgrKey = `${String(hierarchyType)}_${code}`.toUpperCase();
    if (exists(pgrKey)) return t(pgrKey);
  }
  if (level.label && level.label !== code) return level.label;
  return code;
}

const GroupByLevelSelect = ({ value, options, hierarchyType, onChange }) => {
  // Subscribes the control to language/bundle changes so option labels
  // re-resolve on a language switch.
  const { t: tt } = useDashboardT();
  const label = tt("DASHBOARD_GROUPBY_LABEL", "Group by");
  const optionLabel = (opt) =>
    opt.leaf
      ? tt("DASHBOARD_GROUPBY_LEAF", "Leaf")
      : levelDisplayLabel(opt.level, hierarchyType);
  const current = options.find((opt) => opt.value === value);

  return (
    <span className="dashboard-groupby-chip-wrap">
      <PopoverMenu
        compact
        align="end"
        panelWidth={200}
        ariaLabel={label}
        chipTitle={label}
        chipPrefix={tt("DASHBOARD_GROUPBY_CHIP", "Group")}
        chip={current ? optionLabel(current) : String(value)}
      >
        {({ close }) => (
          <div className="dashboard-popover-list">
            {options.map((opt) => (
              <PopoverMenuItem
                key={opt.value}
                selected={opt.value === value}
                onSelect={() => {
                  onChange(opt.value);
                  close();
                }}
              >
                {optionLabel(opt)}
              </PopoverMenuItem>
            ))}
          </div>
        )}
      </PopoverMenu>
    </span>
  );
};

export default GroupByLevelSelect;
