import React from "react";
import { ActionLinks, CheckPoint } from "@egovernments/digit-ui-react-components";
import { Link } from "react-router-dom";
import StarRated from "./StarRated";
import { useTranslation } from "react-i18next";
import Reopen from "./reopen";
//const GetTranslatedAction = (action, t) => t(`CS_COMMON_${action}`);

const Resolved = ({ action, nextActions,complaintDetails, ComplainMaxIdleTime=3600000, rating, serviceRequestId, reopenDate, isCompleted, customChild }) => {
  const { t } = useTranslation();

  // Render the rating display whenever `rating` is present, regardless of
  // workflow.action — after a citizen submits their rating, workflow.action
  // transitions away from "RATE" (to something like "" / "REOPEN" depending
  // on backend), and the previous code only rendered <StarRated/> inside the
  // `action === "RATE"` branch — so the stars vanished once the workflow
  // moved on. Hoist the render so it appears in every branch when rating
  // is set (closes egovernments/CCRS#473 reopen).
  const ratingDisplay = rating ? (
    <StarRated text={t("CS_ADDCOMPLAINT_YOU_RATED")} rating={rating} />
  ) : null;

  if (action === "RESOLVE") {
    let actions =
      nextActions &&
      nextActions.map((action, index) => {
        if (action && action !== "COMMENT") {
          return (
            <Link key={index} to={`/digit-ui/citizen/pgr/${action.toLowerCase()}/${serviceRequestId}`}>
              <ActionLinks>{t(`CS_COMMON_${action}`)}</ActionLinks>
            </Link>
          );
        }
      });
    return <CheckPoint isCompleted={isCompleted} label={t(`CS_COMMON_COMPLAINT_RESOLVED`)} customChild={<div>{actions}{ratingDisplay}{customChild}</div>} />;
  } else if (action === "RATE") {
    return (
      <CheckPoint
        isCompleted={isCompleted}
        label={t(`CS_COMMON_COMPLAINT_RESOLVED`)}
        customChild={<div>
          {ratingDisplay}
          {customChild}
        </div>}
      />
    );
  } else if (action === "REOPEN") {
    return <CheckPoint isCompleted={isCompleted} label={t(`CS_COMMON_COMPLAINT_REOPENED`)} info={reopenDate} customChild={<div>{ratingDisplay}{customChild}</div>} />;
  } else {
    const lastModifiedTime = complaintDetails?.service?.auditDetails?.lastModifiedTime;
    const reopenWindowOpen = typeof lastModifiedTime === "number"
      && Number.isFinite(lastModifiedTime)
      && (Date.now() - lastModifiedTime) < ComplainMaxIdleTime;
    let actions =
      nextActions &&
      nextActions.map((action, index) => {
        if (action && action !== "COMMENT") {
          // Date.now() - undefined === NaN, and NaN < n is always false,
          // so REOPEN was hidden whenever auditDetails was still loading.
          if (action !== "REOPEN" || reopenWindowOpen)
          return (
            <Link key={index} to={`/digit-ui/citizen/pgr/${action.toLowerCase()}/${serviceRequestId}`}>
              <ActionLinks>{t(`CS_COMMON_${action}`)}</ActionLinks>
            </Link>
          );
        }
      });
    return <CheckPoint isCompleted={isCompleted} label={t(`CS_COMMON_COMPLAINT_RESOLVED`)} customChild={<div>{actions}{ratingDisplay}{customChild}</div>} />;
  }
};

export default Resolved;
