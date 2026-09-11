/**
 * Process-local runtime mode for the standalone dashboard bundle.
 *
 * The public page is a separate esbuild entry, so setting this before its first
 * React render cannot affect the employee SPA. Services consult it at request
 * time to guarantee that a public view never borrows a co-hosted employee
 * session from localStorage.
 */
let mode = "session";

export function configurePublicDashboardRuntime() {
  mode = "public";
}

export function isPublicDashboardRuntime() {
  return mode === "public";
}
