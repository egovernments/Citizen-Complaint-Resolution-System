import React from "react";
import { ActionLinks, CheckPoint } from "@egovernments/digit-ui-react-components";
import { Link } from "react-router-dom";
import StarRated from "./StarRated";
import { useTranslation } from "react-i18next";
import Reopen from "./reopen";
//const GetTranslatedAction = (action, t) => t(`CS_COMMON_${action}`);

const Resolved = ({ action, nextActions,complaintDetails, ComplainMaxIdleTime, rating, serviceRequestId, reopenDate, isCompleted, customChild }) => {
  const { t } = useTranslation();

  if (action === "RESOLVE") {
    let actions =
      nextActions &&
      nextActions.map((action, index) => {
        if (action && action !== "COMMENT") {
          return (
            <Link key={index} to={`/${window?.contextPath}/citizen/pgr/${action.toLowerCase()}/${serviceRequestId}`}>
              <ActionLinks>{t(`CS_COMMON_${action}`)}</ActionLinks>
            </Link>
          );
        }
      });
    return <CheckPoint isCompleted={isCompleted} label={t(`CS_COMMON_COMPLAINT_RESOLVED`)} customChild={<div>{actions}{customChild}</div>} />;
  } else if (action === "RATE") {
    return (
      <CheckPoint
        isCompleted={isCompleted}
        label={t(`CS_COMMON_COMPLAINT_RESOLVED`)}
        customChild={<div>
          {/* {rating ? <StarRated text={t("CS_ADDCOMPLAINT_YOU_RATED")} rating={rating} /> : null} */}
          {customChild}
        </div>}
      />
    );
  } else if (action === "REOPEN") {
    return <CheckPoint isCompleted={isCompleted} label={t(`CS_COMMON_COMPLAINT_REOPENED`)} info={reopenDate} customChild={customChild} />;
  } else {
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
    const windowKnown = typeof ComplainMaxIdleTime === "number" && ComplainMaxIdleTime > 0;
    const elapsedKnown = typeof lastModifiedTime === "number" && Number.isFinite(lastModifiedTime);
    const reopenWindowOpen =
      !windowKnown || !elapsedKnown || !(Date.now() - lastModifiedTime > ComplainMaxIdleTime);
    let actions =
      nextActions &&
      nextActions.map((action, index) => {
        if (action && action !== "COMMENT") {
          if (action !== "REOPEN" || reopenWindowOpen)
          return (
            <Link key={index} to={`/${window?.contextPath}/citizen/pgr/${action.toLowerCase()}/${serviceRequestId}`}>
              <ActionLinks>{t(`CS_COMMON_${action}`)}</ActionLinks>
            </Link>
          );
        }
      });
    return <CheckPoint isCompleted={isCompleted} label={t(`CS_COMMON_COMPLAINT_RESOLVED`)} customChild={<div>{actions}{customChild}</div>} />;
  }
};

export default Resolved;
