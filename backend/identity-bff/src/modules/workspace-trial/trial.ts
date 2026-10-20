import { config } from "../../infrastructure/config.js";

/** Organization attributes that carry a workspace's trial window. */
export const TRIAL_ATTRIBUTES = {
  endsAt: "digit.trialEndsAt",
  approvedAt: "digit.trialApprovedAt",
  approvedBy: "digit.trialApprovedBy",
} as const;

export interface WorkspaceTrial {
  endsAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

export type WorkspaceTrialState = "NONE" | "TRIAL" | "APPROVED" | "EXPIRED";

export interface WorkspaceTrialNotice {
  title: string;
  message: string;
  linkLabel?: string;
  linkUrl?: string;
}

function first(attributes: Record<string, string[]>, name: string): string | null {
  const value = attributes[name]?.[0];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Null when the Organization has no trial end: such a workspace is never locked. */
export function readWorkspaceTrial(
  attributes: Record<string, string[]> | undefined,
): WorkspaceTrial | null {
  if (!attributes) return null;
  const endsAt = first(attributes, TRIAL_ATTRIBUTES.endsAt);
  if (!endsAt) return null;
  return {
    endsAt,
    approvedAt: first(attributes, TRIAL_ATTRIBUTES.approvedAt),
    approvedBy: first(attributes, TRIAL_ATTRIBUTES.approvedBy),
  };
}

export function workspaceTrialState(trial: WorkspaceTrial | null, now: number): WorkspaceTrialState {
  if (!trial) return "NONE";
  if (trial.approvedAt) return "APPROVED";
  // Date.parse reads a date-only value as UTC midnight; an unparseable end
  // fails closed (NaN is never after now).
  const ends = Date.parse(trial.endsAt);
  return ends > now ? "TRIAL" : "EXPIRED";
}

export function isTrialLocked(trial: WorkspaceTrial | null, now: number): boolean {
  return workspaceTrialState(trial, now) === "EXPIRED";
}

export function trialNotice(): WorkspaceTrialNotice {
  return { ...config.workspaceTrialNotice };
}
