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

    // pgr-services' _count is genuinely unpaginated (LIMIT NULL / no OFFSET
    // is treated as "no limit"), but reuses the same criteria object as
    // _search — forwarding the UI's page-size limit/offset into it made the
    // reported total cap out at one page (#916). Drop both so the backend
    // returns the true total.
    const { limit, offset, ...countParams } = params;

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
        params: countParams,
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
          // WorkflowStatusFilter uses `statusid` as each checkbox's value, and
          // PGRInboxConfig.preProcess feeds the checked keys straight into the
          // pgr-services `applicationStatus` filter. pgr-services matches that
          // against the state CODE (e.g. PENDINGFORASSIGNMENT), not the workflow
          // state UUID — so emitting `s.uuid` here made every status selection
          // return zero rows and the inbox list vanished (issue #432). Use the
          // state code as the identifier so a selection actually filters.
          statusid: s.state,
          state: s.state,
          businessservice: "PGR",
        }));
    } catch (e) {
      console.error("PGR inbox: failed to fetch workflow states", e);
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
