import { BackLink, CitizenHomeCard, CitizenInfoLabel } from "@egovernments/digit-ui-components";
import React from "react";
import { useTranslation } from "react-i18next";
import { Redirect, Route, Switch, useHistory, useRouteMatch } from "react-router-dom";
import ErrorBoundary from "../../components/ErrorBoundaries";
import ErrorComponent from "../../components/ErrorComponent";
import { AppHome, moduleIcon, processLinkData } from "../../components/Home";
import TopBarSideBar from "../../components/TopBarSideBar";
import StaticCitizenSideBar from "../../components/TopBarSideBar/SideBar/StaticCitizenSideBar";
import { Card as V2Card, CitizenServiceCard } from "@egovernments/digit-ui-components-v2";
import { BackButton } from "@egovernments/digit-ui-react-components";
import CitizenNavSideBar from "../../components/TopBarSideBar/SideBar/CitizenNavSideBar";
import FAQsSection from "./FAQs/FAQs";
import CitizenHome from "./Home";
import LanguageSelection from "./Home/LanguageSelection";
import LocationSelection from "./Home/LocationSelection";
import UserProfile from "./Home/UserProfile";
import HowItWorks from "./HowItWorks/howItWorks";
import Login from "./Login";
import Search from "./SearchApp";
import StaticDynamicCard from "./StaticDynamicComponent/StaticDynamicCard";
import ImageComponent from "../../components/ImageComponent";

/**
 * A module's landing page (/citizen/<module>-home, e.g. /pgr-home): the
 * module's All Services card on its own, under the Back row the module's
 * other pages open with. No page heading: the card's title is the module's
 * name, so a heading above it only said the same thing twice (CCRS#557).
 *
 * Data layer (linkData → processLinkData, bannerImage from the modules
 * config) is unchanged.
 */
function V2ModuleHomePage({ code, bannerImage, mdmsDataObj, stateInfoBannerUrl, t }) {
  const moduleLabelKey = `MODULE_${code?.toUpperCase()}`;
  const moduleTitle = (() => {
    const v = t(moduleLabelKey);
    return v === moduleLabelKey ? code : v;
  })();
  const banner = bannerImage || stateInfoBannerUrl;
  // ImageComponent renders nothing for a dead URL (CCRS#881), which left its
  // card behind as an empty 2px bar above the module card; drop both.
  const [failedBanner, setFailedBanner] = React.useState(null);
  return (
    <div className="v2-scope citizen-module-home">
      <BackButton>{t("CS_COMMON_BACK")}</BackButton>
      {banner && failedBanner !== banner ? (
        <V2Card style={{ padding: 0, overflow: "hidden", display: "block" }}>
          <ImageComponent
            src={banner}
            alt={moduleTitle}
            onError={() => setFailedBanner(banner)}
            style={{ display: "block", width: "100%", height: "auto", maxHeight: "260px", objectFit: "cover" }}
          />
        </V2Card>
      ) : null}
      {mdmsDataObj ? (
        <div className="citizen-module-home__cards">
          <CitizenServiceCard code={code} data={mdmsDataObj} renderIcon={moduleIcon} t={t} />
        </div>
      ) : null}
      <StaticDynamicCard moduleCode={code?.toUpperCase()} />
    </div>
  );
}

const sidebarHiddenFor = [
  `${window?.contextPath}/citizen/register/name`,
  `/${window?.contextPath}/citizen/select-language`,
  `/${window?.contextPath}/citizen/select-location`,
  `/${window?.contextPath}/citizen/login`,
  `/${window?.contextPath}/citizen/register/otp`,
];

const getTenants = (codes, tenants) => {
  return tenants.filter((tenant) => codes.map((item) => item.code).includes(tenant.code));
};

const Home = ({
  stateInfo,
  userDetails,
  CITIZEN,
  cityDetails,
  mobileView,
  handleUserDropdownSelection,
  logoUrl,
  DSO,
  stateCode,
  modules,
  appTenants,
  sourceUrl,
  pathname,
  initData,
}) => {
  const { isLoading: islinkDataLoading, data: linkData, isFetched: isLinkDataFetched } = Digit.Hooks.useCustomMDMS(
    Digit.ULBService.getStateId(),
    "ACCESSCONTROL-ACTIONS-TEST",
    [
      {
        name: "actions-test",
        filter: `[?(@.url == '${Digit.Utils.getMultiRootTenant() ? window.globalPath : window.contextPath}-card')]`,
      },
    ],
    {
      select: (data) => {
        const formattedData = data?.["ACCESSCONTROL-ACTIONS-TEST"]?.["actions-test"]
          ?.filter((el) => el.enabled === true)
          .reduce((a, b) => {
            a[b.parentModule] = a[b.parentModule]?.length > 0 ? [b, ...a[b.parentModule]] : [b];
            return a;
          }, {});
        return formattedData;
      },
    }
  );
  // Always `.citizen`. useRouteSubscription swaps in `.employee` for any path
  // with a "user", "search" or "inbox" segment, a DSO leftover that laid the
  // citizen's own Edit Profile page out with the employee app's rules.
  const classname = "citizen";
  const { t } = useTranslation();
  const { path } = useRouteMatch();
  const history = useHistory();
  const handleClickOnWhatsApp = (obj) => {
    window.open(obj);
  };

  const hideSidebar = sidebarHiddenFor.some((e) => window.location.href.includes(e));
  // The sign-in steps sit on the navy ground the employee sign-in uses, where
  // only the white wordmark reads; the colour one is the fallback for a
  // deployment that configures just that.
  const onSignIn = /\/citizen\/(login|register)(\/|$)/.test(window.location.pathname);
  const footerMark =
    (onSignIn && window?.globalConfigs?.getConfig?.("DIGIT_FOOTER_BW")) || window?.globalConfigs?.getConfig?.("DIGIT_FOOTER");
  const appRoutes = modules.map(({ code, tenants }, index) => {
    const Module = Digit.ComponentRegistryService.getComponent(`${code}Module`);
    return Module ? (
      <Route key={index} path={`${path}/${code.toLowerCase()}`}>
        <Module stateCode={stateCode} moduleCode={code} userType="citizen" tenants={getTenants(tenants, appTenants)} />
      </Route>
    ) : null;
  });

  const ModuleLevelLinkHomePages = modules.map(({ code, bannerImage }, index) => {
    let Links = Digit.ComponentRegistryService.getComponent(`${code}Links`) || (() => <React.Fragment />);
    let mdmsDataObj = isLinkDataFetched ? processLinkData(linkData, code, t) : undefined;

    if (mdmsDataObj?.header === "ACTION_TEST_WS") {
      mdmsDataObj?.links.sort((a, b) => {
        return b.orderNumber - a.orderNumber;
      });
    }
    return (
      <React.Fragment>
        <Route key={index} path={`${path}/${code.toLowerCase()}-home`}>
          <V2ModuleHomePage
            code={code}
            bannerImage={bannerImage}
            mdmsDataObj={mdmsDataObj}
            stateInfoBannerUrl={stateInfo?.bannerUrl}
            t={t}
          />
        </Route>
        <Route key={"faq" + index} path={`${path}/${code.toLowerCase()}-faq`}>
          <FAQsSection module={code?.toUpperCase()} />
        </Route>
        <Route key={"hiw" + index} path={`${path}/${code.toLowerCase()}-how-it-works`}>
          <HowItWorks module={code?.toUpperCase()} />
        </Route>
      </React.Fragment>
    );
  });

  return (
    <div className={classname}>
      <TopBarSideBar
        t={t}
        stateInfo={stateInfo}
        userDetails={userDetails}
        CITIZEN={CITIZEN}
        cityDetails={cityDetails}
        mobileView={mobileView}
        handleUserDropdownSelection={handleUserDropdownSelection}
        logoUrl={logoUrl}
        logoUrlWhite={stateInfo?.logoUrlWhite}
        showSidebar={CITIZEN ? true : false}
        linkData={linkData}
        islinkDataLoading={islinkDataLoading}
      />

      <div className={`main center-container citizen-home-container mb-25`}>
        {hideSidebar ? null : <CitizenNavSideBar t={t} crestUrl={logoUrl} />}

        <Switch>
          <Route exact path={path}>
            <CitizenHome />
          </Route>

          <Route exact path={`${path}/select-language`}>
            <LanguageSelection />
          </Route>

          <Route exact path={`${path}/select-location`}>
            <LocationSelection />
          </Route>
          <Route path={`${path}/error`}>
            <ErrorComponent
              initData={initData}
              goToHome={() => {
                history.push(`/${window?.contextPath}/${Digit?.UserService?.getType?.()}`);
              }}
            />
          </Route>
          <Route path={`${path}/all-services`}>
            <AppHome
              userType="citizen"
              modules={modules}
              getCitizenMenu={linkData}
              fetchedCitizen={isLinkDataFetched}
              isLoading={islinkDataLoading}
            />
          </Route>

          <Route path={`${path}/login`}>
            <Login stateCode={stateCode} />
          </Route>

          <Route path={`${path}/register`}>
            <Login stateCode={stateCode} isUserRegistered={false} />
          </Route>

          {/* /user/profile must require an active citizen session. The
              employee router has an equivalent gate in AppModules.js;
              before this change the citizen route rendered the form
              for logged-out visitors (form was empty so nothing leaked,
              but Save would fail with 401 silently and the sidebar
              still showed "Login"). Mirror the employee pattern:
              redirect to /citizen/login with a `from` state so post-
              login the user lands back on the profile page they tried
              to open (CCRS#556 follow-up). */}
          <Route
            path={`${path}/user/profile`}
            render={({ location }) =>
              Digit.UserService.getUser()?.access_token ? (
                <UserProfile stateCode={stateCode} userType={"citizen"} cityDetails={cityDetails} />
              ) : (
                <Redirect
                  to={{
                    pathname: `${path}/login`,
                    state: { from: location.pathname + location.search },
                  }}
                />
              )
            }
          />

          <Route path={`${path}/Audit`}>
            <Search />
          </Route>
          <ErrorBoundary initData={initData}>
            {appRoutes}
            {ModuleLevelLinkHomePages}
          </ErrorBoundary>
        </Switch>
      </div>
      <div className="citizen-home-footer" style={window.location.href.includes("citizen/obps") ? { zIndex: "-1" } : {}}>
        <ImageComponent
          alt="Powered by DIGIT"
          style={{ height: "1.2em", cursor: "pointer" }}
          src={footerMark}
          onClick={() => {
            window.open(window?.globalConfigs?.getConfig?.("DIGIT_HOME_URL"), "_blank").focus();
          }}
        />
      </div>
    </div>
  );
};

export default Home;
