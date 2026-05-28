-- Schema definition for tenant.tenants
INSERT INTO eg_mdms_schema_definition
    (id, tenantid, code, description, definition, isactive, createdBy, lastModifiedBy, createdTime, lastModifiedTime)
SELECT
    'tenant-schema-001',
    'pg',
    'tenant.tenants',
    'Tenant master for encryption bootstrap',
    '{
      "$schema":"http://json-schema.org/draft-07/schema#",
      "type":"object",
      "properties":{
        "code":{"type":"string"},
        "name":{"type":"string"},
        "tenantId":{"type":"string"},
        "parent":{"type":["string","null"]},
        "city":{"type":"object","properties":{"code":{"type":"string"},"name":{"type":"string"}}}
      },
      "required":["code","name","tenantId"],
      "title":"Tenant master"
    }'::jsonb,
    TRUE,
    'system-mdms-seed',
    'system-mdms-seed',
    EXTRACT(EPOCH FROM NOW())::bigint * 1000,
    EXTRACT(EPOCH FROM NOW())::bigint * 1000
WHERE NOT EXISTS (
    SELECT 1 FROM eg_mdms_schema_definition
    WHERE tenantid='pg' AND code='tenant.tenants'
);

-- Minimal tenant rows (with city.code required by idgen)
INSERT INTO eg_mdms_data
    (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdBy, lastModifiedBy, createdTime, lastModifiedTime)
VALUES
    ('tenant-root', 'pg', 'Tenant.pg', 'tenant.tenants',
     '{"code":"pg","name":"Punjab","tenantId":"pg","city":{"code":"PB","name":"Punjab"}}', TRUE,
     'system-mdms-seed','system-mdms-seed',
     EXTRACT(EPOCH FROM NOW())::bigint * 1000,
     EXTRACT(EPOCH FROM NOW())::bigint * 1000),
    ('tenant-citya', 'pg', 'Tenant.pg.citya', 'tenant.tenants',
     '{"code":"pg.citya","name":"City A","tenantId":"pg.citya","parent":"pg","city":{"code":"CITYA","name":"City A"}}', TRUE,
     'system-mdms-seed','system-mdms-seed',
     EXTRACT(EPOCH FROM NOW())::bigint * 1000,
     EXTRACT(EPOCH FROM NOW())::bigint * 1000)
ON CONFLICT (tenantid, schemacode, uniqueidentifier) DO NOTHING;
