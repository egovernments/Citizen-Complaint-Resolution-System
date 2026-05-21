import { Card, CardSubHeader, CheckPoint, ConnectingCheckPoints, GreyOutText, Loader, DisplayPhotos } from "@egovernments/digit-ui-react-components";
import React, {Fragment, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LOCALIZATION_KEY } from "../constants/Localization";
import PendingAtLME from "./timelineInstances/pendingAtLme";
import PendingForAssignment from "./timelineInstances/PendingForAssignment";
import PendingForReassignment from "./timelineInstances/PendingForReassignment";
import Reopen from "./timelineInstances/reopen";
import Resolved from "./timelineInstances/resolved";
import Rejected from "./timelineInstances/rejected";
import StarRated from "./timelineInstances/StarRated";

const TLCaption = ({ data , comments}) => {
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

const TimeLine = ({ isLoading, data, serviceRequestId, complaintWorkflow, rating, zoomImage, complaintDetails, ComplainMaxIdleTime }) => {
  const { t } = useTranslation();

  function zoomImageWrapper(imageSource, index,thumbnailsToShow){
    let newIndex=thumbnailsToShow.thumbs?.findIndex(link=>link===imageSource);
    zoomImage((newIndex>-1&&thumbnailsToShow?.fullImage?.[newIndex])||imageSource);
  }

  let { timeline } = data;
  const totalTimelineLength = useMemo(()=> timeline?.length ,[timeline])

  useEffect(() => {
    let filteredTimeline = timeline?.filter((status, index, array) => {
      if (index === array.length - 1 && status.status === "PENDINGFORASSIGNMENT") {
        return true;
      } else {
        return false;
      }
    });
    const [{auditDetails}] = filteredTimeline?.length>0 ? filteredTimeline : [{}];

    const onlyPendingForAssignmentStatusArray = timeline?.filter( e => e?.status === "PENDINGFORASSIGNMENT")
    const duplicateCheckpointOfPendingForAssignment = onlyPendingForAssignmentStatusArray.at(-1)
    timeline?.push({
      ...duplicateCheckpointOfPendingForAssignment,
      performedAction: "FILED",
      status: "COMPLAINT_FILED",
    });
  }, [timeline]);

  // egov-workflow-v2's EMPLOYEE-role enrichment appends the assigner's full
  // role-name list to `assigner.name` as `"<name> - <role1>, <role2>, ..."`
  // (visible only on the employee timeline; citizen view gets `<name>` clean).
  // For admin-like users with 8+ roles this produces a multi-line wall of
  // text — see egovernments/CCRS#524. Until the backend stops concatenating
  // roles into the display name, strip everything from " - " onward so the
  // employee timeline matches the citizen view's single-name caption.
  const cleanAssignerName = (raw) => {
    if (typeof raw !== "string") return raw;
    const sep = raw.indexOf(" - ");
    return sep === -1 ? raw : raw.slice(0, sep).trim();
  };

  const getCommentsInCustomChildComponent = ({comment, thumbnailsToShow, auditDetails, assigner, status}) => {
    const captionDetails = {
      date: auditDetails?.lastModified,
      name: cleanAssignerName(assigner?.name),
      mobileNumber: assigner?.mobileNumber,
      source: status == "COMPLAINT_FILED" ? complaintDetails?.audit.source : ""
    }
    return <>
    {comment ? <div>{comment?.map( e => {
      const match = typeof e === "string" && e.match(/^\[([A-Z_][A-Z0-9_]*)\]\s*(.*)$/s);
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
          <p>{e}</p>
        </>}
      </div>
      );
    })}</div> : null}
    {thumbnailsToShow?.thumbs?.length > 0 ? <div className="TLComments">
      <h3>{t("CS_COMMON_ATTACHMENTS")}</h3>
      <DisplayPhotos srcs={thumbnailsToShow.thumbs} onClick={(src, index) => {zoomImageWrapper(src, index,thumbnailsToShow)}} />
    </div> : null}
    {captionDetails?.date ? <TLCaption data={captionDetails} comments={comment}/> : null}
    </>
  }

  const getCheckPoint = ({ status, caption, auditDetails, timeLineActions, index, array, performedAction, comment, thumbnailsToShow, assigner, totalTimelineLength }) => {
    const isCurrent = 0 === index;
    switch (status) {
      case "PENDINGFORREASSIGNMENT":
        return <CheckPoint isCompleted={isCurrent} key={index} label={t(`CS_COMMON_${status}`)} customChild={getCommentsInCustomChildComponent({comment, thumbnailsToShow, auditDetails, assigner})} />;

      case "PENDINGFORASSIGNMENT":
        const isFirstPendingForAssignment = totalTimelineLength - (index + 1) === 0 ? true : false
        return <PendingForAssignment key={index} isCompleted={isCurrent} text={t(`CS_COMMON_${status}`)} customChild={getCommentsInCustomChildComponent({comment, ...isFirstPendingForAssignment ? {auditDetails} : {thumbnailsToShow, auditDetails} })} />;

      case "PENDINGFORASSIGNMENT_AFTERREOPEN":
        return <PendingForAssignment isCompleted={isCurrent} key={index} text={t(`CS_COMMON_${status}`)} customChild={getCommentsInCustomChildComponent({comment, thumbnailsToShow, auditDetails, assigner})} />;

      case "PENDINGATLME":
        let { name, mobileNumber } = caption && caption.length > 0 ? caption[0] : { name: "", mobileNumber: "" };
        const assignedTo = `${t(`CS_COMMON_${status}`)}`;
        return <PendingAtLME isCompleted={isCurrent} key={index} name={name} mobile={mobileNumber} text={assignedTo} customChild={getCommentsInCustomChildComponent({comment, thumbnailsToShow, auditDetails, assigner})} />;

      case "RESOLVED":
        return (
          <Resolved
            key={index}
            isCompleted={isCurrent}
            action={complaintWorkflow.action}
            nextActions={index <= 1 && timeLineActions}
            complaintDetails={complaintDetails}
            ComplainMaxIdleTime={ComplainMaxIdleTime}
            //rating={index <= 1 && rating}
            serviceRequestId={serviceRequestId}
            reopenDate={Digit.DateUtils.ConvertTimestampToDate(auditDetails.lastModifiedTime)}
            customChild={getCommentsInCustomChildComponent({comment, thumbnailsToShow, auditDetails, assigner})}
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
            //rating={index <= 1 && rating}
            serviceRequestId={serviceRequestId}
            reopenDate={Digit.DateUtils.ConvertTimestampToDate(auditDetails.lastModifiedTime)}
            customChild={getCommentsInCustomChildComponent({comment, thumbnailsToShow, auditDetails, assigner})}
          />
        );
      case "CLOSEDAFTERRESOLUTION":
        return <CheckPoint isCompleted={isCurrent} key={index} label={t(`CS_COMMON_${`CS_COMMON_${status}`}`)} customChild={<div>{getCommentsInCustomChildComponent({comment, thumbnailsToShow, auditDetails, assigner})}{rating ? <StarRated text={t("CS_ADDCOMPLAINT_YOU_RATED")} rating={rating} /> : null}</div>} />;

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
        return <CheckPoint isCompleted={isCurrent} key={index} label={t("CS_COMMON_COMPLAINT_FILED")} customChild={getCommentsInCustomChildComponent({comment, auditDetails, assigner, status})} />;

      default:
        return <CheckPoint isCompleted={isCurrent} key={index} label={t(`CS_COMMON_${status}`)} customChild={getCommentsInCustomChildComponent({comment, thumbnailsToShow, auditDetails, assigner, status})} />;
    }
  };

  return (
    <React.Fragment>
      <CardSubHeader>{t(`${LOCALIZATION_KEY.CS_COMPLAINT_DETAILS}_COMPLAINT_TIMELINE`)}</CardSubHeader>
      {timeline && totalTimelineLength > 0 ? (
        <ConnectingCheckPoints>
          {timeline.map(({ status, caption, auditDetails, timeLineActions, performedAction, wfComment: comment, thumbnailsToShow, assigner }, index, array) => {
            return getCheckPoint({ status, caption, auditDetails, timeLineActions, index, array, performedAction, comment, thumbnailsToShow, assigner, totalTimelineLength });
          })}
        </ConnectingCheckPoints>
      ) : (
        <Loader />
      )}
    </React.Fragment>
  );
};

export default TimeLine;