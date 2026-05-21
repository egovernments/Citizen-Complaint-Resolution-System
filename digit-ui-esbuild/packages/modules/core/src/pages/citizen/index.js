import { BackLink, CitizenHomeCard, CitizenInfoLabel } from "@egovernments/digit-ui-components";
import React from "react";
import { useTranslation } from "react-i18next";
import { Link, Redirect, Route, Switch, useHistory, useRouteMatch } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import ErrorBoundary from "../../components/ErrorBoundaries";
import ErrorComponent from "../../components/ErrorComponent";
import { AppHome, processLinkData } from "../../components/Home";
import TopBarSideBar from "../../components/TopBarSideBar";
import StaticCitizenSideBar from "../../components/TopBarSideBar/SideBar/StaticCitizenSideBar";
import { CitizenSidebar as CitizenSidebarV2, Card as V2Card } from "@egovernments/digit-ui-components-v2";
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
 * v2 module-home page (rendered for /citizen/<module>-home routes, e.g.
 * /pgr-home). Mirrors the all-services & complaints surfaces:
 *
 *   - flex column constrained to the available height between topbar
 *     and page footer (so internal content scrolls, never the page),
 *   - brand-tinted page header + back affordance,
 *   - banner image as a soft-cornered card,
 *   - module link list as a v2 Card with chevron rows that take the
 *     theme yellow tint on hover,
 *   - StaticDynamicCard preserved at the bottom for FAQs / How-it-works.
 *
 * Data layer (linkData → processLinkData, bannerImage from the modules
 * config) is unchanged.
 */
function V2ModuleHomePage({ code, bannerImage, mdmsDataObj, stateInfoBannerUrl, t, history }) {
  const linkRows = (mdmsDataObj?.links ?? [])
    .filter((l) => !!l?.link)
    .sort((a, b) => (a?.orderNumber ?? 0) - (b?.orderNumber ?? 0));
  const moduleLabelKey = `MODULE_${code?.toUpperCase()}`;
  const moduleTitle = (() => {
    const v = t(moduleLabelKey);
    return v === moduleLabelKey ? code : v;
  })();
  const banner = bannerImage || stateInfoBannerUrl;
  return (
    <div
      className="v2-scope"
      style={{
        display: "flex",
        flexDirection: "column",
        height:
          "calc(100vh - var(--v2-topbar-height, 82px) - var(--v2-page-footer-height, 38px))",
        minHeight: 0,
        width: "100%",
      }}
    >
      {/* Page header dropped per CCRS#557 — the module title was
          redundant with the banner image + the link card's own header
          and stole vertical space on a 1366×647 display. The banner
          + card content now leads. */}
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          padding: "0.5rem 1.5rem 1.5rem 1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {banner ? (
          <V2Card
            style={{
              padding: 0,
              overflow: "hidden",
              display: "block",
            }}
          >
            <ImageComponent
              src={banner}
              alt={moduleTitle}
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                maxHeight: "260px",
                objectFit: "cover",
              }}
            />
          </V2Card>
        ) : null}
        {mdmsDataObj && linkRows.length > 0 ? (
          <V2Card style={{ padding: "20px 20px 12px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <h2
              style={{
                margin: 0,
                fontSize: "1rem",
                fontWeight: 600,
                color: "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
              }}
            >
              {t(mdmsDataObj?.header)}
            </h2>
            {code === "OBPS" ? (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  backgroundColor: "var(--color-primary-selected-bg, #FFF4D7)",
                  color: "var(--color-text-heading, #363636)",
                  fontSize: "0.8125rem",
                  lineHeight: 1.5,
                }}
              >
                <strong>{t("CS_FILE_APPLICATION_INFO_LABEL")}</strong>{" "}
                {t("BPA_CITIZEN_HOME_STAKEHOLDER_INCLUDES_INFO_LABEL")}
              </div>
            ) : null}
            <ul
              role="list"
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "2px",
              }}
            >
              {linkRows.map((link, i) => {
                const href = link.link ?? "#";
                const label = link.i18nKey ? link.i18nKey : (link.name ? t(link.name) : href);
                const isExternal = /^https?:\/\//i.test(href);
                const inner = (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      padding: "10px 8px",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                      color: "var(--color-text-heading, #363636)",
                      transition: "background-color 0.15s ease-out, color 0.15s ease-out",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor =
                        "var(--color-primary-selected-bg, #FFF4D7)";
                      e.currentTarget.style.color =
                        "var(--color-primary-1, var(--color-primary-main, #c84c0e))";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color =
                        "var(--color-text-heading, #363636)";
                    }}
                  >
                    <span style={{ flex: 1 }}>{label}</span>
                    <ChevronRight
                      aria-hidden
                      style={{
                        height: "1rem",
                        width: "1rem",
                        flexShrink: 0,
                        color: "var(--color-text-secondary, #6B7280)",
                      }}
                    />
                  </span>
                );
                return (
                  <li key={`${href}-${i}`}>
                    {isExternal ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: "block", textDecoration: "none", color: "inherit" }}
                      >
                        {inner}
                      </a>
                    ) : (
                      <Link
                        to={{ pathname: href, state: link.state }}
                        style={{ display: "block", textDecoration: "none", color: "inherit" }}
                      >
                        {inner}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </V2Card>
        ) : null}
        <StaticDynamicCard moduleCode={code?.toUpperCase()} />
      </div>
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
  const classname = Digit.Hooks.useRouteSubscription(pathname);
  const { t } = useTranslation();
  const { path } = useRouteMatch();
  const history = useHistory();
  const handleClickOnWhatsApp = (obj) => {
    window.open(obj);
  };

  const hideSidebar = sidebarHiddenFor.some((e) => window.location.href.includes(e));
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
            history={history}
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
        {hideSidebar ? null : (
          <CitizenSidebarV2 linkData={linkData} isLoading={islinkDataLoading} />
        )}

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
          src={window?.globalConfigs?.getConfig?.("DIGIT_FOOTER")}
          onClick={() => {
            window.open(window?.globalConfigs?.getConfig?.("DIGIT_HOME_URL"), "_blank").focus();
          }}
        />
      </div>
    </div>
  );
};

export default Home;
