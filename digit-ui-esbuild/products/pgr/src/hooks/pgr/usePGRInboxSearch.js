import { useQuery, useQueryClient } from "react-query";
import { useMemo } from "react";
import { Request } from "@egovernments/digit-ui-libraries";

/**
 * usePGRInboxSearch — Custom hook for InboxSearchComposer.
 *
 * Calls PGR search API, then batch-fetches workflow data for the results,
 * and merges them into the shape the inbox table columns expect
 * ({businessObject: {service}, ProcessInstance, serviceSla}).
 */
/**
 * Build the Status-filter's checkbox list from the PGR workflow BusinessService.
 * Derived from the workflow definition (NOT the search results), so the Status
 * filter shows the full set of toggleable states even when a search returns zero
 * rows. Returns [] only if the BusinessService lookup fails.
 */
const buildPgrStatusMap = async (tenantId) => {
  try {
    const wfBs = await Request({
      url: "/egov-workflow-v2/egov-wf/businessservice/_search",
      method: "POST",
      auth: true,
      userService: true,
      useCache: true,
      params: { tenantId, businessServices: "PGR" },
    });
    const states = wfBs?.BusinessServices?.[0]?.states || [];
    return states
      .filter((s) => s.state)
      .map((s) => ({
        // WorkflowStatusFilter uses `statusid` as each checkbox's value, and
        // preProcess feeds the checked keys straight into the pgr-services
        // `applicationStatus` filter. pgr-services matches that against the
        // state CODE (e.g. PENDINGFORASSIGNMENT), not the workflow state UUID —
        // so the identifier must be the state code for a selection to filter.
        statusid: s.state,
        state: s.state,
        businessservice: "PGR",
      }));
  } catch (e) {
    console.error("PGR inbox: failed to fetch workflow states", e);
    return [];
  }
};

const usePGRInboxSearch = (reqCriteria) => {
  const client = useQueryClient();
  const { url, params = {}, body = {}, config = {} } = reqCriteria;
  const stableParams = useMemo(() => JSON.stringify(params), [params]);

  const fetchData = async () => {
    // Build count URL from search URL
    const countUrl = url.replace("_search", "_count");

    // 1. Call PGR search + count in parallel
    const [pgrResponse, countResponse] = await Promise.all([
      Request({
        url,
        method: "POST",
        auth: true,
        userService: true,
        useCache: false,
        params,
      }),
      Request({
        url: countUrl,
        method: "POST",
        auth: true,
        userService: true,
        useCache: false,
        params,
      }),
    ]);
    const wrappers = pgrResponse?.ServiceWrappers || [];
    const totalCount = countResponse?.count ?? wrappers.length;
    const tenantId = params.tenantId || Digit.ULBService.getCurrentTenantId();

    // Build the statusMap from the PGR workflow BusinessService UP-FRONT, so the
    // Status filter's checkboxes render regardless of how many rows the search
    // returns. WorkflowStatusFilter derives its checkbox list solely from
    // statusMap; the previous early `return {... statusMap: []}` on an empty
    // result set wiped the Status filter entirely (e.g. searching a province
    // with no complaints made every status checkbox disappear).
    const statusMap = await buildPgrStatusMap(tenantId);

    if (wrappers.length === 0) {
      return { items: [], totalCount, statusMap };
    }

    // 2. Batch-fetch workflow data
    const businessIds = wrappers
      .map((sw) => sw.service?.serviceRequestId)
      .filter(Boolean)
      .join(",");

    let wfMap = {};
    if (businessIds) {
      try {
        const wfResponse = await Digit.WorkflowService.getByBusinessId(
          tenantId,
          businessIds,
          {},
          false
        );
        (wfResponse?.ProcessInstances || []).forEach((pi) => {
          wfMap[pi.businessId] = pi;
        });
      } catch (e) {
        console.error("PGR inbox: workflow fetch failed", e);
      }
    }

    // Per-complaint-type SLA budget (hours) from MDMS ServiceDefs — the inbox filter
    // caches these in SessionStorage on mount. Used to show "SLA days remaining" per
    // type, matching the server-side sortBy=sla ordering (issue #432).
    const serviceDefs = Digit.SessionStorage.get("serviceDefs") || [];
    const slaHoursByCode = {};
    if (Array.isArray(serviceDefs)) {
      serviceDefs.forEach((d) => {
        if (d?.serviceCode != null && d?.slaHours != null) slaHoursByCode[d.serviceCode] = Number(d.slaHours);
      });
    }
    const DAY_MS = 24 * 60 * 60 * 1000;

    return {
      items: wrappers.map((sw) => {
        const pi = wfMap[sw.service?.serviceRequestId] || {};
        // SLA days remaining = per-type SLA budget (ServiceDefs.slaHours) − elapsed
        // since creation. Falls back to the workflow's uniform businesssServiceSla
        // when slaHours isn't available (serviceDefs not yet cached, or a type with
        // no slaHours) so the column never goes blank.
        const slaHours = slaHoursByCode[sw.service?.serviceCode];
        const createdTime = sw.service?.auditDetails?.createdTime;
        let slaDays = null;
        if (slaHours != null && createdTime != null) {
          slaDays = Math.round((slaHours * 60 * 60 * 1000 - (Date.now() - createdTime)) / DAY_MS);
        } else if (pi.businesssServiceSla != null) {
          slaDays = Math.round(pi.businesssServiceSla / DAY_MS);
        }
        return {
          businessObject: { service: sw.service, serviceSla: slaDays },
          ProcessInstance: pi,
        };
      }),
      totalCount,
      statusMap,
    };
  };

  const queryKey = useMemo(
    () => ["pgrInboxSearch", url, stableParams],
    [url, stableParams]
  );

  const { isLoading, data, isFetching, refetch, error } = useQuery(
    queryKey,
    fetchData,
    {
      enabled: config.enabled !== false,
      cacheTime: 0,
      staleTime: 0,
      keepPreviousData: true,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  return {
    isLoading,
    isFetching,
    data,
    refetch,
    error,
    revalidate: () => client.invalidateQueries(queryKey),
  };
};

export default usePGRInboxSearch;
