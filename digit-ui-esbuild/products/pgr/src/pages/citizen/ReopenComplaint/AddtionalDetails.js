import React, { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import { useParams, useHistory, Redirect } from "react-router-dom";

import { BackButton, Card, CardHeader, CardText, TextArea, SubmitBar } from "@egovernments/digit-ui-react-components";

import { updateComplaints } from "../../../redux/actions/index";
import { LOCALIZATION_KEY } from "../../../constants/Localization";
import { mergeAdditionalDetail } from "../../../utils/additionalDetail";

const AddtionalDetails = (props) => {
  // const [details, setDetails] = useState(null);
  const history = useHistory();
  let { id } = useParams();
  const dispatch = useDispatch();
  const appState = useSelector((state) => state)["common"];
  let { t } = useTranslation();
  
  const {complaintDetails} = props
  useEffect(() => {
    if (appState.complaints) {
      const { response } = appState.complaints;
      if (response && response.responseInfo.status === "successful") {
        history.push(`${props.match.path}/response/:${id}`);
      }
    }
  }, [appState.complaints, props.history]);

  const updateComplaint = useCallback(
    async (complaintDetails) => {
      await dispatch(updateComplaints(complaintDetails));
      history.push(`${props.match.path}/response/${id}`);
    },
    [dispatch]
  );

  const getUpdatedWorkflow = (reopenDetails, type) => {
    switch (type) {
      case "REOPEN":
        return {
          action: "REOPEN",
          comments: reopenDetails.addtionalDetail,
          assignes: [],
          verificationDocuments: reopenDetails.verificationDocuments,
        };
      default:
        return "";
    }
  };

  function reopenComplaint() {
    let reopenDetails = Digit.SessionStorage.get(`reopen.${id}`);
    if (complaintDetails) {
      complaintDetails.workflow = getUpdatedWorkflow(
        reopenDetails,
        // complaintDetails,
        "REOPEN"
      );
      // CCSD-2012: MERGE the reopen reason into additionalDetail instead of
      // replacing the object. Replacing dropped the `department` stamped at
      // create/ASSIGN, so the backend re-derived it from the serviceCode —
      // "NA" for unmapped codes — and department-scoped supervisors could no
      // longer see the reopened complaint (inbox empty + details "No Results
      // Found" while the workflow's Take Action still rendered).
      // resetEscalation: a reopen starts a fresh lifecycle — carrying the
      // escalation bookkeeping over would freeze auto-escalation at the old
      // level (the pre-fix replace reset it by accident; we do it on purpose).
      complaintDetails.service.additionalDetail = mergeAdditionalDetail(
        complaintDetails.service.additionalDetail,
        { REOPEN_REASON: reopenDetails.reason },
        { resetEscalation: true }
      );
      updateComplaint({ service: complaintDetails.service, workflow: complaintDetails.workflow });
    }
    return (
      <Redirect
        to={{
          pathname: `${props.parentRoute}/response`,
          state: { complaintDetails },
        }}
      />
    );
  }

  function textInput(e) {
    // setDetails(e.target.value);
    let reopenDetails = Digit.SessionStorage.get(`reopen.${id}`);
    Digit.SessionStorage.set(`reopen.${id}`, {
      ...reopenDetails,
      addtionalDetail: e.target.value,
    });
  }

  return (
    <React.Fragment>
      <Card>
        <CardHeader>
          {t(`${LOCALIZATION_KEY.CS_ADDCOMPLAINT}_PROVIDE_ADDITIONAL_DETAILS`) +
            // Free-text details are not required to reopen (CCSD-1955)
            " " + (t("CS_OPTIONAL_SUFFIX") === "CS_OPTIONAL_SUFFIX" ? "(Optional)" : t("CS_OPTIONAL_SUFFIX"))}
        </CardHeader>
        <CardText>{t(`${LOCALIZATION_KEY.CS_ADDCOMPLAINT}_ADDITIONAL_DETAILS_TEXT`)}</CardText>
        <TextArea name={"AdditionalDetails"} onChange={textInput}></TextArea>
        <div onClick={reopenComplaint}>
          <SubmitBar label={t(`${LOCALIZATION_KEY.CS_HEADER}_REOPEN_COMPLAINT`)} />
        </div>
      </Card>
    </React.Fragment>
  );
};

export default AddtionalDetails;
