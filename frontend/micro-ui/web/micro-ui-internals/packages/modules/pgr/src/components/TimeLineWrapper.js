import React, { useState, useEffect } from 'react';
import { useTranslation } from "react-i18next";
import { PopUp, Timeline, TimelineMolecule, Loader, DisplayPhotos } from '@egovernments/digit-ui-components';
import { useMyContext } from "../utils/context";
import { convertEpochFormateToDate } from '../utils';

const TimelineWrapper = ({ businessId, isWorkFlowLoading, workflowData, labelPrefix = "" }) => {
    const { state } = useMyContext();
    const { t } = useTranslation();

    const tenantId = Digit.ULBService.getCurrentTenantId();

    // Manage timeline data
    const [timelineSteps, setTimelineSteps] = useState([]);

    useEffect(() => {
        if (workflowData && workflowData.ProcessInstances) {
            // Map API response to timeline steps
            const steps = workflowData.ProcessInstances.map((instance, index) => {
                const subElements = [
                    convertEpochFormateToDate(instance?.auditDetails?.lastModifiedTime),
                    // For ASSIGN or REASSIGN actions, show assignee details; otherwise show assigner details
                    (instance?.action == "ASSIGN" || instance?.action == "REASSIGN" ? instance?.assignes && `${instance.assignes?.[0]?.name} - ${instance?.assignes?.[0]?.roles
                        ?.map(role => t(Digit.Utils.locale.getTransformedLocale(`ACCESSCONTROL_ROLES_ROLES_${role.code}`)))
                        .join(", ") || t('NA')
                        }` : instance?.assigner &&
                    `${instance.assigner?.name} - ${instance.assigner?.roles
                        ?.map(role => t(Digit.Utils.locale.getTransformedLocale(`ACCESSCONTROL_ROLES_ROLES_${role.code}`)))
                        .join(", ") || t('NA')
                    }`),
                    (instance?.action === "ASSIGN" || instance?.action === "REASSIGN" ? `${t("ES_COMMON_CONTACT_DETAILS")}: ${instance?.assignes?.[0]?.mobileNumber}` : `${t("ES_COMMON_CONTACT_DETAILS")}: ${instance?.assigner?.mobileNumber}`),
                    instance?.comment && `${t('CS_COMMON_EMPLOYEE_COMMENTS')} : "${instance.comment}"`
                ];

                // Add attachments if available
                if (instance?.documents && instance.documents.length > 0) {
                    const fileStoreIds = instance.documents.map(doc => doc.fileStoreId);
                    // Create a simple display of document count and links
                    subElements.push(
                        <div key={`attachments-${index}`}>
                            <strong>{t('CS_COMMON_ATTACHMENTS')}:</strong> {instance.documents.length} {t('FILES')}
                        </div>
                    );
                }

                return {
                    label: t(`${labelPrefix}${instance?.action}`),
                    variant: 'completed',
                    subElements: subElements.filter(Boolean), // Remove null/undefined elements
                    showConnector: true
                };
            });
            setTimelineSteps(steps);
        }
    }, [workflowData]);

    return (
        isWorkFlowLoading ? <Loader /> :
            <TimelineMolecule key="timeline" initialVisibleCount={4} hidePastLabel={timelineSteps.length < 5}>
                {timelineSteps.map((step, index) => (
                    <Timeline
                        key={index}
                        label={step.label}
                        subElements={step.subElements}
                        variant={step.variant}
                        showConnector={step.showConnector}
                    />
                ))}
            </TimelineMolecule>
    );
};

export default TimelineWrapper;
