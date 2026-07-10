-- Additive column for citizen-supplied, category-schema-driven, PII-encrypted fields.
-- Kept separate from additionalDetails (system-managed metadata: department, serviceName,
-- escalation) to isolate concerns and allow independent schema evolution.
ALTER TABLE eg_pgr_service_v2
    ADD COLUMN IF NOT EXISTS extended_attributes JSONB;

-- B-tree expression indexes on the two primary search predicates (caseRelatedTo filter,
-- confidentiality gate). Cheaper to maintain than a full GIN index on the whole column.
CREATE INDEX IF NOT EXISTS idx_pgr_svc_ext_case_related_to
    ON eg_pgr_service_v2 ((extended_attributes->>'caseRelatedTo'));

CREATE INDEX IF NOT EXISTS idx_pgr_svc_ext_is_confidential
    ON eg_pgr_service_v2 (((extended_attributes->>'isConfidential')::boolean));
