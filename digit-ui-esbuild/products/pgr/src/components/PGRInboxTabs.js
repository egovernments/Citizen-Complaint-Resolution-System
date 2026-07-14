import React from "react";
import { useTranslation } from "react-i18next";

/**
 * PGRInboxTabs — the My / All tab strip for the PGR inbox (Visibility V1).
 *
 * Rendered inside the composer's results column (via the `resultsHeader`
 * slot) so the tabs sit directly above the complaint list, per the PRD.
 *
 * Badge semantics (PRD): the (##) IS the alert count — complaints new in
 * the tab since the user last opened it (high-water-mark cursor, see
 * useTabCounts) — not the tab's total. The red dot accompanies a non-zero
 * count.
 */
const TABS = [
  { key: "MY", label: "PGR_INBOX_TAB_MY", fallback: "My Complaints" },
  { key: "ALL", label: "PGR_INBOX_TAB_ALL", fallback: "All Complaints" },
];

const PGRInboxTabs = ({ activeTab, onChange, counts = {} }) => {
  const { t } = useTranslation();
  const label = (tab) => {
    const v = t(tab.label);
    return v === tab.label ? tab.fallback : v;
  };

  return (
    <div className="pgr-inbox-tabs" role="tablist">
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        const count = counts[tab.key] || 0;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={`pgr-inbox-tab${active ? " active" : ""}`}
            onClick={() => onChange(tab.key)}
          >
            <span>{`${label(tab)} (${count})`}</span>
            {count > 0 && <span className="pgr-inbox-tab-dot" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
};

export default PGRInboxTabs;
