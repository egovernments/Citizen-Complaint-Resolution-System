-- H2 stand-in for db/migration/main/V20260205120000__create_user_preference.sql.
-- Differences are H2 limitations, not behavioural choices:
--   payload is TEXT because H2 has no jsonb type (the repository binds a plain
--   parameter rather than a jsonb cast when the driver is not PostgreSQL);
--   the uniqueness rule is a plain constraint on the three key columns rather
--   than an index over COALESCE(tenant_id, ''), which H2 cannot express. The
--   service only ever writes '' for an absent tenant, never NULL, so the two
--   are equivalent for anything it stores.
CREATE TABLE IF NOT EXISTS user_preference (
    id                  UUID NOT NULL,
    user_id             VARCHAR(64) NOT NULL,
    tenant_id           VARCHAR(64),
    preference_code     VARCHAR(128) NOT NULL,
    payload             TEXT NOT NULL,
    created_by          VARCHAR(64) NOT NULL,
    created_time        BIGINT NOT NULL,
    last_modified_by    VARCHAR(64) NOT NULL,
    last_modified_time  BIGINT NOT NULL,
    CONSTRAINT pk_user_preference PRIMARY KEY (id),
    CONSTRAINT uk_user_preference UNIQUE (user_id, tenant_id, preference_code)
);

CREATE INDEX IF NOT EXISTS idx_user_preference_user_id ON user_preference (user_id);
CREATE INDEX IF NOT EXISTS idx_user_preference_tenant_id ON user_preference (tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_preference_code ON user_preference (preference_code);
CREATE INDEX IF NOT EXISTS idx_user_preference_created_time ON user_preference (created_time DESC);
