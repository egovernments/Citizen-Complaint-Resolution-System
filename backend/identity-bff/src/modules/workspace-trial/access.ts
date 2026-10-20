import type express from "express";
import { errorBody, errorStatus } from "../../contract/error-codes.js";
import { readTenantMappingForUrlSlug } from "../organizations/organization-service.js";
import { isTrialLocked, trialNotice, type WorkspaceTrialNotice } from "./trial.js";

/**
 * The lock a public route reports for a slug, from the cached tenant
 * directory (up to a minute stale). Advisory: the live gates re-read the
 * Organization before they grant anything.
 */
export async function publicTrialAccess(
  urlSlug: string,
): Promise<{ state: "TRIAL_EXPIRED"; notice: WorkspaceTrialNotice } | null> {
  const mapping = await readTenantMappingForUrlSlug(urlSlug);
  return mapping && isTrialLocked(mapping.trial, Date.now())
    ? { state: "TRIAL_EXPIRED", notice: trialNotice() }
    : null;
}

/** Every refusal of a locked workspace carries the configured notice. */
export function sendTrialExpired(response: express.Response): express.Response {
  return response.status(errorStatus("WORKSPACE_TRIAL_EXPIRED"))
    .json(errorBody("WORKSPACE_TRIAL_EXPIRED", "This workspace's trial has ended", { notice: trialNotice() }));
}
