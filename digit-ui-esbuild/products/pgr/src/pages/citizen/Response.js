/* eslint-disable react/prop-types */
// Citizen complaint-submitted response, as in the #2038 design: a check, the
// complaint number with Copy, what was filed, and View Complaint / home.
//
// Same redux data flow (`state.pgr.complaints.response`), same action-message
// switch (CREATE / REOPEN / RATE / failure) and same SessionStorage cleanup as
// before. The filing summary (category, location, photos, time) arrives in the
// route's state from the filing flow; the create response carries only codes.
//
// Note: filename is `Response.js` (matches the registry entry
// `PGRResponseCitzen` / Module.js import).

import React from "react";
import { useHistory, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { Button } from "@egovernments/digit-ui-components-v2";

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

const CheckGlyph = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const AlertGlyph = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <path d="M12 16h.01" />
  </svg>
);
const EyeGlyph = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** "Today, 10:42" for today, else the date and time. */
function filedOn(ts, tr) {
  const when = new Date(ts);
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (when.toDateString() === new Date().toDateString()) {
    return `${tr("CS_FILE_TODAY", "Today")}, ${time}`;
  }
  return `${when.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}, ${time}`;
}

function ComplaintNumber({ id, tr }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      // No clipboard permission: the number stays selectable.
    }
  };
  return (
    <div className="cms-receipt-number">
      <div>
        <div className="cms-receipt-number-label">{tr("CS_FILE_COMPLAINT_NUMBER", "Complaint number")}</div>
        <div className="cms-receipt-number-value">{id}</div>
      </div>
      <button
        type="button"
        className="cms-link-button"
        onClick={copy}
        aria-live="polite"
        data-analytics-event="pgr.complaint.response-copy-number"
      >
        {copied ? tr("CS_COMMON_COPIED", "Copied") : tr("CS_COMMON_COPY", "Copy")}
      </button>
    </div>
  );
}

const Response = () => {
  const { t } = useTranslation();
  const history = useHistory();
  const location = useLocation();
  const appState = useSelector((state) => state)["pgr"] || {};
  const { complaints } = appState;
  const summary = location.state?.filedSummary;

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
  const filed = success && action !== "REOPEN" && action !== "RATE";

  const headlineKey = success ? getActionMessageKey(action) : "CS_COMMON_COMPLAINT_NOT_SUBMITTED";
  const headline = tr(
    headlineKey,
    success
      ? action === "REOPEN"
        ? "Complaint reopened"
        : action === "RATE"
        ? "Thank you for the rating"
        : "Complaint Submitted"
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
        : "The notification along with complaint number is sent to your registered mobile number. You can track the complaint status using mobile or web app."
      : "Something went wrong while submitting your complaint. Please try again."
  );

  const goHome = `/${window?.contextPath}/citizen/all-services`;
  const goDetail = complaintId ? `/${window?.contextPath}/citizen/pgr/complaints/${complaintId}` : null;
  const retryFlow = `/${window?.contextPath}/citizen/pgr/create-complaint`;

  const rows =
    filed && summary
      ? [
          [tr("CS_FILE_CATEGORY_LABEL", "Category"), summary.category || "—"],
          [tr("CS_FILE_STEP_LOCATION", "Location"), summary.location || "—"],
          [tr("CS_FILE_FILED_ON", "Filed on"), summary.filedAt ? filedOn(summary.filedAt, tr) : "—"],
          [
            tr("CS_FILE_ATTACHMENTS", "Attachments"),
            summary.photos
              ? tr(summary.photos === 1 ? "CS_FILE_ONE_PHOTO" : "CS_FILE_N_PHOTOS", summary.photos === 1 ? "1 photo" : "{count} photos").replace(
                  "{count}",
                  String(summary.photos)
                )
              : tr("CS_FILE_NONE", "None"),
          ],
        ]
      : [];

  return (
    <div className="v2-scope cms-receipt">
      <div className="cms-receipt-strip">{headline}</div>
      <div className="cms-receipt-card">
        <div className={`cms-receipt-icon${success ? "" : " failed"}`}>{success ? <CheckGlyph /> : <AlertGlyph />}</div>
        <h1 className="cms-receipt-head">{headline}</h1>
        <p className="cms-receipt-text">{supporting}</p>
        {complaintId ? <ComplaintNumber id={complaintId} tr={tr} /> : null}
        {rows.length ? (
          <dl className="cms-receipt-rows">
            {rows.map(([label, value]) => (
              <div key={label} className="cms-review-row">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="cms-receipt-actions">
          {success && goDetail ? (
            <Button
              variant="outline"
              leading={<EyeGlyph />}
              onClick={() => history.push(goDetail)}
              data-analytics-event="pgr.complaint.response-view"
            >
              {tr("CS_COMMON_VIEW_COMPLAINT", "View Complaint")}
            </Button>
          ) : !success ? (
            <Button variant="outline" onClick={() => history.push(retryFlow)} data-analytics-event="pgr.complaint.response-try-again">
              {tr("CS_COMMON_TRY_AGAIN", "Try Again")}
            </Button>
          ) : null}
          {/* Same name the employee response page gives its home button. */}
          <Button onClick={() => history.push(goHome)} data-analytics-event="pgr.complaint.response-go-home">
            {tr("CORE_COMMON_GO_TO_HOME", "Go back to home page")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Response;
