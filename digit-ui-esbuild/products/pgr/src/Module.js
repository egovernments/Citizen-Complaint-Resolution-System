import { Loader } from "@egovernments/digit-ui-react-components";
import React, { useState } from "react";
import { useRouteMatch } from "react-router-dom";
import { default as EmployeeApp } from "./pages/employee";
import PGRCard from "./components/PGRCard";
import { overrideHooks, updateCustomConfigs } from "./utils";
import { ProviderContext } from "./utils/context";
import BoundaryComponent from "./components/BoundaryComponent";
import ComplaintHierarchyComponent from "./components/ComplaintHierarchyComponent";
import PGRDatePicker from "./components/PGRDatePicker";
import PGRDetails from "./pages/employee/PGRDetails";
import TimelineWrapper from "./components/TimeLineWrapper";
import AssigneeComponent from "./components/AssigneeComponent";
import VerificationDocsComponent from "./components/VerificationDocsComponent";
import ActionUploadComponent from "./components/ActionUploadComponent";
import PGRSearchInbox from "./pages/employee/PGRInbox";
import CreateComplaint from "./pages/employee/CreateComplaint";
import Response from "./components/Response";
import BreadCrumbs from "./components/BreadCrumbs";
import CitizenApp from "./pages/citizen";
import getRootReducer from "./redux/reducers";
import { ComplaintsList } from "./pages/citizen/ComplaintsList";
import ComplaintDetailsPage from "./pages/citizen/ComplaintDetails";
import SelectRating from "./pages/citizen/Rating/SelectRating";
import ResponseCitizen from "./pages/citizen/Response";
import GeoLocations from "./components/GeoLocations";
import SelectAddress from "../../pgr/src/pages/citizen/Create/Steps/SelectAddress";
import SelectImages from "../../pgr/src/pages/citizen/Create/Steps/SelectImages";
// CreatePGRFlow now points at the v2 (Tailwind + shadcn-style) implementation.
// FormExplorer.js remains in the tree for one release as a safety rollback —
// can be deleted once v2 is verified on naipepea.
import CreatePGRFlow from "./pages/citizen/Create/CreatePGRFlowV2";


export const PGRReducers = getRootReducer;


export const PGRModule = ({ stateCode, userType, tenants }) => {
  const { path, url } = useRouteMatch();
  const tenantId = Digit.ULBService.getCurrentTenantId();

  const hierarchyType = window?.globalConfigs?.getConfig("HIERARCHY_TYPE") || "ADMIN";
  const moduleCode = ["pgr", `boundary-${hierarchyType?.toString().toLowerCase()}`];
  const modulePrefix = "rainmaker";
  const language = Digit.StoreData.getCurrentLanguage();
  const { isLoading, data: store } = Digit.Services.useStore({
    stateCode,
    moduleCode,
    language,
    modulePrefix,
  });
  let user = Digit?.SessionStorage.get("User");

  // NOTE: the former usePGRInitialization mount-time boundary prefetch is gone.
  // It fired before the citizen picked an authority (wrong tenant on
  // multi-authority envs → 400 → react-query retry spam) and its failure left
  // boundaryHierarchyOrder unset, blanking the cascade. fetchBoundaries now
  // derives and stores boundaryHierarchyOrder from the SAME response the
  // cascade renders — one call, right tenant, fired only when needed.

  Digit.SessionStorage.set("PGR_TENANTS", tenants);

  if (isLoading) {
    return <Loader />;
  }

  if (userType === "citizen") {
    return <CitizenApp />;
  } else {
    return (
      <ProviderContext>
        <EmployeeApp path={path} stateCode={stateCode} userType={userType} tenants={tenants} />
      </ProviderContext>
    );
  }
};

const PGRLinks = ({ matchPath }) => {
  const { t } = useTranslation();
  const [params, setParams, clearParams] = Digit.Hooks.useSessionStorage(PGR_CITIZEN_CREATE_COMPLAINT, {});

  useEffect(() => {
    clearParams();
  }, []);

  const links = [
    {
      link: `${matchPath}/create-complaint/complaint-type`,
      i18nKey: t("CS_COMMON_FILE_A_COMPLAINT"),
    },
    {
      link: `${matchPath}/complaints`,
      i18nKey: t(LOCALE.MY_COMPLAINTS),
    },
  ];

  return <CitizenHomeCard header={t("CS_COMMON_HOME_COMPLAINTS")} links={links} Icon={ComplaintIcon} />;
};

const componentsToRegister = {
  PGRModule,
  PGRLinks,
  PGRCard,
  PGRBoundaryComponent: BoundaryComponent,
  PGRComplaintHierarchyComponent: ComplaintHierarchyComponent,
  PGRDatePicker,
  PGRComplaintDetails: PGRDetails,
  PGRTimeLineWrapper: TimelineWrapper,
  PGRAssigneeComponent: AssigneeComponent,
  PGRVerificationDocsComponent: VerificationDocsComponent,
  PGRActionUploadComponent: ActionUploadComponent,
  PGRSearchInbox,
  PGRCreateComplaint: CreateComplaint,
  PGRResponse: Response,
  PGRBreadCrumbs: BreadCrumbs,
  PGRComplaintsList: ComplaintsList,
  PGRComplaintDetailsPage: ComplaintDetailsPage,
  PGRSelectRating: SelectRating,
  PGRResponseCitzen: ResponseCitizen,
  GeoLocations,
  // Employee create-complaint map field (egovernments/CCRS#447 item 5).
  // Same leaflet/Nominatim/resolveWard component the citizen flow uses
  // ("GeoLocations"); aliased under a PGR-prefixed name so the employee
  // CreateComplaintConfig can reference it as a `type: "component"` field
  // without colliding with the citizen flow's `getComponent("GeoLocations")`
  // lookup. It writes the same `GeoLocationsPoint` form key (lat/lng +
  // resolved `ward`) that PGRBoundaryComponent's auto-cascade watches.
  PGRComplaintLocationMap: GeoLocations,
  SelectAddress,
  SelectImages,
  CreatePGRFlow: CreatePGRFlow,
};

export const initPGRComponents = () => {
  overrideHooks();
  updateCustomConfigs();
  Object.entries(componentsToRegister).forEach(([key, value]) => {
    Digit.ComponentRegistryService.setComponent(key, value);
  });
};
