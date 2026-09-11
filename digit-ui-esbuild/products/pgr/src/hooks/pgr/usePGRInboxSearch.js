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
    const tenantId = params.tenantId || Digit.ULBService.getCurrentTenantId();

    // Build a statusMap from the PGR workflow business service so the inbox's
    // WorkflowStatusFilter renders a non-empty list of toggleable states.
    //
    // Built up front — BEFORE the empty-result early return — so the Status
    // filter card keeps its checkboxes even when the CURRENT filter matches
    // zero rows. Previously this was computed only on the non-empty path, so
    // selecting a status that momentarily returned nothing also wiped the
    // filter's own options (the "status filter shows no fields below" half of
    // issue #432), stranding the operator with no way to change the filter.
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

    // Per-complaint-type SLA budget (hours) from MDMS RAINMAKER-PGR.ComplaintHierarchy
    // leaves — the SAME master and `slaHours` field pgr-services reads to order the
    // inbox by SLA remaining (issue #432), so the number shown matches the server sort.
    //
    // Load them here rather than relying solely on the SessionStorage cache the inbox
    // filter fills on mount: the inbox search can resolve BEFORE that cache is
    // populated, and the react-query result is keyed only on the search params — it
    // never recomputes when serviceDefs land later. Without this, every fresh-load row
    // fell through to the fallback below and showed the wrong SLA.
    let serviceDefs = Digit.SessionStorage.get("serviceDefs");
    if (!Array.isArray(serviceDefs) || serviceDefs.length === 0) {
      try {
        serviceDefs = await Digit.MDMSService.getServiceDefs(tenantId, "PGR");
        if (Array.isArray(serviceDefs) && serviceDefs.length > 0) {
          Digit.SessionStorage.set("serviceDefs", serviceDefs);
        }
      } catch (e) {
        console.error("PGR inbox: serviceDefs fetch failed", e);
        serviceDefs = [];
      }
    }
    const slaHoursByCode = {};
    if (Array.isArray(serviceDefs)) {
      serviceDefs.forEach((d) => {
        if (d?.serviceCode != null && d?.slaHours != null) slaHoursByCode[d.serviceCode] = Number(d.slaHours);
      });
    }
    const DAY_MS = 24 * 60 * 60 * 1000;
    const HOUR_MS = 60 * 60 * 1000;
    // Uniform business-level SLA fallback for complaint types with no per-type
    // slaHours = pgr.business.level.sla (432000000 ms / 5 days) — the SAME default
    // pgr-services' SLA ORDER BY uses (PGRQueryBuilder.addOrderByClause →
    // config.getBusinessLevelSla), so display and server sort stay consistent.
    // The previous fallback read the workflow ProcessInstance's business-service
    // SLA (pi.businesssServiceSla) instead — a DIFFERENT, larger budget that
    // showed e.g. 14 days for a 5-day complaint (issue #432).
    const DEFAULT_SLA_MS = 432000000;

    return {
      items: wrappers.map((sw) => {
        const pi = wfMap[sw.service?.serviceRequestId] || {};
        // SLA days remaining = per-complaint-type SLA budget − elapsed since creation
        // (option 1 in the #432 thread: whole-complaint SLA, per type, from creation).
        // Falls back to the uniform business-level SLA when a type has no slaHours, so
        // the column never goes blank and stays consistent with the server-side sort.
        const slaHours = slaHoursByCode[sw.service?.serviceCode];
        const createdTime = sw.service?.auditDetails?.createdTime;
        let slaDays = null;
        if (createdTime != null) {
          const budgetMs = slaHours != null ? slaHours * HOUR_MS : DEFAULT_SLA_MS;
          slaDays = Math.round((budgetMs - (Date.now() - createdTime)) / DAY_MS);
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
