import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { buildComplaintPath } from "../../utils/complaintHierarchyPath";
import { buildExtendedAttributeRows, useExtendedAttributeOrder } from "../../components/PgrExtendedAttributesView";

/**
 * Assemble everything the PDF receipt prints for one complaint.
 *
 * This is the SAME derivation the citizen detail page performs (details map,
 * classification path, extended-attribute rows) — deliberately shared so the
 * receipt and the screen can never show different content. The success screen
 * holds only the created ServiceWrapper, so it calls this hook to fill in the
 * rest instead of printing a near-empty document.
 *
 * `complaintDetails` is the object from Digit.Hooks.pgr.useComplaintDetails.
 * Everything is memoised and degrades to empty rather than throwing.
 */
const useComplaintReceiptModel = (complaintDetails) => {
  const { t } = useTranslation();
  const service = complaintDetails?.service;

  const extAttrOrder = useExtendedAttributeOrder(service?.extendedAttributes);

  // The hierarchy is onboarded at the COMPLAINT's tenant (e.g. mz.igsae), not
  // the citizen's home city, which on a multi-authority env is the state root
  // with no such rows. Same read the detail page performs.
  const hierarchyTenant = service?.tenantId || Digit.ULBService.getCurrentTenantId();
  const { data: hier } = Digit.Hooks.useCustomMDMS(
    hierarchyTenant,
    "RAINMAKER-PGR",
    [{ name: "ComplaintHierarchyDefinition" }, { name: "ComplaintHierarchy" }],
    {
      cacheTime: Infinity,
      select: (raw) => ({
        defs: (raw?.["RAINMAKER-PGR"]?.ComplaintHierarchyDefinition || []).filter((d) => d?.active !== false),
        allRows: raw?.["RAINMAKER-PGR"]?.ComplaintHierarchy || [],
      }),
    },
    // The 5th arg switches useCustomMDMS into its v2 branch, which IGNORES the
    // positional tenantId — the tenant must ride inside this object.
    //
    // It MUST be passed on every render: useCustomMDMS's v1/v2 branches call
    // different hooks, so a value that flips between false and an object across
    // renders changes the hook order and crashes React (this took the citizen
    // success screen down: the tenant arrived only after the complaint fetch
    // resolved). Callers therefore mount this hook only once the complaint
    // record exists (see DownloadReceiptButton's mount gate); the
    // getCurrentTenantId fallback above is a stability net for a misused
    // caller, not a supported path.
    { schemaCode: "PGR_COMPLAINT_HIERARCHY_DETAILS", tenantId: hierarchyTenant }
  );


  // Pick the definition that owns THIS complaint's leaf: a tenant can hold
  // several hierarchies, and "first def with any rows" mis-picks for complaints
  // belonging to another authority.
  const classification = useMemo(() => {
    const defs = hier?.defs || [];
    const allRows = hier?.allRows || [];
    const sc = service?.serviceCode;
    if (!sc) return null;
    const leaf = allRows.find((n) => n?.code === sc);
    const def =
      (leaf && defs.find((d) => d?.hierarchyType === leaf?.hierarchyType)) ||
      defs.find((d) => allRows.some((n) => n?.hierarchyType === d?.hierarchyType)) ||
      defs[0] ||
      null;
    const nodes = def ? allRows.filter((n) => n?.hierarchyType === def.hierarchyType) : [];
    return buildComplaintPath({ serviceCode: sc, def, nodes, t });
  }, [hier, service?.serviceCode, t]);

  const extendedRows = useMemo(
    () => buildExtendedAttributeRows(service?.extendedAttributes, t, extAttrOrder),
    [service?.extendedAttributes, t, extAttrOrder]
  );

  return { service, details: complaintDetails?.details, classification, extendedRows };
};

export default useComplaintReceiptModel;
