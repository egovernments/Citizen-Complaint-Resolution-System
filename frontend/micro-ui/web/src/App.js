import React, { Suspense } from "react";
import { initLibraries } from "@egovernments/digit-ui-libraries";
import { UICustomizations } from "./Customisations/UICustomizations";
import { Loader } from "@egovernments/digit-ui-components";

window.contextPath = window?.globalConfigs?.getConfig("CONTEXT_PATH");

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

  // Dynamic imports — each module gets its own chunk, loaded in parallel
  const [pgr, utilities, workbench, hrms] = await Promise.all([
    import("@egovernments/digit-ui-module-cms"),
    import("@egovernments/digit-ui-module-utilities"),
    import("@egovernments/digit-ui-module-workbench"),
    import("@egovernments/digit-ui-module-hrms"),
  ]);

  _PGRReducers = pgr.PGRReducers;
  pgr.initPGRComponents();
  utilities.initUtilitiesComponents();
  workbench.initWorkbenchComponents();
  hrms.initHRMSComponents();
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
