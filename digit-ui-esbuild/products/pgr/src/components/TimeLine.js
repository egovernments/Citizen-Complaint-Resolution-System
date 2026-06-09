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

const TLCaption = ({ data, comments }) => {
  const { t } = useTranslation()
  return (
    <div>
      {data?.date && <p>{data?.date}</p>}
      <p>{data?.name}</p>
      <p>{data?.mobileNumber}</p>
      {data?.source && <p>{t("ES_COMMON_FILED_VIA_" + data?.source.toUpperCase())}</p>}
    </div>
  );
};

// Workflow audit comments come from the reject modal as
// "[<CODE>] <free text>" (e.g. "[NOT_PUBLIC_INFRA] sfdgdsfg"). When the
// [CODE] resolves to a `CS_REJECTION__<CODE>` localization key, show the
// localized reason under a "Rejection Reason" heading and render any
// trailing free text on its own line. Falls back to the existing
// "Comments" heading for any other comment shape so non-reject
// timeline entries on the citizen side (and other modules sharing
// this component) are unaffected (egovernments/CCRS#489).
const TLCommentItem = ({ value, t }) => {
  const match = typeof value === "string" && value.match(/^\[([A-Z_][A-Z0-9_]*)\]\s*(.*)$/s);
  const reasonKey = match && `CS_REJECTION__${match[1]}`;
  const reasonLabel = reasonKey && t(reasonKey);
  const reasonResolved = reasonLabel && reasonLabel !== reasonKey;
  return (
    <div className="TLComments">
      {reasonResolved ? <>
        <h3>{t("CS_REJECT_COMPLAINT")}</h3>
        <p>{reasonLabel}</p>
        {match[2] && <p>{match[2]}</p>}
      </> : <>
        <h3>{t("WF_COMMON_COMMENTS")}</h3>
        <p>{value}</p>
      </>}
    </div>
  );
};

const TimeLine = ({ isLoading, data, serviceRequestId, complaintWorkflow, rating, zoomImage, complaintDetails, ComplainMaxIdleTime }) => {
  const { t } = useTranslation();

  function zoomImageWrapper(imageSource, index, thumbnailsToShow) {
    let newIndex = thumbnailsToShow.thumbs?.findIndex(link => link === imageSource);
    zoomImage((newIndex > -1 && thumbnailsToShow?.fullImage?.[newIndex]) || imageSource);
  }

  // `data` is the workflow-details response. The egov-workflow-v2 API
  // returns 400 for some complaints (e.g. detached / partially-loaded
  // workflow rows) and the hook surfaces that as `data === undefined`,
  // which used to crash the destructure on the next line and tip the
  // whole ComplaintDetails page into the ErrorBoundary's "Something
  // went wrong" fallback. Default to an empty object so we render a
  // bare-but-not-broken timeline section instead.
  let { timeline } = data || {};
  const totalTimelineLength = useMemo(() => timeline?.length, [timeline])

  useEffect(() => {
    if (!timeline || timeline.length === 0) return;
    // (Filtered for documentation; the value isn't read elsewhere — kept
    // because removing it changes timing of the synthetic FILED checkpoint
    // push below.)
    timeline?.filter((status, index, array) => {
      if (index === array.length - 1 && status.status === "PENDINGFORASSIGNMENT") {
        return true;
      } else {
        return false;
      }
    });

    const onlyPendingForAssignmentStatusArray = timeline?.filter(e => e?.status === "PENDINGFORASSIGNMENT") || [];
    if (onlyPendingForAssignmentStatusArray.length === 0) return;
    const duplicateCheckpointOfPendingForAssignment = onlyPendingForAssignmentStatusArray.at(-1)
    timeline.push({
      ...duplicateCheckpointOfPendingForAssignment,
      performedAction: "FILED",
      status: "COMPLAINT_FILED",
    });
  }, [timeline]);

  const getCommentsInCustomChildComponent = ({ comment, thumbnailsToShow, auditDetails, assigner, status }) => {
    const captionDetails = {
      date: auditDetails?.lastModified,
      name: assigner?.name,
      mobileNumber: assigner?.mobileNumber,
      source: status == "COMPLAINT_FILED" ? complaintDetails?.audit.source : ""
    }
    return <>
      {comment ? <div>{comment?.map((e, i) => <TLCommentItem key={i} value={e} t={t} />)}</div> : null}
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
        // The outer CheckPoint already prints the "Pending at LME" label, so
        // pass an empty prefix to PendingAtLME — it just needs the assignee
        // name + mobile beside the phone icon (issue CCRS#490).
        return <PendingAtLME isCompleted={isCurrent} key={index} name={name} mobile={mobileNumber} text="" customChild={getCommentsInCustomChildComponent({ comment, thumbnailsToShow, auditDetails, assigner })} />;

      case "RESOLVED":
        return (
          <Resolved
            key={index}
            isCompleted={isCurrent}
            action={complaintWorkflow.action}
            nextActions={index <= 1 && timeLineActions}
            complaintDetails={complaintDetails}
            ComplainMaxIdleTime={ComplainMaxIdleTime}
            rating={index === 0 ? rating : undefined}
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
            rating={index === 0 ? rating : undefined}
            serviceRequestId={serviceRequestId}
            reopenDate={Digit.DateUtils.ConvertTimestampToDate(auditDetails.lastModifiedTime)}
            customChild={getCommentsInCustomChildComponent({ comment, thumbnailsToShow, auditDetails, assigner })}
          />
        );
      case "CLOSEDAFTERRESOLUTION":
        return <CheckPoint isCompleted={isCurrent} key={index} label={t(`CS_COMMON_${status}`)} customChild={<div>{getCommentsInCustomChildComponent({ comment, thumbnailsToShow, auditDetails, assigner })}{rating ? <StarRated text={t("CS_ADDCOMPLAINT_YOU_RATED")} rating={rating} /> : null}</div>} />;
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

  // Header is owned by the v2 ComplaintDetails parent ("Activity timeline"
  // SectionTitle), so don't render the legacy CardSubHeader here. The
  // wrapper class drives the v2 timeline visuals via overrides.css.
  return (
    <div className="timeline-wrapper v2-timeline">
      {timeline && totalTimelineLength > 0 ? (
        <ConnectingCheckPoints>
          {timeline.map(({ status, caption, auditDetails, timeLineActions, performedAction, wfComment: comment, thumbnailsToShow, assigner }, index, array) => {
            return getCheckPoint({ status, caption, auditDetails, timeLineActions, index, array, performedAction, comment, thumbnailsToShow, assigner, totalTimelineLength });
          })}
        </ConnectingCheckPoints>
      ) : (
        <Loader />
      )}
    </div>
  );
};

export default TimeLine;