import { timingSafeEqual } from "node:crypto";
import type express from "express";
import { config } from "../../infrastructure/config.js";
import {
  ensureOrganization,
  ensureOrganizationMembership,
  ensureOrganizationRoleAssignment,
  ensureOrganizationTenantGroup,
  IdentityAdminError,
  organizationIdentifierAvailable,
  readOrganizationMapping,
  readTenantMappingForTenant,
  type TenantMapping,
} from "../organizations/organization-service.js";
import { currentSession } from "../sessions/current-session.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { runIdentityReconciliation } from "../reconciliation/reconciliation-service.js";
import { syncSubject } from "../reconciliation/subject-sync.js";
import { clearTenantCaches, isActiveDigitTenant } from "../access-context/tenant-directory.js";
import { ManagedAccountError } from "../managed-accounts/managed-account-service.js";

function asyncRoute(
  handler: (req: express.Request, res: express.Response) => Promise<unknown>,
): express.RequestHandler {
  return (req, res, next) => void handler(req, res).catch(next);
}

function sameSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

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
  if (error instanceof IdentityAdminError || error instanceof ManagedAccountError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error instanceof DigitUnavailableError) {
    return res.status(error.status === 409 ? 409 : 502).json({ error: error.message });
  }
  throw error;
}

export function registerControlPlaneRoutes(app: express.Application): void {
  app.use("/internal/identity/v1", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const onboardingRead = req.path === "/sessions/_introspect" ||
      req.path === "/identifiers/_check";
    const expected = onboardingRead
      ? config.identitySessionIntrospectionToken
      : config.identityControlPlaneToken;
    if (!expected) {
      return res.status(503).json({ error: "Identity control plane is not configured" });
    }
    const authorization = req.get("authorization") || "";
    const supplied = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!supplied || !sameSecret(supplied, expected)) {
      return res.status(401).json({ error: "Invalid workload credential" });
    }
    next();
  });

  app.post("/internal/identity/v1/organizations/_ensure", asyncRoute(async (req, res) => {
    try {
      const tenantId = requiredString(req.body?.tenantId, "tenantId");
      const alias = requiredString(req.body?.alias, "alias");
      const name = requiredString(req.body?.name, "name");
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(alias)) {
        throw new IdentityAdminError("alias is invalid", 400);
      }
      clearTenantCaches();
      if (!await isActiveDigitTenant(tenantId)) {
        throw new IdentityAdminError("The DIGIT tenant foundation does not exist yet", 409);
      }
      // Control-plane _ensure is an operator-driven idempotent upsert: an
      // Organization that already maps to the tenant is the expected steady state.
      const organization = await ensureOrganization({ tenantId, alias, name, adoptExisting: true });
      clearTenantCaches();
      return res.json({ organization });
    } catch (error) {
      return handleAdminError(error, res);
    }
  }));

  app.post("/internal/identity/v1/tenant-groups/_ensure", asyncRoute(async (req, res) => {
    try {
      const organizationId = requiredString(req.body?.organizationId, "organizationId");
      const tenantId = requiredString(req.body?.tenantId, "tenantId");
      const parentTenantId = requiredString(req.body?.parentTenantId, "parentTenantId");
      const urlSlug = requiredString(req.body?.urlSlug, "urlSlug").toLowerCase();
      const name = requiredString(req.body?.name, "name");
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(urlSlug) ||
          (urlSlug.match(/[a-z]/g) || []).length < 2) {
        throw new IdentityAdminError("urlSlug is invalid", 400);
      }
      if (req.body?.fallbackTenantIds !== undefined &&
          (!Array.isArray(req.body.fallbackTenantIds) ||
           !req.body.fallbackTenantIds.every((value: unknown) =>
             typeof value === "string" && value.trim()))) {
        throw new IdentityAdminError("fallbackTenantIds must be a string array", 400);
      }
      const fallbackTenantIds = [...new Set<string>(
        (req.body?.fallbackTenantIds || []).map((value: string) => value.trim()),
      )];
      if (fallbackTenantIds.includes(tenantId)) {
        throw new IdentityAdminError("A tenant cannot fall back to itself", 400);
      }
      clearTenantCaches();
      const requested = [tenantId, parentTenantId, ...fallbackTenantIds];
      for (const candidate of requested) {
        if (!await isActiveDigitTenant(candidate)) {
          throw new IdentityAdminError(`DIGIT tenant does not exist: ${candidate}`, 409);
        }
      }
      const organization = await readOrganizationMapping(organizationId);
      const parent = await readTenantMappingForTenant(parentTenantId);
      if (!organization || !parent ||
          parent.organizationId !== organizationId ||
          parent.rootTenantId !== organization.tenantId) {
        throw new IdentityAdminError("parentTenantId is not mapped inside the Organization", 409);
      }
      const ancestors = new Set([tenantId]);
      let ancestor: TenantMapping | null = parent;
      while (ancestor) {
        if (ancestors.has(ancestor.tenantId)) {
          throw new IdentityAdminError("Subtenant parent mapping would create a cycle", 409);
        }
        ancestors.add(ancestor.tenantId);
        if (!ancestor.parentTenantId) break;
        ancestor = await readTenantMappingForTenant(ancestor.parentTenantId);
        if (!ancestor || ancestor.organizationId !== organizationId) {
          throw new IdentityAdminError("Subtenant parent chain is incomplete", 409);
        }
      }
      for (const fallbackTenantId of fallbackTenantIds) {
        const fallback = await readTenantMappingForTenant(fallbackTenantId);
        if (!fallback || fallback.organizationId !== organizationId ||
            fallback.rootTenantId !== organization.tenantId) {
          throw new IdentityAdminError(
            `Fallback tenant is not mapped inside the Organization: ${fallbackTenantId}`,
            409,
          );
        }
      }
      const mapping = await ensureOrganizationTenantGroup({
        organizationId,
        tenantId,
        parentTenantId,
        urlSlug,
        name,
        fallbackTenantIds,
      });
      clearTenantCaches();
      return res.json({ tenant: mapping });
    } catch (error) {
      return handleAdminError(error, res);
    }
  }));

  app.post("/internal/identity/v1/sessions/_introspect", asyncRoute(async (req, res) => {
    const current = await currentSession(req.headers.cookie);
    if (!current) {
      return res.status(401).json({ error: "Invalid or missing identity session" });
    }
    const { claims } = current.session;
    return res.json({
      active: true,
      identity: {
        issuer: config.keycloakIssuer,
        subject: claims.sub,
        email: claims.email,
        name: claims.name,
        preferredUsername: claims.preferred_username,
      },
    });
  }));

  app.post("/internal/identity/v1/identifiers/_check", asyncRoute(async (req, res) => {
    try {
      const type = requiredString(req.body?.type, "type").toUpperCase();
      const value = requiredString(req.body?.value, "value");
      let available = await organizationIdentifierAvailable(type, value);
      if (available && type === "TENANT_ID") {
        clearTenantCaches();
        available = !await isActiveDigitTenant(value.toLowerCase());
      }
      return res.json({ type, value, available });
    } catch (error) {
      return handleAdminError(error, res);
    }
  }));

  // Adds Keycloak Organization membership, then resolves the member's managed
  // DIGIT account: created when absent (requires mobileNumber) and given the
  // Organization tenant's base and allowlisted group roles. Existing
  app.post("/internal/identity/v1/memberships/_ensure", asyncRoute(async (req, res) => {
    try {
      const organizationId = requiredString(req.body?.organizationId, "organizationId");
      const userId = requiredString(req.body?.userId, "userId");
      if (req.body?.digitUserUuid !== undefined) {
        throw new IdentityAdminError(
          "digitUserUuid is not supported: only BFF-managed DIGIT accounts are linked",
          400,
        );
      }
      const mobileNumber = optionalString(req.body?.mobileNumber, "mobileNumber") || "";
      const countryCode = optionalString(req.body?.countryCode, "countryCode") || "";
      const mapping = await readOrganizationMapping(organizationId);
      if (!mapping) {
        throw new IdentityAdminError("Organization is not mapped to a DIGIT tenant", 404);
      }
      await ensureOrganizationMembership({ organizationId, userId });
      const outcome = (await syncSubject(userId, mobileNumber, countryCode)).get(mapping.tenantId);
      return res.json({
        tenantId: mapping.tenantId,
        digitUserUuid: outcome?.account?.uuid ?? null,
        created: outcome?.created ?? false,
      });
    } catch (error) {
      return handleAdminError(error, res);
    }
  }));

  app.post("/internal/identity/v1/role-assignments/_ensure", asyncRoute(async (req, res) => {
    try {
      const organizationId = requiredString(req.body?.organizationId, "organizationId");
      const userId = requiredString(req.body?.userId, "userId");
      const groupName = requiredString(req.body?.groupName, "groupName");
      const clientId = requiredString(req.body?.clientId, "clientId");
      if (!Array.isArray(req.body?.roles) || req.body.roles.length === 0 ||
          !req.body.roles.every((role: unknown) => typeof role === "string" && role.trim())) {
        throw new IdentityAdminError("roles must be a non-empty string array", 400);
      }
      const roles = [...new Set<string>(
        req.body.roles.map((role: string) => role.trim()),
      )].sort();
      const assignment = await ensureOrganizationRoleAssignment({
        organizationId,
        userId,
        groupName,
        clientId,
        roles,
      });
      const mapping = await readOrganizationMapping(organizationId);
      const outcome = (await syncSubject(userId)).get(mapping?.tenantId || "");
      return res.json({ assignment, digitUserUuid: outcome?.account?.uuid ?? null });
    } catch (error) {
      return handleAdminError(error, res);
    }
  }));

  app.post("/internal/identity/v1/reconciliation/_run", asyncRoute(async (_req, res) => {
    const result = await runIdentityReconciliation();
    return res.status(result.acquired ? 200 : 202).json(result);
  }));
}
