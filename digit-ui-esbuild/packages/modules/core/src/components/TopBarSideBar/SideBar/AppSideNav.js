import React, { useCallback, useLayoutEffect, useState } from "react";
import { SideNav } from "@egovernments/digit-ui-components";
import { SidebarHead, SidebarFoot } from "./SidebarBrand";

/**
 * The collapsible rail the employee and citizen apps both render. They differ
 * only in their rows and in where the open/closed choice is kept, so the rail
 * itself, its head and foot, and the page offset it publishes live here once.
 */

/**
 * Open unless the user closed it. With hover-to-open gone, a first visit to a
 * closed rail shows a column of unlabelled icons, and open, the labels teach
 * the icons. Below 1280px the open rail's 240px costs the page too much (an
 * 834px tablet keeps 548px of content), so there it starts closed.
 */
const OPEN_BY_DEFAULT_MIN_WIDTH = 1280;

function readPinned(storageKey) {
  const fallback = typeof window !== "undefined" && window.innerWidth >= OPEN_BY_DEFAULT_MIN_WIDTH;
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored === null ? fallback : stored === "true";
  } catch {
    // Private windows and blocked site data throw on access rather than
    // returning null, so the read has to be guarded, not just null-checked.
    return fallback;
  }
}

export const AppSideNav = ({ t, items, storageKey, crestUrl, crestAlt, onItemSelect }) => {
  const [pinned, setPinned] = useState(() => readPinned(storageKey));

  /**
   * The nav is `position: fixed`, so widening it cannot move anything on its
   * own; the page simply disappears underneath. Publishing the state on the
   * root element lets the stylesheet inset the page and the top bar by the
   * same width, over the same duration, so both travel with the panel.
   *
   * A layout effect, so the attribute is there before the first paint. As a
   * plain effect it landed a frame late: every load painted the collapsed
   * layout first and then animated open.
   */
  useLayoutEffect(() => {
    document.documentElement.dataset.sidebarPinned = pinned ? "true" : "false";
    return () => {
      delete document.documentElement.dataset.sidebarPinned;
    };
  }, [pinned]);

  const onPinnedChange = useCallback(
    (next) => {
      setPinned(next);
      try {
        window.localStorage.setItem(storageKey, next ? "true" : "false");
      } catch {
        // Preference is lost on reload, the nav still works. Nothing to do.
      }
    },
    [storageKey]
  );

  return (
    <SideNav
      items={items}
      hideAccessbilityTools={true}
      // No search box: SideNav defaults it on, which buys a magnifier over a
      // handful of rows.
      enableSearch={false}
      onSelect={({ item }) => onItemSelect?.(item)}
      theme={"dark"}
      variant={"primary"}
      // Concrete widths so the width genuinely animates; the stylesheet's open
      // state is `width: auto`, which cannot be interpolated.
      transitionDuration={0.28}
      expandedWidth="15rem"
      collapsedWidth="3rem"
      className=""
      styles={{}}
      pinnable={true}
      pinned={pinned}
      onPinnedChange={onPinnedChange}
      // The toggle beside the crest is the only way to open or close the rail;
      // no foot control, no hover-to-open.
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
  );
};
