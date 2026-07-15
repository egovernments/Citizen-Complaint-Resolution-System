import { useState } from "react";
import { useQuery } from "react-query";
import { Request } from "@egovernments/digit-ui-libraries";
import Urls from "../../utils/urls";

/**
 * useTabCounts — tab badge counts (Visibility V1).
 *
 * PRD: the (##) on each tab is the ALERT count, not the total —
 *  - MY : complaints newly ASSIGNED-TO-ME-scoped since I last opened the tab
 *         (assignee = me, the same axis the My tab's list uses)
 *  - ALL: complaints newly added since the tab was last opened
 * realised as a high-water-mark cursor per (user, tenant, tab)
 * (VISIBILITY-DESIGN.md §5.5): badge = pgr `_count` over the tab's state
 * set with `fromDate = lastSeen`. Opening a tab advances its cursor, so
 * its badge drops to 0 and starts accumulating again (channel-unread
 * semantics). A never-opened tab counts everything currently in it.
 *
 * The cursor is mirrored into React state and into the query KEY: reading
 * it from localStorage inside the query fn raced markSeen (the refetch
 * deduped into an in-flight fetch that had already read the old cursor,
 * leaving a stale badge). A key change always refetches deterministically.
 *
 * Step-1 caveats (accepted, see design doc): the cursor keys off
 * `createdTime` (the only date filter the pgr criteria supports), so
 * complaints re-routed into the queue don't count until Step 2 keys off
 * state-entry time; and the cursor lives in localStorage, so it's
 * per-browser until Step 2 moves it server-side.
 */
const safeGet = (k) => {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
};
const safeSet = (k, v) => {
  try {
    window.localStorage.setItem(k, v);
  } catch (e) {
    /* storage unavailable (private mode / quota) — badge degrades to "all new" */
  }
};

const useTabCounts = ({ tenantId, allStates, enabled = true, serverSide = false }) => {
  const uuid = Digit.UserService.getUser()?.info?.uuid || "anon";
  const keyFor = (tab) => `pgr.inbox.lastSeen.${tenantId}.${tab}.${uuid}`;

  const [seen, setSeen] = useState(() => ({
    MY: Number(safeGet(keyFor("MY"))) || 0,
    ALL: Number(safeGet(keyFor("ALL"))) || 0,
  }));

  // Server mode counts through the visibility-aware endpoint (the server
  // resolves the tab's assignee/reportee scope from the `tab` param).
  const countUrl = serverSide ? Urls.pgr.visibilityCount : Urls.pgr.search.replace("_search", "_count");

  const rawCount = async (params) => {
    try {
      const res = await Request({ url: countUrl, method: "POST", auth: true, userService: true, useCache: false, params });
      return res?.count ?? 0;
    } catch (e) {
      return 0;
    }
  };

  const countsFor = async (tab) => {
    if (!allStates?.length) return { newCount: 0 };
    const since = seen[tab];
    const params = { tenantId, applicationStatus: allStates };
    if (serverSide) {
      // the server resolves the tab's visibility scope
      params.tab = tab;
    } else if (tab === "MY") {
      // MY is the assignee axis; requires the count-parity fix in
      // pgr-services PGRService.count() (same assignee resolution as search).
      params.assignee = [uuid];
    }
    if (since) params.fromDate = since;
    return { newCount: await rawCount(params) };
  };

  const { data, refetch } = useQuery(
    ["pgrTabCounts", tenantId, JSON.stringify(allStates), uuid, seen.MY, seen.ALL, serverSide],
    async () => {
      const [my, all] = await Promise.all([countsFor("MY"), countsFor("ALL")]);
      return { my, all };
    },
    { staleTime: 0, retry: false, refetchOnWindowFocus: false, enabled: !!tenantId && enabled, keepPreviousData: true }
  );

  const counts = { MY: data?.my?.newCount ?? 0, ALL: data?.all?.newCount ?? 0 };

  const markSeen = (tab) => {
    const now = Date.now();
    safeSet(keyFor(tab), String(now));
    setSeen((s) => ({ ...s, [tab]: now }));
  };

  return { counts, markSeen, refetch };
};

export default useTabCounts;
