import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import { useQueryClient } from "react-query";
import { useParams, useHistory, Redirect } from "react-router-dom";

import { BackButton, Card, CardHeader, CardText, CardLabelError, TextArea, SubmitBar } from "@egovernments/digit-ui-react-components";

import { updateComplaints } from "../../../redux/actions/index";
import { LOCALIZATION_KEY } from "../../../constants/Localization";
import { mergeAdditionalDetail } from "../../../utils/additionalDetail";
import { findLatestAssigneeUuidByRole } from "../../../utils/workflowAssignee";

const AddtionalDetails = (props) => {
  const history = useHistory();
  let { id } = useParams();
  const dispatch = useDispatch();
  const appState = useSelector((state) => state)["common"];
  let { t } = useTranslation();

  const { complaintDetails } = props;
  const queryClient = useQueryClient();

  // CCSD-2082 Issue 3: reason details are now MANDATORY (reverses CCSD-1955,
  // which had made them optional). Track the value locally so we can block the
  // reopen and surface an error until the citizen provides an explanation.
  const [details, setDetails] = useState(() => Digit.SessionStorage.get(`reopen.${id}`)?.addtionalDetail || "");
  const [error, setError] = useState(false);

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
      // CCSD-2119: the reopen goes through the redux updateComplaints path, which
      // does NOT touch react-query. The citizen status pill (useComplaintDetails
      // -> ["complaintDetails", tenantId, id]) and My Complaints list
      // (useComplaintsListByMobile -> ["complaintsList", …]) therefore kept
      // serving the pre-reopen status until a manual browser refresh. Invalidate
      // both so they refetch — active views update live, others on next mount.
      queryClient.invalidateQueries(["complaintDetails"]);
      queryClient.invalidateQueries(["complaintsList"]);
      history.push(`${props.match.path}/response/${id}`);
    },
    [dispatch, queryClient]
  );

  // CCSD-2167: reopen routes the complaint back to the SUPERVISOR who handled
  // it. `assignes` defaults to [] so a complaint with no supervisor in its
  // history (e.g. rejected at the screening stage, or the standard non-CMS
  // workflow) keeps the pre-2167 behaviour. hrmsAssignes mirrors assignes,
  // matching the employee ASSIGN payload (PGRDetails.js).
  const getUpdatedWorkflow = (reopenDetails, type, assignes = []) => {
    switch (type) {
      case "REOPEN":
        return {
          action: "REOPEN",
          comments: reopenDetails.addtionalDetail,
          assignes,
          hrmsAssignes: assignes,
          verificationDocuments: reopenDetails.verificationDocuments,
        };
      default:
        return "";
    }
  };

  async function reopenComplaint() {
    // CCSD-2082 Issue 3: require a non-empty explanation before reopening.
    if (!details || !details.trim()) {
      setError(true);
      return;
    }
    let reopenDetails = Digit.SessionStorage.get(`reopen.${id}`);
    if (complaintDetails) {
      // CCSD-2167: find the Supervisor from the complaint's workflow history.
      // Complaint's tenant, not the state root — see SelectRating.js note.
      const wfTenant = complaintDetails?.service?.tenantId || Digit.ULBService.getStateId();
      const businessId = complaintDetails?.service?.serviceRequestId || id;
      const supervisorUuid = await findLatestAssigneeUuidByRole(wfTenant, businessId, "CMS_SUPERVISOR");
      const assignes = supervisorUuid ? [supervisorUuid] : [];
      complaintDetails.workflow = getUpdatedWorkflow(
        reopenDetails,
        // complaintDetails,
        "REOPEN",
        assignes
      );
      // `department` is linked at ASSIGN time: the employee action modal stamps
      // the picked assignee's HRMS department onto additionalDetail.department
      // (PGRDetails.js); complaints are born "NA" since the hierarchy master is
      // deliberately unmapped. Every update round-trips the WHOLE service
      // object from the client and the backend trusts it — a payload whose
      // department is missing/"NA" gets re-derived from that unmapped
      // hierarchy ("NA" again), overwriting the stamp. The hook's copy here
      // can be up to 15 minutes stale (global react-query staleTime, no
      // override), so a pre-ASSIGN copy would do exactly that, and
      // department-scoped roles then lose the complaint. Merge into the
      // CURRENT stored object instead; on fetch failure fall back to the
      // cached copy — no worse than before.
      //
      // Deliberately reopen-only (product call, full workflow sweep 2026-08-31):
      // the RATE flow has the same stale-cache exposure but only reaches the
      // terminal CLOSEDAFTER* states, which have no REOPEN — a wiped
      // department there affects closed-record reporting only, not routing,
      // and is accepted.
      try {
        const fresh = await Digit.PGRService.search(wfTenant, { serviceRequestId: businessId });
        const freshService = fresh?.ServiceWrappers?.[0]?.service;
        if (freshService) complaintDetails.service = freshService;
      } catch (e) {
        /* network hiccup — proceed with the cached copy */
      }
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
    const value = e.target.value;
    setDetails(value);
    if (error && value && value.trim()) setError(false);
    let reopenDetails = Digit.SessionStorage.get(`reopen.${id}`);
    Digit.SessionStorage.set(`reopen.${id}`, {
      ...reopenDetails,
      addtionalDetail: value,
    });
  }

  // CCSD-2082 Issue 3: mandatory label. Falls back to the required PT copy when
  // the localisation key is not yet present, so it reads correctly pre-seed.
  const detailsLabel =
    t("CS_REOPEN_DETAILS_LABEL") === "CS_REOPEN_DETAILS_LABEL"
      ? "Forneça os detalhes do motivo da re-abertura da reclamação"
      : t("CS_REOPEN_DETAILS_LABEL");

  return (
    <React.Fragment>
      <Card>
        <CardHeader>
          {detailsLabel} <span style={{ color: "#d4351c" }}>*</span>
        </CardHeader>
        <CardText>{t(`${LOCALIZATION_KEY.CS_ADDCOMPLAINT}_ADDITIONAL_DETAILS_TEXT`)}</CardText>
        <TextArea name={"AdditionalDetails"} value={details} onChange={textInput}></TextArea>
        {error ? <CardLabelError>{t(`${LOCALIZATION_KEY.CS_ADDCOMPLAINT}_ERROR_REOPEN_DETAILS`)}</CardLabelError> : null}
        <div onClick={reopenComplaint}>
          <SubmitBar label={t(`${LOCALIZATION_KEY.CS_HEADER}_REOPEN_COMPLAINT`)} />
        </div>
      </Card>
    </React.Fragment>
  );
};

export default AddtionalDetails;
