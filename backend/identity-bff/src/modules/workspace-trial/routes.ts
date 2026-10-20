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

/** Sort key: an unparseable end (EXPIRED, fail closed) goes last instead of turning the comparison into NaN. */
function endOf(workspace: ReturnType<typeof view>): number {
  const ends = Date.parse(workspace.trialEndsAt!);
  return Number.isNaN(ends) ? Number.MAX_VALUE : ends;
}

type Change = (attributes: Record<string, string[]>) => void;

/**
 * Whether an Organization can serve `tenantId`: it maps that tenant and is not
 * superseded or FAILED (a failed earlier attempt may share the tenant id).
 */
function serves(org: OnboardingOrganization, tenantId: string | undefined): boolean {
  return !!tenantId && organizationAttribute(org, "rootTenantId") === tenantId &&
    !organizationAttribute(org, "supersededBy") && organizationAttribute(org, "lifecycle") !== "FAILED";
}

/** The Organization that serves a tenant. More than one is ambiguous. */
function organizationOf(organizations: OnboardingOrganization[], tenantId: string): OnboardingOrganization | null {
  const matches = organizations.filter((org) => serves(org, tenantId));
  if (matches.length > 1) throw new OnboardingError("IDENTITY_UNAVAILABLE", "Ambiguous Organization ownership for tenant");
  return matches[0] ?? null;
}

/**
 * Writes `change` into the trial attributes of a tenant's Organization.
 * Stock Keycloak requires the complete representation, so it is read again
 * immediately before the PUT, as reconcile does for a rename. The read-modify-
 * write runs under the onboarding lock the primitives take for this
 * Organization (its operation, else its tenant), so neither a concurrent
 * operator write nor a lifecycle change is lost. Null when the tenant has no
 * Organization.
 */
async function updateTrial(tenantId: string, change: Change): Promise<OnboardingOrganization | null> {
  const found = organizationOf(await readOnboardingOrganizations(), tenantId);
  if (!found) return null;
  const operationId = organizationAttribute(found, "operationId");
  return withOnboardingLock(operationId ? "op" : "tenant", operationId ?? tenantId, async (fence) => {
    const path = `/organizations/${encodeURIComponent(found.id)}`;
    const fresh = await (await onboardingAdminRequest(path)).json() as OnboardingOrganization;
    // It may have failed or been superseded while this call waited.
    if (!serves(fresh, tenantId)) throw new OnboardingError("IDENTITY_UNAVAILABLE", "The tenant's Organization changed; retry");
    const attributes = { ...fresh.attributes };
    change(attributes);
    const next = { ...fresh, attributes };
    // A no-op change (a repeated approval) skips the write.
    if (JSON.stringify(attributes) !== JSON.stringify(fresh.attributes)) {
      await fence.assertHeld();
      await onboardingAdminRequest(path, { method: "PUT", body: JSON.stringify(next) });
      // The public tenant directory caches the trial for up to a minute.
      clearTenantCaches();
    }
    return next;
  });
}

export function registerWorkspaceTrialRoutes(app: express.Application, actorOf: (value: unknown) => string): void {
  const base = "/internal/identity/v1/workspace-trials";

  app.get(base, asyncRoute(async (_req, res) => {
    try {
      const organizations = await readOnboardingOrganizations();
      // Only rows the writes accept: the one Organization serving its tenant, so
      // never a FAILED, superseded or ambiguous one.
      const writable = (org: OnboardingOrganization) => {
        const tenantId = organizationAttribute(org, "rootTenantId");
        return serves(org, tenantId) && organizations.filter((other) => serves(other, tenantId)).length === 1;
      };
      const workspaces = organizations
        .filter((org) => readWorkspaceTrial(org.attributes) && writable(org))
        .map(view)
        .sort((a, b) => endOf(a) - endOf(b));
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
        if (readWorkspaceTrial(attributes)?.approvedAt) return;
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
