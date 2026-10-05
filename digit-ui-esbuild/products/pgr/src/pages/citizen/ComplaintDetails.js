/* eslint-disable react/prop-types */
// Citizen complaint details, as in the #2038 design: a Home breadcrumb, one
// card of captioned values, then location, attachments and the timeline, and
// "File another complaint".
//
// Same data hooks (`useComplaintDetails`, `useWorkflowDetails`,
// `useReopenWindow` for the reopen window) and same subcomponents
// (TimeLine with its reopen / rate actions, ComplaintPhotos,
// ComplaintLocationMap) as before; only the layout changed.

import React, { useEffect } from "react";
import { Link, useHistory, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Loader } from "@egovernments/digit-ui-react-components";
import { Button, Card } from "@egovernments/digit-ui-components-v2";
import { AlertCircle } from "lucide-react";

import { buildComplaintPath } from "../../utils/complaintHierarchyPath";
import { complaintLabel } from "../../utils/complaintLabel";
import TimeLine from "../../components/TimeLine";
import ComplaintPhotos from "../../components/ComplaintPhotos";
import ComplaintLocationMap from "../../components/ComplaintLocationMap";
import useReopenWindow from "../../hooks/pgr/useReopenWindow";
import { hasUsableGeoLocation } from "../../utils/geoLocation";

function renderRowValue(val, t) {
  if (Array.isArray(val)) {
    return val
      .map((item) => (typeof item === "object" && item ? t(item?.code) : t(String(item ?? ""))))
      .filter(Boolean)
      .join(", ");
  }
  if (val == null || val === "") return "N/A";
  if (typeof val === "object") return t(val?.code ?? "") || "N/A";
  return t(String(val)) || "N/A";
}

function WorkflowComponent({ complaintDetails, id }) {
  const tenantId =
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    complaintDetails.service.tenantId;
  const workFlowDetails = Digit.Hooks.useWorkflowDetails({ tenantId, id, moduleCode: "PGR" });

  // Replaces a fetch of the legacy RAINMAKER-PGR.ComplainClosingTime master whose result was
  // discarded — the vestige of the reopen-window lookup that #925 restores. REOPENSLA is the
  // master the configurator actually exposes, so read that and feed the timeline.
  const ComplainMaxIdleTime = useReopenWindow(tenantId);

  useEffect(() => {
    workFlowDetails.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (workFlowDetails.isLoading) return null;
  return (
    <TimeLine
      data={workFlowDetails.data}
      serviceRequestId={id}
      complaintWorkflow={complaintDetails.workflow}
      rating={complaintDetails.audit?.rating}
      complaintDetails={complaintDetails}
      ComplainMaxIdleTime={ComplainMaxIdleTime}
    />
  );
}

const ComplaintDetailsPage = () => {
  const { t } = useTranslation();
  const history = useHistory();
  const { id } = useParams();
  const tenantId =
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit.ULBService.getCurrentTenantId();
  const { isLoading, isError, complaintDetails } = Digit.Hooks.pgr.useComplaintDetails({
    tenantId,
    id,
  });

  // Complaint classification hierarchy (configurable N levels). Absent on
  // un-migrated tenants -> buildComplaintPath returns null and the legacy flat
  // Type/Sub-Type rows from `details` are shown unchanged.
  // Single RAINMAKER-PGR.ComplaintHierarchy adjacency list (interior nodes +
  // leaf complaint types). buildComplaintPath finds the leaf (code===serviceCode)
  // and walks parentCode up through these same rows.
  const { data: hier } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ComplaintHierarchyDefinition" }, { name: "ComplaintHierarchy" }],
    {
      cacheTime: Infinity,
      select: (raw) => {
        const defs = (raw?.["RAINMAKER-PGR"]?.ComplaintHierarchyDefinition || []).filter((d) => d?.active !== false);
        const allRows = raw?.["RAINMAKER-PGR"]?.ComplaintHierarchy || [];
        const def = defs.find((d) => allRows.some((n) => n?.hierarchyType === d?.hierarchyType)) || defs[0] || null;
        const nodes = def ? allRows.filter((n) => n?.hierarchyType === def.hierarchyType) : [];
        return { def, nodes };
      },
    },
    { schemaCode: "PGR_COMPLAINT_HIERARCHY_DETAILS" }
  );

  const classification = buildComplaintPath({
    serviceCode: complaintDetails?.service?.serviceCode,
    def: hier?.def,
    nodes: hier?.nodes,
    t,
  });

  const tr = (key, fallback) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  // The details hook hands the flat Type / Sub-Type rows over as bare
  // COMPLAINT_HIERARCHY.<code> keys, which printed raw on any tenant that has
  // not seeded them. Label them as My Complaints and the employee page do:
  // the key's translation, else the hierarchy node's own name.
  const serviceDefs = Digit.Hooks.pgr.useServiceDefs(tenantId, "PGR");
  const serviceDef = (serviceDefs || []).find((def) => def?.serviceCode === complaintDetails?.service?.serviceCode);
  const typeRowLabels = serviceDef
    ? {
        CS_ADDCOMPLAINT_COMPLAINT_TYPE: complaintLabel(t, serviceDef.menuPath, serviceDef.menuPathName),
        CS_ADDCOMPLAINT_COMPLAINT_SUB_TYPE: complaintLabel(t, serviceDef.serviceCode, serviceDef.name),
      }
    : {};

  // When a hierarchy applies, the level rows below replace the flat category
  // and subcategory entries the details hook injects (useComplaintDetails).
  // Matched by key: the labels are whatever the tenant seeds, so matching on
  // their text stopped working as soon as they were renamed.
  const isFlatTypeRow = (key) => key === "CS_ADDCOMPLAINT_COMPLAINT_TYPE" || key === "CS_ADDCOMPLAINT_COMPLAINT_SUB_TYPE";

  const geoLocation = complaintDetails?.service?.address?.geoLocation;
  const address = complaintDetails?.service?.address;
  const displayAddress = [
    address?.buildingName,
    address?.street,
    address?.landmark,
    address?.locality?.name || address?.locality?.code,
    address?.pincode,
  ]
    .filter(Boolean)
    .join(", ");

  // One captioned value per detail, in the design's order: the classification
  // (when a hierarchy applies) where the flat Type / Sub-Type rows sat, the
  // status after the boundary levels, and the description last, full width.
  const detailRows = [];
  let statusRow = null;
  let descriptionRow = null;
  let classificationPlaced = false;
  const pushClassification = () => {
    if (classificationPlaced || !classification || classification.length === 0) return;
    classification.forEach((r) => detailRows.push({ key: r.levelCode, label: r.label, value: r.value || "N/A" }));
    classificationPlaced = true;
  };
  Object.keys(complaintDetails?.details || {}).forEach((flag) => {
    if (classification && isFlatTypeRow(flag)) {
      pushClassification();
      return;
    }
    const row = {
      key: flag,
      label: t(flag),
      value: typeRowLabels[flag] || renderRowValue(complaintDetails.details[flag], t),
    };
    if (flag === "CS_COMPLAINT_DETAILS_APPLICATION_STATUS") statusRow = row;
    else if (flag === "CS_COMPLAINT_ADDTIONAL_DETAILS") descriptionRow = { ...row, wide: true };
    else detailRows.push(row);
    // After the complaint number, when no flat type row marks the spot.
    if (flag === "CS_COMPLAINT_DETAILS_COMPLAINT_NO") pushClassification();
  });
  pushClassification();
  if (statusRow) detailRows.push(statusRow);
  if (descriptionRow) detailRows.push(descriptionRow);

  const home = `/${window?.contextPath}/citizen/all-services`;
  const fileAnother = `/${window?.contextPath}/citizen/pgr/create-complaint`;
  const pageTitle = tr("CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS", "Complaint Details");

  return (
    <div className="v2-scope cms-details">
      <nav className="cms-breadcrumb" aria-label={tr("CS_COMMON_BREADCRUMB", "Breadcrumb")}>
        <Link to={home} data-analytics-event="pgr.complaint.details-home">
          {tr("CS_COMMON_HOME", "Home")}
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{pageTitle}</span>
      </nav>
      <h1 className="cms-details-head">{pageTitle}</h1>
      {isLoading ? (
        <div style={{ padding: "32px 0" }}>
          <Loader />
        </div>
      ) : isError || !complaintDetails || Object.keys(complaintDetails).length === 0 ? (
        <Card
          style={{
            padding: "48px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: "3rem",
              width: "3rem",
              borderRadius: "9999px",
              backgroundColor: "var(--color-error-bg, #FAE5E2)",
              color: "var(--color-error, #d4351c)",
            }}
          >
            <AlertCircle style={{ height: "1.5rem", width: "1.5rem" }} />
          </span>
          <h3
            style={{
              margin: 0,
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "var(--color-text-heading, #363636)",
            }}
          >
            {tr("CS_COMPLAINT_DETAILS_LOAD_ERROR", "Couldn't load this complaint")}
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: "0.875rem",
              color: "var(--color-text-secondary, #6B7280)",
              maxWidth: "32rem",
            }}
          >
            {tr(
              "CS_COMPLAINT_DETAILS_LOAD_ERROR_DESC",
              "The complaint details aren't reachable right now. Please try refreshing in a moment."
            )}
          </p>
        </Card>
      ) : (
        <>
          <section className="cms-details-card">
            <dl className="cms-details-grid">
              {detailRows.map((row) => (
                <div key={row.key} className={`cms-details-item${row.wide ? " wide" : ""}`}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {hasUsableGeoLocation(geoLocation) ? (
            <section className="cms-details-card">
              <h2 className="cms-details-card-head">{t("CS_COMPLAINT_LOCATION")}</h2>
              <ComplaintLocationMap
                latitude={geoLocation.latitude}
                longitude={geoLocation.longitude}
                address={displayAddress}
              />
            </section>
          ) : null}

          {complaintDetails?.workflow?.verificationDocuments?.length > 0 ? (
            <section className="cms-details-card">
              <h2 className="cms-details-card-head">{t("CS_COMMON_ATTACHMENTS")}</h2>
              <ComplaintPhotos serviceWrapper={complaintDetails} />
            </section>
          ) : null}

          <section className="cms-details-card">
            <h2 className="cms-details-card-head">{tr("CS_COMPLAINT_DETAILS_COMPLAINT_TIMELINE", "Complaint Timeline")}</h2>
            {complaintDetails?.service ? <WorkflowComponent complaintDetails={complaintDetails} id={id} /> : null}
          </section>

          <div className="cms-details-actions">
            <Button onClick={() => history.push(fileAnother)} data-analytics-event="pgr.complaint.details-file-another">
              {tr("CS_FILE_ANOTHER", "File another complaint")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default ComplaintDetailsPage;
