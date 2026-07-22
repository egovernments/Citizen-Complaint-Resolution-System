import { useQuery, useQueryClient } from "react-query";

// TODO: move to service
const getThumbnails = async (ids, tenantId) => {
  const res = await Digit.UploadServices.Filefetch(ids, tenantId);
  if (res.data.fileStoreIds && res.data.fileStoreIds.length !== 0) {
    return { thumbs: res.data.fileStoreIds.map((o) => o.url.split(",")[3]), images: res.data.fileStoreIds.map((o) => Digit.Utils.getFileUrl(o.url)) };
  } else {
    return null;
  }
};

// County / Sub-County / Ward are NOT stored on the complaint (only the leaf
// locality code is) and the backend does not enrich them — verified against
// live PGR data (CCRS#927). Derive the full chain from the boundary hierarchy
// by asking boundary-service for the locality's ancestors. Returns an ordered
// list (root → leaf), each entry carrying the boundaryType + code so the
// caller can label and localize them. Resolves to [] on any failure so the
// detail view degrades gracefully rather than erroring.
const fetchBoundaryAncestors = async (tenantId, localityCode) => {
  if (!tenantId || !localityCode) return [];
  const hierarchyType = window?.globalConfigs?.getConfig?.("HIERARCHY_TYPE") || "ADMIN";
  try {
    const res = await Digit.CustomService.getResponse({
      url: "/boundary-service/boundary-relationships/_search",
      useCache: false,
      method: "POST",
      userService: false,
      params: { tenantId, hierarchyType, codes: localityCode, includeParents: true },
    });
    // includeParents returns a single root → leaf chain; walk children[0] down
    // to the requested locality, collecting one entry per level.
    const chain = [];
    let node = res?.TenantBoundary?.[0]?.boundary?.[0];
    while (node) {
      chain.push({ boundaryType: node.boundaryType, code: node.code, hierarchyType });
      if (node.code === localityCode) break;
      node = node.children && node.children[0];
    }
    return chain;
  } catch (e) {
    return [];
  }
};

const getDetailsRow = ({ id, service, complaintType }) => ({
  CS_COMPLAINT_DETAILS_COMPLAINT_NO: id,
  CS_COMPLAINT_DETAILS_APPLICATION_STATUS: `CS_COMMON_${service.applicationStatus}`,
  // Key-based (COMPLAINT_HIERARCHY.<code>) — the display t()s these values, so
  // they resolve per-locale like every other service. complaintType is the
  // parent node code (already upper-cased); serviceCode is the leaf.
  CS_ADDCOMPLAINT_COMPLAINT_TYPE: complaintType === "" ? `CS_COMPLAINT_TYPE_OTHERS` : `COMPLAINT_HIERARCHY.${complaintType}`,
  CS_ADDCOMPLAINT_COMPLAINT_SUB_TYPE: `COMPLAINT_HIERARCHY.${service.serviceCode.toUpperCase()}`,
  CS_COMPLAINT_ADDTIONAL_DETAILS: service.description,
  CS_COMPLAINT_FILED_DATE: Digit.DateUtils.ConvertTimestampToDate(service.auditDetails.createdTime),
  // QA #31/#25: the Endereço row shows ONLY what the complainant typed —
  // the boundary key (ADMIN_<code>) and the tenant name (TENANT_TENANTS_*)
  // were concatenated here and rendered as raw codes / authority names
  // ("MZ_IGE_ADMIN_hungaro", "…, Matola, IGSAE"). Both removed per product
  // call; buildingName/street included so employee-created complaints (which
  // store the address there) still show their address.
  ES_CREATECOMPLAINT_ADDRESS: [
    service.address.buildingName,
    service.address.street,
    service.address.landmark,
    service.address.pincode,
  ],
});

const isEmptyOrNull = (obj) => obj === undefined || obj === null || Object.keys(obj).length === 0;

const transformDetails = ({ id, service, workflow, thumbnails, complaintType, boundaryAncestors }) => {
  const { Customizations, SessionStorage } = window.Digit;
  const role = (SessionStorage.get("user_type") || "CITIZEN").toUpperCase();
  const customDetails = Customizations?.PGR?.getComplaintDetailsTableRows
    ? Customizations.PGR.getComplaintDetailsTableRows({ id, service, role })
    : {};
  return {
    details: !isEmptyOrNull(customDetails) ? customDetails : getDetailsRow({ id, service, complaintType, boundaryAncestors }),
    thumbnails: thumbnails?.thumbs,
    images: thumbnails?.images,
    workflow: workflow,
    service,
    audit: {
      citizen: service.citizen,
      details: service.auditDetails,
      source: service.source,
      rating: service.rating,
      serviceCode: service.serviceCode,
    },
    service: service,
  };
};

const fetchComplaintDetails = async (tenantId, id) => {
  // getServiceDefs sources leaf complaint types from ComplaintHierarchy and
  // adapts them to the legacy shape (the leaf row whose `code` === serviceCode).
  var serviceDefs = await Digit.MDMSService.getServiceDefs(tenantId, "PGR");
  const { service, workflow } = (await Digit.PGRService.search(tenantId, { serviceRequestId: id })).ServiceWrappers[0] || {};
  Digit.SessionStorage.set("complaintDetails", { service, workflow });
  if (service && workflow && serviceDefs) {
    const matchedDef = serviceDefs.find((def) => def.serviceCode === service.serviceCode);
    // Type label derives from the leaf's parent node (parentCode), which the
    // adapter mirrors onto `menuPath`. No standalone menuPath master anymore.
    const complaintType = (matchedDef?.parentCode || matchedDef?.menuPath || "").toUpperCase();
    const ids = workflow.verificationDocuments
      ? workflow.verificationDocuments.filter((doc) => doc.documentType === "PHOTO").map((photo) => photo.fileStoreId || photo.id)
      : null;
    const thumbnails = ids ? await getThumbnails(ids, service.tenantId) : null;
    const boundaryAncestors = await fetchBoundaryAncestors(service.tenantId, service?.address?.locality?.code);
    const details = transformDetails({ id, service, workflow, thumbnails, complaintType, boundaryAncestors });
    return details;
  } else {
    return {};
  }
};

const useComplaintDetails = ({ tenantId, id }) => {
  const queryClient = useQueryClient();
  const { isLoading, error, data } = useQuery(["complaintDetails", tenantId, id], () => fetchComplaintDetails(tenantId, id));
  return { isLoading, error, complaintDetails: data, revalidate: () => queryClient.invalidateQueries(["complaintDetails", tenantId, id]) };
};

export default useComplaintDetails;
