import React, { Fragment,useState,useEffect } from 'react'
import { Loader } from "./Loader"
import CardSectionHeader from './CardSectionHeader';
import { CheckPoint, ConnectingCheckPoints } from './ConnectingCheckPoints';
import BreakLine from './BreakLine';
import { useTranslation } from "react-i18next";
import TLCaption from './TLCaption';

function OpenImage(imageSource, index, thumbnailsToShow) {
    window.open(thumbnailsToShow?.fullImage?.[0], "_blank");
}

const WorkflowTimeline = ({ businessService, tenantId,applicationNo, timelineStatusPrefix="WF_SERVICE_" ,statusAttribute="status", ...props}) => {
    const [additionalComment,setAdditionalComment] = useState(false)
    //for testing from url these 2 lines of code are kept here
    // const { estimateNumber } = Digit.Hooks.useQueryParams();
    // applicationNo = applicationNo? applicationNo : estimateNumber 
    const { t } = useTranslation();

    const getTimelineCaptions = (checkpoint, index) => {

        let captionDetails = {
            name : '',
            date : '',
            mobileNumber : '',
            wfComment : '',
            additionalComment : '',
            thumbnailsToShow : ''
        }
        if(index === -1) {
            captionDetails.name = checkpoint?.assignes?.[0]?.name;
            captionDetails.date = '';
            captionDetails.mobileNumber = '';
            captionDetails.wfComment = '';
            captionDetails.additionalComment = '';
            captionDetails.thumbnailsToShow = '';
        }else {
            // Prefer the assignee on rows produced by an ASSIGN-shaped action
            // (ASSIGN, REASSIGN, ESCALATE). Those rows describe a state the
            // complaint moved INTO — "Pending at LME (<assignee name>)" reads
            // far better than "Pending at LME (<the actor who clicked Assign>)".
            // Falls through to the actor for APPLY / RESOLVE / REJECT, where
            // there's no meaningful assignee and the actor *is* the right
            // identity to show. Final fall-back is `CS_NA` so a missing record
            // never renders as the literal string "undefined"
            // (closes egovernments/CCRS#490 sub-bugs 2-4).
            //
            // egov-workflow-v2's EMPLOYEE-role response concatenates the
            // assigner's full role-name list onto `assigner.name` as
            // `"<name> - <role1>, <role2>, ..."`. Strip that here too so the
            // timeline caption matches the citizen view (egovernments/CCRS#524).
            const stripRoleSuffix = (raw) =>
                typeof raw === "string" && raw.indexOf(" - ") !== -1
                    ? raw.slice(0, raw.indexOf(" - ")).trim()
                    : raw;
            const assignee = checkpoint?.assignes?.[0];
            const preferAssignee = assignee?.name && ["ASSIGN", "REASSIGN", "ESCALATE"].includes(checkpoint?.performedAction);
            const rawName = preferAssignee ? assignee.name : checkpoint?.assigner?.name;
            const cleaned = stripRoleSuffix(rawName);
            captionDetails.name = (typeof cleaned === "string" && cleaned.length > 0) ? cleaned : t("CS_NA");
            captionDetails.date = `${Digit.DateUtils?.ConvertTimestampToDate(checkpoint.auditDetails.lastModifiedEpoch)} ${Digit.DateUtils?.ConvertEpochToTimeInHours(
                checkpoint.auditDetails.lastModifiedEpoch
            )} ${Digit.DateUtils?.getDayfromTimeStamp(checkpoint.auditDetails.lastModifiedEpoch)}`;
            captionDetails.mobileNumber = preferAssignee ? assignee?.mobileNumber : checkpoint?.assigner?.mobileNumber;
            captionDetails.wfComment = checkpoint?.comment ? [checkpoint?.comment] : [];
            captionDetails.additionalComment = additionalComment && checkpoint?.performedAction === "APPROVE",
            captionDetails.thumbnailsToShow = checkpoint?.thumbnailsToShow;
        }

        const caption = {
            date: captionDetails?.date,
            name: captionDetails?.name,
            mobileNumber: captionDetails?.mobileNumber,
            wfComment: captionDetails?.wfComment,
            additionalComment: captionDetails?.additionalComment,
            thumbnailsToShow: checkpoint?.thumbnailsToShow
        };

        return <TLCaption data={caption} OpenImage={OpenImage} />;
        
    };

    let workflowDetails = Digit.Hooks.useWorkflowDetailsV2(
        {
            tenantId: tenantId,
            id: applicationNo,
            moduleCode: businessService,
            config: {
                enabled: true,
                cacheTime: 0
            }
        }
    );

    useEffect(() => {
        if (workflowDetails?.data?.applicationBusinessService === "muster-roll-approval" && workflowDetails?.data?.actionState?.applicationStatus === "APPROVED") {
            setAdditionalComment(true)
        }
    }, [workflowDetails])
    
    
    return (
        <Fragment>
            {workflowDetails?.isLoading && <Loader />}
            { workflowDetails?.data?.timeline?.length > 0 && (
                <React.Fragment>
                    {workflowDetails?.breakLineRequired === undefined ? <BreakLine /> : workflowDetails?.breakLineRequired ? <BreakLine /> : null}
                    {!workflowDetails?.isLoading && (
                        <Fragment>
                            <CardSectionHeader style={{ marginBottom: "16px", marginTop: "32px" }}>
                                {t("WORKS_WORKFLOW_TIMELINE")}
                            </CardSectionHeader>
                            {workflowDetails?.data?.timeline && 
                                <ConnectingCheckPoints>
                                    {workflowDetails?.data?.timeline &&
                                        workflowDetails?.data?.timeline.map((checkpoint, index, arr) => {
                                            return (
                                                <React.Fragment key={index}>
                                                    {
                                                        index === 0 && !checkpoint?.isTerminateState &&
                                                            <React.Fragment>
                                                                <CheckPoint
                                                                    keyValue={index}
                                                                    isCompleted={index === 0}
                                                                    label={t(
                                                                        Digit.Utils.locale.getTransformedLocale(`${timelineStatusPrefix}STATE_${checkpoint?.["state"]}`)
                                                                    )}
                                                                    // customChild={getTimelineCaptions(checkpoint, -1)}
                                                                    customClassName="checkpoint-connect-wrap"
                                                                />
                                                            </React.Fragment>
                                                    }   
                                                    <CheckPoint
                                                        keyValue={index}
                                                        isCompleted={checkpoint?.isTerminateState && index === 0}
                                                        label={t(
                                                            Digit.Utils.locale.getTransformedLocale(`${timelineStatusPrefix}STATUS_${checkpoint?.performedAction === "EDIT" ? `${checkpoint?.performedAction}` :   `${checkpoint?.performedAction}`
                                                            }`)
                                                        )}
                                                        customChild={getTimelineCaptions(checkpoint, index)}
                                                    />
                                                </React.Fragment>
                                            );  
                                        })}
                                </ConnectingCheckPoints>
                            }
                        </Fragment>
                    )}
                </React.Fragment>
            )}
        </Fragment>
    )
}

export default WorkflowTimeline