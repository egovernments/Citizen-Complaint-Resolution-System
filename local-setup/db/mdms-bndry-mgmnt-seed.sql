-- Seed CRS-ADMIN-CONSOLE.adminSchema for boundary management template generation
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'crs-admin-schema', 'pg', 'CRS-ADMIN-CONSOLE.adminSchema', 'CRS Admin Console Schema for boundary management',
'{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["title", "campaignType"],
  "x-unique": ["title"],
  "properties": {
    "title": {"type": "string", "minLength": 1, "maxLength": 200},
    "campaignType": {"type": "string", "minLength": 1, "maxLength": 100},
    "properties": {
      "type": "object",
      "properties": {
        "numberProperties": {"type": "array"},
        "stringProperties": {"type": "array"}
      },
      "additionalProperties": false
    }
  },
  "x-ref-schema": [],
  "additionalProperties": false
}'::jsonb,
TRUE, 'system-mdms-seed', 'system-mdms-seed',
EXTRACT(EPOCH FROM NOW())::bigint * 1000,
EXTRACT(EPOCH FROM NOW())::bigint * 1000
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition
  WHERE tenantid='pg' AND code='CRS-ADMIN-CONSOLE.adminSchema'
);

-- Seed CRS_BOUNDARY_DATA configuration for boundary template columns
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
VALUES
  ('crs-boundary-data', 'pg', 'CRS_BOUNDARY_DATA', 'CRS-ADMIN-CONSOLE.adminSchema',
   '{
     "title": "CRS_BOUNDARY_DATA",
     "campaignType": "all",
     "properties": {
       "numberProperties": [
         {
           "name": "CRS_LAT",
           "type": "number",
           "isRequired": true,
           "description": "Latitude",
           "orderNumber": 2
         },
         {
           "name": "CRS_LONG",
           "type": "number",
           "isRequired": true,
           "description": "Longitude",
           "orderNumber": 3
         }
       ],
       "stringProperties": [
         {
           "name": "CRS_BOUNDARY_CODE",
           "type": "string",
           "isRequired": true,
           "description": "Boundary Code",
           "orderNumber": 1,
           "freezeColumn": true
         }
       ]
     }
   }'::jsonb,
   TRUE, 'system-mdms-seed', 'system-mdms-seed',
   EXTRACT(EPOCH FROM NOW())::bigint * 1000,
   EXTRACT(EPOCH FROM NOW())::bigint * 1000)
ON CONFLICT (tenantid, schemacode, uniqueidentifier) DO NOTHING;
