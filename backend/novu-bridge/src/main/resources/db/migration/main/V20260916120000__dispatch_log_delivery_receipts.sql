-- Ledger truth: (1) test-sends are real rows at the operator's tenant, flagged, instead of
-- hiding under tenant_id='TEST'; (2) a provider reference so delivery receipts can find the
-- row; (3) receipts move a row SENT -> DELIVERED | BOUNCED | FAILED and stamp delivered_time.
ALTER TABLE nb_dispatch_log ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE nb_dispatch_log ADD COLUMN IF NOT EXISTS provider_ref VARCHAR(256);
ALTER TABLE nb_dispatch_log ADD COLUMN IF NOT EXISTS delivered_time BIGINT;

CREATE INDEX IF NOT EXISTS idx_nb_dispatch_provider_ref ON nb_dispatch_log (provider_ref);
CREATE INDEX IF NOT EXISTS idx_nb_dispatch_tenant_is_test ON nb_dispatch_log (tenant_id, is_test);

-- Backfill: rows the old test-send wrote under the synthetic tenant.
UPDATE nb_dispatch_log SET is_test = TRUE WHERE tenant_id = 'TEST';
