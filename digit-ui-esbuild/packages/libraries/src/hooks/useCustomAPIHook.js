import { useQuery, useQueryClient } from "react-query";
import { useMemo } from "react";
import { CustomService } from "../services/elements/CustomService";
import idbCache from "../services/atoms/Utils/idbCache";

/**
 * Custom hook which can make an API call and format the response.
 *
 * @author jagankumar-egov
 *
 * @example
 * 
 const requestCriteria = [
      "/user/_search",             // API details
    {},                            //requestParam
    {data : {uuid:[Useruuid]}},    // requestBody
    {} ,                           // privacy value 
    {                              // other configs
      enabled: privacyState,
      cacheTime: 100,
      select: (data) => {
                                    // format data
        return  _.get(data, loadData?.jsonPath, value);
      },
    },
  ];
  const { isLoading, data, revalidate } = Digit.Hooks.useCustomAPIHook(...requestCriteria);

 *
 * @returns {Object} Returns the object which contains data and isLoading flag
 */

const useCustomAPIHook = ({
  url,
  params = {},
  body = {},
  config = {},
  headers = {},
  method = "POST",
  plainAccessRequest,
  changeQueryName = "Random",
  options = {},
}) => {
  const client = useQueryClient();

  // Memoize body and params to prevent unnecessary re-fetching. Both are
  // serialized because callers rebuild these objects on every render — the
  // CONTENT is what identifies a request, not the object reference.
  const stableBody = useMemo(() => JSON.stringify(body), [body]);
  // params belongs in the identity too: several callers put the ENTIRE request
  // identity there and leave body empty (AuditHistory pagination offset/limit;
  // open-payment OpenView consumerCode/tenantId/businessService). Without it
  // those share one cache entry, so paging serves the previous page and two
  // different bills collide. Repo-wide audit of all 60 callsites found none
  // whose params content churns per render, so this cannot cause refetch loops.
  const stableParams = useMemo(() => JSON.stringify(params), [params]);

  const queryKey = useMemo(
    () => [url, changeQueryName, stableBody, stableParams],
    [url, changeQueryName, stableBody, stableParams]
  );

  // Opt-in cross-session persistence: when a caller passes options.idbTtlSecs,
  // the raw response is cached in IndexedDB (idbCache) under a key derived from
  // the query identity (changeQueryName + body + params — already tenant-scoped),
  // so a page reload / re-mount serves it instantly instead of re-hitting the
  // network. Used by the MDMS v2 dropdown path (master data that changes
  // rarely). No-op for every other caller (idbTtlSecs undefined).
  //
  // stableParams MUST be part of this key for the same reason it is part of
  // queryKey: once the in-memory key distinguishes params but this one does
  // not, two queries become separate react-query entries that share a single
  // IndexedDB slot, and a reload serves one caller the other's response.
  const idbTtlSecs = options?.idbTtlSecs;
  const persistKey = idbTtlSecs ? "apihook." + changeQueryName + "." + stableBody + "." + stableParams : null;

  // Fetch function with error handling
  const fetchData = async () => {
    try {
      if (persistKey) {
        const cached = await idbCache.get(persistKey);
        if (cached != null) return cached; // IndexedDB hit — skip the network call
      }
      const response = await CustomService.getResponse({ url, params, body, plainAccessRequest, headers, method, ...options });
      const value = response || null; // Ensure it never returns undefined
      if (persistKey && value != null) idbCache.set(persistKey, value, idbTtlSecs); // fire-and-forget persist
      return value;
    } catch (error) {
      console.error("Error fetching data:", error);
      throw error; // React Query will handle retries if needed
    }
  };

  const { isLoading, data, isFetching, refetch } = useQuery(queryKey, fetchData, {
    // When persisting to IndexedDB, also hold it in-memory for the session so a
    // re-mount doesn't refetch; otherwise keep the prior 1s/5s defaults.
    cacheTime: options?.cacheTime || (idbTtlSecs ? idbTtlSecs * 1000 : 1000),
    staleTime: options?.staleTime || (idbTtlSecs ? idbTtlSecs * 1000 : 5000),
    keepPreviousData: true,
    retry: 2,
    refetchOnWindowFocus: false,
    ...config,
  });

  return {
    isLoading,
    isFetching,
    data,
    refetch,
    revalidate: () => {
      if (data) {
        client.invalidateQueries(queryKey);
      }
    },
  };
};

export default useCustomAPIHook;