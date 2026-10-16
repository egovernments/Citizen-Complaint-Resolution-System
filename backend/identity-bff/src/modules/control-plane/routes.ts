import type express from "express";
import { config } from "../../infrastructure/config.js";
import { asyncRoute, sendError } from "../../app/async-route.js";
import { bearerMatches } from "../../app/request-security.js";
import {
  findEnabledIdentityUser,
  IdentityAdminError,
} from "../organizations/organization-service.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { runReconcile } from "../sync/reconcile.js";
import { clearTenantCaches, isActiveDigitTenant } from "../access-context/tenant-directory.js";
import {
  CITIZEN_USER_TYPE,
  ManagedAccountError,
  type ManagedUserType,
} from "../managed-accounts/managed-account-service.js";
import {
  AccountLinkError,
  createAccountLink,
  EMPLOYEE_USER_TYPE,
  findEmployeeUuid,
  linksOf,
  removeAccountLink,
} from "../account-links/account-links.js";
import { onboardingAuthorization, registerOnboardingRoutes } from "../onboarding/routes.js";
import { onboardingDependencies } from "../onboarding/production.js";
import { backfillTenantRoutes } from "../tenant-routes/backfill.js";

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new IdentityAdminError(`${name} is required`, 400);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, name);
}

function handleAdminError(error: unknown, res: express.Response) {
  if (error instanceof AccountLinkError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error instanceof IdentityAdminError || error instanceof ManagedAccountError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error instanceof DigitUnavailableError) {
    return res.status(error.status === 409 ? 409 : 502).json({ error: error.message });
  }
  throw error;
}

const MAX_LINKS_PER_REQUEST = 500;

function actorOf(value: unknown): string {
  return typeof value === "string" && /^[\w.@:-]{1,100}$/.test(value) ? `control-plane:${value}` : "control-plane";
}

function linkUserType(value: unknown): ManagedUserType {
  if (value === undefined || value === EMPLOYEE_USER_TYPE) return EMPLOYEE_USER_TYPE;
  if (value === CITIZEN_USER_TYPE) return CITIZEN_USER_TYPE;
  throw new IdentityAdminError("userType must be EMPLOYEE or CITIZEN", 400);
}

export function registerControlPlaneRoutes(app: express.Application): void {
  app.use("/internal/identity/v1", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const onboarding = onboardingAuthorization(req, res);
    if (onboarding !== undefined) {
      if (onboarding) next();
      return;
    }
    const expected = config.identityControlPlaneToken;
    if (!expected) {
      return res.status(503).json({ code: "CONTROL_PLANE_NOT_CONFIGURED", error: "Identity control plane is not configured" });
    }
    if (!bearerMatches(req, [expected])) {
      return res.status(401).json({ code: "WORKLOAD_UNAUTHORIZED", error: "Invalid workload credential" });
    }
    next();
  });

  // Existing-tenant routes (#2167). Idempotent; never renames a slug. Kept
  // after item 14: it is the only writer of routes for root tenants that
  // predate signup (e.g. `ke`); signup's organizations/_ensure covers new ones.
  app.post("/internal/identity/v1/tenant-routes/_backfill", asyncRoute(async (req, res) => {
    try {
      return res.json(await backfillTenantRoutes({
        dryRun: req.body?.dryRun === true,
        actor: actorOf(req.body?.actor),
      }));
    } catch (error) {
      if (error instanceof DigitUnavailableError) return sendError(res, "DIGIT_UNAVAILABLE", error.message);
      if (error instanceof IdentityAdminError) return sendError(res, "IDENTITY_UNAVAILABLE", error.message);
      throw error;
    }
  }));

  /**
   * Admin links of existing DIGIT accounts (#2167), one or a bulk import.
   * Each item names the Keycloak user (`subject` or `email`) and the DIGIT
   * account (`digitUserUuid`, or `digitUserName` for an employee). Items are
   * independent: each gets its own result and audit record.
   */
  app.post("/internal/identity/v1/account-links/_link", asyncRoute(async (req, res) => {
    const items = req.body?.links;
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_LINKS_PER_REQUEST) {
      return res.status(400).json({ error: `links must hold 1-${MAX_LINKS_PER_REQUEST} items`, code: "INVALID_REQUEST" });
    }
    const actor = actorOf(req.body?.actor);
    clearTenantCaches();
    const results = [];
    for (const [index, item] of items.entries()) {
      try {
        const userType = linkUserType(item?.userType);
        const tenantId = requiredString(item?.tenantId, "tenantId");
        if (userType === CITIZEN_USER_TYPE && tenantId.includes(".")) {
          throw new AccountLinkError("Citizen accounts live at the root tenant", 400, "INVALID_REQUEST");
        }
        if (!await isActiveDigitTenant(tenantId)) {
          throw new AccountLinkError("Unknown or inactive DIGIT tenant", 404, "TENANT_NOT_FOUND");
        }
        const subject = await findEnabledIdentityUser({
          id: optionalString(item?.subject, "subject"),
          email: optionalString(item?.email, "email"),
        });
        if (!subject) throw new AccountLinkError("No enabled Keycloak user matches", 404, "IDENTITY_NOT_FOUND");
        const userName = optionalString(item?.digitUserName, "digitUserName");
        const digitUuid = optionalString(item?.digitUserUuid, "digitUserUuid") ||
          (userName && userType === EMPLOYEE_USER_TYPE ? await findEmployeeUuid(tenantId, userName) : null);
        if (!digitUuid) throw new AccountLinkError("No active DIGIT account matches", 404, "DIGIT_ACCOUNT_NOT_FOUND");
        const { status } = await createAccountLink({
          subject, userType, tenantId, digitUuid, method: "ADMIN", actor,
        });
        results.push({ index, status, subject, userType, tenantId, digitUserUuid: digitUuid });
      } catch (error) {
        if (error instanceof AccountLinkError || error instanceof IdentityAdminError) {
          const code = error instanceof AccountLinkError ? error.code
            : error.status === 400 ? "INVALID_REQUEST" : "IDENTITY_UNAVAILABLE";
          results.push({ index, status: "REFUSED", code, error: error.message });
          continue;
        }
        if (error instanceof DigitUnavailableError) {
          results.push({ index, status: "REFUSED", code: "DIGIT_UNAVAILABLE", error: error.message });
          continue;
        }
        throw error;
      }
    }
    return res.json({ results });
  }));

  app.post("/internal/identity/v1/account-links/_unlink", asyncRoute(async (req, res) => {
    try {
      const subject = requiredString(req.body?.subject, "subject");
      const result = await removeAccountLink({
        subject,
        userType: linkUserType(req.body?.userType),
        tenantId: requiredString(req.body?.tenantId, "tenantId"),
        digitUuid: requiredString(req.body?.digitUserUuid, "digitUserUuid"),
        block: req.body?.block === true,
        actor: actorOf(req.body?.actor),
      });
      return res.json(result);
    } catch (error) {
      return handleAdminError(error, res);
    }
  }));

  app.get("/internal/identity/v1/account-links", asyncRoute(async (req, res) => {
    try {
      const subject = requiredString(req.query.subject, "subject");
      return res.json(await linksOf(subject));
    } catch (error) {
      return handleAdminError(error, res);
    }
  }));

  registerOnboardingRoutes(app, onboardingDependencies);

  app.post("/internal/identity/v1/reconciliation/_run", asyncRoute(async (_req, res) => {
    const result = await runReconcile();
    return res.status(result.acquired ? 200 : 202).json(result);
  }));
}
