import React, { useState, useEffect } from "react";
import { Card, Banner, CardText, SubmitBar, Loader } from "@egovernments/digit-ui-react-components";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";

const getActionMessage = (t, { action }) => {
  switch (action) {
    case "REOPEN":
      return t(`CS_COMMON_COMPLAINT_REOPENED`);
    case "RATE":
      return t("CS_COMMON_THANK_YOU");
    default:
      return t(`CS_COMMON_COMPLAINT_SUBMITTED`);
  }
};

const Response = (props) => {
  const { t } = useTranslation();
  const appState = useSelector((state) => state)["pgr"] || {};

  // Brief wait to let Redux state settle after navigation before deciding what to show.
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setWaiting(false), 800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (appState.complaints?.response?.ServiceWrappers?.length > 0) {
      Digit.SessionStorage.del("PGR_MAP_LOCATION");
    }
  }, [appState]);

  if (waiting) {
    return (
      <Card>
        <Loader />
      </Card>
    );
  }

  // --- Primary source: Redux store (populated by updateComplaints dispatch) ---
  const reduxResponse = appState?.complaints?.response;
  const hasReduxData =
    reduxResponse?.responseInfo &&
    reduxResponse?.ServiceWrappers?.length > 0;

  // --- Fallback source: session storage written by SelectRating on submit ---
  // Guards against any Redux race condition on navigation.
  const ratingSession = Digit.SessionStorage.get("PGR_LAST_RATING");
  const SESSION_TTL_MS = 2 * 60 * 1000; // 2 minutes
  const isSessionValid =
    ratingSession && Date.now() - ratingSession.timestamp < SESSION_TTL_MS;

  let action, serviceRequestId, successful;

  if (hasReduxData) {
    action = reduxResponse.ServiceWrappers[0].workflow.action;
    serviceRequestId = reduxResponse.ServiceWrappers[0].service.serviceRequestId;
    successful = true;
  } else if (isSessionValid) {
    action = ratingSession.action;
    serviceRequestId = ratingSession.serviceRequestId;
    successful = true;
    // Clear the session flag now that we've consumed it
    Digit.SessionStorage.del("PGR_LAST_RATING");
  } else {
    successful = false;
  }

  return (
    <Card>
      <Banner
        message={
          successful
            ? getActionMessage(t, { action })
            : t("CS_COMMON_COMPLAINT_NOT_SUBMITTED")
        }
        complaintNumber={serviceRequestId}
        successful={successful}
      />
      {successful && (
        <CardText>
          {action === "RATE"
            ? t("CS_COMMON_RATING_SUBMIT_TEXT")
            : t("CS_COMMON_TRACK_COMPLAINT_TEXT")}
        </CardText>
      )}
      <Link to={`/${window?.contextPath}/citizen/all-services`}>
        <SubmitBar label={t("CORE_COMMON_GO_TO_HOME")} />
      </Link>
    </Card>
  );
};

export default Response;
