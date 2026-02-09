import { Loader } from "@egovernments/digit-ui-react-components";
console.log('Triggering CMS release workflow 55');
console.log('Triggering CMS release workflow 66');
import React, { useState } from "react";
import { useRouteMatch } from "react-router-dom";
import { default as EmployeeApp } from "./pages/employee";
import PGRCard from "./components/PGRCard";
import { overrideHooks, updateCustomConfigs } from "./utils";
import { ProviderContext } from "./utils/context";
import BoundaryComponent from "./components/BoundaryComponent";
import PGRDetails from "./pages/employee/PGRDetails";
import TimelineWrapper from "./components/TimeLineWrapper";
import AssigneeComponent from "./components/AssigneeComponent";
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
import CreatePGRFlow from "./pages/citizen/Create/FormExplorer";


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

  // Only initialize boundary hierarchy for employee users (not needed for citizens)
  const { isLoading: isPGRInitializing } = userType === "employee"
    ? Digit.Hooks.pgr.usePGRInitialization({ tenantId: tenantId })
    : { isLoading: false };

  Digit.SessionStorage.set("PGR_TENANTS", tenants);

  if (isLoading || isPGRInitializing) {
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
  PGRComplaintDetails: PGRDetails,
  PGRTimeLineWrapper: TimelineWrapper,
  PGRAssigneeComponent: AssigneeComponent,
  PGRSearchInbox,
  PGRCreateComplaint: CreateComplaint,
  PGRResponse: Response,
  PGRBreadCrumbs: BreadCrumbs,
  PGRComplaintsList: ComplaintsList,
  PGRComplaintDetailsPage: ComplaintDetailsPage,
  PGRSelectRating: SelectRating,
  PGRResponseCitzen: ResponseCitizen,
  GeoLocations,
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
