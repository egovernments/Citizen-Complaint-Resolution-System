import { describe, expect, it } from "vitest";
import {
  TRIAL_ATTRIBUTES,
  isTrialLocked,
  readWorkspaceTrial,
  workspaceTrialState,
} from "../../src/modules/workspace-trial/trial.js";

const now = Date.parse("2026-11-01T00:00:00Z");

describe("workspace trial model", () => {
  it("names the Organization attributes", () => {
    expect(TRIAL_ATTRIBUTES).toEqual({
      endsAt: "digit.trialEndsAt",
      approvedAt: "digit.trialApprovedAt",
      approvedBy: "digit.trialApprovedBy",
    });
  });

  it("no trialEndsAt is NONE and never locks", () => {
    expect(workspaceTrialState(readWorkspaceTrial({ "digit.lifecycle": ["ACTIVE"] }), now)).toBe("NONE");
    expect(isTrialLocked(readWorkspaceTrial(undefined), now)).toBe(false);
  });

  it("before the end is TRIAL, at the end is EXPIRED", () => {
    expect(workspaceTrialState(readWorkspaceTrial({ "digit.trialEndsAt": ["2026-11-01T00:00:01Z"] }), now)).toBe("TRIAL");
    expect(workspaceTrialState(readWorkspaceTrial({ "digit.trialEndsAt": ["2026-11-01T00:00:00Z"] }), now)).toBe("EXPIRED");
    expect(isTrialLocked(readWorkspaceTrial({ "digit.trialEndsAt": ["2026-11-01T00:00:00Z"] }), now)).toBe(true);
  });

  it("approval wins over an expired end", () => {
    const t = readWorkspaceTrial({ "digit.trialEndsAt": ["2026-01-01T00:00:00Z"], "digit.trialApprovedAt": ["2026-02-01T00:00:00Z"], "digit.trialApprovedBy": ["op"] });
    expect(workspaceTrialState(t, now)).toBe("APPROVED");
    expect(t?.approvedBy).toBe("op");
    expect(isTrialLocked(t, now)).toBe(false);
  });

  it("date-only parses as UTC midnight; garbage fails closed", () => {
    expect(workspaceTrialState(readWorkspaceTrial({ "digit.trialEndsAt": ["2026-11-02"] }), now)).toBe("TRIAL");
    expect(workspaceTrialState(readWorkspaceTrial({ "digit.trialEndsAt": ["soon"] }), now)).toBe("EXPIRED");
  });

  it("empty approvedAt value is not approval", () => {
    expect(workspaceTrialState(readWorkspaceTrial({ "digit.trialEndsAt": ["2026-01-01T00:00:00Z"], "digit.trialApprovedAt": [""] }), now)).toBe("EXPIRED");
  });
});
