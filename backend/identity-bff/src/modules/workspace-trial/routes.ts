import type express from "express";
import { asyncRoute, sendError } from "../../app/async-route.js";
import { clearTenantCaches } from "../access-context/tenant-directory.js";
import { OnboardingError } from "../onboarding/errors.js";
import { withOnboardingLock } from "../onboarding/locks.js";
import { onboardingAdminRequest, readOnboardingOrganizations, readOrganizationByTenant } from "../onboarding/organization-reader.js";
import { organizationAttribute, type OnboardingOrganization } from "../onboarding/primitives.js";
import { audit } from "../citizen-otp/audit.js";
import { isTrialLocked, readWorkspaceTrial, TRIAL_ATTRIBUTES, workspaceTrialState } from "./trial.js";

// A full ISO 8601 timestamp with an offset, on a real calendar day: Date.parse alone reads "7" as
// 2001-07-01 and rolls 2026-02-30 over to 2 March.
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
function parseInstant(value: unknown): number {
  const raw = typeof value === "string" ? value.trim() : "";
  const match = INSTANT.exec(raw);
  if (!match) return NaN;
  const [year, month, day] = match.slice(1, 4).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? Date.parse(raw) : NaN;
}

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
    // What the gates do: false for every workspace while trials are off, whatever `state` says.
    locked: isTrialLocked(trial, Date.now()),
  };
}

/**
 * Writes `change` into the trial attributes of a tenant's Organization: the one
 * the sign-in gates read (`readOrganizationByTenant`), so an approval never lands
 * on an older attempt whose supersession a crash left unpublished.
 * Stock Keycloak requires the complete representation, so it is read again
 * under the onboarding lock the primitives take for this Organization, so a
 * concurrent lifecycle write is not lost. Null when no live Organization serves the tenant.
 */
async function updateTrial(tenantId: string, change: (attributes: Record<string, string[]>) => void) {
  const authority = await readOrganizationByTenant(tenantId);
  if (!authority || authority.lifecycle === "FAILED") return null;
  const path = `/organizations/${encodeURIComponent(authority.id)}`;
  const read = async () => await (await onboardingAdminRequest(path)).json() as OnboardingOrganization;
  const operationId = organizationAttribute(await read(), "operationId");
  return withOnboardingLock(operationId ? "op" : "tenant", operationId ?? tenantId, async (fence) => {
    const fresh = await read();
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
    if (error instanceof OnboardingError) {
      return sendError(res, error.code === "IDENTITY_BUSY" ? "IDENTITY_BUSY" : "IDENTITY_UNAVAILABLE", error.message);
    }
    throw error;
  };
  const trialAudit = (event: "WORKSPACE_TRIAL_APPROVED" | "WORKSPACE_TRIAL_EXTENDED", tenantId: string, actor: string,
    from: string | null, to: string | null) =>
    audit({ event, outcome: "SUCCESS", tenantId, actor, detail: JSON.stringify({ from, to }) });

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
      let from: string | null = null;
      const org = await updateTrial(tenantId, (attributes) => {
        // A second approval keeps the first, on a workspace with no trial too.
        from = attributes[TRIAL_ATTRIBUTES.approvedAt]?.[0] || null;
        if (from) return;
        attributes[TRIAL_ATTRIBUTES.approvedAt] = [new Date().toISOString()];
        attributes[TRIAL_ATTRIBUTES.approvedBy] = [actor];
      });
      if (!org) return sendError(res, "WORKSPACE_NOT_FOUND", "No workspace for this tenant");
      await trialAudit("WORKSPACE_TRIAL_APPROVED", tenantId, actor, from, org.attributes?.[TRIAL_ATTRIBUTES.approvedAt]?.[0] ?? null);
      return res.json({ workspace: view(org) });
    } catch (error) {
      return unavailable(res, error);
    }
  }));

  app.post(`${base}/_extend`, asyncRoute(async (req, res) => {
    const tenantId = typeof req.body?.tenantId === "string" ? req.body.tenantId.trim() : "";
    if (!tenantId) return sendError(res, "INVALID_REQUEST", "tenantId is required");
    const ends = parseInstant(req.body?.endsAt);
    if (Number.isNaN(ends)) {
      return sendError(res, "INVALID_REQUEST", "endsAt must be an ISO 8601 timestamp with an offset, e.g. 2026-12-31T23:59:59Z");
    }
    const actor = actorOf(req.body?.actor);
    try {
      let from: string | null = null;
      const org = await updateTrial(tenantId, (attributes) => {
        from = attributes[TRIAL_ATTRIBUTES.endsAt]?.[0] || null;
        attributes[TRIAL_ATTRIBUTES.endsAt] = [new Date(ends).toISOString()];
      });
      if (!org) return sendError(res, "WORKSPACE_NOT_FOUND", "No workspace for this tenant");
      await trialAudit("WORKSPACE_TRIAL_EXTENDED", tenantId, actor, from, new Date(ends).toISOString());
      return res.json({ workspace: view(org) });
    } catch (error) {
      return unavailable(res, error);
    }
  }));
}
