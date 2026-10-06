-- Persisted name keys already use Java Locale.ROOT lowercase. Do not use database
-- lower(), whose locale rules differ. Add only NFC and ECMAScript whitespace.
-- Temporary helper is migration-local; runtime normalization remains in Java.
CREATE FUNCTION pg_temp.pgr_workspace_name_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT btrim(regexp_replace(normalize(value, NFC),
        U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g'))
$$;

-- Prevent writes while validating and rewriting keys. Flyway runs this whole
-- migration transactionally, including collision failure and all four updates.
LOCK TABLE eg_pgr_onboarding_identifier, eg_pgr_onboarding_workspace_name,
    eg_pgr_onboarding_workspace_rename IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM eg_pgr_onboarding_workspace_name
        GROUP BY pg_temp.pgr_workspace_name_key(normalized_name) HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Workspace name normalization collision: resolve equivalent workspace_name ownership before retrying migration';
    END IF;
    IF EXISTS (SELECT 1 FROM eg_pgr_onboarding_identifier WHERE identifier_type='ORGANIZATION_NAME'
        GROUP BY pg_temp.pgr_workspace_name_key(normalized_value) HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Organization name normalization collision: resolve equivalent identifier keys (including released history) before retrying migration';
    END IF;
    IF EXISTS (SELECT 1 FROM eg_pgr_onboarding_identifier i
        JOIN eg_pgr_onboarding_signup s ON s.id=i.signup_id
        JOIN eg_pgr_onboarding_workspace_name n ON pg_temp.pgr_workspace_name_key(n.normalized_name)=pg_temp.pgr_workspace_name_key(i.normalized_value)
        WHERE i.identifier_type='ORGANIZATION_NAME' AND i.status<>'RELEASED' AND n.tenant_id<>s.requested_tenant_id) THEN
        RAISE EXCEPTION 'Organization name normalization ownership conflict: resolve identifier/workspace_name owners before retrying migration';
    END IF;
END $$;
UPDATE eg_pgr_onboarding_identifier SET normalized_value=pg_temp.pgr_workspace_name_key(normalized_value)
    WHERE identifier_type='ORGANIZATION_NAME';
UPDATE eg_pgr_onboarding_workspace_name SET normalized_name=pg_temp.pgr_workspace_name_key(normalized_name);
UPDATE eg_pgr_onboarding_workspace_rename SET normalized_name=pg_temp.pgr_workspace_name_key(normalized_name),
    old_normalized_name=pg_temp.pgr_workspace_name_key(old_normalized_name);
DROP FUNCTION pg_temp.pgr_workspace_name_key(text);
