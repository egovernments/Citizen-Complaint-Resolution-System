import { useQuery, useQueryClient } from "react-query";
import { useMemo } from "react";
import { Request } from "@egovernments/digit-ui-libraries";

/**
 * useAdminComplaintSearch — custom hook for the SUPERUSER Admin Complaint
 * Search screen (InboxSearchComposer customHookName "pgr.useAdminComplaintSearch").
 *
 * Calls POST /pgr-services/v2/request/_admin/_search (backend PR #1260) and
 * reshapes rows to the composer/table shape ({ businessObject: { service } }).
 *
 * totalCount workaround: the current backend build returns totalCount equal to
 * the page size (count query receives limit/offset — reported on #1260). Until
 * that lands, we over-fetch by ONE row: if limit+1 rows come back there is a
 * next page, and we report a synthetic total of offset+limit+1 so the table's
 * Next control stays enabled. When the backend starts returning a real total
 * (> rows fetched), we trust it as-is — no FE change needed then.
 */
const useAdminComplaintSearch = (reqCriteria) => {
  const client = useQueryClient();
  const { url, params = {}, config = {} } = reqCriteria;
  const stableParams = useMemo(() => JSON.stringify(params), [params]);

  const fetchData = async () => {
    const limit = Number(params.limit) > 0 ? Number(params.limit) : 20;
    const offset = Number(params.offset) >= 0 ? Number(params.offset) : 0;
    const probeParams = { ...params, limit: Math.min(limit + 1, 50), offset };

    const response = await Request({
      url,
      method: "POST",
      auth: true,
      userService: true,
      useCache: false,
      params: probeParams,
    });

    const all = response?.ServiceWrappers || [];
    const hasMore = all.length > limit;
    const wrappers = hasMore ? all.slice(0, limit) : all;

    const backendTotal = Number(response?.totalCount);
    const trustBackendTotal = Number.isFinite(backendTotal) && backendTotal > all.length;
    const totalCount = trustBackendTotal
      ? backendTotal
      : offset + wrappers.length + (hasMore ? 1 : 0);

    return {
      items: wrappers.map((sw) => ({ businessObject: { service: sw.service } })),
      totalCount,
    };
  };

  const queryKey = useMemo(() => ["pgrAdminSearch", url, stableParams], [url, stableParams]);

  const { isLoading, data, isFetching, refetch, error } = useQuery(queryKey, fetchData, {
    enabled: config.enabled !== false,
    cacheTime: 0,
    staleTime: 0,
    keepPreviousData: true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return {
    isLoading,
    isFetching,
    data,
    refetch,
    error,
    revalidate: () => client.invalidateQueries(queryKey),
  };
};

export default useAdminComplaintSearch;
