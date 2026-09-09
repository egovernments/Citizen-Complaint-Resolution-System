import React from "react";
import { ActionLinks, CheckPoint } from "@egovernments/digit-ui-react-components";
import { Link } from "react-router-dom";
import StarRated from "./StarRated";
import { useTranslation } from "react-i18next";
import Reopen from "./reopen";
//const GetTranslatedAction = (action, t) => t(`CS_COMMON_${action}`);

const Rejected = ({ action, nextActions, complaintDetails, ComplainMaxIdleTime, rating, serviceRequestId, reopenDate, isCompleted, customChild }) => {
  const { t } = useTranslation();

  // Render the rating display whenever `rating` is present, regardless of
  // workflow.action — same fix as resolved.js. After rating, action moves
  // away from "RATE" and the previous code only rendered <StarRated/> in
  // the RATE branch, so stars vanished (closes egovernments/CCRS#473
  // reopen).
  const ratingDisplay = rating ? (
    <StarRated text={t("CS_ADDCOMPLAINT_YOU_RATED")} rating={rating} />
  ) : null;

  const lastModifiedTime = complaintDetails?.service?.auditDetails?.lastModifiedTime;
  // ComplainMaxIdleTime is REOPENSLA from MDMS, undefined while it loads or on a tenant
  // without the master. Unknown window => leave REOPEN visible and let pgr-services decide;
  // hiding it here would re-create the unconfigured deadline that #925 was about.
  //
  // An unknown lastModifiedTime is deferred the same way (#1252). The employee action bar
  // already lets REOPEN through when the timestamp is missing, so blocking it here made the
  // citizen and employee surfaces disagree about the very same unknown.
  //
  // The comparison is `>` rather than `<` so it mirrors pgr-services validateReOpen()
  // exactly. With `<` the two disagreed at the boundary instant (elapsed === window: the UI
  // hid REOPEN while the server would still have accepted it).
  //
  // Computed once for EVERY branch, not just the fallthrough. `action` is the LAST workflow
  // action (complaintDetails.workflow.action), so a complaint an employee just resolved
  // arrives as "RESOLVE" and takes the FIRST branch — gating only the fallthrough left the
  // case citizens actually hit wide open, which is the split-brain #1252 is about.
  const windowKnown = typeof ComplainMaxIdleTime === "number" && ComplainMaxIdleTime > 0;
  const elapsedKnown = typeof lastModifiedTime === "number" && Number.isFinite(lastModifiedTime);
  const reopenWindowOpen =
    !windowKnown || !elapsedKnown || !(Date.now() - lastModifiedTime > ComplainMaxIdleTime);

  if (action === "REJECTED") {
    let actions =
      nextActions &&
      nextActions.map((action, index) => {
        if (action && action !== "COMMENT") {
          if (action !== "REOPEN" || reopenWindowOpen)
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
    let actions =
      nextActions &&
      nextActions.map((action, index) => {
        if (action && (action !== "COMMENT") ) {
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
