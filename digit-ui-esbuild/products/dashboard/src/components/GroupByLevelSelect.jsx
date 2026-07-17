import React from "react";
import useDashboardT from "../i18n/useDashboardT";
import { translate as t, exists } from "../i18n/localeRuntime";
import PopoverMenu, { PopoverMenuItem, PopoverMenuGroupLabel } from "./ui/PopoverMenu";

/**
 * Per-widget "Group by" hierarchy-level control (#1111 PR2), owner design
 * round 2: per-widget options live behind a small SETTINGS (gear) icon in
 * the widget header's title row — muted, 16px, the same icon-button idiom
 * as the widget remove control — so every header looks identical whether
 * or not a widget has options (the icon is simply absent when it has
 * none; the earlier labeled text chip made headers with it read
 * differently from headers without). Clicking opens the shared
 * PopoverMenu panel with "Group by" as the menu's section label above the
 * level options; the panel end-aligns so it stays on-screen for tiles
 * hugging the right edge.
 *
 * RGL: the anchor is a <button> (already in AdminDashboard's
 * draggableCancel list) and the panel portals to document.body, outside
 * the grid item — so using the menu can never start a widget drag.
 *
 * This is deliberately NOT a dashboard filter: it changes the widget's own
 * aggregation dimension (which level the service_code buckets roll up to),
 * never which complaints qualify.
 */

/** lucide "settings" gear — stroke/currentColor family of the header's
 *  remove (x) icon; 16px per the header icon sizing. */
const SettingsIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

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

const ChevronIcon = () => (
  <svg
    className="dashboard-widget-group-by-chevron"
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

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
  const currentLabel = current ? optionLabel(current) : String(value);

  return (
    <span className="dashboard-widget-settings-wrap">
      <PopoverMenu
        align="end"
        panelWidth={200}
        ariaLabel={label}
        chipTitle={`${label}: ${currentLabel}`}
        icon={<SettingsIcon />}
      >
        {({ close }) => (
          <div className="dashboard-popover-list">
            <PopoverMenuGroupLabel>{label}</PopoverMenuGroupLabel>
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
