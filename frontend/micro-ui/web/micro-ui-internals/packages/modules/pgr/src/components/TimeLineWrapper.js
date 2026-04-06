import React, { useState, useEffect } from 'react';
import { useTranslation } from "react-i18next";
import { PopUp, Timeline, TimelineMolecule, Loader, DisplayPhotos } from '@egovernments/digit-ui-components';
import { useMyContext } from "../utils/context";
import { convertEpochFormateToDate } from '../utils';

// Helper function to mask employee names (show first 1 char + * + X's)
const maskName = (name) => {
    if (!name || name.length < 2) return name;
    return name.charAt(0) + '*' + 'X'.repeat(Math.max(0, name.length - 2));
};

// Helper function to mask phone numbers (show last 4 digits only)
const maskPhoneNumber = (phone) => {
    if (!phone || phone.length < 4) return phone;
    return 'XXXXXX' + phone.slice(-4);
};

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
                // CCSD-1777 Fix: Business rule — show employee info ONLY when the user
                // explicitly selected an assignee, indicated by assignes[0] being present.
                // We intentionally ignore instance.assigner (the action performer) because
                // it is always populated by the backend, even for actions where no user
                // selection is possible (CREATE, REJECT, RESOLVE, REOPEN-without-assignee).
                //
                // This handles all cases correctly:
                //   ASSIGN / REASSIGN with assignee     → assignes[0] present  → show ✓
                //   REOPEN with assignee (CSR selects)  → assignes[0] present  → show ✓
                //   CREATE / REJECT / RESOLVE / REOPEN  → assignes empty/null  → hide ✓
                const employee = instance?.assignes?.[0] || null;

                // Mask employee name and mobile number (only relevant when employee is set)
                const maskedName = employee?.name ? maskName(employee.name) : null;
                const maskedMobile = employee?.mobileNumber ? maskPhoneNumber(employee.mobileNumber) : null;

                const subElements = [
                    convertEpochFormateToDate(instance?.auditDetails?.lastModifiedTime),
                    // Show assignee name+role only when an assignee was explicitly selected
                    employee && maskedName && `${maskedName} - ${employee?.roles
                        ?.map(role => t(Digit.Utils.locale.getTransformedLocale(`ACCESSCONTROL_ROLES_ROLES_${role.code}`)))
                        .join(", ") || t('NA')
                    }`,
                    // Show masked mobile only when an assignee was explicitly selected
                    maskedMobile && `${t("ES_COMMON_CONTACT_DETAILS")}: ${maskedMobile}`,
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
