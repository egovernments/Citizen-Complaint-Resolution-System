import { Card, CardSubHeader, CheckPoint, ConnectingCheckPoints, GreyOutText, Loader, DisplayPhotos } from "@egovernments/digit-ui-react-components";
import React, { Fragment, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LOCALIZATION_KEY } from "../constants/Localization";
import PendingAtLME from "./timelineInstances/pendingAtLme";
import PendingForAssignment from "./timelineInstances/PendingForAssignment";
import PendingForReassignment from "./timelineInstances/PendingForReassignment";
import Reopen from "./timelineInstances/reopen";
import Resolved from "./timelineInstances/resolved";
import Rejected from "./timelineInstances/rejected";
import StarRated from "./timelineInstances/StarRated";

// Helper function to mask employee names (show first 1 char + * + X's)
const maskName = (name) => {
  if (!name || name.length < 2) return name;
  return name.charAt(0) + '*' + 'X'.repeat(Math.max(0, name.length - 2));
};

// Helper function to mask phone numbers for citizen view (show last 4 digits only)
const maskPhoneNumber = (phone) => {
  if (!phone || phone.length < 4) return phone;
  return 'XXXXXX' + phone.slice(-4);
};

const TLCaption = ({ data, comments }) => {
  const { t } = useTranslation()
  return (
    <div>
      {data?.date && <p>{data?.date}</p>}
      {data?.name && <p>{maskName(data?.name)}</p>}
      {data?.mobileNumber && <p>{t("ES_COMMON_CONTACT_DETAILS")}: {maskPhoneNumber(data?.mobileNumber)}</p>}
      {data?.source && <p>{t("ES_COMMON_FILED_VIA_" + data?.source.toUpperCase())}</p>}
    </div>
  );
};

const TimeLine = ({ isLoading, data, serviceRequestId, complaintWorkflow, rating, zoomImage, complaintDetails, ComplainMaxIdleTime }) => {
  const { t } = useTranslation();

  function zoomImageWrapper(imageSource, index, thumbnailsToShow) {
    let newIndex = thumbnailsToShow.thumbs?.findIndex(link => link === imageSource);
    zoomImage((newIndex > -1 && thumbnailsToShow?.fullImage?.[newIndex]) || imageSource);
  }

  const { timeline } = data || {};

  // Append a synthetic "COMPLAINT_FILED" checkpoint at the end of the timeline,
  // mirroring the original PENDINGFORASSIGNMENT entry. Done as a useMemo
  // returning a new array — the previous implementation mutated the source
  // array inside a useEffect, so the appended entry only became visible
  // whenever some unrelated event triggered a re-render. On slow networks the
  // timing of that re-render varied, producing the "timeline inconsistent /
  // sometimes the filed step is missing" symptom.
  const augmentedTimeline = useMemo(() => {
    if (!timeline?.length) return timeline;
    const lastPendingForAssignment = timeline
      .filter((e) => e?.status === "PENDINGFORASSIGNMENT")
      .at(-1);
    if (!lastPendingForAssignment) return timeline;
    return [
      ...timeline,
      {
        ...lastPendingForAssignment,
        performedAction: "FILED",
        status: "COMPLAINT_FILED",
      },
    ];
  }, [timeline]);
  const totalTimelineLength = augmentedTimeline?.length;

  const getCommentsInCustomChildComponent = ({ comment, thumbnailsToShow, auditDetails, assigner, status }) => {
    const captionDetails = {
      date: auditDetails?.lastModified,
      name: assigner?.name,
      mobileNumber: assigner?.mobileNumber,
      source: status == "COMPLAINT_FILED" ? complaintDetails?.audit.source : ""
    }
    return <>
      {comment ? <div>{comment?.map(e =>
        <div className="TLComments">
          <h3>{t("WF_COMMON_COMMENTS")}</h3>
          <p>{e}</p>
        </div>
      )}</div> : null}
      {thumbnailsToShow?.thumbs?.length > 0 ? <div className="TLComments">
        <h3>{t("CS_COMMON_ATTACHMENTS")}</h3>
        <DisplayPhotos srcs={thumbnailsToShow.thumbs} onClick={(src, index) => { zoomImageWrapper(src, index, thumbnailsToShow) }} />
      </div> : null}
      {captionDetails?.date ? <TLCaption data={captionDetails} comments={comment} /> : null}
    </>
  }

  const getCheckPoint = ({ status, caption, auditDetails, timeLineActions, index, array, performedAction, comment, thumbnailsToShow, assigner, totalTimelineLength }) => {
    const isCurrent = 0 === index;
    switch (status) {
      case "PENDINGFORREASSIGNMENT":
        return <CheckPoint isCompleted={isCurrent} key={index} label={t(`CS_COMMON_${status}`)} customChild={getCommentsInCustomChildComponent({ comment, thumbnailsToShow, auditDetails, assigner })} />;

      case "PENDINGFORASSIGNMENT":
        const isFirstPendingForAssignment = totalTimelineLength - (index + 1) === 0 ? true : false
        return <PendingForAssignment key={index} isCompleted={isCurrent} text={t(`CS_COMMON_${status}`)} customChild={getCommentsInCustomChildComponent({ comment, ...isFirstPendingForAssignment ? { auditDetails } : { thumbnailsToShow, auditDetails } })} />;

      case "PENDINGFORASSIGNMENT_AFTERREOPEN":
        return <PendingForAssignment isCompleted={isCurrent} key={index} text={t(`CS_COMMON_${status}`)} customChild={getCommentsInCustomChildComponent({ comment, thumbnailsToShow, auditDetails, assigner })} />;

      case "PENDINGATLME":
        let { name, mobileNumber } = caption && caption.length > 0 ? caption[0] : { name: "", mobileNumber: "" };
        const assignedTo = `${t(`CS_COMMON_${status}`)}`;
        // Show assignee info only in TLCaption (via customChild) to avoid duplicate display
        return <PendingAtLME isCompleted={isCurrent} key={index} name={null} mobile={null} text={assignedTo} customChild={getCommentsInCustomChildComponent({ comment, thumbnailsToShow, auditDetails, assigner })} />;

      case "RESOLVED":
        return (
          <Resolved
            key={index}
            isCompleted={isCurrent}
            action={complaintWorkflow.action}
            nextActions={index <= 1 && timeLineActions}
            complaintDetails={complaintDetails}
            ComplainMaxIdleTime={ComplainMaxIdleTime}
            rating={index <= 1 ? rating : undefined}
            serviceRequestId={serviceRequestId}
            reopenDate={Digit.DateUtils.ConvertTimestampToDate(auditDetails.lastModifiedTime)}
            customChild={getCommentsInCustomChildComponent({ comment, thumbnailsToShow, auditDetails, assigner })}
          />
        );
      case "REJECTED":
        return (
          <Rejected
            key={index}
            isCompleted={isCurrent}
            action={complaintWorkflow.action}
            nextActions={index <= 1 && timeLineActions}
            complaintDetails={complaintDetails}
            ComplainMaxIdleTime={ComplainMaxIdleTime}
            // rating intentionally NOT passed here — stars belong to the
            // CLOSEDAFTERREJECTION checkpoint above, mirroring how resolved.js
            // suppresses stars on its action === "RATE" branch and leaves
            // them to CLOSEDAFTERRESOLUTION. Passing rating here would cause
            // duplicate "You Rated ★★★" rows on the timeline.
            serviceRequestId={serviceRequestId}
            reopenDate={Digit.DateUtils.ConvertTimestampToDate(auditDetails.lastModifiedTime)}
            customChild={getCommentsInCustomChildComponent({ comment, thumbnailsToShow, auditDetails, assigner })}
          />
        );
      case "CLOSEDAFTERRESOLUTION":
        return <CheckPoint isCompleted={isCurrent} key={index} label={t(`CS_COMMON_${`CS_COMMON_${status}`}`)} customChild={<div>{getCommentsInCustomChildComponent({ comment, thumbnailsToShow, auditDetails, assigner })}{rating ? <StarRated text={t("CS_ADDCOMPLAINT_YOU_RATED")} rating={rating} /> : null}</div>} />;
      case "CLOSEDAFTERREJECTION":
        return <CheckPoint isCompleted={isCurrent} key={index} label={t(`CS_COMMON_${status}`)} customChild={<div>{getCommentsInCustomChildComponent({ comment, thumbnailsToShow, auditDetails, assigner })}{rating ? <StarRated text={t("CS_ADDCOMPLAINT_YOU_RATED")} rating={rating} /> : null}</div>} />;

      // case "RESOLVE":
      // return (
      //   <Resolved
      //     action={complaintWorkflow.action}
      //     nextActions={timeLineActions}
      //     rating={rating}
      //     serviceRequestId={serviceRequestId}
      //     reopenDate={Digit.DateUtils.ConvertTimestampToDate(auditDetails.lastModifiedTime)}
      //   />
      // );
      case "COMPLAINT_FILED":
        return <CheckPoint isCompleted={isCurrent} key={index} label={t("CS_COMMON_COMPLAINT_FILED")} customChild={getCommentsInCustomChildComponent({ comment, auditDetails, assigner, status })} />;

      default:
        return <CheckPoint isCompleted={isCurrent} key={index} label={t(`CS_COMMON_${status}`)} customChild={getCommentsInCustomChildComponent({ comment, thumbnailsToShow, auditDetails, assigner, status })} />;
    }
  };

  return (
    <React.Fragment>
      <style>
        {`
          .timeline-wrapper h2,
          .timeline-wrapper h3,
          .timeline-wrapper h4,
          .timeline-wrapper header,
          .timeline-wrapper .checkpoint-label {
             font-size: 18px !important;
             font-weight: 700 !important;
             color: #0b0c0c !important;
          }
          .timeline-wrapper p {
             font-size: 16px !important;
          }
        `}
      </style>
      <CardSubHeader style={{ marginBottom: "15px", fontSize: "24px", fontWeight: 700, lineHeight: "28px", color: "#0b0c0c" }}>{t(`${LOCALIZATION_KEY.CS_COMPLAINT_DETAILS}_COMPLAINT_TIMELINE`)}</CardSubHeader>
      {augmentedTimeline && totalTimelineLength > 0 ? (
        <div className="timeline-wrapper">
          <ConnectingCheckPoints>
            {augmentedTimeline.map(({ status, caption, auditDetails, timeLineActions, performedAction, wfComment: comment, thumbnailsToShow, assigner }, index, array) => {
              return getCheckPoint({ status, caption, auditDetails, timeLineActions, index, array, performedAction, comment, thumbnailsToShow, assigner, totalTimelineLength });
            })}
          </ConnectingCheckPoints>
        </div>
      ) : (
        <Loader />
      )}
    </React.Fragment>
  );
};

export default TimeLine;