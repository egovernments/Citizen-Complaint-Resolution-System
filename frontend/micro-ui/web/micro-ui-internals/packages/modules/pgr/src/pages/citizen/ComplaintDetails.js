import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MdmsService } from "@egovernments/digit-ui-libraries";


import { LOCALIZATION_KEY } from "../../constants/Localization";

import {
  Card,
  Header,
  CardSubHeader,
  StatusTable,
  Row,
  TextArea,
  SubmitBar,
  DisplayPhotos,
  ImageViewer,
  Loader,
  Toast,
} from "@egovernments/digit-ui-react-components";

import TimeLine from "../../components/TimeLine";
import ComplaintPhotos from "../../components/ComplaintPhotos";
import ComplaintLocationMap from "../../components/ComplaintLocationMap";

const WorkflowComponent = ({ complaintDetails, id }) => {
  const tenantId = Digit.Utils.getMultiRootTenant()
    ? Digit.ULBService.getCurrentTenantId()
    : Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code || Digit.ULBService.getCurrentTenantId();
  let workFlowDetails = Digit.Hooks.useWorkflowDetails({ tenantId: tenantId, id, moduleCode: "PGR" });

  const { isLoading: isMDMSLoading, data: cct } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ComplainClosingTime" }],
    {
      cacheTime: Infinity,
      select: (data) => data?.["RAINMAKER-PGR"]?.cct,
    }
  );

  // CCSD-1766 Fix: Force revalidation on mount to ensure fresh data after rating submission.
  // If a rating was just submitted for this complaint, use a longer delay (3 s) so the
  // backend has time to commit the RATE transaction before the workflow/timeline API refetches.
  useEffect(() => {
    const ratingSession = Digit.SessionStorage.get("PGR_LAST_RATING");
    const SESSION_TTL_MS = 2 * 60 * 1000;
    const isJustRated =
      ratingSession &&
      ratingSession.id === id &&
      Date.now() - ratingSession.timestamp < SESSION_TTL_MS;

    workFlowDetails.revalidate();
    const delay = isJustRated ? 3000 : 1500;
    const timer = setTimeout(() => {
      workFlowDetails.revalidate();
    }, delay);
    return () => clearTimeout(timer);
  }, []);

  return (
    !workFlowDetails.isLoading && (
      <TimeLine
        // isLoading={workFlowDetails.isLoading}
        data={workFlowDetails.data}
        serviceRequestId={id}
        complaintWorkflow={complaintDetails.workflow}
        rating={complaintDetails.audit.rating}
        complaintDetails={complaintDetails}
      // ComplainMaxIdleTime={ComplainMaxIdleTime}
      />
    )
  );
};

const ComplaintDetailsPage = (props) => {
  let { t } = useTranslation();
  let { id } = useParams();

  let tenantId = Digit.Utils.getMultiRootTenant()
    ? Digit.ULBService.getCurrentTenantId()
    : Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code || Digit.ULBService.getCurrentTenantId();
  const { isLoading, error, isError, complaintDetails, revalidate } = Digit.Hooks.pgr.useComplaintDetails({ tenantId, id });

  // CCSD-1766 Fix: Force fresh fetch of complaint data on mount so rating is not stale after submission.
  // Use a longer delay when navigating back from a fresh rating submission.
  useEffect(() => {
    const ratingSession = Digit.SessionStorage.get("PGR_LAST_RATING");
    const SESSION_TTL_MS = 2 * 60 * 1000;
    const isJustRated =
      ratingSession &&
      ratingSession.id === id &&
      Date.now() - ratingSession.timestamp < SESSION_TTL_MS;

    revalidate();
    const delay = isJustRated ? 3000 : 1500;
    const timer = setTimeout(() => {
      revalidate();
    }, delay);
    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return <Loader />;
  }

  if (isError) {
    return <h2>Error</h2>;
  }

  const geoLocation = complaintDetails?.service?.address?.geoLocation;
  const address = complaintDetails?.service?.address;
  // Construct a readable address for the map
  const displayAddress = [
    address?.buildingName,
    address?.street,
    address?.landmark,
    address?.locality?.name || address?.locality?.code,
    address?.pincode
  ].filter(Boolean).join(", ");


  return (
    <React.Fragment>
      <div className="complaint-summary">
        <Header>{t(`${LOCALIZATION_KEY.CS_HEADER}_COMPLAINT_SUMMARY`)}</Header>

        {complaintDetails && Object.keys(complaintDetails).length > 0 ? (
          <React.Fragment>
            <Card>
              <CardSubHeader style={{ marginBottom: "16px" }}>{t("CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS")}</CardSubHeader>
              <StatusTable>
                {Object.keys(complaintDetails.details)
                  .filter((key) => {
                    const additionalDetailRaw = complaintDetails?.service?.additionalDetail;
                    const additionalDetail = typeof additionalDetailRaw === "string" && additionalDetailRaw.startsWith("{") ? JSON.parse(additionalDetailRaw) : additionalDetailRaw;
                    const hierarchy = additionalDetail?.boundaryHierarchy;

                    const hasHierarchy = hierarchy && typeof hierarchy === "object" && !Array.isArray(hierarchy) && Object.keys(hierarchy).length > 0;
                    // Hide locality/area row if hierarchy is already showing it
                    if (hasHierarchy && (key === "CS_ADDCOMPLAINT_LOCALITY" || key === "CS_COMPLAINT_DETAILS_LOCALITY" || key === "CS_COMPLAINT_DETAILS_AREA")) {
                      return false;
                    }
                    return true;
                  })
                  .map((flag, index, arr) => (
                    <Row
                      key={index}
                      label={t(flag)}
                      text={
                        Array.isArray(complaintDetails.details[flag])
                          ? complaintDetails.details[flag].map((val) => (typeof val === "object" ? t(val?.code) : t(val)))
                          : t(complaintDetails.details[flag]) || "N/A"
                      }
                      last={index === arr.length - 1}
                    />
                  ))}
              </StatusTable>
              {(() => {
                const additionalDetailRaw = complaintDetails?.service?.additionalDetail;
                const additionalDetail = typeof additionalDetailRaw === "string" && additionalDetailRaw.startsWith("{") ? JSON.parse(additionalDetailRaw) : additionalDetailRaw;
                const hierarchy = additionalDetail?.boundaryHierarchy;

                if (!hierarchy) return null;
                // Object format: { Region: "CODE", Block: "CODE" }
                if (typeof hierarchy === "object" && !Array.isArray(hierarchy)) {
                  return (
                    <StatusTable>
                      {Object.entries(hierarchy).map(([level, code], idx, arr) => (
                        <Row
                          key={level}
                          label={t(`EGOV_LOCATION_BOUNDARYTYPE_${level.toUpperCase()}`)}
                          text={t(code)}
                          last={idx === arr.length - 1}
                        />
                      ))}
                    </StatusTable>
                  );
                }
                // Flat array fallback
                if (Array.isArray(hierarchy) && hierarchy.length > 0) {
                  return (
                    <StatusTable>
                      <Row
                        label={t("CS_COMPLAINT_DETAILS_BOUNDARY_HIERARCHY")}
                        text={hierarchy.map(code => t(code)).join(" > ")}
                        last={true}
                      />
                    </StatusTable>
                  );
                }
                return null;
              })()}
              {!!(
                complaintDetails?.service?.documents?.length ||
                complaintDetails?.workflow?.verificationDocuments?.length
              ) && (
                  <React.Fragment>
                    <CardSubHeader>{t("CS_COMMON_ATTACHMENTS")}</CardSubHeader>
                    <ComplaintPhotos serviceWrapper={complaintDetails} />
                  </React.Fragment>
                )}
            </Card>

            {!!(geoLocation?.latitude && geoLocation?.longitude) && (
              <Card>
                <CardSubHeader style={{ marginBottom: "16px" }}>{t("CS_COMPLAINT_LOCATION")}</CardSubHeader>
                <ComplaintLocationMap
                  latitude={geoLocation.latitude}
                  longitude={geoLocation.longitude}
                  address={displayAddress}
                />
              </Card>
            )}

            <Card>
              {complaintDetails?.service && (
                <WorkflowComponent complaintDetails={complaintDetails} id={id} />
              )}
            </Card>
          </React.Fragment>
        ) : (
          <Loader />
        )}
      </div>
    </React.Fragment>
  );
};

export default ComplaintDetailsPage;