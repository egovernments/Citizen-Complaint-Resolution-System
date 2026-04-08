import React, { Suspense } from "react";
import { initLibraries } from "@egovernments/digit-ui-libraries";
import { UICustomizations } from "./Customisations/UICustomizations";

window.contextPath = window?.globalConfigs?.getConfig("CONTEXT_PATH");

// Inline fallback spinner — avoids a static import of @egovernments/digit-ui-components
// which would pull 1MB+ of transitive deps into the critical path.
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

// Lazy load DigitUI — defers the core module (and its deps) out of the critical path.
// CJS modules expose exports under .default when bundled as ESM by esbuild.
const DigitUI = React.lazy(() =>
  import("@egovernments/digit-ui-module-core").then((mod) => ({
    default: (mod.default || mod).DigitUI,
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

// initLibraries is also called in index.js (synchronous setup).
// This second call waits for any async init to complete, then loads modules.
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

  // Dynamic imports — each module gets its own chunk, loaded in parallel.
  // CJS modules expose exports under .default when bundled as ESM.
  const resolve = (m) => m.default || m;
  const [pgrRaw, utilRaw, wbRaw, hrmsRaw] = await Promise.all([
    import("@egovernments/digit-ui-module-cms"),
    import("@egovernments/digit-ui-module-utilities"),
    import("@egovernments/digit-ui-module-workbench"),
    import("@egovernments/digit-ui-module-hrms"),
  ]);
  const pgr = resolve(pgrRaw);
  const utilities = resolve(utilRaw);
  const workbench = resolve(wbRaw);
  const hrms = resolve(hrmsRaw);

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
