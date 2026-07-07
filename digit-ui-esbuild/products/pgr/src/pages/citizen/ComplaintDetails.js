/* eslint-disable react/prop-types */
// Citizen complaint summary — v2 (Tailwind + shadcn-style chrome).
//
// Strangler-fig replacement for the legacy ComplaintDetails.js. Same
// data hooks (`useComplaintDetails`, `useWorkflowDetails`,
// `useCustomMDMS` for closing-time) and same subcomponents
// (TimeLine, ComplaintPhotos, ComplaintLocationMap). Only the visual
// chrome — page header, summary cards, key-value rows, status pill —
// is replaced with the v2 Card / typography / theme tokens used by
// the rest of the modernized citizen surface.

import React, { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Loader } from "@egovernments/digit-ui-react-components";
import { Card } from "@egovernments/digit-ui-components-v2";
import { AlertCircle } from "lucide-react";

import { LOCALIZATION_KEY } from "../../constants/Localization";
import { buildComplaintPath } from "../../utils/complaintHierarchyPath";
import TimelineWrapper from "../../components/TimeLineWrapper";
import ComplaintPhotos from "../../components/ComplaintPhotos";
import ComplaintLocationMap from "../../components/ComplaintLocationMap";
import { buildExtendedAttributeRows } from "../../components/PgrExtendedAttributesView";
import StarRated from "../../components/timelineInstances/StarRated";

// Terminal (non-active) states across standard PGR *and* the mz.igsae CMS workflow.
// CANCELLED / CLOSEDAFTER* are CMS terminals; without them CANCELLED wrongly showed
// as "open" (active). A fully workflow-driven derivation would read isTerminateState
// off the BusinessService, but that state is not fetched on the citizen detail page,
// so we key off the status name (which the BusinessService states are named after).
const REJECTED_STATUSES = ["REJECTED", "CLOSEDAFTERREJECTION", "CANCELLED"];
const CLOSED_STATUSES = ["RESOLVED", "REJECTED", "CLOSEDAFTERREJECTION", "CLOSEDAFTERRESOLUTION", "CANCELLED"];

function statusToTone(status) {
  if (REJECTED_STATUSES.includes(status)) return "rejected";
  if (CLOSED_STATUSES.includes(status)) return "closed";
  return "open";
}

const TONE_STYLES = {
  open: {
    bg: "var(--color-primary-selected-bg, #FFF4D7)",
    fg: "var(--color-warning, #9E5F00)",
  },
  closed: {
    bg: "var(--color-success-bg, #E8F3EE)",
    fg: "var(--color-success, #00703C)",
  },
  rejected: {
    bg: "var(--color-error-bg, #FAE5E2)",
    fg: "var(--color-error, #d4351c)",
  },
};

function StatusPill({ status, t }) {
  const tone = statusToTone(status);
  const palette = TONE_STYLES[tone];
  const labelKey = `${LOCALIZATION_KEY.CS_COMMON}_${status}`;
  const translated = t(labelKey);
  const fallback = tone.toUpperCase();
  const label = translated === labelKey ? fallback : translated.toUpperCase();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 12px",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        letterSpacing: "0.04em",
        backgroundColor: palette.bg,
        color: palette.fg,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function SectionTitle({ children }) {
  return (
    <h2
      style={{
        margin: 0,
        fontSize: "1rem",
        fontWeight: 600,
        color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
      }}
    >
      {children}
    </h2>
  );
}

function DetailRow({ label, value }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(140px, 200px) 1fr",
        gap: "16px",
        padding: "10px 0",
        borderBottom: "1px solid var(--color-border, #e5e7eb)",
        fontSize: "0.875rem",
        alignItems: "baseline",
      }}
    >
      <div style={{ color: "var(--color-text-secondary, #6B7280)", fontWeight: 500 }}>{label}</div>
      <div style={{ color: "var(--color-text-heading, #363636)", wordBreak: "break-word" }}>
        {value}
      </div>
    </div>
  );
}

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
  const { t } = useTranslation();
  const tenantId =
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    complaintDetails.service.tenantId;

  // Workflow-driven timeline: fetch the raw process instances (same source the
  // employee side uses) and render them via the generic TimelineWrapper. This
  // renders whatever states a BusinessService defines (standard PGR *and* the
  // mz.igsae CMS workflow) with no hardcoded status list, replacing the legacy
  // status-ordered <TimeLine>.
  const { isLoading: isWorkFlowLoading, data: workflowData, revalidate } = Digit.Hooks.useCustomAPIHook({
    url: "/egov-workflow-v2/egov-wf/process/_search",
    params: { tenantId, history: true, businessIds: id },
    changeQueryName: id,
  });

  // Reopen window (RAINMAKER-PGR.ComplainClosingTime → cct): REOPEN is offered
  // to the citizen only within this many ms of the last workflow update —
  // same rule the legacy status-ordered <TimeLine> applied.
  const { data: complainMaxIdleTime } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ComplainClosingTime" }],
    { cacheTime: Infinity, select: (data) => data?.["RAINMAKER-PGR"]?.cct }
  );

  useEffect(() => {
    revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Citizen actions for the CURRENT state (RATE / REOPEN / …) straight from the
  // workflow's nextActions — the legacy <TimeLine> rendered these links inside
  // its Resolved/Rejected checkpoints, so the TimelineWrapper swap dropped them.
  // COMMENT is excluded (no citizen page for it); REOPEN honors the idle-window.
  const current = workflowData?.ProcessInstances?.[0];
  const lastModifiedTime = complaintDetails?.service?.auditDetails?.lastModifiedTime;
  const maxIdle = typeof complainMaxIdleTime === "number" ? complainMaxIdleTime : 3600000;
  const reopenWindowOpen =
    typeof lastModifiedTime === "number" && Number.isFinite(lastModifiedTime) && Date.now() - lastModifiedTime < maxIdle;
  const citizenActions = (current?.nextActions || [])
    .filter((a) => Array.isArray(a?.roles) && a.roles.includes("CITIZEN"))
    .map((a) => a?.action)
    .filter((a) => a && a !== "COMMENT")
    .filter((a) => a !== "REOPEN" || reopenWindowOpen);

  // Rendered INSIDE the current-state timeline row (legacy-checkpoint parity):
  // action buttons while actions are open; the given star rating once rated.
  const rating = complaintDetails?.service?.rating;
  const currentStateChildren =
    rating || citizenActions.length > 0 ? (
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
        {rating ? <StarRated text={t("CS_ADDCOMPLAINT_YOU_RATED")} rating={rating} /> : null}
        {citizenActions
          .filter((action) => !(rating && action === "RATE"))
          .map((action) => {
            const key = `CS_COMMON_${action}`;
            const label = t(key) === key ? action : t(key);
            return (
              <Link key={action} to={`/digit-ui/citizen/pgr/${action.toLowerCase()}/${id}`}>
                <button
                  type="button"
                  style={{
                    padding: "0.4rem 1.1rem",
                    fontWeight: 600,
                    color: "#fff",
                    background: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
                    border: "none",
                    borderRadius: "0.375rem",
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              </Link>
            );
          })}
      </div>
    ) : null;

  return (
    <TimelineWrapper
      businessId={id}
      isWorkFlowLoading={isWorkFlowLoading}
      workflowData={workflowData}
      labelPrefix="WF_PGR_"
      currentStateChildren={currentStateChildren}
    />
  );
}

const ComplaintDetailsPage = () => {
  const { t } = useTranslation();
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
  // The hierarchy (nodes + their names) is onboarded at the COMPLAINT'S tenant
  // (e.g. mz.igsae) — not the citizen's home city, which on multi-authority envs
  // is the state root with no such rows. Read it where it lives, else the
  // Type/Sub-Type rows render raw COMPLAINT_HIERARCHY.* keys with no name
  // fallback (nodes absent at the home tenant too).
  const hierarchyTenant = complaintDetails?.service?.tenantId || tenantId;
  const { data: hier } = Digit.Hooks.useCustomMDMS(
    hierarchyTenant,
    "RAINMAKER-PGR",
    [{ name: "ComplaintHierarchyDefinition" }, { name: "ComplaintHierarchy" }],
    {
      cacheTime: Infinity,
      select: (raw) => {
        const defs = (raw?.["RAINMAKER-PGR"]?.ComplaintHierarchyDefinition || []).filter((d) => d?.active !== false);
        const allRows = raw?.["RAINMAKER-PGR"]?.ComplaintHierarchy || [];
        return { defs, allRows };
      },
    },
    // NOTE: this 5th arg switches useCustomMDMS into its v2 branch, which
    // IGNORES the positional tenantId — the tenant must ride inside this
    // object (mdmsv2.tenantId) or the fetch silently uses the logged-in
    // tenant (the citizen's home/state root) no matter what we pass above.
    { schemaCode: "PGR_COMPLAINT_HIERARCHY_DETAILS", tenantId: hierarchyTenant }
  );

  // Pick the hierarchy DEFINITION that owns this complaint's leaf node — a
  // tenant can hold several hierarchies (e.g. the state root aggregates every
  // authority's), and "first def with any rows" mis-picked for complaints of
  // the other authority, collapsing the view to the legacy flat rows.
  const { hierDef, hierNodes } = React.useMemo(() => {
    const defs = hier?.defs || [];
    const allRows = hier?.allRows || [];
    const sc = complaintDetails?.service?.serviceCode;
    const leaf = sc ? allRows.find((n) => n?.code === sc) : null;
    const def =
      (leaf && defs.find((d) => d?.hierarchyType === leaf?.hierarchyType)) ||
      defs.find((d) => allRows.some((n) => n?.hierarchyType === d?.hierarchyType)) ||
      defs[0] ||
      null;
    const nodes = def ? allRows.filter((n) => n?.hierarchyType === def.hierarchyType) : [];
    return { hierDef: def, hierNodes: nodes };
  }, [hier, complaintDetails?.service?.serviceCode]);

  const classification = buildComplaintPath({
    serviceCode: complaintDetails?.service?.serviceCode,
    def: hierDef,
    nodes: hierNodes,
    t,
  });

  const tr = (key, fallback) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  // When a hierarchy applies, the level rows below replace the flat Type/Sub-Type
  // entries the details hook injects — drop those by their displayed label.
  const isFlatTypeRow = (key) => {
    const lbl = String(t(key) || "").toLowerCase().replace(/[-_]+/g, " ").trim();
    return lbl === "complaint type" || lbl === "complaint sub type" || lbl === "complaint subtype";
  };

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

  const status = complaintDetails?.service?.applicationStatus;

  return (
    <div
      className="v2-scope"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minHeight: 0,
        width: "100%",
      }}
    >
      <header
        style={{
          padding: "1rem 1.5rem 0.5rem 1.5rem",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            margin: 0,
            color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
            lineHeight: 1.25,
          }}
        >
          {tr(`${LOCALIZATION_KEY.CS_HEADER}_COMPLAINT_SUMMARY`, "Complaint Summary")}
        </h1>
        {status ? <StatusPill status={status} t={t} /> : null}
      </header>
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          padding: "0.5rem 1.5rem 1.5rem 1.5rem",
        }}
      >
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
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {classification && classification.length > 0 ? (
              <Card style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <SectionTitle>{tr("CS_COMPLAINT_CLASSIFICATION", "Complaint Classification")}</SectionTitle>
                <div>
                  {classification.map((r) => (
                    <DetailRow key={r.levelCode} label={r.label} value={r.value || "N/A"} />
                  ))}
                </div>
              </Card>
            ) : null}

            <Card style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Sub-type already appears as its own "Complaint Sub Type"
                  row below; the redundant header chip was removed. */}
              <SectionTitle>{t("CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS")}</SectionTitle>
              <div>
                {Object.keys(complaintDetails.details)
                  .filter((flag) => !(classification && isFlatTypeRow(flag)))
                  .map((flag) => (
                    <DetailRow
                      key={flag}
                      label={t(flag)}
                      value={renderRowValue(complaintDetails.details[flag], t)}
                    />
                  ))}
              </div>
              {complaintDetails?.workflow?.verificationDocuments?.length > 0 ? (
                <div style={{ marginTop: "12px" }}>
                  <SectionTitle>{t("CS_COMMON_ATTACHMENTS")}</SectionTitle>
                  <div style={{ marginTop: "12px" }}>
                    <ComplaintPhotos serviceWrapper={complaintDetails} />
                  </div>
                </div>
              ) : null}
            </Card>

            {(() => {
              // Read-only "Additional Details" — just fetch service.extendedAttributes
              // and show it; the backend already returns masked ("****") values.
              const extAttrRows = buildExtendedAttributeRows(complaintDetails?.service?.extendedAttributes);
              return extAttrRows.length > 0 ? (
                <Card style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <SectionTitle>{tr("CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS", "Additional Details")}</SectionTitle>
                  <div>
                    {extAttrRows.map((r) => (
                      <DetailRow key={r.fieldKey} label={r.label} value={r.value} />
                    ))}
                  </div>
                </Card>
              ) : null;
            })()}

            {Number.isFinite(geoLocation?.latitude) && Number.isFinite(geoLocation?.longitude) ? (
              <Card style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <SectionTitle>{t("CS_COMPLAINT_LOCATION")}</SectionTitle>
                <ComplaintLocationMap
                  latitude={geoLocation.latitude}
                  longitude={geoLocation.longitude}
                  address={displayAddress}
                />
              </Card>
            ) : null}

            <Card style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <SectionTitle>
                {tr(`${LOCALIZATION_KEY.CS_COMMON}_TIMELINE`, "Activity timeline")}
              </SectionTitle>
              {complaintDetails?.service ? (
                <WorkflowComponent complaintDetails={complaintDetails} id={id} />
              ) : null}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default ComplaintDetailsPage;
