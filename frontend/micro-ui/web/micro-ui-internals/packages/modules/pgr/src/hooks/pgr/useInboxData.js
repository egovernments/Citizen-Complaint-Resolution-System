import { useQuery, useQueryClient } from "react-query";

const useInboxData = (searchParams) => {
  const client = useQueryClient();

  const fetchInboxData = async () => {
    const tenantId = Digit.ULBService.getCurrentTenantId();
    let serviceIds = [];
    let commonFilters = { start: 1, end: 10 };
    const { limit, offset } = searchParams;
    let appFilters = { ...commonFilters, ...searchParams.filters.pgrQuery, ...searchParams.search, limit, offset };
    let wfFilters = { ...commonFilters, ...searchParams.filters.wfQuery };
    let complaintDetailsResponse = null;
    complaintDetailsResponse = await Digit.PGRService.search(tenantId, appFilters);
    complaintDetailsResponse.ServiceWrappers.forEach((service) => serviceIds.push(service.service.serviceRequestId));

    if (serviceIds.length === 0) {
      return [];
    }

    const serviceIdParams = serviceIds.join();

    // Workflow enrichment is best-effort — render rows even if workflow is unavailable
    let workflowInstances = { ProcessInstances: [] };
    try {
      workflowInstances = await Digit.WorkflowService.getByBusinessId(tenantId, serviceIdParams, wfFilters, false) || { ProcessInstances: [] };
    } catch (e) {
      console.warn("Workflow service unavailable, showing complaints without workflow data:", e);
    }

    let combinedRes = combineResponses(complaintDetailsResponse, workflowInstances).map((data) => ({
      ...data,
      sla: data.sla != null ? Math.round(data.sla / (24 * 60 * 60 * 1000)) : null,
    }));

    // BUG-3 fix: Client-side assignee filtering.
    // The workflow API doesn't support assignee filtering as a query param.
    // Filter results here based on the wfFilters.assignee value.
    const assigneeFilter = searchParams?.filters?.wfFilters?.assignee;
    const processInstances = workflowInstances?.ProcessInstances || [];
    if (assigneeFilter?.length && assigneeFilter[0]?.code && processInstances.length) {
      const assigneeUuid = assigneeFilter[0].code;
      combinedRes = combinedRes.filter((item) => {
        const wf = processInstances.find(
          (pi) => pi.businessId === item.serviceRequestId
        );
        return wf?.assignes?.some((a) => a.uuid === assigneeUuid);
      });
    }

    return combinedRes;
  };

  const result = useQuery(
    ["fetchInboxData",
      ...Object.keys(searchParams).map(i =>
        typeof searchParams[i] === "object" ? Object.keys(searchParams[i]).map(e => searchParams[i][e]) : searchParams[i]
      )
    ],
    fetchInboxData,
    { staleTime: Infinity }
  );
  return { ...result, revalidate: () => client.refetchQueries(["fetchInboxData"]) };
};

const mapWfBybusinessId = (wfs) => {
  return wfs.reduce((object, item) => {
    return { ...object, [item["businessId"]]: item };
  }, {});
};

const combineResponses = (complaintDetailsResponse, workflowInstances) => {
  let wfMap = mapWfBybusinessId(workflowInstances?.ProcessInstances || []);
  const wrappers = complaintDetailsResponse?.ServiceWrappers || [];

  return wrappers.map((complaint) => ({
    serviceRequestId: complaint.service.serviceRequestId,
    complaintSubType: complaint.service.serviceCode,
    locality: complaint.service.address?.locality?.code || "",
    status: complaint.service.applicationStatus,
    taskOwner: wfMap[complaint.service.serviceRequestId]?.assignes?.[0]?.name || "-",
    sla: wfMap[complaint.service.serviceRequestId]?.businesssServiceSla,
    tenantId: complaint.service.tenantId,
  }));
};

export default useInboxData;
