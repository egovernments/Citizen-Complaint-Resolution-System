import React, { useState, useEffect } from "react";
import { complaintLabel } from "../../utils/complaintLabel";
import { useTranslation } from "react-i18next";
import { useHistory, useParams } from "react-router-dom/cjs/react-router-dom.min";
import { HeaderComponent, Button, Card, Footer, SummaryCard, Tag, Timeline, Toast, NoResultsFound } from "@egovernments/digit-ui-components";
import { ActionBar, Loader, DisplayPhotos, ImageViewer } from "@egovernments/digit-ui-react-components";
import { convertEpochFormateToDate } from "../../utils";
import TimelineWrapper from "../../components/TimeLineWrapper";
import PGRWorkflowModal from "../../components/PGRWorkflowModal";
import ComplaintLocationMap from "../../components/ComplaintLocationMap";
import Urls from "../../utils/urls";
import ComplaintPhotos from "../../components/ComplaintPhotos";
import { buildExtendedAttributeRows } from "../../components/PgrExtendedAttributesView";
import { buildComplaintPath } from "../../utils/complaintHierarchyPath";
import { selectServiceDefsFromComplaintHierarchy } from "../../utils";

// Action configurations used for handling different workflow actions like ASSIGN, REJECT, RESOLVE
// TO DO: Move this to MDMS for handling Action Modal properties
// Generic action-modal form builder — replaces the hardcoded ACTION_CONFIGS allowlist so the UI
// renders a sensible modal for ANY workflow action (standard PGR *and* the mz.igsae CMS workflow),
// with no per-action code. Field labels/headings are localization KEYS resolved by the modal.
//   • reason dropdown — reject-type actions (RejectionReasons MDMS)
//   • assignee picker — when the action forwards to a NON-terminal state that has assignable roles
//                       (mandatory for ASSIGN, optional otherwise)
//   • doc upload      — when the action's target state is flagged docUploadRequired on the
//                       BusinessService (verification documents plumbed into workflow.verificationDocuments)
//   • comments        — always
// Per-action extras can later be driven by an MDMS master (RAINMAKER-PGR.WorkflowActionUiConfig)
// without touching this code.
// additionalDetail arrives as an OBJECT on some complaints and a JSON STRING on
// others (citizen create sends "{}", employee create sends a stringified object).
// Parse both shapes; anything unparseable is treated as empty.
const parseAdditionalDetail = (ad) => {
  if (ad && typeof ad === "object") return ad;
  if (typeof ad === "string") {
    try { const o = JSON.parse(ad); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; }
  }
  return {};
};

const buildActionFormConfig = ({ action, assigneeRoles = [], isTerminal = false, docUploadRequired = false, assigneeMandatory }) => {
  const body = [];
  if (action === "REJECT") {
    body.push({
      isMandatory: false,
      key: "SelectedReason",
      type: "dropdown",
      label: "CS_REJECT_COMPLAINT",
      disable: false,
      populators: {
        name: "SelectedReason",
        optionsKey: "name",
        error: "Required",
        mdmsConfig: { masterName: "RejectionReasons", moduleName: "RAINMAKER-PGR", localePrefix: "CS_REJECTION_" },
      },
    });
  }
  if (!isTerminal && (assigneeRoles?.length || 0) > 0) {
    body.push({
      type: "component",
      // Callers pass assigneeMandatory (dept-mapping + actor aware); default
      // preserves the original rule: picking a person is required on ASSIGN.
      isMandatory: assigneeMandatory !== undefined ? assigneeMandatory : action === "ASSIGN",
      component: "PGRAssigneeComponent",
      key: "SelectedAssignee",
      label: "CS_COMMON_EMPLOYEE_NAME",
      populators: { name: "SelectedAssignee" },
    });
  }
  if (docUploadRequired) {
    body.push({
      type: "component",
      isMandatory: true,
      component: "PGRVerificationDocsComponent",
      key: "SelectedDocuments",
      label: "CS_UPLOAD_DOCUMENTS",
      populators: { name: "SelectedDocuments" },
    });
  }
  body.push({
    type: "textarea",
    isMandatory: true,
    key: "SelectedComments",
    label: "CS_COMMON_EMPLOYEE_COMMENTS",
    populators: { name: "SelectedComments", maxLength: 1000, validation: { required: true }, error: "CORE_COMMON_REQUIRED_ERRMSG" },
  });
  return {
    label: { heading: `CS_ACTION_${action}`, cancel: "CS_COMMON_CANCEL", submit: "CS_COMMON_SUBMIT" },
    form: [{ body }],
  };
};


const PGRDetails = () => {
  // Hooks for local state management
  const [openModal, setOpenModal] = useState(false);
  const { t } = useTranslation();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const history = useHistory();
  const { id } = useParams();
  const [selectedAction, setSelectedAction] = useState(null);
  const [toast, setToast] = useState({ show: false, label: "", type: "" });
  const userInfo = Digit.UserService.getUser();

  // Persist session data for complaint update
  const UpdateComplaintSession = Digit.Hooks.useSessionStorage("COMPLAINT_UPDATE", {});
  const [sessionFormData, setSessionFormData, clearSessionFormData] = UpdateComplaintSession;

  // Service definitions (leaf complaint types) adapted from the single
  // RAINMAKER-PGR.ComplaintHierarchy master — drives department + category
  // lookups below. Legacy ServiceDefs shape preserved (serviceCode/menuPath/
  // department) so getServiceCategoryByCode / getUpdatedConfig stay unchanged.
  const { isLoading: isMDMSLoading, data: serviceDefs } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ComplaintHierarchy" }],
    {
      cacheTime: Infinity,
      select: selectServiceDefsFromComplaintHierarchy,
    },
    { schemaCode: "PGR_COMPLAINT_HIERARCHY_DETAILS" }
  );

  // Complaint classification hierarchy (configurable N levels). Absent on
  // un-migrated tenants -> buildComplaintPath returns null and the flat
  // Type/Sub-Type rows are kept below. `nodes` is the full adjacency list
  // (interior + leaf) that buildComplaintPath walks via parentCode.
  const { data: hier } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ComplaintHierarchyDefinition" }, { name: "ComplaintHierarchy" }],
    {
      cacheTime: Infinity,
      select: (raw) => {
        const defs = (raw?.["RAINMAKER-PGR"]?.ComplaintHierarchyDefinition || []).filter((d) => d?.active !== false);
        const allRows = raw?.["RAINMAKER-PGR"]?.ComplaintHierarchy || [];
        const def = defs.find((d) => allRows.some((n) => n?.hierarchyType === d?.hierarchyType)) || defs[0] || null;
        const nodes = def ? allRows.filter((n) => n?.hierarchyType === def.hierarchyType) : [];
        return { def, nodes };
      },
    },
    { schemaCode: "PGR_COMPLAINT_HIERARCHY_DETAILS" }
  );

  // Key-based labels (COMPLAINT_HIERARCHY.<code>) like every other service,
  // with a node-name fallback so a not-yet-seeded key never shows raw. The leaf
  // def carries its parent group + own name; a complaint filed on an interior
  // node is resolved from the full adjacency list (nodes) via parentCode.
  function getServiceCategoryLabel(t, serviceCode, services, nodes) {
    if (!serviceCode) return null;
    const match = Array.isArray(services) ? services.find((item) => item.serviceCode === serviceCode) : null;
    if (match?.menuPath) return complaintLabel(t, match.menuPath, match.menuPathName); // leaf → parent group
    const byCode = new Map((nodes || []).map((n) => [n.code, n]));
    const self = byCode.get(serviceCode);
    if (self?.parentCode) return complaintLabel(t, self.parentCode, byCode.get(self.parentCode)?.name);
    return self ? complaintLabel(t, self.code, self.name) : null;
  }

  function getServiceLeafLabel(t, serviceCode, services, nodes) {
    if (!serviceCode) return null;
    const match = Array.isArray(services) ? services.find((item) => item.serviceCode === serviceCode) : null;
    if (match) return complaintLabel(t, match.serviceCode, match.name);
    const byCode = new Map((nodes || []).map((n) => [n.code, n]));
    const self = byCode.get(serviceCode);
    return self ? complaintLabel(t, self.code, self.name) : null;
  }

  // Fetch complaint details
  const { isLoading, isError, error, data: pgrData, revalidate: pgrSearchRevalidate } = Digit.Hooks.pgr.usePGRSearch({ serviceRequestId: id }, tenantId);

  // Use the complaint's tenantId for workflow queries (complaints live at city level,
  // but getCurrentTenantId() may return root tenant for root-level ADMIN users)
  const complaintTenantId = pgrData?.ServiceWrappers?.[0]?.service?.tenantId || tenantId;

  // Hook to update the complaint
  const { mutate: UpdateComplaintMutation } = Digit.Hooks.pgr.usePGRUpdate(complaintTenantId);

  // Fetch workflow details
  const { isLoading: isWorkflowLoading, data: workflowData, revalidate: workFlowRevalidate } = Digit.Hooks.useCustomAPIHook({
    url: "/egov-workflow-v2/egov-wf/process/_search",
    params: { tenantId: complaintTenantId, history: true, businessIds: id },
    config: { enabled: !!pgrData },
    changeQueryName: id,
  });

  // Fetch business service metadata
  const { isLoading: isBusinessServiceLoading, data: businessServiceData } = Digit.Hooks.useCustomAPIHook({
    url: Urls.workflow.businessServiceSearch,
    params: { tenantId: complaintTenantId, businessServices: "PGR" },
    config: { enabled: !!pgrData },
  });

  // Automatically dismiss toast messages after 3 seconds
  useEffect(() => {
    if (toast?.show) {
      setTimeout(() => {
        handleToastClose();
      }, 3000);
    }
  }, [toast?.show]);

  const handleToastClose = () => {
    setToast({ show: false, label: "", type: "" });
  };

  // Assignee requirement on ASSIGN:
  // - complaint type mapped to a department  -> mandatory (scoped routing; a person must be picked)
  // - unmapped type ("NA"/absent department) -> OPTIONAL — the complaint may move forward
  //   unassigned (pgr skips department validation and the workflow accepts empty assignes)
  // - EXCEPT a CMS_SCREENING_OFFICER (incl. multi-role users): routing IS their job,
  //   so the assignee stays mandatory for them even on unmapped types.
  const isAssigneeMandatory = (action) => {
    if (action?.action !== "ASSIGN") return false;
    const roles = userInfo?.info?.roles?.map((r) => r.code) || [];
    if (roles.includes("CMS_SCREENING_OFFICER")) return true;
    const def = serviceDefs?.find((d) => d.serviceCode === pgrData?.ServiceWrappers?.[0]?.service?.serviceCode);
    const department = def?.department;
    return !!department && department !== "NA";
  };

  // Prepare and submit the update complaint request
  const handleActionSubmit = (_data) => {
    // Build the same generic form config the modal renders, so mandatory-field validation stays in sync.
    const actionConfig = { formConfig: buildActionFormConfig({ ...selectedAction, assigneeMandatory: isAssigneeMandatory(selectedAction) }) };

    const missingFields = [];

    actionConfig.formConfig.form.forEach((section) => {
      section.body.forEach((field) => {
        if (field.isMandatory) {
          const fieldKey = field.key;
          const fieldValue = _data?.[fieldKey];

          // For dropdowns or components, also check if selected value is valid object or string
          const isEmpty =
            fieldValue === undefined ||
            fieldValue === null ||
            (typeof fieldValue === "string" && fieldValue.trim() === "") ||
            (typeof fieldValue === "object" && Object.keys(fieldValue).length === 0);

          if (isEmpty) {
            missingFields.push(t(field.label));
          }
        }
      });
    });

    if (missingFields.length > 0) {
      setToast({
        show: true,
        label: t("CS_COMMON_REQUIRED_FIELDS_MISSING") + ": " + missingFields.join(", "),
        type: "error",
      });
      return;
    }
    // Forward the rejection-reason picker into the workflow comment so
    // the audit log records *why* a complaint was rejected. The form
    // collects the reason in `_data.SelectedReason` (RejectionReasons
    // MDMS lookup) but it was never plumbed into the update payload —
    // operators only saw whatever free-text comment they typed.
    const reasonCode =
      _data?.SelectedReason?.code ||
      _data?.SelectedReason?.name ||
      _data?.SelectedReason ||
      "";
    const freeComment = _data?.SelectedComments || "";
    const isReject = selectedAction.action === "REJECT";
    const composedComment = isReject && reasonCode
      ? (freeComment ? `[${reasonCode}] ${freeComment}` : `[${reasonCode}]`)
      : freeComment;

    // Record the routed department: when the officer assigns to an employee,
    // stamp that employee's department onto additionalDetail so the complaint
    // reflects WHERE it was routed — instead of the stale type department / "NA"
    // carried over from filing time. Only applied when an assignee with a
    // department is picked (REJECT/RESOLVE etc. leave additionalDetail untouched).
    const baseService = pgrData?.ServiceWrappers[0].service;
    const assigneeDept = _data?.SelectedAssignee?.department;
    // Parse (object OR stringified) so stamping never discards existing keys
    // like supervisorName / serviceName that older flows stored as a string.
    const baseAdditionalDetail = parseAdditionalDetail(baseService?.additionalDetail);
    const updateRequest = {
      service: assigneeDept
        ? { ...baseService, additionalDetail: { ...baseAdditionalDetail, department: assigneeDept } }
        : { ...baseService },
      workflow: {
        action: selectedAction.action,
        assignes: _data?.SelectedAssignee?.uuid ? [_data?.SelectedAssignee?.uuid] : null,
        hrmsAssignes: _data?.SelectedAssignee?.uuid ? [_data?.SelectedAssignee?.uuid] : null,
        comments: composedComment,
        // Verification documents captured when the target state is docUploadRequired
        // (VerificationDocsComponent already shapes them as {documentType,fileStoreId,…}).
        ...(Array.isArray(_data?.SelectedDocuments) && _data.SelectedDocuments.length > 0
          ? { verificationDocuments: _data.SelectedDocuments }
          : {}),
      },
    };
    handleResponseForUpdateComplaint(updateRequest);
  };

  // Refresh the complaint and workflow data
  const refreshData = async () => {
    await pgrSearchRevalidate();
    await workFlowRevalidate();
  };

  // Handle response after updating complaint
  const handleResponseForUpdateComplaint = async (payload) => {
    setOpenModal(false);
    await UpdateComplaintMutation(payload, {
      onError: () => setToast({ show: true, label: t("FAILED_TO_UPDATE_COMPLAINT"), type: "error" }),
      onSuccess: async (responseData) => {
        const msg = payload.workflow.action || "RESOLVE";
        if (responseData?.ResponseInfo?.Errors) {
          setToast({ show: true, label: t("FAILED_TO_UPDATE_COMPLAINT"), type: "error" });
        } else {
          setToast({ show: true, label: t(`${msg}_SUCCESSFULLY`), type: "success" });
          await refreshData();
          clearSessionFormData();
        }
      },
    });
  };

  // Enhance config with roles and department dynamically
  const getUpdatedConfig = (selectedAction, workflowData, configs, serviceDefs, complaintData) => {
    const def = serviceDefs?.find((d) => d.serviceCode === complaintData?.ServiceWrappers[0]?.service?.serviceCode);
    // Assignee-scoping department, in precedence order:
    //   1. the complaint TYPE's mapped department (MDMS — authoritative, backend enforces it)
    //   2. the ROUTED department stamped on additionalDetail at the previous ASSIGN
    //      (screening picked the department; every later stage stays inside it)
    //   3. none -> the assignee list stays unscoped (all departments, grouped)
    const typeDept = def?.department;
    const routedDept = parseAdditionalDetail(complaintData?.ServiceWrappers?.[0]?.service?.additionalDetail)?.department;
    const department = typeDept && typeDept !== "NA" ? typeDept : routedDept || typeDept;
    // Build the modal form generically from workflow metadata — no hardcoded per-action allowlist,
    // so ANY action defined on the BusinessService (standard PGR + the CMS workflow) renders a form.
    const actionConfig = { formConfig: buildActionFormConfig({ ...selectedAction, assigneeMandatory: isAssigneeMandatory(selectedAction) }) };
    // The dropdown is the *assignee* picker, so we want the roles that can ACT on
    // the next state — not the roles that can perform the current action. The
    // latter (selectedAction.roles) was returning the GRO/PGR_VIEWER set, which
    // matches almost every employee in HRMS and produced a 37-row mega-dropdown.
    const roles = selectedAction?.assigneeRoles?.length ? selectedAction.assigneeRoles : (selectedAction?.roles || []);

    // A CMS_SCREENING_OFFICER screens the complaint and routes it to the CORRECT
    // department — at its discretion across the WHOLE tenant, not just the
    // departments this complaint type maps to. So its assignee picker shows
    // EVERY department's assignable employees (allDepartments), grouped by
    // department. Every other actor stays scoped to the complaint type's single
    // primary department. (Backend validateDepartment still scopes to the primary
    // until relaxed — cross-department assigns will be rejected at submit for now.)
    const userRoles = userInfo?.info?.roles?.map((r) => r.code) || [];
    const allDepartments = userRoles.includes("CMS_SCREENING_OFFICER");

    return {
      ...actionConfig.formConfig,
      form: actionConfig.formConfig.form.map((formItem) => ({
        ...formItem,
        body: formItem.body.map((bodyItem) => ({
          ...bodyItem,
          populators: {
            ...bodyItem.populators,
            roles,
            department,
            allDepartments,
            props: { ...bodyItem.populators.props, department, allDepartments },
          },
        })),
      })),
    };
  };

  // Roles that should never appear in an assignee dropdown even if a workflow
  // state lists them (system or non-employee actors).
  const NON_ASSIGNEE_ROLES = new Set(["CITIZEN", "AUTO_ESCALATE", "ANONYMOUS", "CMS_VIEWER"]);

  // Compute the assignee role set for an action by looking at the *forward*
  // (non-self-looping) actions defined on the next state and unioning their
  // roles. Self-loops like ESCALATE / SLA_ESCALATE / COMMENT add noise (e.g.
  // GRO showing up in a PENDINGATLME assignment dropdown), so we exclude them.
  // System roles (CITIZEN, AUTO_ESCALATE, ANONYMOUS) are filtered out too.
  const computeAssigneeRoles = (nextStateUuid, businessServiceResponse) => {
    const nextState = businessServiceResponse?.states?.find((s) => s.uuid === nextStateUuid);
    if (!nextState?.actions) return [];
    const forwardActions = nextState.actions.filter((act) => act.nextState && act.nextState !== nextStateUuid);
    const source = forwardActions.length > 0 ? forwardActions : nextState.actions; // fall back if no forward actions
    const set = new Set();
    source.forEach((act) => (act.roles || []).forEach((r) => set.add(r)));
    return [...set].filter((r) => !NON_ASSIGNEE_ROLES.has(r));
  };

  // Get list of valid actions for current user and state
  const getNextActionOptions = (workflowData, businessServiceResponse) => {
    const currentState = workflowData?.ProcessInstances?.[0]?.state;
    const matchingState = businessServiceResponse?.states?.find((state) => state.uuid === currentState?.uuid);
    if (!matchingState) return [];
    const userRoles = userInfo?.info?.roles?.map((role) => role.code) || [];
    return matchingState.actions
      ? matchingState.actions.filter((action) => action.roles.some((role) => userRoles.includes(role)))
        .map((action) => {
          // Look up the target state so the modal can adapt generically (terminal → no assignee,
          // docUploadRequired → future doc capture) with no per-action code.
          const nextStateData = businessServiceResponse?.states?.find((s) => s.uuid === action.nextState);
          return {
            action: action.action,
            // Raw workflow action code, shown as-is — the WF_PGR_* keys hold past-tense
            // timeline labels ("Rejected"), which read as states in an action menu.
            name: action.action,
            roles: action.roles,
            nextState: action.nextState,
            assigneeRoles: computeAssigneeRoles(action.nextState, businessServiceResponse),
            isTerminal: !!nextStateData?.isTerminateState,
            docUploadRequired: !!nextStateData?.docUploadRequired,
            uuid: action.uuid,
          };
        })
      : [];
  };

  // Show the action toolbar if the user holds *any* role declared on
  // the current state's actions. The previous gate required both
  // PGR_VIEWER *and* another matching role, which silently hid every
  // action from real LME / GRO field users on naipepea (most of whom
  // are seeded with PGR_LME or GRO but no PGR_VIEWER). PGR_VIEWER is
  // a viewer credential, not a prerequisite to act.
  const shouldShowActionButton = () => {
    const userRoles = userInfo?.info?.roles?.map((role) => role.code) || [];
    const currentState = workflowData?.ProcessInstances?.[0]?.state;
    if (!currentState?.actions) return false;
    const allActionRoles = new Set();
    currentState.actions.forEach((action) => (action.roles || []).forEach((r) => allActionRoles.add(r)));
    return userRoles.some((r) => allActionRoles.has(r));
  };

  // Display loader until required data loads
  if (isLoading || isMDMSLoading || isWorkflowLoading) return <Loader />;

  // Full hierarchy breakdown for the selected complaint type (null => flat).
  const complaintServiceCode = pgrData?.ServiceWrappers?.[0]?.service?.serviceCode;
  const complaintClassification = buildComplaintPath({
    serviceCode: complaintServiceCode,
    def: hier?.def,
    nodes: hier?.nodes,
    t,
  });

  return (
    <div className="v2-pgr-details v2-scope">
      {/* Header */}
      <header className="v2-employee-page-header">
        <h1>{t("CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS")}</h1>
      </header>

      {/* Complaint Summary Card */}
      <div>
        {pgrData?.ServiceWrappers?.length > 0 ? (
          <SummaryCard
            asSeperateCards
            header="Heading"
            layout={1}
            sections={[
              {
                cardType: "primary",
                fieldPairs: [
                  {
                    inline: true,
                    label: t("CS_COMPLAINT_DETAILS_COMPLAINT_NO"),
                    type: "text",
                    value: pgrData?.ServiceWrappers[0].service?.serviceRequestId || "NA",
                  },
                  // Hierarchy tenants: one row per level (Main Category › Sector ›
                  // Sub-Type …). Flat tenants: the legacy Type + Sub-Type pair.
                  ...(complaintClassification
                    ? complaintClassification.map((r) => ({
                        inline: true,
                        label: r.label,
                        type: "text",
                        value: r.value || "NA",
                      }))
                    : [
                        {
                          inline: true,
                          label: t("CS_COMPLAINT_DETAILS_COMPLAINT_TYPE"),
                          type: "text",
                          value: getServiceCategoryLabel(t, pgrData?.ServiceWrappers[0].service?.serviceCode, serviceDefs, hier?.nodes) || t("NA"),
                        },
                        {
                          inline: true,
                          label: t("CS_COMPLAINT_DETAILS_COMPLAINT_SUBTYPE"),
                          type: "text",
                          value: getServiceLeafLabel(t, pgrData?.ServiceWrappers[0].service?.serviceCode, serviceDefs, hier?.nodes) || t("NA"),
                        },
                      ]),
                  {
                    inline: true,
                    label: t("CS_COMPLAINT_FILED_DATE"),
                    value: convertEpochFormateToDate(pgrData?.ServiceWrappers[0].service?.auditDetails?.createdTime) || t("NA"),
                  },
                  {
                    inline: true,
                    label: t("CS_COMPLAINT_DETAILS_AREA"),
                    value: t(pgrData?.ServiceWrappers[0].service?.address?.locality?.code || "NA"),
                  },
                  {
                    inline: true,
                    label: t("CS_COMPLAINT_DETAILS_CURRENT_STATUS"),
                    value: t(`CS_COMMON_PGR_STATE_${pgrData?.ServiceWrappers[0].service?.applicationStatus || "NA"}`),
                  },
                  {
                    inline: true,
                    label: t("CS_COMPLAINT_LANDMARK__DETAILS"),
                    value: pgrData?.ServiceWrappers[0].service?.address?.landmark || "NA",
                  },
                  {
                    inline: true,
                    label: t("CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS_DESCRIPTION"),
                    value: pgrData?.ServiceWrappers[0].service?.description || "NA",
                  },
                ],
              },
              // Read-only "Additional Details" — fetch service.extendedAttributes
              // and show it as label:value rows; backend returns masked ("****")
              // values. Renders nothing when there are no extended attributes.
              ...(buildExtendedAttributeRows(pgrData?.ServiceWrappers?.[0]?.service?.extendedAttributes).length > 0
                ? [{
                  cardType: "primary",
                  header: t("CS_COMPLAINT_DETAILS_ADDITIONAL_DETAILS"),
                  fieldPairs: buildExtendedAttributeRows(pgrData?.ServiceWrappers?.[0]?.service?.extendedAttributes).map((r) => ({
                    inline: true,
                    label: r.label,
                    type: "text",
                    value: r.value,
                  })),
                }]
                : []
              ),
              ...(pgrData?.ServiceWrappers[0]?.workflow?.verificationDocuments?.length > 0
                ? [{
                  cardType: "primary",
                  fieldPairs: [
                    {
                      inline: false,
                      type: "custom",
                      renderCustomContent: () => (
                        <ComplaintPhotos t={t} serviceWrapper={pgrData?.ServiceWrappers[0]} />
                      ),
                    },
                  ],
                  header: t("CS_COMMON_ATTACHMENTS"),
                }]
                : []
              ),
              // Conditionally include location section only if coordinates exist
              ...(pgrData?.ServiceWrappers[0]?.service?.address?.geoLocation?.latitude &&
                pgrData?.ServiceWrappers[0]?.service?.address?.geoLocation?.longitude
                ? [{
                  cardType: "primary",
                  fieldPairs: [
                    {
                      inline: false,
                      type: "custom",
                      renderCustomContent: () => {
                        const geoLocation = pgrData?.ServiceWrappers[0]?.service?.address?.geoLocation;
                        const address = pgrData?.ServiceWrappers[0]?.service?.address;

                        // Construct a readable address from API data
                        const addressParts = [
                          address?.buildingName,
                          address?.street,
                          address?.landmark,
                          address?.locality?.name || address?.locality?.code,
                          address?.pincode
                        ].filter(Boolean);

                        const addressString = addressParts.length > 0 ? addressParts.join(", ") : null;

                        return (
                          <ComplaintLocationMap
                            latitude={geoLocation.latitude}
                            longitude={geoLocation.longitude}
                            address={addressString}
                          />
                        );
                      },
                    },
                  ],
                  header: t("CS_COMPLAINT_LOCATION"),
                }]
                : []
              ),
              {
                cardType: "primary",
                fieldPairs: [
                  {
                    inline: false,
                    type: "custom",
                    renderCustomContent: () => (
                      <TimelineWrapper isWorkFlowLoading={isWorkflowLoading} workflowData={workflowData} businessId={id} labelPrefix="WF_PGR_" />
                    ),
                  },
                ],
                header: t("CS_COMPLAINT_DETAILS_COMPLAINT_TIMELINE"),
              },
            ]}
            type="primary"
          />
        ) : (
          <NoResultsFound />
        )}
      </div>

      {/* Footer Action Bar */}
      {shouldShowActionButton() && (
        <Footer
          actionFields={[
            <Button
              className="custom-class"
              isSearchable
              onClick={function noRefCheck() { }}
              menuStyles={{
                bottom: "40px",
              }}
              isDisabled={getNextActionOptions(workflowData, businessServiceData?.BusinessServices?.[0]).length === 0}
              key="action-button"
              label={t("ES_COMMON_TAKE_ACTION")}
              onOptionSelect={(selected) => {
                setSelectedAction(selected);
                setOpenModal(true);
              }}
              options={getNextActionOptions(workflowData, businessServiceData?.BusinessServices?.[0])}
              optionsKey="name"
              type="actionButton"
            />,
          ]}
          className=""
          maxActionFieldsAllowed={5}
          setactionFieldsToRight
          sortActionFields
          style={{}}
        />
      )}

      {/* Toast Message */}
      {toast?.show && <Toast type={toast?.type} label={toast?.label} isDleteBtn onClose={handleToastClose} />}

      {/* Workflow Modal for Actions */}
      {openModal && selectedAction && (
        <PGRWorkflowModal
          selectedAction={selectedAction}
          sessionFormData={sessionFormData}
          setSessionFormData={setSessionFormData}
          clearSessionFormData={clearSessionFormData}
          config={getUpdatedConfig(selectedAction, workflowData, null, serviceDefs, pgrData)}
          closeModal={() => setOpenModal(false)}
          onSubmit={handleActionSubmit}
        />
      )}
    </div>
  );
};

export default PGRDetails;