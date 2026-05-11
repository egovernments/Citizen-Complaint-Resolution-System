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

  // Always re-fetch on mount and block render for a minimum window so the fresh
  // API response can land before we paint. Without this gate, a warm cache
  // would render stale data instantly and only flip to fresh data after the
  // background revalidate returned — causing a visible flash where stars were
  // missing right after a RATE submission.
  const FRESH_WAIT_MS = 700;
  const [hasFreshWorkflow, setHasFreshWorkflow] = useState(false);
  useEffect(() => {
    setHasFreshWorkflow(false);
    workFlowDetails.revalidate();
    const t = setTimeout(() => setHasFreshWorkflow(true), FRESH_WAIT_MS);
    return () => clearTimeout(t);
  }, [id]);

  if (workFlowDetails.isLoading || !hasFreshWorkflow) return <Loader />;

  return (
    <TimeLine
      data={workFlowDetails.data}
      serviceRequestId={id}
      complaintWorkflow={complaintDetails.workflow}
      rating={complaintDetails?.audit?.rating}
      complaintDetails={complaintDetails}
    />
  );
};

const ComplaintDetailsPage = (props) => {
  let { t } = useTranslation();
  let { id } = useParams();

  let tenantId = Digit.Utils.getMultiRootTenant()
    ? Digit.ULBService.getCurrentTenantId()
    : Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code || Digit.ULBService.getCurrentTenantId();
  const { isLoading, error, isError, complaintDetails, revalidate } = Digit.Hooks.pgr.useComplaintDetails({ tenantId, id });

  // Always re-fetch on mount and block render for a fixed minimum window so
  // the fresh API response can land before we paint. Cached data is ignored —
  // any update (e.g. RATE) is reflected on first paint instead of a flash of
  // stale data followed by an in-place re-render.
  const FRESH_WAIT_MS = 700;
  const [hasFreshDetails, setHasFreshDetails] = useState(false);
  useEffect(() => {
    setHasFreshDetails(false);
    revalidate();
    const t = setTimeout(() => setHasFreshDetails(true), FRESH_WAIT_MS);
    return () => clearTimeout(t);
  }, [id]);

  if (isLoading || !hasFreshDetails) {
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
              <CardSubHeader style={{ marginBottom: "16px", fontSize: "24px", fontWeight: 700, lineHeight: "28px", color: "#0b0c0c" }}>{t("CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS")}</CardSubHeader>
              <StatusTable>
                {Object.keys(complaintDetails.details)
                  .filter((key) => {
                    const _rawHierarchy1 = complaintDetails?.service?.additionalDetail?.boundaryHierarchy;
                    const hierarchy = (() => { try { return typeof _rawHierarchy1 === "string" ? JSON.parse(_rawHierarchy1) : _rawHierarchy1; } catch (e) { return _rawHierarchy1; } })();

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
                const _rawHierarchy2 = complaintDetails?.service?.additionalDetail?.boundaryHierarchy;
                const hierarchy = (() => { try { return typeof _rawHierarchy2 === "string" ? JSON.parse(_rawHierarchy2) : _rawHierarchy2; } catch (e) { return _rawHierarchy2; } })();

                if (!hierarchy) return null;
                // Object format: { Region: "CODE", Block: "CODE" }
                if (typeof hierarchy === "object" && !Array.isArray(hierarchy)) {
                  const labelForLevel = (level) => {
                    const key = `EGOV_LOCATION_BOUNDARYTYPE_${level.toUpperCase()}`;
                    const translated = t(key);
                    // Fall back to a humanised level name when the key is missing,
                    // so the row label stays short enough to align with the value column.
                    return translated === key ? level.charAt(0).toUpperCase() + level.slice(1).toLowerCase() : translated;
                  };
                  return (
                    <StatusTable>
                      {Object.entries(hierarchy).map(([level, code], idx, arr) => (
                        <Row
                          key={level}
                          label={labelForLevel(level)}
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
                    <CardSubHeader style={{ fontSize: "24px", fontWeight: 700, lineHeight: "28px", color: "#0b0c0c" }}>{t("CS_COMMON_ATTACHMENTS")}</CardSubHeader>
                    <ComplaintPhotos serviceWrapper={complaintDetails} />
                  </React.Fragment>
                )}
            </Card>

            {!!(geoLocation?.latitude && geoLocation?.longitude) && (
              <Card>
                <CardSubHeader style={{ marginBottom: "16px", fontSize: "24px", fontWeight: 700, lineHeight: "28px", color: "#0b0c0c" }}>{t("CS_COMPLAINT_LOCATION")}</CardSubHeader>
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