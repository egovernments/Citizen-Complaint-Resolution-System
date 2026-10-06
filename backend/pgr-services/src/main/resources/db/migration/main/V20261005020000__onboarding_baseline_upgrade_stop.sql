-- BaselineUpgrader stops retrying a workspace after repeated failures at the same point.
-- upgrade_attempts now counts consecutive failures at upgrade_failed_step. A stopped
-- workspace (upgrade_stopped_at set) is never claimed again until an operator clears it;
-- see docs/onboarding-workspace-contract.md.
ALTER TABLE eg_pgr_onboarding_workspace
    ADD COLUMN upgrade_failed_step varchar(128),
    ADD COLUMN upgrade_stopped_at bigint;
