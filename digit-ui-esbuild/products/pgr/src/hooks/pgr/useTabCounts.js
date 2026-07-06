import { useQuery } from "react-query";
import { Request } from "@egovernments/digit-ui-libraries";
import Urls from "../../utils/urls";

/**
 * useTabCounts — tab badge counts.
 *
 * Returns two things per tab:
 *  - `counts`  : the TOTAL number of complaints in that tab's state set — always
 *                shown on the badge so a number is always visible.
 *  - `hasNew`  : whether any complaints arrived since the user last opened that
 *                tab (high-water-mark cursor, CCRS/VISIBILITY-DESIGN.md §5.5) —
 *                drives the red "new" dot only.
 *
 * Cursor is one `lastSeen` per (user, tab) in localStorage; "new" is a pgr `_count`
 * with `fromDate = lastSeen`. Step-1 caveat: `_count` filters on `createdTime`, so
 * "new" means *created* since you last looked (Step 2 moves the cursor server-side
 * and keys off state-entry time).
 */
const useTabCounts = ({ tenantId, myStates, allStates }) => {
  const uuid = Digit.UserService.getUser()?.info?.uuid || "anon";
  const keyFor = (tab) => `pgr.inbox.lastSeen.${tab}.${uuid}`;
  const getSeen = (tab) => Number(window.localStorage.getItem(keyFor(tab))) || 0;

  const countUrl = Urls.pgr.search.replace("_search", "_count");

  const rawCount = async (params) => {
    try {
      const res = await Request({ url: countUrl, method: "POST", auth: true, userService: true, useCache: false, params });
      return res?.count ?? 0;
    } catch (e) {
      return 0;
    }
  };

  // total (always shown) + new-since-lastSeen (drives the red dot)
  const countsFor = async (statuses, tab) => {
    if (!statuses?.length) return { total: 0, newCount: 0 };
    const total = await rawCount({ tenantId, applicationStatus: statuses });
    const since = getSeen(tab);
    const newCount = since ? await rawCount({ tenantId, applicationStatus: statuses, fromDate: since }) : total;
    return { total, newCount };
  };

  const { data, refetch } = useQuery(
    ["pgrTabCounts", tenantId, JSON.stringify(myStates), JSON.stringify(allStates), uuid],
    async () => {
      const [my, all] = await Promise.all([countsFor(myStates, "MY"), countsFor(allStates, "ALL")]);
      return { my, all };
    },
    { staleTime: 0, retry: false, refetchOnWindowFocus: false, enabled: !!tenantId }
  );

  const counts = { MY: data?.my?.total ?? 0, ALL: data?.all?.total ?? 0 };
  const hasNew = { MY: (data?.my?.newCount ?? 0) > 0, ALL: (data?.all?.newCount ?? 0) > 0 };

  const markSeen = (tab) => {
    window.localStorage.setItem(keyFor(tab), String(Date.now()));
    refetch();
  };

  return { counts, hasNew, markSeen, refetch };
};

export default useTabCounts;
