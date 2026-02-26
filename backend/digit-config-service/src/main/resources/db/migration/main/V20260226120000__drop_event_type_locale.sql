-- Migrate event_type into value JSON as "eventName"
UPDATE config_entry
SET "value" = jsonb_set("value"::jsonb, '{eventName}', to_jsonb(event_type))::text
WHERE event_type IS NOT NULL
  AND ("value"::jsonb ->> 'eventName') IS NULL;

-- Migrate locale into value JSON as "locale"
UPDATE config_entry
SET "value" = jsonb_set("value"::jsonb, '{locale}', to_jsonb(locale))::text
WHERE locale IS NOT NULL
  AND ("value"::jsonb ->> 'locale') IS NULL;

-- Drop old unique constraint
ALTER TABLE config_entry DROP CONSTRAINT IF EXISTS uq_config_entry;

-- Drop old indexes
DROP INDEX IF EXISTS idx_config_entry_event_type;
DROP INDEX IF EXISTS idx_config_entry_channel;

-- Drop columns
ALTER TABLE config_entry DROP COLUMN IF EXISTS event_type;
ALTER TABLE config_entry DROP COLUMN IF EXISTS locale;

-- New unique constraint without event_type and locale
ALTER TABLE config_entry ADD CONSTRAINT uq_config_entry UNIQUE (tenant_id, config_code, module, channel);

-- GIN index on value for efficient JSON querying
CREATE INDEX IF NOT EXISTS idx_config_entry_value_gin ON config_entry USING gin (CAST("value" AS jsonb));
