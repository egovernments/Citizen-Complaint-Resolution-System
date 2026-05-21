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

  let tenantId = Digit.Utils.getMultiRootTenant()? Digit.ULBService.getStateId() : Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code || Digit.ULBService.getCurrentTenantId();
  const complaintDetails = Digit.Hooks.pgr.useComplaintDetails({ tenantId: tenantId, id: id }).complaintDetails;
  const updateComplaint = useCallback((complaintDetails) => dispatch(updateComplaints(complaintDetails)), [dispatch]);
  const [submitError, setError] = useState(false)
  
  function log(data) {
    if (complaintDetails?.service && data.rating > 0) {
      // `CS_FEEDBACK_WHAT_WAS_GOOD` is only present when the citizen
      // ticked at least one positive-feedback checkbox. Calling `.join`
      // on undefined used to throw and crash the UI via the error
      // boundary, leaving the citizen on a blank page
      // (closes egovernments/CCRS#441).
      const feedbackSelections = Array.isArray(data.CS_FEEDBACK_WHAT_WAS_GOOD)
        ? data.CS_FEEDBACK_WHAT_WAS_GOOD
        : [];
      complaintDetails.service.rating = data.rating;
      complaintDetails.service.additionalDetail = feedbackSelections.join(",");
      complaintDetails.workflow = {
        action: "RATE",
        comments: data.comments,
        verificationDocuments: [],
      };
      updateComplaint({ service: complaintDetails.service, workflow: complaintDetails.workflow });
      history.push(`${parentRoute}/response`);
    }
    else{
      setError(true)
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
