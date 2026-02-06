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
  const tenantId = Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code || complaintDetails.service.tenantId;
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

  console.log(`*** LOG ***`, cct);

  useEffect(() => {
    workFlowDetails.revalidate();
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

  let tenantId = Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code || Digit.ULBService.getCurrentTenantId(); // ToDo: fetch from state
  const { isLoading, error, isError, complaintDetails, revalidate } = Digit.Hooks.pgr.useComplaintDetails({ tenantId, id });

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
                {Object.keys(complaintDetails.details).map((flag, index, arr) => (
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
              {complaintDetails?.workflow?.verificationDocuments?.length > 0 && (
                <React.Fragment>
                  <CardSubHeader>{t("CS_COMMON_ATTACHMENTS")}</CardSubHeader>
                  <ComplaintPhotos serviceWrapper={complaintDetails} />
                </React.Fragment>
              )}
            </Card>

            {geoLocation?.latitude && geoLocation?.longitude && (
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