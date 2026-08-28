-- Add missing index on eg_pgr_address_v2.parentid (FK to eg_pgr_service_v2.id)
--
-- Without this index, every complaint fetch does a sequential scan of the
-- entire address table. At 100K records: 24ms seq scan → 0.12ms index scan (200x).

CREATE INDEX IF NOT EXISTS idx_eg_pgr_address_v2_parentid ON eg_pgr_address_v2 (parentid);
