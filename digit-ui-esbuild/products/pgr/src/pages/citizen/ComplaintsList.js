/* eslint-disable react/prop-types */
// Citizen "My Complaints" list — v2 (Tailwind + shadcn-style chrome).
//
// Strangler-fig replacement for the legacy ComplaintsList.js (which
// rendered react-components Cards + the per-item <Complaint /> tile).
// Data layer is preserved — same `useComplaintsListByMobile` hook, same
// ServiceWrapper shape, same revalidate-on-mount cadence.
//
// What changes:
//   - v2 page chrome: header row with brand-tinted title + "File new
//     complaint" primary CTA on the right.
//   - List area is the only scrollable region (flex: 1, overflow-y),
//     so the page footer stays pinned at the viewport bottom.
//   - Each complaint is a v2 Card showing: service category, complaint
//     id, created date, plus a colored status pill (open / closed /
//     rejected) on the right. Click anywhere to drill in.
//   - Empty + error states use the same Card surface and theme colors
//     instead of the legacy raw <Card> with text.

import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useHistory, useRouteMatch } from "react-router-dom";

import { Loader } from "@egovernments/digit-ui-react-components";
import { Button, Card } from "@egovernments/digit-ui-components-v2";
import { ChevronRight, FilePlus2, Inbox } from "lucide-react";
import { LOCALE, LOCALIZATION_KEY } from "../../constants/Localization";

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
    label: "OPEN",
  },
  closed: {
    bg: "var(--color-success-bg, #E8F3EE)",
    fg: "var(--color-success, #00703C)",
    label: "CLOSED",
  },
  rejected: {
    bg: "var(--color-error-bg, #FAE5E2)",
    fg: "var(--color-error, #d4351c)",
    label: "REJECTED",
  },
};

function StatusPill({ status, t }) {
  const tone = statusToTone(status);
  const palette = TONE_STYLES[tone];
  const labelKey = `CS_COMMON_${palette.label}`;
  const translated = t(labelKey);
  const label = translated === labelKey ? palette.label : translated.toUpperCase();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 10px",
        borderRadius: "9999px",
        fontSize: "0.6875rem",
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

function ComplaintRow({ data, onClick, t }) {
  const { serviceCode, serviceRequestId, applicationStatus, auditDetails } = data;
  const titleKey = `SERVICEDEFS.${(serviceCode || "").toUpperCase()}`;
  const title = (() => {
    const v = t(titleKey);
    return v === titleKey ? serviceCode : v;
  })();
  const dateStr = auditDetails?.createdTime
    ? Digit.DateUtils.ConvertTimestampToDate(auditDetails.createdTime)
    : "";
  const stageKey = `${LOCALIZATION_KEY.CS_COMMON}_${applicationStatus}`;
  const stage = (() => {
    const v = t(stageKey);
    return v === stageKey ? applicationStatus : v;
  })();
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        cursor: "pointer",
        transition: "border-color 0.15s ease-out, box-shadow 0.15s ease-out, transform 0.05s ease-out",
        padding: "16px 20px",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor =
          "var(--color-primary-1, var(--color-primary-main, #c84c0e))";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginBottom: "6px",
              flexWrap: "wrap",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "0.95rem",
                fontWeight: 600,
                color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
              }}
            >
              {title}
            </h3>
            <StatusPill status={applicationStatus} t={t} />
          </div>
          <div
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary, #6B7280)",
              display: "flex",
              flexWrap: "wrap",
              gap: "16px",
              alignItems: "center",
            }}
          >
            <span>
              <span style={{ fontWeight: 500, color: "var(--color-text-heading, #363636)" }}>
                {t(`${LOCALIZATION_KEY.CS_COMMON}_COMPLAINT_NO`)}:
              </span>{" "}
              {serviceRequestId}
            </span>
            {dateStr ? <span>{dateStr}</span> : null}
            {stage && stage !== title ? <span>{stage}</span> : null}
          </div>
        </div>
        <ChevronRight
          aria-hidden
          style={{
            height: "1.25rem",
            width: "1.25rem",
            flexShrink: 0,
            color: "var(--color-text-secondary, #9CA3AF)",
          }}
        />
      </div>
    </Card>
  );
}

function EmptyState({ icon, title, body, action }) {
  return (
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
          backgroundColor: "var(--color-primary-selected-bg, #FFF4D7)",
          color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
        }}
      >
        {icon}
      </span>
      <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: "var(--color-text-heading, #363636)" }}>
        {title}
      </h3>
      {body ? (
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-secondary, #6B7280)", maxWidth: "32rem" }}>
          {body}
        </p>
      ) : null}
      {action}
    </Card>
  );
}

export const ComplaintsList = () => {
  const User = Digit.UserService.getUser();
  const mobileNumber =
    User?.mobileNumber || User?.info?.mobileNumber || User?.info?.userInfo?.mobileNumber;
  const tenantId =
    Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit.ULBService.getCurrentTenantId();
  const { t } = useTranslation();
  const history = useHistory();
  const { path } = useRouteMatch();
  const { isLoading, error, data, revalidate } = Digit.Hooks.pgr.useComplaintsListByMobile(
    tenantId,
    mobileNumber
  );

  useEffect(() => {
    revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goCreate = () => history.push(`/${window.contextPath}/citizen/pgr/create-complaint`);

  const tr = (key, fallback) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

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
          justifyContent: "space-between",
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
          {tr(LOCALE.MY_COMPLAINTS, "My Complaints")}
        </h1>
        <Button onClick={goCreate} leading={<FilePlus2 className="h-4 w-4" />}>
          {tr("CS_COMMON_FILE_A_COMPLAINT", "File a Complaint")}
        </Button>
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
        ) : error ? (
          <EmptyState
            icon={<Inbox style={{ height: "1.5rem", width: "1.5rem" }} />}
            title={tr("CS_COMMON_ERROR_LOADING_TITLE", "Couldn't load your complaints")}
            body={tr(LOCALE.ERROR_LOADING_RESULTS, "Please try again in a moment.")}
            action={
              <Button variant="outline" onClick={revalidate}>
                {tr("CS_COMMON_RETRY", "Retry")}
              </Button>
            }
          />
        ) : !data?.ServiceWrappers?.length ? (
          <EmptyState
            icon={<Inbox style={{ height: "1.5rem", width: "1.5rem" }} />}
            title={tr("CS_NO_COMPLAINTS_TITLE", "No complaints yet")}
            body={tr(LOCALE.NO_COMPLAINTS, "You haven't filed any complaints. File one and we'll route it to the right team.")}
            action={
              <Button onClick={goCreate} leading={<FilePlus2 className="h-4 w-4" />}>
                {tr("CS_COMMON_FILE_A_COMPLAINT", "File a Complaint")}
              </Button>
            }
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {data.ServiceWrappers.map(({ service }) => (
              <ComplaintRow
                key={service.serviceRequestId}
                data={service}
                t={t}
                onClick={() => history.push(`${path}/${service.serviceRequestId}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ComplaintsList;
