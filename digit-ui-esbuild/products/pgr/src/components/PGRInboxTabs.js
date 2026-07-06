import React from "react";
import { useTranslation } from "react-i18next";

/**
 * PGRInboxTabs — the My / All tab strip for the PGR inbox (Visibility V1).
 *
 * The shared `Tab` atom renders labels through t()/capitalisation with no room
 * for a count + red-dot node, so we render a small purpose-built strip. Each tab
 * shows a "new since last opened" count and a red dot when that count > 0.
 */
const TABS = [
  { key: "MY", label: "PGR_INBOX_TAB_MY", fallback: "My Complaints" },
  { key: "ALL", label: "PGR_INBOX_TAB_ALL", fallback: "All Complaints" },
];

const PRIMARY = "#c84c0e"; // digit primary
const MUTED = "#505a5f";

const PGRInboxTabs = ({ activeTab, onChange, counts = {}, hasNew = {} }) => {
  const { t } = useTranslation();
  const label = (tab) => {
    const v = t(tab.label);
    return v === tab.label ? tab.fallback : v;
  };

  return (
    <div
      className="pgr-inbox-tabs"
      style={{ display: "flex", gap: "2rem", borderBottom: "1px solid #d6d5d4", margin: "0 0 16px 0" }}
    >
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        const count = counts[tab.key] || 0;
        const isNew = !!hasNew[tab.key];
        return (
          <div
            key={tab.key}
            role="button"
            onClick={() => onChange(tab.key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 4px",
              cursor: "pointer",
              color: active ? PRIMARY : MUTED,
              fontWeight: active ? 700 : 500,
              borderBottom: active ? `3px solid ${PRIMARY}` : "3px solid transparent",
              marginBottom: "-1px",
            }}
          >
            <span>{label(tab)}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
              {/* total count for this tab — always visible */}
              <span
                style={{
                  background: active ? PRIMARY : "#eee",
                  color: active ? "#fff" : MUTED,
                  borderRadius: "10px",
                  padding: "0 8px",
                  fontSize: "12px",
                  lineHeight: "18px",
                  minWidth: "18px",
                  textAlign: "center",
                }}
              >
                {count}
              </span>
              {/* red dot only when there's something new since last opened */}
              {isNew && (
                <span
                  aria-label="new"
                  style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#d4351c", display: "inline-block" }}
                />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default PGRInboxTabs;
