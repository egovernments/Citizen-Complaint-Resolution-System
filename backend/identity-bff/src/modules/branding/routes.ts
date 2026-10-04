import type express from "express";
import { asyncRoute } from "../../app/async-route.js";
import { config } from "../../infrastructure/config.js";
import { resolvePublicTenantRoute } from "../access-context/tenant-route.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { IdentityAdminError } from "../organizations/organization-service.js";
import {
  BrandingRequestError,
  requestedBrandingLocale,
  tenantBranding,
} from "./tenant-branding.js";

export function registerBrandingRoutes(app: express.Application): void {
  // Public and cacheable: the Keycloak digit-employee/digit-citizen themes
  // read it before anyone is authenticated. It exposes only what the legacy
  // login pages already render to anonymous visitors.
  app.get("/identity/v1/tenant-contexts/:urlSlug/branding", asyncRoute(async (request, response) => {
    let locale: string;
    try {
      locale = requestedBrandingLocale(request.query.locale);
    } catch (error) {
      if (error instanceof BrandingRequestError) {
        return response.status(400).json({ error: error.message });
      }
      throw error;
    }
    const rawUrlSlug = request.params.urlSlug;
    try {
      const tenant = await resolvePublicTenantRoute(
        Array.isArray(rawUrlSlug) ? rawUrlSlug[0] : rawUrlSlug,
      );
      if (!tenant) {
        return response.status(404).json({ error: "Tenant route is not available" });
      }
      const branding = await tenantBranding(tenant, locale);
      response.setHeader(
        "Cache-Control",
        `public, max-age=${Math.max(0, config.identityBrandingCacheSeconds)}`,
      );
      response.setHeader("Vary", "Origin");
      return response.json(branding);
    } catch (error) {
      if (error instanceof IdentityAdminError || error instanceof DigitUnavailableError) {
        console.warn("Tenant branding failed:", error.message);
        return response.status(503).json({ error: "Tenant branding is temporarily unavailable" });
      }
      throw error;
    }
  }));
}
