import React from "react";
import { DEFAULT_EGOV_LOGO_ON_DARK } from "../brandLogos";

/**
 * The panel icon every sidebar toggle people already use draws: a frame with
 * the rail marked off on the left, and a chevron pointing the way the rail will
 * move. Drawn inline so it takes `currentColor` from the sidebar's own text.
 */
const PanelIcon = ({ open }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
    {open ? <path d="m16 15-3-3 3-3" /> : <path d="m14 9 3 3-3 3" />}
  </svg>
);

/**
 * Top of the sidebar: the tenant's crest, and the one control that opens or
 * closes the rail. Open, they share a row; at 3rem there is no room for both
 * side by side, so the toggle drops under the crest.
 */
export const SidebarHead = ({ t, crestUrl, crestAlt, expanded, onToggle }) => {
  const label = expanded
    ? t("CORE_SIDEBAR_CLOSE", "Close sidebar")
    : t("CORE_SIDEBAR_OPEN", "Open sidebar");
  return (
    <div className={`digit-sidebar-head ${expanded ? "open" : "closed"}`}>
      {crestUrl ? <img className="digit-sidebar-crest" src={crestUrl} alt={crestAlt || ""} /> : null}
      {onToggle ? (
        <button
          type="button"
          className="digit-sidebar-toggle"
          aria-expanded={expanded}
          aria-label={label}
          title={label}
          onClick={onToggle}
        >
          <PanelIcon open={expanded} />
        </button>
      ) : null}
    </div>
  );
};

/**
 * Foot of the sidebar: the eGov lockup, only while the rail is open. At 3rem
 * a 112px wordmark would have to shrink to a smudge.
 */
export const SidebarFoot = ({ expanded }) =>
  expanded ? (
    <div className="digit-sidebar-foot">
      <img className="digit-sidebar-egov" src={DEFAULT_EGOV_LOGO_ON_DARK} alt="eGov Foundation" />
    </div>
  ) : null;
