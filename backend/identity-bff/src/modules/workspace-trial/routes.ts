import type express from "express";
import { asyncRoute, sendError } from "../../app/async-route.js";
import { clearTenantCaches } from "../access-context/tenant-directory.js";
import { OnboardingError } from "../onboarding/errors.js";
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

type Change = (attributes: Record<string, string[]>) => void;

/**
 * The Organization that serves a tenant: not superseded and not FAILED (a
 * failed earlier attempt may share the tenant id). More than one is ambiguous.
 */
async function organizationOf(tenantId: string): Promise<OnboardingOrganization | null> {
  const matches = (await readOnboardingOrganizations()).filter((org) =>
    organizationAttribute(org, "rootTenantId") === tenantId && !organizationAttribute(org, "supersededBy") &&
    organizationAttribute(org, "lifecycle") !== "FAILED");
  if (matches.length > 1) throw new OnboardingError("IDENTITY_UNAVAILABLE", "Ambiguous Organization ownership for tenant");
  return matches[0] ?? null;
}

/**
 * Writes `change` into the trial attributes of a tenant's Organization.
 * Stock Keycloak requires the complete representation, so it is read again
 * immediately before the PUT, as reconcile does for a rename. Null when the
 * tenant has no Organization.
 */
async function updateTrial(tenantId: string, change: Change): Promise<OnboardingOrganization | null> {
  const found = await organizationOf(tenantId);
  if (!found) return null;
  const path = `/organizations/${encodeURIComponent(found.id)}`;
  const fresh = await (await onboardingAdminRequest(path)).json() as OnboardingOrganization;
  const attributes = { ...fresh.attributes };
  change(attributes);
  const next = { ...fresh, attributes };
  // A no-op change (a repeated approval) skips the write.
  if (JSON.stringify(attributes) !== JSON.stringify(fresh.attributes)) {
    await onboardingAdminRequest(path, { method: "PUT", body: JSON.stringify(next) });
    // The public tenant directory caches the trial for up to a minute.
    clearTenantCaches();
  }
  return next;
}

export function registerWorkspaceTrialRoutes(app: express.Application, actorOf: (value: unknown) => string): void {
  const base = "/internal/identity/v1/workspace-trials";

  app.get(base, asyncRoute(async (_req, res) => {
    try {
      const workspaces = (await readOnboardingOrganizations())
        .filter((org) => readWorkspaceTrial(org.attributes) && !organizationAttribute(org, "supersededBy"))
        .map(view)
        .sort((a, b) => Date.parse(a.trialEndsAt!) - Date.parse(b.trialEndsAt!));
      return res.json({ workspaces });
    } catch (error) {
      if (error instanceof OnboardingError) return sendError(res, "IDENTITY_UNAVAILABLE", error.message);
      throw error;
    }
  }));

  app.post(`${base}/_approve`, asyncRoute(async (req, res) => {
    const tenantId = typeof req.body?.tenantId === "string" ? req.body.tenantId.trim() : "";
    if (!tenantId) return sendError(res, "INVALID_REQUEST", "tenantId is required");
    const actor = actorOf(req.body?.actor);
    try {
      let notOnTrial = false;
      const org = await updateTrial(tenantId, (attributes) => {
        if (!readWorkspaceTrial(attributes)) { notOnTrial = true; return; }
        // Idempotent: a second approval keeps the first.
        if (attributes[TRIAL_ATTRIBUTES.approvedAt]?.[0]) return;
        attributes[TRIAL_ATTRIBUTES.approvedAt] = [new Date().toISOString()];
        attributes[TRIAL_ATTRIBUTES.approvedBy] = [actor];
      });
      if (!org) return sendError(res, "WORKSPACE_NOT_FOUND", "No workspace for this tenant");
      if (notOnTrial) return sendError(res, "WORKSPACE_NOT_ON_TRIAL", "This workspace has no trial");
      return res.json({ workspace: view(org) });
    } catch (error) {
      if (error instanceof OnboardingError) return sendError(res, "IDENTITY_UNAVAILABLE", error.message);
      throw error;
    }
  }));

  app.post(`${base}/_extend`, asyncRoute(async (req, res) => {
    const tenantId = typeof req.body?.tenantId === "string" ? req.body.tenantId.trim() : "";
    if (!tenantId) return sendError(res, "INVALID_REQUEST", "tenantId is required");
    const ends = typeof req.body?.endsAt === "string" ? Date.parse(req.body.endsAt) : NaN;
    if (!Number.isFinite(ends) || ends <= Date.now()) {
      return sendError(res, "INVALID_REQUEST", "endsAt must be a date in the future");
    }
    try {
      const org = await updateTrial(tenantId, (attributes) => {
        attributes[TRIAL_ATTRIBUTES.endsAt] = [new Date(ends).toISOString()];
      });
      if (!org) return sendError(res, "WORKSPACE_NOT_FOUND", "No workspace for this tenant");
      return res.json({ workspace: view(org) });
    } catch (error) {
      if (error instanceof OnboardingError) return sendError(res, "IDENTITY_UNAVAILABLE", error.message);
      throw error;
    }
  }));
}
