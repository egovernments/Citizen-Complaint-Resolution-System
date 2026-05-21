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

    if (wrappers.length === 0) {
      return { items: [], totalCount: totalCount, statusMap: [] };
    }

    // 2. Batch-fetch workflow data
    const businessIds = wrappers
      .map((sw) => sw.service?.serviceRequestId)
      .filter(Boolean)
      .join(",");
    const tenantId = params.tenantId || Digit.ULBService.getCurrentTenantId();

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

    // 3. Build a statusMap from the PGR workflow business service so the
    // inbox's WorkflowStatusFilter renders a non-empty list of toggleable
    // states. Previously this returned `[]`, so the Status filter card in
    // the inbox showed only its label and no checkboxes.
    let statusMap = [];
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
      statusMap = states
        .filter((s) => s.state)
        .map((s) => ({
          statusid: s.uuid,
          state: s.state,
          businessservice: "PGR",
        }));
    } catch (e) {
      console.error("PGR inbox: failed to fetch workflow states", e);
    }

    return {
      items: wrappers.map((sw) => {
        const pi = wfMap[sw.service?.serviceRequestId] || {};
        const slaDays =
          pi.businesssServiceSla != null
            ? Math.round(pi.businesssServiceSla / (24 * 60 * 60 * 1000))
            : null;
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
