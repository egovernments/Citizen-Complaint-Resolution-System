/**
 * Public (unauthenticated) dashboard entry.
 *
 * A second esbuild entry over the SAME products/dashboard source tree that the
 * employee app mounts at /employee/dashboard — not a fork. The only difference
 * is the mount: `mode="public"` skips the standalone login gate, so requests go
 * out with no authToken/userInfo and the backend's PUBLIC floor decides what
 * comes back (see AnalyticsService.extractRoles → PUBLIC).
 *
 * Deliberately does NOT call initLibraries(): with no window.Digit runtime the
 * dashboard's own fallbacks engage, which is exactly what a public page wants —
 *   - useDashboardConfig  → { config: null, loading: false } (no MDMS gate)
 *   - i18n/localeRuntime  → standalone branch, fetches message bundles straight
 *                           from /localization/messages/v1/_search
 * The subtree pulls in no @egovernments modules, no react-router and no Digit
 * services, so this stays a small independent bundle.
 *
 * Served from the same /digit-ui/ docroot as the employee build (so hashed
 * assets resolve against one publicPath) at public-dashboard.html; give it a
 * friendly URL with an nginx alias rather than a second docroot.
 *
 * The three analytics read paths this page calls (/packs, /catalog/_search,
 * /_query) are explicitly auth-optional on both gateways, so anonymous access is
 * a declared contract rather than a side effect of Kong's audit mode. The actual
 * boundary is server-side: AnalyticsService degrades a role-less caller to the
 * PUBLIC role, which resolves only rbac.visibleTo:["PUBLIC"] defs and refuses
 * inline query grammar (kpiId reference only).
 */
import React from "react";
import ReactDOM from "react-dom";
import AdminDashboard from "../products/dashboard/src/AdminDashboard";
import { applyTheme } from "./theme/applyTheme";
import defaultTheme from "./theme/default.json";

// Same bundled default theme the employee app applies synchronously before
// render, so shared design tokens resolve identically on both surfaces.
applyTheme(defaultTheme);

ReactDOM.render(
  <React.StrictMode>
    <AdminDashboard mode="public" />
  </React.StrictMode>,
  document.getElementById("root")
);
