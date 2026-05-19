import React, { useState, useEffect } from 'react';
import { useTranslation } from "react-i18next";
import { PopUp, Timeline, TimelineMolecule, Loader, DisplayPhotos } from '@egovernments/digit-ui-components';
import { DisplayPhotos as LegacyDisplayPhotos, ImageViewer } from '@egovernments/digit-ui-react-components';
import { useMyContext } from "../utils/context";
import { convertEpochFormateToDate } from '../utils';
import StarRated from './timelineInstances/StarRated';

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

// Fetches and renders thumbnails for a list of workflow documents
const WorkflowDocuments = ({ documents, tenantId }) => {
    const [thumbs, setThumbs] = useState([]);
    const [fullImages, setFullImages] = useState([]);
    const [zoomedImage, setZoomedImage] = useState(null);
    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        if (!documents || documents.length === 0) return;
        const ids = documents.map((d) => d.fileStoreId).join(",");
        Digit.UploadServices.Filefetch([ids], tenantId)
            .then((res) => {
                if (!res?.data) return;
                const t = [], f = [];
                Object.keys(res.data).forEach((key) => {
                    if (key === "fileStoreIds" || key === "responseInfo") return;
                    const val = res.data[key];
                    if (typeof val === "string") {
                        const urls = val.split(",");
                        const full = urls[0];
                        const thumb = urls.find((u) => u.includes("small")) || full;
                        f.push(full);
                        t.push(thumb);
                    }
                });
                setThumbs(t);
                setFullImages(f);
            })
            .catch(() => {});
    }, [documents, tenantId]);

    if (thumbs.length === 0) return null;

    return (
        <div style={{ marginTop: "0.5rem" }}>
            <LegacyDisplayPhotos
                srcs={thumbs}
                onClick={(src, index) => { setZoomedImage(fullImages[index]); setCurrentIndex(index); }}
            />
            {zoomedImage && (
                <ImageViewer imageSrc={zoomedImage} onClose={() => setZoomedImage(null)} />
            )}
        </div>
    );
};

const TimelineWrapper = ({ businessId, isWorkFlowLoading, workflowData, labelPrefix = "", rating }) => {
    const { state } = useMyContext();
    const { t } = useTranslation();

    const tenantId = Digit.ULBService.getCurrentTenantId();

    // Manage timeline data
    const [timelineSteps, setTimelineSteps] = useState([]);

    useEffect(() => {
        if (workflowData && workflowData.ProcessInstances) {
            // Map API response to timeline steps
            const steps = workflowData.ProcessInstances.map((instance, index) => {
                // Resolve star rating for the RATE step. Backend may put it directly on
                // the ProcessInstance (instance.rating) for the RATE action; otherwise
                // fall back to the rating passed in from the complaint's service.rating.
                const instanceRating = instance?.action === "RATE"
                    ? (Number(instance?.rating) > 0 ? Number(instance.rating) : Number(rating) || 0)
                    : 0;
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
                    instance?.comment && `${t('CS_COMMON_EMPLOYEE_COMMENTS')} : "${instance.comment}"`,
                    // Render workflow document thumbnails inline in the timeline step
                    instance?.documents?.length > 0 && (
                        <WorkflowDocuments
                            key={`wf-docs-${index}`}
                            documents={instance.documents}
                            tenantId={tenantId}
                        />
                    ),
                    // Render citizen-submitted star rating on the RATE step.
                    // Use a citizen-rated label (not "You Rated") since this timeline is
                    // viewed by employees; fall back to plain English when the key isn't
                    // present in the locale bundle.
                    instanceRating > 0 && (
                        <StarRated
                            key={`wf-rating-${index}`}
                            text={(() => {
                                const key = "CS_COMMON_CITIZEN_RATED";
                                const value = t(key);
                                return value === key ? "Citizen rated " : value + " ";
                            })()}
                            rating={instanceRating}
                        />
                    ),
                ];

                return {
                    label: t(`${labelPrefix}${instance?.action}`),
                    variant: 'completed',
                    subElements: subElements.filter(Boolean), // Remove null/undefined elements
                    showConnector: true
                };
            });
            setTimelineSteps(steps);
        }
    }, [workflowData, rating]);

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
