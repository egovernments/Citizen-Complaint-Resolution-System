// Deployment entry for <PGRLandingPage /> inside the DIGIT shell.
//
// The app's react-router has NO basename — every route path carries
// `/${window.contextPath}` explicitly (see core App.js). The landing page's
// route defaults are basename-relative, so this wrapper prefixes the known
// in-app destinations with the runtime contextPath before mounting.
//
// Registered as "PGRLandingPage" in products/pgr/src/Module.js and mounted
// shell-free at `/${contextPath}/landing` by core's DigitApp switch.

import * as React from "react";
import PGRLandingPage from "./index";
import type { LandingRoutes } from "./routes";

export function PGRLandingEntry() {
  const ctx = (typeof window !== "undefined" && (window as any)?.contextPath) || "digit-ui";

  const routes: Partial<LandingRoutes> = React.useMemo(
    () => ({
      HOME: `/${ctx}/landing`,
      REGISTER_COMPLAINT: `/${ctx}/citizen/pgr/create-complaint`,
      TRACK_COMPLAINT: `/${ctx}/citizen/pgr/complaints`,
      CITIZEN_LOGIN: `/${ctx}/citizen/login`,
      EMPLOYEE_LOGIN: `/${ctx}/employee`,
    }),
    [ctx]
  );

  return <PGRLandingPage routes={routes} />;
}

export default PGRLandingEntry;
