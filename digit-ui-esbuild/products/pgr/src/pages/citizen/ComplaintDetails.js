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
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Loader } from "@egovernments/digit-ui-react-components";
import { Card } from "@egovernments/digit-ui-components-v2";
import { AlertCircle } from "lucide-react";

import { LOCALIZATION_KEY } from "../../constants/Localization";
import TimeLine from "../../components/TimeLine";
import ComplaintPhotos from "../../components/ComplaintPhotos";
import ComplaintLocationMap from "../../components/ComplaintLocationMap";

const CLOSED_STATUSES = ["RESOLVED", "REJECTED", "CLOSEDAFTERREJECTION", "CLOSEDAFTERRESOLUTION"];
const REJECTED_STATUSES = ["REJECTED", "CLOSEDAFTERREJECTION"];

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
  const tenantId =
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    complaintDetails.service.tenantId;
  const workFlowDetails = Digit.Hooks.useWorkflowDetails({ tenantId, id, moduleCode: "PGR" });

  // Pre-fetched MDMS for downstream rules; kept to avoid changing fetch
  // cadence vs. the legacy file (some hooks gate on its cache hit).
  Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ComplainClosingTime" }],
    { cacheTime: Infinity, select: (data) => data?.["RAINMAKER-PGR"]?.cct }
  );

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

  const tr = (key, fallback) => {
    const v = t(key);
    return v === key ? fallback : v;
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
            <Card style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Sub-type already appears as its own "Complaint Sub Type"
                  row below; the redundant header chip was removed. */}
              <SectionTitle>{t("CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS")}</SectionTitle>
              <div>
                {Object.keys(complaintDetails.details).map((flag) => (
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
