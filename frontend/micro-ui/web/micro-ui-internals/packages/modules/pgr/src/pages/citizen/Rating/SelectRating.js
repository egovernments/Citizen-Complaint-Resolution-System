import React, { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import { RatingCard, CardLabelError } from "@egovernments/digit-ui-react-components";
import { useParams, Redirect, useHistory } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { updateComplaints } from "../../../redux/actions/index";

const SelectRating = ({ parentRoute }) => {
  const { t } = useTranslation();
  const { id } = useParams();
  const dispatch = useDispatch();
  const history = useHistory();

  let tenantId = Digit.Utils.getMultiRootTenant()
    ? Digit.ULBService.getCurrentTenantId()
    : Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code || Digit.ULBService.getCurrentTenantId();
  const { complaintDetails, revalidate: revalidateComplaint } = Digit.Hooks.pgr.useComplaintDetails({ tenantId: tenantId, id: id });
  const updateComplaint = useCallback((complaintDetails) => dispatch(updateComplaints(complaintDetails)), [dispatch]);
  const [submitError, setError] = useState(false);

  async function log(data) {
    if (complaintDetails && data.rating > 0) {
      complaintDetails.service.rating = data.rating;
      complaintDetails.service.additionalDetail = data.CS_FEEDBACK_WHAT_WAS_GOOD.join(",");
      complaintDetails.workflow = {
        action: "RATE",
        comments: data.comments,
        verificationDocuments: [],
      };
      await updateComplaint({ service: complaintDetails.service, workflow: complaintDetails.workflow });

      // Immediately trigger the complaint-details API to invalidate SWR cache.
      // This ensures ComplaintDetails & timeline show updated rating without manual refresh.
      revalidateComplaint();

      // Store rating result in session storage as a reliable fallback for the Response page.
      // This prevents a blank banner if the Redux state hasn't fully settled on navigation.
      Digit.SessionStorage.set("PGR_LAST_RATING", {
        id,
        action: "RATE",
        serviceRequestId: complaintDetails.service.serviceRequestId,
        timestamp: Date.now(),
      });

      history.push(`${parentRoute}/response`);
    } else {
      setError(true);
    }
  }

  const config = {
    texts: {
      header: "CS_COMPLAINT_RATE_HELP_TEXT",
      submitBarLabel: "CS_COMMONS_NEXT",
    },
    inputs: [
      {
        type: "rate",
        maxRating: 5,
        label: t("CS_COMPLAINT_RATE_TEXT"),
        error: submitError ? <CardLabelError>{t("CS_FEEDBACK_ENTER_RATING_ERROR")}</CardLabelError> : null
      },
      {
        type: "checkbox",
        label: "CS_FEEDBACK_WHAT_WAS_GOOD",
        checkLabels: [t("CS_FEEDBACK_SERVICES"), t("CS_FEEDBACK_RESOLUTION_TIME"), t("CS_FEEDBACK_QUALITY_OF_WORK"), t("CS_FEEDBACK_OTHERS")],
      },
      {
        type: "textarea",
        label: t("CS_COMMON_COMMENTS"),
        name: "comments",
      },
    ],
  };
  return <RatingCard {...{ config: config }} t={t} onSelect={log} />;
};
export default SelectRating;
