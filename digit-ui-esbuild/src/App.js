import React, { Suspense } from "react";
import { initLibraries } from "@egovernments/digit-ui-libraries";
import { UICustomizations } from "./Customisations/UICustomizations";
import { initUtilitiesComponents } from "@egovernments/digit-ui-module-utilities";
import { initPGRComponents, PGRReducers, } from "@egovernments/digit-ui-module-pgr";
import { Loader } from "@egovernments/digit-ui-components";
import { Button as V2Button, Card as V2Card } from "@egovernments/digit-ui-components-v2";
import { initDashboardComponents } from "../products/dashboard/Module";

window.contextPath = window?.globalConfigs?.getConfig("CONTEXT_PATH");
window.globalPath = window.contextPath;

// Lazy load DigitUI
const DigitUI = React.lazy(() =>
  import("@egovernments/digit-ui-module-core").then((mod) => ({
    default: mod.DigitUI,
  }))
);

// HRMS + Workbench intentionally omitted — employees/admins manage HRMS
// and workbench configs via the configurator app (separate /configurator/
// deployment), not from inside digit-ui. Closes egovernments/CCRS#561
// and egovernments/CCRS#560.
const enabledModules = [
  "Utilities",
  "PGR",
  "Dashboard",
];

initLibraries().then(() => {
  initDigitUI();
});

const moduleReducers = (initData) => ({
  initData,
  pgr: PGRReducers(initData)
});

const initDigitUI = () => {
  window.Digit.ComponentRegistryService.setupRegistry({});
  window.Digit.Customizations = {
    commonUiConfig: UICustomizations,
  };

  initUtilitiesComponents();
  initPGRComponents();
  initDashboardComponents();
};

function App() {
  const [tenantConflict, setTenantConflict] = React.useState(
    Boolean(window.__digitTenantContextConflict),
  );
  React.useEffect(() => {
    const blockStaleTenant = () => setTenantConflict(true);
    window.addEventListener("digit:tenant-context-conflict", blockStaleTenant);
    return () => window.removeEventListener("digit:tenant-context-conflict", blockStaleTenant);
  }, []);

  if (window.__digitTenantContextError) {
    return (
      <main style={{ maxWidth: "42rem", margin: "12vh auto", padding: "2rem", fontFamily: "Roboto, sans-serif" }}>
        <h1>Tenant unavailable</h1>
        <p>{window.__digitTenantContextError.message}</p>
      </main>
    );
  }
  const routeTenant = window.__digitTenantContext;
  if (routeTenant && tenantConflict) {
    const resume = () => {
      window.sessionStorage.removeItem("Digit.tenantContextConflict");
      window.__digitTenantContextConflict = false;
      const login = routeTenant.surface === "citizen"
        ? `/${routeTenant.appBasePath}/citizen/login`
        : `/${routeTenant.appBasePath}/employee/user/login`;
      window.location.replace(login);
    };
    return (
      <main
        className="v2-scope"
        style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}
      >
        <V2Card style={{ width: "100%", maxWidth: "440px", padding: "32px", display: "grid", gap: "20px" }}>
          <h1 style={{ margin: 0, color: "var(--color-text-heading, #1D2433)" }}>Tenant session changed</h1>
          <p style={{ margin: 0, color: "var(--color-text-secondary, #505A5F)", lineHeight: 1.5 }}>
            Another tab signed in to a different tenant. This tab has been paused so it cannot use that session with {routeTenant.name}.
          </p>
          <V2Button type="button" width="full" onClick={resume}>
            Continue with {routeTenant.name}
          </V2Button>
        </V2Card>
      </main>
    );
  }
  window.contextPath = routeTenant?.appBasePath || window?.globalConfigs?.getConfig("CONTEXT_PATH");
  window.globalPath = window.contextPath;
  const stateCode =
    routeTenant?.tenantId ||
    window.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID") ||
    process.env.REACT_APP_STATE_LEVEL_TENANT_ID ||
    "pg";
  if (!stateCode) {
    return <h1>stateCode is not defined</h1>;
  }

  return (
    <Suspense fallback={<Loader page={true} variant={"PageLoader"} />}>
      <DigitUI
        stateCode={stateCode}
        enabledModules={enabledModules}
        moduleReducers={moduleReducers}
        defaultLanding="employee"
        allowedUserTypes={["employee", "citizen"]}
      />
    </Suspense>
  );
}

export default App;
