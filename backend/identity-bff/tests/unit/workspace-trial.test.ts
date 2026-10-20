import { describe, expect, it } from "vitest";
import { readWorkspaceTrial, workspaceTrialState } from "../../src/modules/workspace-trial/trial.js";

const now = Date.parse("2026-11-01T00:00:00Z");
const state = (attributes?: Record<string, string[]>) => workspaceTrialState(readWorkspaceTrial(attributes), now);

describe("workspace trial model", () => {
  it("reads NONE, TRIAL, EXPIRED and APPROVED from the Organization attributes", () => {
    expect(state(undefined)).toBe("NONE");
    expect(state({ "digit.lifecycle": ["ACTIVE"] })).toBe("NONE");
    expect(state({ "digit.trialEndsAt": ["2026-11-01T00:00:01Z"] })).toBe("TRIAL");
    expect(state({ "digit.trialEndsAt": ["2026-11-01T00:00:00Z"] })).toBe("EXPIRED");
    expect(state({ "digit.trialEndsAt": ["2026-01-01T00:00:00Z"], "digit.trialApprovedAt": ["2026-02-01T00:00:00Z"] })).toBe("APPROVED");
  });

  it("fails closed on an unparseable end, and a blank approval is not approval", () => {
    expect(state({ "digit.trialEndsAt": ["soon"] })).toBe("EXPIRED");
    expect(state({ "digit.trialEndsAt": ["2026-01-01T00:00:00Z"], "digit.trialApprovedAt": [""] })).toBe("EXPIRED");
  });
});
