import React, { Suspense } from "react";
import { UICustomizations } from "./Customisations/UICustomizations";

window.contextPath = window?.globalConfigs?.getConfig("CONTEXT_PATH");

// Inline fallback spinner — avoids a static import of @egovernments/digit-ui-components
// which would pull 5MB of transitive deps (pdfmake, jspdf, lottie, SVG icons) into
// the critical path. The real Loader renders once DigitUI resolves.
const Spinner = () => (
  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
    <div style={{
      width: 48, height: 48, border: "4px solid #e0e0e0",
      borderTop: "4px solid #f47738", borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
    }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
  </div>
);

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

// initLibraries is already called synchronously in index.js (sets up window.Digit).
// Here we just wait for any async init, then load modules.
// Using dynamic import avoids pulling digit-ui-libraries into the entry's static deps
// (index.js already has the static import).
import("@egovernments/digit-ui-libraries").then((m) =>
  m.initLibraries()
).then(() => {
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
    <Suspense fallback={<Spinner />}>
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
