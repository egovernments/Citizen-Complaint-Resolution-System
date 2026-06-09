import { useQuery, useQueryClient } from "react-query";
import { useMemo } from "react";
import { CustomService } from "../../services/elements/CustomService";

/**
 * Custom hook for InboxSearchComposer that calls PGR search API directly
 * (instead of inbox-v2 which requires Elasticsearch), then enriches results
 * with workflow data client-side.
 *
 * Returns data in the same shape as the inbox-v2 API so existing column
 * configs and additionalCustomizations work unchanged.
 */
const usePGRInboxSearch = (reqCriteria) => {
  const client = useQueryClient();
  const { url, params = {}, body = {}, config = {} } = reqCriteria;

  const stableParams = useMemo(() => JSON.stringify(params), [params]);

  const fetchData = async () => {
    // 1. Call PGR search
    const pgrResponse = await CustomService.getResponse({ url, params, body });
    const wrappers = pgrResponse?.ServiceWrappers || [];

    if (wrappers.length === 0) {
      return { items: [], totalCount: 0, statusMap: [] };
    }

    // 2. Batch-fetch workflow process instances for all complaints on this page
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
        console.error("PGR inbox: workflow fetch failed, showing without SLA/assignee", e);
      }
    }

    // 3. Merge into inbox-compatible shape (matches inbox-v2 response structure)
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
      totalCount: wrappers.length,
      statusMap: [],
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
