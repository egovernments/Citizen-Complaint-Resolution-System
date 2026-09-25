import React, { useCallback, useLayoutEffect, useState } from "react";
import { SideNav } from "@egovernments/digit-ui-components";
import { useHistory } from "react-router-dom";
import MediaQuery from "react-responsive";
import { useEmployeeNavItems, navigateToEmployeeUrl } from "./employeeNavItems";
import { SidebarHead, SidebarFoot } from "./SidebarBrand";

/**
 * A pinned sidebar is a display preference, not user data: it survives a
 * reload but nothing downstream reads it, so one key per browser is the right
 * scope. (Contrast the dashboard layout, which is keyed by tenant+user
 * because two personas sharing a machine would otherwise overwrite each
 * other's saved arrangement.) A shared counter machine sharing this costs one
 * click to undo.
 */
const PINNED_STORAGE_KEY = "ccrs.employee.sidebar-pinned";

/**
 * The user's own choice wins. Without one, open where there is room for it:
 * with hover-to-open gone, a first visit to a closed rail shows a column of
 * unlabelled icons, and open, the labels teach the icons. Below 1280px the
 * open rail's 240px costs the page too much (an 834px tablet keeps 548px of
 * content), so there it starts closed.
 */
const OPEN_BY_DEFAULT_MIN_WIDTH = 1280;

function readPinned() {
  const fallback = typeof window !== "undefined" && window.innerWidth >= OPEN_BY_DEFAULT_MIN_WIDTH;
  try {
    const stored = window.localStorage.getItem(PINNED_STORAGE_KEY);
    return stored === null ? fallback : stored === "true";
  } catch {
    // Private windows and blocked site data throw on access rather than
    // returning null, so the read has to be guarded, not just null-checked.
    return fallback;
  }
}

const EmployeeSideBar = ({ t, crestUrl, crestAlt }) => {
  const { items } = useEmployeeNavItems();
  const [pinned, setPinned] = useState(readPinned);

  /**
   * The nav is `position: fixed`, so widening it cannot move anything on its
   * own — the page simply disappears underneath. Publishing the state on the
   * root element lets the stylesheet inset the employee surface by the same
   * width, over the same duration, so the content travels with the panel
   * instead of being covered by it (#2038 review). The top bar keys off the
   * same attribute, since it now starts where the rail ends.
   *
   * A layout effect, so the attribute is there before the first paint. As a
   * plain effect it landed a frame late: every load painted the collapsed
   * layout first and then animated open, which read as the page loading
   * broken.
   */
  useLayoutEffect(() => {
    document.documentElement.dataset.employeeSidebarPinned = pinned ? "true" : "false";
    return () => {
      delete document.documentElement.dataset.employeeSidebarPinned;
    };
  }, [pinned]);

  const onPinnedChange = useCallback((next) => {
    setPinned(next);
    try {
      window.localStorage.setItem(PINNED_STORAGE_KEY, next ? "true" : "false");
    } catch {
      // Preference is lost on reload, the nav still works. Nothing to do.
    }
  }, []);
  const isMultiRootTenant = Digit.Utils.getMultiRootTenant();
  const history = useHistory();
  const tenantId = Digit.ULBService.getStateId();

  const onItemSelect = ({ item }) => {
    if (item?.navigationUrl) {
      navigateToEmployeeUrl(history, item?.navigationUrl, { isMultiRootTenant, tenantId });
    }
  };

  // No early return while the nav items load. A spinner in place of the rail
  // meant the crest, the toggle and the rail's width all arrived late; the
  // rail renders at once and its rows fill in.
  return (
    <MediaQuery minWidth={768}>
      <SideNav
        items={items}
        hideAccessbilityTools={true}
        // #2038: drop the search affordance. SideNav defaults enableSearch to
        // true, which on a CCRS deployment buys a magnifier over a two-item
        // nav. The component already ships the collapsed `searchDisabled`
        // layout for this case, so nothing else has to move.
        enableSearch={false}
        onSelect={({ item, index, parentIndex }) => onItemSelect({ item, index, parentIndex })}
        theme={"dark"}
        variant={"primary"}
        // These three were empty strings, which is why the panel snapped open
        // rather than sliding. SideNav only writes an inline width when both
        // widths are supplied; without them it fell through to the stylesheet,
        // whose open state is `width:auto`, and `auto` cannot be animated.
        // The values match the stylesheet's own 3rem / 15rem so nothing moves
        // except the interpolation between them.
        transitionDuration={0.28}
        expandedWidth="15rem"
        collapsedWidth="3rem"
        className=""
        styles={{}}
        pinnable={true}
        pinned={pinned}
        onPinnedChange={onPinnedChange}
        // The toggle beside the crest is the only way to open or close the
        // rail now; the foot control and hover-to-open both go (#2038 review).
        hoverExpand={false}
        pinPlacement="none"
        renderHeader={({ expanded }) => (
          <SidebarHead
            t={t}
            crestUrl={crestUrl}
            crestAlt={crestAlt}
            expanded={expanded}
            onToggle={() => onPinnedChange(!pinned)}
          />
        )}
        renderFooter={({ expanded }) => <SidebarFoot expanded={expanded} />}
        onBottomItemClick={() => {}}
      />
    </MediaQuery>
  );
};

export default EmployeeSideBar;
