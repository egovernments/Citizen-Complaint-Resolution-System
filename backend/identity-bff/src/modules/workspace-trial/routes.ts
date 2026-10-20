import type express from "express";
import { asyncRoute, sendError } from "../../app/async-route.js";
import { clearTenantCaches } from "../access-context/tenant-directory.js";
import { OnboardingError } from "../onboarding/errors.js";
import { withOnboardingLock } from "../onboarding/locks.js";
import { onboardingAdminRequest, readOnboardingOrganizations } from "../onboarding/organization-reader.js";
import { organizationAttribute, type OnboardingOrganization } from "../onboarding/primitives.js";
import { readWorkspaceTrial, TRIAL_ATTRIBUTES, workspaceTrialState } from "./trial.js";

/** One workspace as the operator sees it. */
function view(org: OnboardingOrganization) {
  const trial = readWorkspaceTrial(org.attributes);
  return {
    tenantId: organizationAttribute(org, "rootTenantId") ?? null,
    urlSlug: organizationAttribute(org, "urlSlug") ?? org.alias,
    name: org.name,
    trialEndsAt: trial?.endsAt ?? null,
    approvedAt: trial?.approvedAt ?? null,
    approvedBy: trial?.approvedBy ?? null,
    state: workspaceTrialState(trial, Date.now()),
  };
}

/** The Organization serving a tenant: not superseded and not FAILED (a failed attempt may share the tenant id). */
function serves(org: OnboardingOrganization, tenantId: string): boolean {
  return organizationAttribute(org, "rootTenantId") === tenantId &&
    !organizationAttribute(org, "supersededBy") && organizationAttribute(org, "lifecycle") !== "FAILED";
}

/**
 * Writes `change` into the trial attributes of a tenant's Organization.
 * Stock Keycloak requires the complete representation, so it is read again
 * under the onboarding lock the primitives take for this Organization, so a
 * concurrent lifecycle write is not lost. Null when the tenant has no Organization.
 */
async function updateTrial(tenantId: string, change: (attributes: Record<string, string[]>) => void) {
  const found = (await readOnboardingOrganizations()).find((org) => serves(org, tenantId));
  if (!found) return null;
  const operationId = organizationAttribute(found, "operationId");
  return withOnboardingLock(operationId ? "op" : "tenant", operationId ?? tenantId, async (fence) => {
    const path = `/organizations/${encodeURIComponent(found.id)}`;
    const fresh = await (await onboardingAdminRequest(path)).json() as OnboardingOrganization;
    const next = { ...fresh, attributes: { ...fresh.attributes } };
    change(next.attributes);
    await fence.assertHeld();
    await onboardingAdminRequest(path, { method: "PUT", body: JSON.stringify(next) });
    // The public tenant directory caches the trial for up to a minute.
    clearTenantCaches();
    return next;
  });
}

export function registerWorkspaceTrialRoutes(app: express.Application, actorOf: (value: unknown) => string): void {
  const base = "/internal/identity/v1/workspace-trials";
  const unavailable = (res: express.Response, error: unknown) => {
    if (error instanceof OnboardingError) return sendError(res, "IDENTITY_UNAVAILABLE", error.message);
    throw error;
  };

  app.get(base, asyncRoute(async (_req, res) => {
    try {
      const organizations = await readOnboardingOrganizations();
      return res.json({ workspaces: organizations.filter((org) => readWorkspaceTrial(org.attributes)).map(view) });
    } catch (error) {
      return unavailable(res, error);
    }
  }));

  app.post(`${base}/_approve`, asyncRoute(async (req, res) => {
    const tenantId = typeof req.body?.tenantId === "string" ? req.body.tenantId.trim() : "";
    if (!tenantId) return sendError(res, "INVALID_REQUEST", "tenantId is required");
    const actor = actorOf(req.body?.actor);
    try {
      const org = await updateTrial(tenantId, (attributes) => {
        // A second approval keeps the first.
        if (readWorkspaceTrial(attributes)?.approvedAt) return;
        attributes[TRIAL_ATTRIBUTES.approvedAt] = [new Date().toISOString()];
        attributes[TRIAL_ATTRIBUTES.approvedBy] = [actor];
      });
      if (!org) return sendError(res, "WORKSPACE_NOT_FOUND", "No workspace for this tenant");
      return res.json({ workspace: view(org) });
    } catch (error) {
      return unavailable(res, error);
    }
  }));

  app.post(`${base}/_extend`, asyncRoute(async (req, res) => {
    const tenantId = typeof req.body?.tenantId === "string" ? req.body.tenantId.trim() : "";
    if (!tenantId) return sendError(res, "INVALID_REQUEST", "tenantId is required");
    const ends = typeof req.body?.endsAt === "string" ? Date.parse(req.body.endsAt) : NaN;
    if (Number.isNaN(ends)) return sendError(res, "INVALID_REQUEST", "endsAt must be a date");
    try {
      const org = await updateTrial(tenantId, (attributes) => {
        attributes[TRIAL_ATTRIBUTES.endsAt] = [new Date(ends).toISOString()];
      });
      if (!org) return sendError(res, "WORKSPACE_NOT_FOUND", "No workspace for this tenant");
      return res.json({ workspace: view(org) });
    } catch (error) {
      return unavailable(res, error);
    }
  }));
}
