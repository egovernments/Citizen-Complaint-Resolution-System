/**
 * URL slug rules. The source of truth is §2.4.1 of docs/identity-bff.md; the
 * SPA (`tenantRoute.js`) and pgr-services (`OnboardingIdentifierService`)
 * carry the same list and are tested against that section.
 *
 * Reserved: the SPA's own path words plus every top-level path prefix nginx
 * or Kong routes on the same host, so `/{slug}/digit-ui/` can never be
 * shadowed by, or shadow, another route.
 */
export const RESERVED_URL_SLUGS: ReadonlySet<string> = new Set([
  "access",
  "api",
  "assets",
  "auth",
  "boundary-service",
  "brand",
  "citizen",
  "common-persist",
  "configurator",
  "dashboard",
  "digit-ui",
  "egov-bndry-mgmnt",
  "egov-enc-service",
  "egov-hrms",
  "egov-idgen",
  "egov-indexer",
  "egov-location",
  "egov-mdms-service",
  "egov-user-event",
  "egov-workflow-v2",
  "employee",
  "env",
  "file-store",
  "filestore",
  "gatus",
  "grafana",
  "health",
  "identity",
  "images",
  "inbox",
  "kc",
  "keycloak",
  "localization",
  "matomo",
  "mcp",
  "mdms-v2",
  "novu",
  "novu-api",
  "novu-bridge",
  "novu-ws",
  "otel",
  "otp",
  "pgr-services",
  "static",
  "status",
  "tests",
  "tests-v2",
  "turbopass",
  "user",
  "user-otp",
  "user-preference",
  "v1",
  "xstate-chatbot",
]);

const URL_SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function validUrlSlug(value: string): boolean {
  return URL_SLUG.test(value) &&
    (value.match(/[a-z]/g) || []).length >= 2 &&
    !RESERVED_URL_SLUGS.has(value);
}
