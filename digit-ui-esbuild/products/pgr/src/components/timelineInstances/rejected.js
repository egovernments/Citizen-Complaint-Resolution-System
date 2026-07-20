import React from "react";
import { ActionLinks, CheckPoint } from "@egovernments/digit-ui-react-components";
import { Link } from "react-router-dom";
import StarRated from "./StarRated";
import { useTranslation } from "react-i18next";
import Reopen from "./reopen";
//const GetTranslatedAction = (action, t) => t(`CS_COMMON_${action}`);

const Rejected = ({ action, nextActions, complaintDetails, ComplainMaxIdleTime=3600000, rating, serviceRequestId, reopenDate, isCompleted, customChild }) => {
  const { t } = useTranslation();

  // Render the rating display whenever `rating` is present, regardless of
  // workflow.action — same fix as resolved.js. After rating, action moves
  // away from "RATE" and the previous code only rendered <StarRated/> in
  // the RATE branch, so stars vanished (closes egovernments/CCRS#473
  // reopen).
  const ratingDisplay = rating ? (
    <StarRated text={t("CS_ADDCOMPLAINT_YOU_RATED")} rating={rating} />
  ) : null;

  if (action === "REJECTED") {
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
    // Without customChild here the citizen sees the rejection but no
    // assigner / wfComment / attachments — the entire reason context
    // disappears. Match the RATE branch which already threads it.
    return <CheckPoint isCompleted={isCompleted} label={t(`CS_COMMON_COMPLAINT_REJECTED`)} customChild={<div>{actions}{ratingDisplay}{customChild}</div>} />;
  } else if (action === "RATE" && rating) {
    return (
      <CheckPoint
        isCompleted={isCompleted}
        label={t(`CS_COMMON_COMPLAINT_REJECTED`)}
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
        if (action && (action !== "COMMENT") ) {
          // Date.now() - undefined === NaN, and NaN < n is always false
          // so REOPEN was being silently hidden when auditDetails
          // hadn't loaded yet. Use a strict-numeric guard.
          if (action !== "REOPEN" || reopenWindowOpen)
          return (
            <Link key={index} to={`/digit-ui/citizen/pgr/${action.toLowerCase()}/${serviceRequestId}`}>
              <ActionLinks>{t(`CS_COMMON_${action}`)}</ActionLinks>
            </Link>
          );
        }
      });
    return <CheckPoint isCompleted={isCompleted} label={t(`CS_COMMON_COMPLAINT_REJECTED`)} customChild={<div>{actions}{ratingDisplay}{customChild}</div>} />;
  }
};

export default Rejected;
