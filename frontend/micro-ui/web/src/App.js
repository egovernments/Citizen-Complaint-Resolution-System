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
// import { initHRMSComponents } from "@egovernments/digit-ui-module-hrms";
import { UICustomizations } from "./Customisations/UICustomizations";
import { initUtilitiesComponents } from "@egovernments/digit-ui-module-utilities";
import { initPGRComponents, PGRReducers, } from "@egovernments/digit-ui-module-cms";
import { Loader } from "@egovernments/digit-ui-components";
import { initWorkbenchComponents } from "@egovernments/digit-ui-module-workbench";
import { initHRMSComponents } from "@egovernments/digit-ui-module-hrms";

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
  initWorkbenchComponents();
  initHRMSComponents();
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
