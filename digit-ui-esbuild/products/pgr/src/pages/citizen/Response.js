/* eslint-disable react/prop-types */
// Citizen complaint-submitted response — v2 (Tailwind + shadcn-style chrome).
//
// Strangler-fig replacement for the legacy Response.js (which rendered a
// <Banner> + <CardText> + <SubmitBar> via react-components). Same redux
// data flow (`state.pgr.complaints.response`), same action-message
// switch (CREATE / REOPEN / RATE / failure), same SessionStorage cleanup
// — only the chrome is replaced with a big success card carrying a
// brand-tinted icon, the complaint ID as a copyable chip, contextual
// "what next" copy, and a primary CTA back to the citizen home plus a
// quieter outline CTA to view the complaint detail when applicable.
//
// Failure path keeps the same shape with a destructive-toned icon and
// a "Try again" CTA back to the create flow.
//
// Note: filename is `Response.js` (matches the registry entry
// `PGRResponseCitzen` / Module.js import) — kept JS so we can reuse
// the same component without retooling the registry.

import React from "react";
import { Link, useHistory } from "react-router-dom";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { CheckCircle2, AlertCircle, Eye } from "lucide-react";
import { Button, Card } from "@egovernments/digit-ui-components-v2";

// PGR `_update` returns `ResponseInfo` (capital R); accept either casing.
const hasUpdatePayload = (complaints) =>
  !!complaints?.response &&
  (complaints.response.ResponseInfo || complaints.response.responseInfo) &&
  Array.isArray(complaints.response.ServiceWrappers) &&
  complaints.response.ServiceWrappers.length > 0;

function getActionMessageKey(action) {
  switch (action) {
    case "REOPEN":
      return "CS_COMMON_COMPLAINT_REOPENED";
    case "RATE":
      return "CS_COMMON_THANK_YOU";
    default:
      return "CS_COMMON_COMPLAINT_SUBMITTED";
  }
}

function StatusIcon({ tone }) {
  const palette =
    tone === "success"
      ? {
          bg: "var(--color-success-bg, #E8F3EE)",
          fg: "var(--color-success, #00703C)",
          Icon: CheckCircle2,
        }
      : {
          bg: "var(--color-error-bg, #FAE5E2)",
          fg: "var(--color-error, #d4351c)",
          Icon: AlertCircle,
        };
  const Icon = palette.Icon;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: "4rem",
        width: "4rem",
        borderRadius: "9999px",
        backgroundColor: palette.bg,
        color: palette.fg,
        flexShrink: 0,
      }}
    >
      <Icon style={{ height: "2.25rem", width: "2.25rem" }} />
    </span>
  );
}

function ComplaintIdChip({ id }) {
  if (!id) return null;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 14px",
        borderRadius: "9999px",
        backgroundColor: "var(--color-primary-selected-bg, #FFF4D7)",
        color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
        fontSize: "0.8125rem",
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      <span style={{ color: "var(--color-text-secondary, #6B7280)", fontWeight: 500 }}>ID</span>
      <span>{id}</span>
    </div>
  );
}

const Response = () => {
  const { t } = useTranslation();
  const history = useHistory();
  const appState = useSelector((state) => state)["pgr"] || {};
  const { complaints } = appState;

  React.useEffect(() => {
    if (appState.complaints?.response?.ServiceWrappers?.length > 0) {
      Digit.SessionStorage.del("PGR_MAP_LOCATION");
    }
  }, [appState]);

  const tr = (key, fallback) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  const success = hasUpdatePayload(complaints);
  const wrapper = success ? complaints.response.ServiceWrappers[0] : null;
  const action = wrapper?.workflow?.action;
  const complaintId = wrapper?.service?.serviceRequestId;

  const headlineKey = success
    ? getActionMessageKey(action)
    : "CS_COMMON_COMPLAINT_NOT_SUBMITTED";
  const headline = tr(
    headlineKey,
    success
      ? action === "REOPEN"
        ? "Complaint reopened"
        : action === "RATE"
        ? "Thank you for the rating"
        : "Complaint submitted"
      : "Complaint couldn't be submitted"
  );
  const supportingKey = success
    ? action === "RATE"
      ? "CS_COMMON_RATING_SUBMIT_TEXT"
      : "CS_COMMON_TRACK_COMPLAINT_TEXT"
    : "CS_COMMON_COMPLAINT_SUBMIT_RETRY";
  const supporting = tr(
    supportingKey,
    success
      ? action === "RATE"
        ? "Your rating has been submitted."
        : "We've routed your complaint to the right team. You can track it from My Complaints."
      : "Something went wrong while submitting your complaint. Please try again."
  );

  const goHome = `/${window?.contextPath}/citizen/all-services`;
  const goDetail = complaintId
    ? `/${window?.contextPath}/citizen/pgr/complaints/${complaintId}`
    : null;
  const retryFlow = `/${window?.contextPath}/citizen/pgr/create-complaint`;

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
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          padding: "1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Card
          style={{
            width: "100%",
            maxWidth: "560px",
            padding: "40px 32px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
            textAlign: "center",
          }}
        >
          <StatusIcon tone={success ? "success" : "error"} />
          <h1
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "var(--color-text-heading, #363636)",
              lineHeight: 1.25,
            }}
          >
            {headline}
          </h1>
          {complaintId ? <ComplaintIdChip id={complaintId} /> : null}
          <p
            style={{
              margin: 0,
              fontSize: "0.9375rem",
              color: "var(--color-text-secondary, #6B7280)",
              maxWidth: "36rem",
              lineHeight: 1.5,
            }}
          >
            {supporting}
          </p>
          <div
            style={{
              marginTop: "8px",
              display: "flex",
              gap: "12px",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {success && goDetail ? (
              <Button
                variant="outline"
                onClick={() => history.push(goDetail)}
                leading={<Eye className="h-4 w-4" />}
              >
                {tr("CS_COMMON_VIEW_COMPLAINT", "View Complaint")}
              </Button>
            ) : !success ? (
              <Button variant="outline" onClick={() => history.push(retryFlow)}>
                {tr("CS_COMMON_TRY_AGAIN", "Try Again")}
              </Button>
            ) : null}
            <Link to={goHome} style={{ textDecoration: "none" }}>
              <Button>{tr("CORE_COMMON_GO_TO_HOME", "Go to Home")}</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Response;
