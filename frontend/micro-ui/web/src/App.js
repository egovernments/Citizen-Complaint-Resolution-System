/**
 * The above code initializes various Digit UI modules and components, sets up customizations, and
 * renders the DigitUI component based on the enabled modules and state code.
 * @returns The `App` component is being returned, which renders the `DigitUI` component with the
 * specified props such as `stateCode`, `enabledModules`, `moduleReducers`, and `defaultLanding`. The
 * `DigitUI` component is responsible for rendering the UI based on the provided configuration and
 * modules.
 */
import React, { Suspense } from "react";
import { initLibraries } from "@egovernments/digit-ui-libraries";
import { UICustomizations } from "./Customisations/UICustomizations";
import { Loader } from "@egovernments/digit-ui-components";

window.contextPath = window?.globalConfigs?.getConfig("CONTEXT_PATH");
window.globalPath = window.contextPath;

// Lazy load DigitUI
const DigitUI = React.lazy(() =>
  import("@egovernments/digit-ui-module-core").then((mod) => ({
    default: mod.DigitUI,
  }))
);

const enabledModules = [
  "Utilities",
  "PGR",
  "Workbench",
  "HRMS",
];

// PGRReducers is needed synchronously by moduleReducers, so we store it
// once the dynamic import resolves.
let _PGRReducers = () => ({});

initLibraries().then(() => {
  initDigitUI();
});

const moduleReducers = (initData) => ({
  initData,
  pgr: _PGRReducers(initData),
});

const initDigitUI = async () => {
  window.Digit.ComponentRegistryService.setupRegistry({});
  window.Digit.Customizations = {
    commonUiConfig: UICustomizations,
  };

  // Dynamic imports — each module gets its own chunk
  // Use individual try/catch so missing optional modules don't block startup
  try {
    const pgr = await import(/* webpackChunkName: "pgr" */ "@egovernments/digit-ui-module-pgr");
    _PGRReducers = pgr.PGRReducers;
    pgr.initPGRComponents();
  } catch (e) { console.warn("[App] PGR module not available:", e.message); }

  try {
    const utilities = await import(/* webpackChunkName: "utilities" */ "@egovernments/digit-ui-module-utilities");
    utilities.initUtilitiesComponents();
  } catch (e) { /* optional */ }

  try {
    const workbench = await import(/* webpackChunkName: "workbench" */ "@egovernments/digit-ui-module-workbench");
    workbench.initWorkbenchComponents();
  } catch (e) { /* optional */ }

  try {
    const hrms = await import(/* webpackChunkName: "hrms" */ "@egovernments/digit-ui-module-hrms");
    hrms.initHRMSComponents();
  } catch (e) { /* optional */ }
};

function App() {
  window.contextPath = window?.globalConfigs?.getConfig("CONTEXT_PATH");
  const stateCode =
    window.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID") ||
    process.env.REACT_APP_STATE_LEVEL_TENANT_ID;
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
