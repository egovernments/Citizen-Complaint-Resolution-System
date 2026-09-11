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
 * assets resolve against one publicPath) at public-dashboard.html. Nginx gives it the
 * canonical friendly URL /digit-ui/public-dashboard (with /dashboard retained as an alias)
 * rather than adding a second docroot.
 *
 * The analytics read paths this page calls are explicitly auth-optional on Kong,
 * so anonymous access is a declared compose/Ansible contract rather than a side
 * effect of Kong's audit mode. Kubernetes' Spring mixed-mode gateway is
 * deliberately not opened: unlike Kong, it does not strip spoofed userInfo from
 * anonymous bodies. The actual data boundary remains server-side.
 */
import React from "react";
import ReactDOM from "react-dom";
import AdminDashboard from "../products/dashboard/src/AdminDashboard";
import { configurePublicDashboardRuntime } from "../products/dashboard/src/services/dashboardRuntime";
import { applyTheme } from "./theme/applyTheme";
import defaultTheme from "./theme/default.json";

// Same bundled default theme the employee app applies synchronously before
// render, so shared design tokens resolve identically on both surfaces.
configurePublicDashboardRuntime();
applyTheme(defaultTheme);

ReactDOM.render(
  <React.StrictMode>
    <AdminDashboard mode="public" />
  </React.StrictMode>,
  document.getElementById("root")
);
