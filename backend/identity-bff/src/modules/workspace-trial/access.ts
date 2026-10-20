import type express from "express";
import { errorBody, errorStatus } from "../../contract/error-codes.js";
import { readTenantMappingForUrlSlug } from "../organizations/organization-service.js";
import { isTrialLocked, trialNotice } from "./trial.js";

/** From the cached tenant directory (up to a minute stale); the live gates re-read the Organization. */
export async function isSlugTrialLocked(urlSlug: string): Promise<boolean> {
  const mapping = await readTenantMappingForUrlSlug(urlSlug);
  return !!mapping && isTrialLocked(mapping.trial, Date.now());
}

/** Every refusal of a locked workspace carries the configured notice. */
export function sendTrialExpired(response: express.Response): express.Response {
  return response.status(errorStatus("WORKSPACE_TRIAL_EXPIRED"))
    .json(errorBody("WORKSPACE_TRIAL_EXPIRED", "This workspace's trial has ended", { notice: trialNotice() }));
}
