-- Auto-generated mdms-v2 bootstrap script. Re-run generate_mdms_seed_sql.py whenever the source JSON files change.

BEGIN;

-- schema/ACCESSCONTROL-ROLEACTIONS.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6f234e53-9093-4d52-9230-5d9363272d93'::uuid, 'pg', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":true,"properties":{"code":{"default":"null","type":"string"},"displayName":{"type":"string"},"enabled":{"default":true,"type":"boolean"},"id":{"type":"number"},"leftIcon":{"type":"string"},"name":{"type":"string"},"navigationURL":{"type":"string"},"orderNumber":{"default":0,"type":"number"},"parentModule":{"type":"string"},"path":{"type":"string"},"rightIcon":{"type":"string"},"serviceCode":{"default":"","type":"string"},"url":{"type":"string"}},"required":["id","name","url","displayName","orderNumber","enabled","serviceCode","path"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["id"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'ACCESSCONTROL-ACTIONS-TEST.actions-test'
);

-- schema/ACCESSCONTROL-ROLEACTIONS.json :: ACCESSCONTROL-ROLEACTIONS.roleactions
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7d0afec9-2b73-493c-b31e-d69da0547ed9'::uuid, 'pg', 'ACCESSCONTROL-ROLEACTIONS.roleactions', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"$schema":"http://json-schema.org/draft-07/schema#","properties":{"actioncode":{"type":"string"},"actionid":{"type":"number"},"rolecode":{"type":"string"},"tenantId":{"type":"string"}},"required":["rolecode","actionid","tenantId"],"title":"Generated schema for Root","type":"object","x-ref-schema":[{"fieldPath":"rolecode","schemaCode":"ACCESSCONTROL-ROLES.roles"},{"fieldPath":"actionid","schemaCode":"ACCESSCONTROL-ACTIONS-TEST.actions-test"}],"x-unique":["rolecode","actionid"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'ACCESSCONTROL-ROLEACTIONS.roleactions'
);

-- schema/ACCESSCONTROL-ROLEACTIONS.json :: ACCESSCONTROL-ROLES.roles
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a759d955-8ce8-4191-9a41-7f7352d97642'::uuid, 'pg', 'ACCESSCONTROL-ROLES.roles', 'ACCESSCONTROL-ROLES.roles', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"code":{"type":"string"},"description":{"type":"string"},"name":{"type":"string"}},"required":["code","name"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'ACCESSCONTROL-ROLES.roles'
);

-- schema/common-masters.json :: common-masters.GenderType
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5641188f-b01c-4f3d-9d5d-b68a089d41ee'::uuid, 'pg', 'common-masters.GenderType', '  ', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"type":"boolean"},"code":{"type":"string"}},"required":["code","active"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'common-masters.GenderType'
);

-- schema/common-masters.json :: common-masters.IdFormat
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7c7f7775-130f-4b14-a4a0-dd9b99a33715'::uuid, 'pg', 'common-masters.IdFormat', '  ', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"format":{"type":"string"},"idname":{"type":"string"}},"required":["format","idname"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["idname"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'common-masters.IdFormat'
);

-- schema/common-masters.json :: common-masters.CronJobAPIConfig
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e8f92cf4-a4f8-4b07-8934-df99df7aabc3'::uuid, 'pg', 'common-masters.CronJobAPIConfig', '  ', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"type":"string"},"header":{"properties":{"Content-Type":{"type":"string"}},"required":["Content-Type"],"type":"object"},"jobName":{"type":"string"},"method":{"type":"string"},"payload":{"properties":{"RequestInfo":{"type":"string"}},"required":["RequestInfo"],"type":"object"},"url":{"type":"string"}},"required":["jobName","active","method","url","payload","header"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["jobName","url"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'common-masters.CronJobAPIConfig'
);

-- schema/common-masters.json :: common-masters.Department
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b3706d92-2050-40cc-b485-e1a4a426da96'::uuid, 'pg', 'common-masters.Department', '  ', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"default":true,"type":"boolean"},"code":{"type":"string"},"name":{"type":"string"}},"required":["name","code","active"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'common-masters.Department'
);

-- schema/common-masters.json :: common-masters.Designation
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4bba95a4-54ef-42f8-858e-d678eae8a2a3'::uuid, 'pg', 'common-masters.Designation', '  ', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"type":"boolean"},"code":{"type":"string"},"department":{"items":{"type":"string"},"type":"array"},"description":{"type":"string"},"name":{"type":"string"}},"required":["code","name","description","active"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'common-masters.Designation'
);

-- schema/common-masters.json :: common-masters.wfSlaConfig
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0233d7a8-f57b-45f1-a0db-b2f97ae4b5f2'::uuid, 'pg', 'common-masters.wfSlaConfig', '  ', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"middleSlabColor":{"type":"string"},"negativeSlabColor":{"type":"string"},"positiveSlabColor":{"type":"string"},"slotPercentage":{"type":"number"}},"required":["slotPercentage","positiveSlabColor","negativeSlabColor","middleSlabColor"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["slotPercentage"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'common-masters.wfSlaConfig'
);

-- schema/common-masters.json :: common-masters.StateInfo
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5ecdde1c-62ed-40e6-9944-5efc4298e00a'::uuid, 'pg', 'common-masters.StateInfo', '  ', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"bannerUrl":{"type":"string"},"code":{"type":"string"},"defaultUrl":{"type":"object"},"enableWhatsApp":{"type":"boolean"},"hasLocalisation":{"type":"boolean"},"languages":{"items":{"type":"object"},"type":"array"},"localizationModules":{"items":{"type":"object"},"type":"array"},"logoUrl":{"type":"string"},"logoUrlWhite":{"type":"string"},"name":{"type":"string"},"qrCodeURL":{"type":"string"},"statelogo":{"type":"string"}},"required":["name","code"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["name","code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'common-masters.StateInfo'
);

-- schema/common-masters.json :: common-masters.uiHomePage
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '236e18b9-1104-4e5d-b9d1-c1a935724cca'::uuid, 'pg', 'common-masters.uiHomePage', '  ', '{"$schema":"http://json-schema.org/draft-07/schema#","properties":{"appBannerDesktop":{"properties":{"bannerUrl":{"type":"string"},"code":{"type":"string"},"enabled":{"type":"boolean"},"name":{"type":"string"}},"required":["code","name","bannerUrl","enabled"],"type":"object"},"appBannerMobile":{"properties":{"bannerUrl":{"type":"string"},"code":{"type":"string"},"enabled":{"type":"boolean"},"name":{"type":"string"}},"required":["code","name","bannerUrl","enabled"],"type":"object"},"citizenServicesCard":{"properties":{"code":{"type":"string"},"enabled":{"type":"boolean"},"headerLabel":{"type":"string"},"name":{"type":"string"},"props":{"items":{"properties":{"code":{"type":"string"},"enabled":{"type":"boolean"},"label":{"type":"string"},"name":{"type":"string"},"navigationUrl":{"type":"string"}},"required":["code","name","label","enabled","navigationUrl"],"type":"object"},"type":"array"},"sideOption":{"properties":{"enabled":{"type":"boolean"},"name":{"type":"string"},"navigationUrl":{"type":"string"}},"required":["name","enabled","navigationUrl"],"type":"object"}},"required":["code","name","enabled","headerLabel","sideOption","props"],"type":"object"},"informationAndUpdatesCard":{"properties":{"code":{"type":"string"},"enabled":{"type":"boolean"},"headerLabel":{"type":"string"},"name":{"type":"string"},"props":{"items":{"properties":{"code":{"type":"string"},"enabled":{"type":"boolean"},"label":{"type":"string"},"name":{"type":"string"},"navigationUrl":{"type":"string"}},"required":["code","name","label","enabled","navigationUrl"],"type":"object"},"type":"array"},"sideOption":{"properties":{"enabled":{"type":"boolean"},"name":{"type":"string"},"navigationUrl":{"type":"string"}},"required":["name","enabled","navigationUrl"],"type":"object"}},"required":["code","name","enabled","headerLabel","sideOption","props"],"type":"object"},"redirectURL":{"type":"string"},"whatsAppBannerDesktop":{"properties":{"bannerUrl":{"type":"string"},"code":{"type":"string"},"enabled":{"type":"boolean"},"name":{"type":"string"},"navigationUrl":{"type":"string"}},"required":["code","name","bannerUrl","enabled","navigationUrl"],"type":"object"},"whatsAppBannerMobile":{"properties":{"bannerUrl":{"type":"string"},"code":{"type":"string"},"enabled":{"type":"boolean"},"name":{"type":"string"},"navigationUrl":{"type":"string"}},"required":["code","name","bannerUrl","enabled","navigationUrl"],"type":"object"},"whatsNewSection":{"properties":{"code":{"type":"string"},"enabled":{"type":"boolean"},"headerLabel":{"type":"string"},"name":{"type":"string"},"sideOption":{"properties":{"enabled":{"type":"boolean"},"name":{"type":"string"},"navigationUrl":{"type":"string"}},"required":["name","enabled","navigationUrl"],"type":"object"}},"required":["code","name","enabled","headerLabel","sideOption"],"type":"object"}},"required":["redirectURL"],"title":"Generated schema for Root","type":"object","x-unique":["redirectURL"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'common-masters.uiHomePage'
);

-- schema/DataSecurity.json :: DataSecurity.DecryptionABAC
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '64ba13dc-5b8b-47e0-9646-b2ab48fc81d1'::uuid, 'pg', 'DataSecurity.DecryptionABAC', 'DataSecurity.DecryptionABAC', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"key":{"type":"string"},"roleAttributeAccessList":{"items":{"properties":{"attributeAccessList":{"items":{"properties":{"accessType":{"type":"string"},"attribute":{"properties":{"jsonPath":{"type":"string"},"maskingTechnique":{"type":"string"}},"required":["jsonPath"],"type":"object"}},"required":["attribute","accessType"],"type":"object"},"type":"array"},"roleCode":{"type":"string"}},"required":["roleCode","attributeAccessList"],"type":"object"},"type":"array"}},"required":["key","roleAttributeAccessList"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["key"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'DataSecurity.DecryptionABAC'
);

-- schema/DataSecurity.json :: DataSecurity.EncryptionPolicy
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b7779eca-1c6b-47dc-a448-c807055ad9bb'::uuid, 'pg', 'DataSecurity.EncryptionPolicy', 'DataSecurity.EncryptionPolicy', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"attributeList":{"items":{"properties":{"jsonPath":{"type":"string"},"type":{"type":"string"}},"required":["jsonPath","type"],"type":"object"},"type":"array"},"key":{"type":"string"}},"required":["key","attributeList"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["key"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'DataSecurity.EncryptionPolicy'
);

-- schema/DataSecurity.json :: DataSecurity.MaskingPatterns
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7d22588c-8704-45a0-8b2a-9d7dbe6a9606'::uuid, 'pg', 'DataSecurity.MaskingPatterns', 'DataSecurity.MaskingPatterns', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"pattern":{"type":"string"},"patternId":{"type":"string"}},"required":["patternId","pattern"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["patternId"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'DataSecurity.MaskingPatterns'
);

-- schema/DataSecurity.json :: DataSecurity.SecurityPolicy
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ab2954d8-1bb5-4c01-a895-6ef95130e2d9'::uuid, 'pg', 'DataSecurity.SecurityPolicy', 'DataSecurity.SecurityPolicy', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"attributes":{"items":{"properties":{"defaultVisibility":{"type":"string"},"jsonPath":{"type":"string"},"name":{"type":"string"},"patternId":{"type":["string","null"]}},"required":["name","jsonPath","patternId","defaultVisibility"],"type":"object"},"type":"array"},"model":{"type":"string"},"roleBasedDecryptionPolicy":{"items":{"properties":{"attributeAccessList":{"items":{"properties":{"attribute":{"type":"string"},"firstLevelVisibility":{"type":"string"},"secondLevelVisibility":{"type":"string"}},"required":["attribute","firstLevelVisibility","secondLevelVisibility"],"type":"object"},"type":"array"},"roles":{"items":{"type":"string"},"type":"array"}},"required":["roles","attributeAccessList"],"type":"object"},"type":"array"},"uniqueIdentifier":{"properties":{"jsonPath":{"type":"string"},"name":{"type":"string"}},"required":["name","jsonPath"],"type":"object"}},"required":["model","uniqueIdentifier","attributes","roleBasedDecryptionPolicy"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["model"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'DataSecurity.SecurityPolicy'
);

-- schema/egov-hrms.json :: egov-hrms.DeactivationReason
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd42fb05a-7250-4780-a87b-3455e01d061a'::uuid, 'pg', 'egov-hrms.DeactivationReason', 'egov-hrms.DeactivationReason', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"type":"boolean"},"code":{"type":"string"}},"required":["code","active"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'egov-hrms.DeactivationReason'
);

-- schema/egov-hrms.json :: egov-hrms.Degree
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '81d8e3d0-6edd-4dd0-b737-5e12e5e396ab'::uuid, 'pg', 'egov-hrms.Degree', 'egov-hrms.Degree', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"type":"boolean"},"code":{"type":"string"}},"required":["code","active"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'egov-hrms.Degree'
);

-- schema/egov-hrms.json :: egov-hrms.EmployeeStatus
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '503b7082-b0b1-459a-9cf8-07e651ff54f9'::uuid, 'pg', 'egov-hrms.EmployeeStatus', 'egov-hrms.EmployeeStatus', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"type":"boolean"},"code":{"type":"string"}},"required":["code","active"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'egov-hrms.EmployeeStatus'
);

-- schema/egov-hrms.json :: egov-hrms.EmployeeType
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6b2371b7-f120-4677-9a9c-65e420202d84'::uuid, 'pg', 'egov-hrms.EmployeeType', 'egov-hrms.EmployeeType', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"type":"boolean"},"code":{"type":"string"}},"required":["code","active"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'egov-hrms.EmployeeType'
);

-- schema/egov-hrms.json :: egov-hrms.EmploymentTest
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fc912db2-1ce7-4479-8fb6-6b4429b86ed1'::uuid, 'pg', 'egov-hrms.EmploymentTest', 'egov-hrms.EmploymentTest', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"type":"boolean"},"code":{"type":"string"}},"required":["code","active"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'egov-hrms.EmploymentTest'
);

-- schema/egov-hrms.json :: egov-hrms.Specalization
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '53a5242c-6116-4eae-add9-59226b16950f'::uuid, 'pg', 'egov-hrms.Specalization', 'egov-hrms.Specalization', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"type":"boolean"},"code":{"type":"string"}},"required":["code","active"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'egov-hrms.Specalization'
);

-- schema/inbox-v2.json :: INBOX.InboxQueryConfiguration
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1523552a-512b-4e18-8a9f-d10c95642711'::uuid, 'pg', 'INBOX.InboxQueryConfiguration', '  ', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"allowedSearchCriteria":{"items":{"properties":{"isHashingRequired":{"type":"boolean"},"isMandatory":{"type":"boolean"},"name":{"type":"string"},"operator":{"type":"string"},"path":{"type":"string"}},"required":["name","path","isMandatory","operator"],"type":"object"},"type":"array"},"index":{"type":"string"},"module":{"type":"string"},"sortBy":{"properties":{"defaultOrder":{"type":"string"},"path":{"type":"string"}},"required":["path","defaultOrder"],"type":"object"},"sourceFilterPathList":{"items":{"type":"string"},"type":"array"}},"required":["module","index"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["module","index"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'INBOX.InboxQueryConfiguration'
);

-- schema/RAINMAKER-PGR.json :: RAINMAKER-PGR.ServiceDefs
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '22c1101e-c277-44f1-8c2d-4164641b6635'::uuid, 'pg', 'RAINMAKER-PGR.ServiceDefs', 'RAINMAKER-PGR.ServiceDefs', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"type":"boolean"},"department":{"type":"string"},"keywords":{"type":"string"},"menuPath":{"type":"string"},"name":{"type":"string"},"order":{"type":"number"},"serviceCode":{"type":"string"},"slaHours":{"type":"number"}},"required":["serviceCode","name","keywords","department","slaHours","active"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["serviceCode"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'RAINMAKER-PGR.ServiceDefs'
);

-- schema/RAINMAKER-PGR.json :: RAINMAKER-PGR.UIConstants
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c5f06aac-cb7f-4964-9f10-d0a934f66456'::uuid, 'pg', 'RAINMAKER-PGR.UIConstants', 'RAINMAKER-PGR.UIConstants', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"REOPENSLA":{"type":"number"}},"required":["REOPENSLA"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["REOPENSLA"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'RAINMAKER-PGR.UIConstants'
);

-- schema/tenant.json :: tenant.citymodule
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '53b24a7f-e787-4830-9696-1442f2f26c9b'::uuid, 'pg', 'tenant.citymodule', 'tenant.citymodule', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"type":"boolean"},"code":{"type":"string"},"module":{"type":"string"},"order":{"type":"number"},"tenants":{"items":{"properties":{"code":{"type":"string"}},"required":["code"],"type":"object"},"type":"array"}},"required":["module","code","active","order","tenants"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'tenant.citymodule'
);

-- schema/tenant.json :: tenant.tenants
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dd0ee25f-6127-4547-a21e-1a8922aa4f7c'::uuid, 'pg', 'tenant.tenants', 'tenant.tenants', '{"$schema":"http://json-schema.org/draft-07/schema#","properties":{"OfficeTimings":{"properties":{"Mon - Fri":{"type":"string"},"Sat":{"type":"string"}},"required":["Mon - Fri"],"type":"object"},"address":{"type":"string"},"centreType":{"type":"string"},"city":{"properties":{"blockCode":{"type":["string","null"]},"captcha":{"type":["string","null"]},"code":{"type":"string"},"ddrName":{"type":["string","null"]},"districtCode":{"type":["string","null"]},"districtName":{"type":["string","null"]},"districtTenantCode":{"type":"string"},"latitude":{"type":"number"},"localName":{"type":["string","null"]},"longitude":{"type":"number"},"name":{"type":"string"},"regionName":{"type":["string","null"]},"shapeFileLocation":{"type":["string","null"]},"ulbGrade":{"type":"string"}},"required":["name","districtName","districtTenantCode","ulbGrade","code"],"type":"object"},"code":{"type":"string"},"contactNumber":{"type":"string"},"description":{"type":["string","null"]},"domainUrl":{"type":"string"},"emailId":{"type":"string"},"facebookUrl":{"type":["string","null"]},"helpLineNumber":{"type":"string"},"imageId":{"type":["string","null"]},"logoId":{"type":"string"},"name":{"type":"string"},"pincode":{"items":{"type":"number"},"type":"array"},"twitterUrl":{"type":["string","null"]},"type":{"type":"string"}},"required":["code","name","domainUrl","type","imageId","emailId","OfficeTimings","city","address","contactNumber"],"title":"Generated schema for Root","type":"object","x-ui-schema":{"ui:order":["code","name","type","logoId","emailId","imageId","address","domainUrl","twitterUrl","facebookUrl","description","contactNumber","helpLineNumber","city","OfficeTimings"]},"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'tenant.tenants'
);

-- schema/Workflow.json :: Workflow.AutoEscalation
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd0163c8f-f303-4f7e-8c2b-b08b7090e968'::uuid, 'pg', 'Workflow.AutoEscalation', 'Workflow.AutoEscalation', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"action":{"type":"string"},"active":{"type":"string"},"businessSLA":{"type":"number"},"businessService":{"type":"string"},"module":{"type":"string"},"state":{"type":"string"},"stateSLA":{"type":"number"},"topic":{"type":"string"}},"required":["businessService","module","state","action","active","stateSLA","businessSLA","topic"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["state","businessService"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'Workflow.AutoEscalation'
);

-- schema/Workflow.json :: Workflow.AutoEscalationStatesToIgnore
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6e342785-460d-47ef-bd40-a2a1cfd21a80'::uuid, 'pg', 'Workflow.AutoEscalationStatesToIgnore', 'Workflow.AutoEscalationStatesToIgnore', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"businessService":{"type":"string"},"module":{"type":"string"},"state":{"items":{"type":"string"},"type":"array"}},"required":["businessService","module","state"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["businessService"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'Workflow.AutoEscalationStatesToIgnore'
);

-- schema/Workflow.json :: Workflow.BusinessService
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '316d40b8-adcd-4169-9ba4-b38e4e88c5c9'::uuid, 'pg', 'Workflow.BusinessService', 'Workflow.BusinessService', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"businessService":{"type":"string"},"getUri":{"type":"string"},"postUri":{"type":"string"},"states":{"items":{"properties":{"UpdateAllowed":{"type":"string"},"actions":{"items":{"properties":{"action":{"type":"string"},"nextStateId":{"type":"string"},"roles":{"type":"string"},"stateId":{"type":"string"},"tenantId":{"type":"string"},"uuid":{"type":"string"}},"required":["stateId","action","nextStateId","roles","tenantId","uuid"],"type":"object"},"type":"array"},"applicableActions":{"type":"string"},"applicableNextStates":{"type":"string"},"businessServiceId":{"type":"string"},"docUploadRequired":{"type":"string"},"isStartState":{"type":"string"},"isTerminateState":{"type":"string"},"state":{"type":"string"},"tenantId":{"type":"string"},"uuid":{"type":"string"}},"required":["businessServiceId","state","applicableNextStates","applicableActions","docUploadRequired","UpdateAllowed","isTerminateState","isStartState","uuid","tenantId","actions"],"type":"object"},"type":"array"},"tenantId":{"type":"string"},"uuid":{"type":"string"}},"required":["tenantId","uuid","businessService","getUri","postUri","states"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["businessService"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'Workflow.BusinessService'
);

-- schema/Workflow.json :: Workflow.BusinessServiceConfig
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a04cc6d7-c3cb-446a-a375-692acec18ed8'::uuid, 'pg', 'Workflow.BusinessServiceConfig', 'Workflow.BusinessServiceConfig', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"code":{"type":"string"},"isStateLevel":{"type":"boolean"}},"required":["code","isStateLevel"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["code"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'Workflow.BusinessServiceConfig'
);

-- schema/Workflow.json :: Workflow.BusinessServiceMasterConfig
INSERT INTO eg_mdms_schema_definition (id, tenantid, code, description, definition, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '65a21dce-d893-4dd8-b724-8a312b65e929'::uuid, 'pg', 'Workflow.BusinessServiceMasterConfig', 'Workflow.BusinessServiceMasterConfig', '{"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false,"properties":{"active":{"type":"string"},"businessService":{"type":"string"},"isStatelevel":{"type":"string"}},"required":["businessService","active","isStatelevel"],"title":"Generated schema for Root","type":"object","x-ref-schema":[],"x-unique":["businessService"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_schema_definition WHERE tenantid = 'pg' AND code = 'Workflow.BusinessServiceMasterConfig'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '98f44a61-20bd-4c91-b476-6d4fe20855cb'::uuid, 'pg', 'e81a8c25e53c4ce4cd89ea2233be2a87775822e9ff8f8100b25e32dcb46d445f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"mSeva Event Notification","enabled":false,"id":2568,"name":"mSeva Event Count","orderNumber":1,"path":"","serviceCode":"msea-event-notification","url":"/egov-user-event/v1/events/notifications/_count"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e81a8c25e53c4ce4cd89ea2233be2a87775822e9ff8f8100b25e32dcb46d445f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ce90d6f7-82d2-42c6-a714-6b86ec2bdfab'::uuid, 'pg', '79f1d542a073ce94767063af495130c43b31407f8967b75ea41c52450ee62cc2', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"mSeva Event Notification","enabled":false,"id":2567,"name":"mSeva Event Search","orderNumber":1,"path":"","serviceCode":"msea-event-notification","url":"/egov-user-event/v1/events/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '79f1d542a073ce94767063af495130c43b31407f8967b75ea41c52450ee62cc2'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0f2547f3-7fef-4adc-b651-2e8256d35cca'::uuid, 'pg', '49dd5af11f0ea198e851c3994a77a02a9e33d3b867fab18a4eb2acfcf66db3dc', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"","displayName":"My Complaints","enabled":true,"id":2566,"leftIcon":"PGRIcon","name":"CS_HOME_MY_COMPLAINTS","navigationURL":"/digit-ui/citizen/pgr/complaints","orderNumber":2,"parentModule":"PGR","path":"","queryParams":"","rightIcon":"","serviceCode":"","sidebar":"digit-ui-links","sidebarURL":"/digit-ui/citizen/pgr-home","url":"digit-ui-card"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '49dd5af11f0ea198e851c3994a77a02a9e33d3b867fab18a4eb2acfcf66db3dc'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0998198f-4f9d-43c8-b371-10e68b4a3258'::uuid, 'pg', 'dc379cd72dc1dc0a3319228853cec0d8b5185b5b818abda9b2367ed827283368', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"","displayName":"File a Complaint","enabled":true,"id":2565,"leftIcon":"PGRIcon","name":"CS_COMMON_FILE_A_COMPLAINT","navigationURL":"/digit-ui/citizen/pgr/create-complaint/complaint-type","orderNumber":1,"parentModule":"PGR","path":"","queryParams":"","rightIcon":"","serviceCode":"","sidebar":"digit-ui-links","sidebarURL":"/digit-ui/citizen/pgr-home","url":"digit-ui-card"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'dc379cd72dc1dc0a3319228853cec0d8b5185b5b818abda9b2367ed827283368'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '517f8289-0862-4b83-ab23-2eeca60e81b5'::uuid, 'pg', '7f58774e1bf2ce11d2fcb3248ce467494c82b42ae7c36ea71b1517593c0bfe6d', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search boundary relationship","enabled":false,"id":2564,"name":"Search boundary relationship","orderNumber":0,"path":"","serviceCode":"boundary-hierarchy","url":"/boundary-service/boundary-relationships/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '7f58774e1bf2ce11d2fcb3248ce467494c82b42ae7c36ea71b1517593c0bfe6d'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'bc4cd5fd-0244-4a6c-96fd-fccdb7e1e442'::uuid, 'pg', '4f090316cfef27c5758ddceab17324d9213ebf7302383c8218c21b01f77a8196', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create boundary relationship","enabled":false,"id":2563,"name":"Create boundary relationship","orderNumber":0,"path":"","serviceCode":"boundary-hierarchy","url":"/boundary-service/boundary-relationships/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '4f090316cfef27c5758ddceab17324d9213ebf7302383c8218c21b01f77a8196'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'da552b9e-5590-4d35-9c5b-d26d841d7553'::uuid, 'pg', '68659181e972034f462082554beba557e5f3ece26139deba640ebfc24649510c', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search boundary entity","enabled":false,"id":2562,"name":"Search boundary entity","orderNumber":0,"path":"","serviceCode":"boundary-hierarchy","url":"/boundary-service/boundary/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '68659181e972034f462082554beba557e5f3ece26139deba640ebfc24649510c'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #8
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0edd4ac3-f2b0-451f-bc5c-39bfdaeac476'::uuid, 'pg', 'abb6677354a96e6d0e33888ec87cdb784cfe108a874dce0b6066f7244c8d894f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create boundary entity","enabled":false,"id":2561,"name":"Create boundary entity","orderNumber":0,"path":"","serviceCode":"boundary-hierarchy","url":"/boundary-service/boundary/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'abb6677354a96e6d0e33888ec87cdb784cfe108a874dce0b6066f7244c8d894f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #9
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '11f97c13-6973-40a8-9969-91f7cf2d17d9'::uuid, 'pg', '87bf99731f22d13808acb2ea0154d6bb6e85b11407078da917d3f87dcce91330', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search boundary hierarchy","enabled":false,"id":2560,"name":"Search boundary hierarchy","orderNumber":0,"path":"","serviceCode":"boundary-hierarchy","url":"/boundary-service/boundary-hierarchy-definition/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '87bf99731f22d13808acb2ea0154d6bb6e85b11407078da917d3f87dcce91330'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #10
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fa75aa6c-16a8-4e6a-a92c-d1bde15fc040'::uuid, 'pg', '89b56d3d76b1a0609816c8024b330a7ce6f3cf634517b3684ad6a734b7cff1b8', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create boundary hierarchy","enabled":false,"id":2559,"name":"Create boundary hierarchy","orderNumber":0,"path":"","serviceCode":"boundary-hierarchy","url":"/boundary-service/boundary-hierarchy-definition/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '89b56d3d76b1a0609816c8024b330a7ce6f3cf634517b3684ad6a734b7cff1b8'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #11
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1c08579b-3d4e-49ca-9425-360372d1f23b'::uuid, 'pg', '1082be94c19b312e148189cfeec0a18ee7e139cbe7aa0690d1264df5a992e436', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"displayName":"Home","enabled":true,"id":4556,"leftIcon":"action:home","name":"Home","navigationURL":"/digit-ui/employee/","orderNumber":1,"parentModule":"rainmaker-pgr","path":"Home","queryParams":"","rightIcon":"","serviceCode":"PGR","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '1082be94c19b312e148189cfeec0a18ee7e139cbe7aa0690d1264df5a992e436'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #12
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '92dbc116-e44f-49cb-a59a-bb6f68b106d1'::uuid, 'pg', '5a4d18ea57e105ae29aad34a42f93dfefb253d9b056aa3373c6ccca01e42f3c8', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"displayName":"Home","enabled":true,"id":1648,"leftIcon":"Home","name":"Home","navigationURL":"/digit-ui/employee/","orderNumber":1,"parentModule":"workbench","path":"0Home","queryParams":"","rightIcon":"","serviceCode":"workbench","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '5a4d18ea57e105ae29aad34a42f93dfefb253d9b056aa3373c6ccca01e42f3c8'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #13
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd1e7d1c0-bc32-4117-9437-552274fcb8a4'::uuid, 'pg', 'b4591062801f7ddab786dca97236124852c8bb814d953db9f1b211fa9fa12fd0', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Inbox v2 video upload","enabled":false,"id":2558,"name":"Inbox Search for UI","orderNumber":0,"path":"","serviceCode":"inbox","url":"/inbox/v2/video/upload"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'b4591062801f7ddab786dca97236124852c8bb814d953db9f1b211fa9fa12fd0'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #14
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'afda92aa-1986-4666-9777-ec12e7d5140f'::uuid, 'pg', '85122f16fcd9a93076645b870205a62a7243bbebe85cbf832c47444aa9d1fa81', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Inbox v2 Search","enabled":true,"id":2557,"name":"Inbox Search for UI","orderNumber":0,"path":"","serviceCode":"inbox","url":"/inbox/v2/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '85122f16fcd9a93076645b870205a62a7243bbebe85cbf832c47444aa9d1fa81'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #15
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4860b3c0-9e60-4dce-ac35-7a7cfbb71542'::uuid, 'pg', '3dc531cc6234aafa9e243533d5b8bbce30fafbc19e95f027d2073bce47a83386', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Inbox Search","enabled":false,"id":2556,"name":"Inbox Search for UI","orderNumber":0,"path":"","serviceCode":"inbox","url":"/inbox/v2/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '3dc531cc6234aafa9e243533d5b8bbce30fafbc19e95f027d2073bce47a83386'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #16
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '094346fe-0410-40ee-80e8-cbea7a4e8dd9'::uuid, 'pg', '35ff41f5f271a54e6398726abb7f527e7ea34aad8c53a8f086f1237a840d12c7', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"IM Workflow Escalation Update","enabled":false,"id":2555,"name":"IM Workflow Escalation Update","orderNumber":1,"parentModule":"","path":"","serviceCode":"egov-workflow-v2","url":"/egov-workflow-v2/egov-wf/auto/Incident/_escalate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '35ff41f5f271a54e6398726abb7f527e7ea34aad8c53a8f086f1237a840d12c7'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #17
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '22f97146-a214-48e7-adb4-db91ffdba13c'::uuid, 'pg', 'b44a2dac094c2fae6199ad7dec0379d83c5eb55db50ae5a742baea0df1da3d58', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"New Ticket","enabled":true,"id":2554,"leftIcon":"action:announcement","name":"New Ticket","navigationURL":"/digit-ui/employee/im/incident/create","orderNumber":1,"parentModule":"rainmaker-pgr","path":"IM.New Ticket","rightIcon":"","serviceCode":"PGR","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'b44a2dac094c2fae6199ad7dec0379d83c5eb55db50ae5a742baea0df1da3d58'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #18
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fc46d8a1-1315-4fec-8e47-2c779eb0af78'::uuid, 'pg', '05f9eaca8d72bee1462a7be8afec5eac292c3abab7f0be621f81b34157023465', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Ticket","enabled":true,"id":2553,"leftIcon":"action:announcement","name":"Search Ticket","navigationURL":"/digit-ui/employee/im/inbox","orderNumber":1,"parentModule":"rainmaker-pgr","path":"IM.SearchTicket","rightIcon":"","serviceCode":"PGR","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '05f9eaca8d72bee1462a7be8afec5eac292c3abab7f0be621f81b34157023465'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #19
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c1bcd0a9-0567-4f76-b91f-d867714416d9'::uuid, 'pg', 'a7a291a0c128fd24acf13fdef713ff4caabb8ebc449c0e534059d6baf863fe8f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Count IM Request","enabled":false,"id":2551,"name":"Search IM Request","orderNumber":0,"parentModule":"","path":"","serviceCode":"im-services","url":"/im-services/v2/request/_count"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'a7a291a0c128fd24acf13fdef713ff4caabb8ebc449c0e534059d6baf863fe8f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #20
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '83791a6d-9add-4f41-957a-faf182234a4e'::uuid, 'pg', 'b52bbba82a40c126422ef2bdd8c3f95bed0ade1b075d840e917683c0556f176b', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Im Search","enabled":true,"id":2550,"name":"","orderNumber":1,"parentModule":"","path":"","serviceCode":"rainmaker-im","url":"/im-services/v2/request/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'b52bbba82a40c126422ef2bdd8c3f95bed0ade1b075d840e917683c0556f176b'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #21
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '61c0cb9d-8b94-454c-9e9a-a03c5cee4b8b'::uuid, 'pg', '5c921cc31ecbb62e03d3a78d996cfc3f35476ec278d146a0756208d05b9f3af3', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Im Update","enabled":true,"id":2549,"name":"","orderNumber":1,"parentModule":"","path":"","serviceCode":"rainmaker-im","url":"/im-services/v2/request/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '5c921cc31ecbb62e03d3a78d996cfc3f35476ec278d146a0756208d05b9f3af3'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #22
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e8da98d4-26e3-45de-9355-a933bc5a2c21'::uuid, 'pg', '4119dbcdaf52072d72afa74e594f996295c484c958eda9a4de1c1502e406b90b', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Im Create","enabled":true,"id":2548,"name":"","orderNumber":1,"parentModule":"","path":"","serviceCode":"rainmaker-im","url":"/im-services/v2/request/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '4119dbcdaf52072d72afa74e594f996295c484c958eda9a4de1c1502e406b90b'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #23
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7adb9ab6-2300-487a-a9df-7e6f4b6b62f9'::uuid, 'pg', 'aa956844a432c21c717fe8c1397601e430cf714cc57c4e83b2dcf2b1881893f9', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update ACCESSCONTROL-ROLES rolesroles","enabled":false,"id":2540,"name":"MDMS","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS","url":"/mdms-v2/v2/_update/ACCESSCONTROL-ROLES.rolesroles"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'aa956844a432c21c717fe8c1397601e430cf714cc57c4e83b2dcf2b1881893f9'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #24
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd001873f-b67b-43c1-a7a1-ca5195ec2c5a'::uuid, 'pg', '3c47a836e243649aaf17d21bc18d8bd82f8e83cd635969f6874f5b208faae405', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create AACCESSCONTROL-ROLES rolesroles","enabled":false,"id":2539,"name":"MDMS","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS","url":"/mdms-v2/v2/_create/ACCESSCONTROL-ROLES.rolesroles"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '3c47a836e243649aaf17d21bc18d8bd82f8e83cd635969f6874f5b208faae405'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #25
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '52393e20-009b-45e9-bf8e-2b595ff4e8bf'::uuid, 'pg', '61a6c028ad982a695cb98e7b7e23d4ea5b2fcf443686e9e2925a379eebe3fe2c', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Roleactions Roles","enabled":false,"id":2538,"leftIcon":"dynamic:ContractIcon","name":"MDMS","navigationURL":"/workbench-ui/employee/workbench/mdms-search-v2?moduleName=ACCESSCONTROL-ROLES&masterName=rolesroles","orderNumber":1,"parentModule":"","path":"9MDMS.ACCESSCONTROL-ROLESrolesroles","serviceCode":"MDMS","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '61a6c028ad982a695cb98e7b7e23d4ea5b2fcf443686e9e2925a379eebe3fe2c'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #26
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1ffa3be4-36a2-43bd-aeb0-1203d9034877'::uuid, 'pg', '5f9985b6f95ee8508d13b289b5b053150082b24855b6d5fb9a6933ee0f9a67e5', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update ACCESSCONTROL-ROLEACTIONS roleactions","enabled":false,"id":2537,"name":"MDMS","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS","url":"/mdms-v2/v2/_update/ACCESSCONTROL-ROLEACTIONS.roleactions"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '5f9985b6f95ee8508d13b289b5b053150082b24855b6d5fb9a6933ee0f9a67e5'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #27
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3b18036b-05ee-4130-9b4f-1cd53886a8ea'::uuid, 'pg', '7d8a587c546820b4f01257a8a310f31080b3052c13a544fe9c9f0b6de67d42f4', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create ACCESSCONTROL-ROLEACTIONS roleactions","enabled":false,"id":2536,"name":"MDMS","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS","url":"/mdms-v2/v2/_create/ACCESSCONTROL-ROLEACTIONS.roleactions"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '7d8a587c546820b4f01257a8a310f31080b3052c13a544fe9c9f0b6de67d42f4'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #28
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '31ef2272-c32e-46c2-ac96-41a499160466'::uuid, 'pg', '7f5a5297e271d66361caca18ee7e4039efdd57677b42d089a0c357ecdc599c80', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Roleactions","enabled":false,"id":2535,"leftIcon":"dynamic:ContractIcon","name":"MDMS","navigationURL":"/workbench-ui/employee/workbench/mdms-search-v2?moduleName=ACCESSCONTROL-ROLEACTIONS&masterName=roleactions","orderNumber":1,"parentModule":"","path":"9MDMS.ACCESSCONTROL-ROLEACTIONSroleactions","serviceCode":"MDMS","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '7f5a5297e271d66361caca18ee7e4039efdd57677b42d089a0c357ecdc599c80'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #29
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7f45fd44-8896-479d-8efc-86bc880a1a63'::uuid, 'pg', 'efe19a0e417c8ed1bb271d8ae1e1030c6d5f82288f51a74556582705aecbc6d7', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update ACCESSCONTROL-ROLES roles","enabled":false,"id":2534,"name":"MDMS","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS","url":"/mdms-v2/v2/_update/ACCESSCONTROL-ROLES.roles"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'efe19a0e417c8ed1bb271d8ae1e1030c6d5f82288f51a74556582705aecbc6d7'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #30
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9654c5a3-4c86-45d9-b4f3-c38ad22b5a66'::uuid, 'pg', '90d53a96889ad204b9a3746c2d710e4211e9a01ccacce075a407dacba7d02078', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create ACCESSCONTROL-ROLES roles","enabled":false,"id":2533,"name":"MDMS","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS","url":"/mdms-v2/v2/_create/ACCESSCONTROL-ROLES.roles"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '90d53a96889ad204b9a3746c2d710e4211e9a01ccacce075a407dacba7d02078'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #31
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '05c3e21b-fef2-4178-851f-227224aa7443'::uuid, 'pg', '7437ab4d5d1d5eedd3e3c652188430bdad53bb3375674fd5b32cd842d3087363', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Roles","enabled":false,"id":2532,"leftIcon":"dynamic:ContractIcon","name":"MDMS","navigationURL":"/workbench-ui/employee/workbench/mdms-search-v2?moduleName=ACCESSCONTROL-ROLES&masterName=roles","orderNumber":1,"parentModule":"","path":"9MDMS.ACCESSCONTROL-ROLESroles","serviceCode":"MDMS","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '7437ab4d5d1d5eedd3e3c652188430bdad53bb3375674fd5b32cd842d3087363'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #32
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '01a8c4f1-04e6-499c-b106-be3759857e77'::uuid, 'pg', '5dbc848a9f5070372f06cde233b45fbc0e599c7d3d7db3dd5073f3c8f7b62f5e', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update ACCESSCONTROL-ACTIONS-TEST actions-test","enabled":false,"id":2531,"name":"MDMS","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS","url":"/mdms-v2/v2/_update/ACCESSCONTROL-ACTIONS-TEST.actions-test"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '5dbc848a9f5070372f06cde233b45fbc0e599c7d3d7db3dd5073f3c8f7b62f5e'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #33
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '108243ed-2805-43e8-a8ed-b0e5ed0124b8'::uuid, 'pg', '6de38af6fb2eb085417cf1470317e056c632a7c59c39b8893932e860e5ae8682', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create ACCESSCONTROL-ACTIONS-TEST actions-test","enabled":false,"id":2530,"name":"MDMS","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS","url":"/mdms-v2/v2/_create/ACCESSCONTROL-ACTIONS-TEST.actions-test"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '6de38af6fb2eb085417cf1470317e056c632a7c59c39b8893932e860e5ae8682'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #34
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'aba6b226-315d-4eac-9968-a763fef40070'::uuid, 'pg', 'a162964dd0f44d86df3242f17e4f11466633674474ee932cd5a0fe6e720e0549', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Actions test","enabled":false,"id":2529,"leftIcon":"dynamic:ContractIcon","name":"MDMS","navigationURL":"/workbench-ui/employee/workbench/mdms-search-v2?moduleName=ACCESSCONTROL-ACTIONS-TEST&masterName=actions-test","orderNumber":1,"parentModule":"","path":"9MDMS.ACCESSCONTROL-ACTIONS-TESTactions-test","serviceCode":"MDMS","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'a162964dd0f44d86df3242f17e4f11466633674474ee932cd5a0fe6e720e0549'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #35
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '53d85624-5a4b-47a2-910a-3cc1f80c331f'::uuid, 'pg', '9b2c46c002b36633d8755c48be48c00794c032d0ce6b3a926409b780be111100', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update tenant tenants","enabled":false,"id":2528,"name":"MDMS","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS","url":"/mdms-v2/v2/_update/tenant.tenants"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '9b2c46c002b36633d8755c48be48c00794c032d0ce6b3a926409b780be111100'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #36
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f27e2cbd-c32a-4aa7-accb-8620b7f3b8ab'::uuid, 'pg', 'bc835bb2c0f31c6227c38e10ddb0472c1938a3b638bd428183b676ae4d5cfef7', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create tenant tenants","enabled":false,"id":2527,"name":"MDMS","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS","url":"/mdms-v2/v2/_create/tenant.tenants"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'bc835bb2c0f31c6227c38e10ddb0472c1938a3b638bd428183b676ae4d5cfef7'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #37
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'bdc2de97-f5a4-4f56-975f-4fb7f61077e1'::uuid, 'pg', 'f98482430a1f3feffa596a74ff539695771fde98adfb845c12dca854bfa15e6a', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Tenant","enabled":false,"id":2526,"leftIcon":"dynamic:ContractIcon","name":"MDMS","navigationURL":"/workbench-ui/employee/workbench/mdms-search-v2?moduleName=tenant&masterName=tenants","orderNumber":1,"parentModule":"","path":"9MDMS.tenanttenants","serviceCode":"MDMS","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f98482430a1f3feffa596a74ff539695771fde98adfb845c12dca854bfa15e6a'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #38
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5ea19fc0-0893-4613-a020-50285d9bf3de'::uuid, 'pg', 'b1fad33ac038b490a276b3670779633c4b8c73f5ab42d2118c25673b3f598c1f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"MDMS v2","enabled":false,"id":2516,"name":"MDMS v2 update data2","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS v2","url":"/mdms-v2/v2/_update/TradeLicense.Usagee"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'b1fad33ac038b490a276b3670779633c4b8c73f5ab42d2118c25673b3f598c1f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #39
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5b68dcf0-2a1e-4c27-8dac-3ed3895c4a12'::uuid, 'pg', '13c458f3a23c1a46d64276f96b594f1a9a069b3555f90cee580d02aa9e240a8f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"MDMS v2","enabled":true,"id":2515,"name":"MDMS v2 update data2","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS v2","url":"/mdms-v2/v2/_update/TradeLicense.Usage"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '13c458f3a23c1a46d64276f96b594f1a9a069b3555f90cee580d02aa9e240a8f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #40
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dc5ae65d-5793-46a6-beaa-4d64c045312b'::uuid, 'pg', 'd6edbe81822577c3aeda256dce21329f9b051c980f7fd7f3f9b6c55df9840eb4', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"MDMS v2","enabled":true,"id":2513,"name":"MDMS v2 (search v2)","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS v2","url":"/mdms-v2/v2/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd6edbe81822577c3aeda256dce21329f9b051c980f7fd7f3f9b6c55df9840eb4'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #41
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'bc2cb38c-a3c9-4f4c-b84f-76bfc0f93fbe'::uuid, 'pg', '4e6be0b482fb4b9b69e74f40127bf5df609c040382c93f4ff412efcd395ef984', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"MDMS v2","enabled":false,"id":2510,"name":"MDMS v2 Search","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS v2","url":"/mdms-v2/schema/v1/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '4e6be0b482fb4b9b69e74f40127bf5df609c040382c93f4ff412efcd395ef984'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #42
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b9949154-31e7-4e3f-a7a3-d9800746b986'::uuid, 'pg', 'd058ba2becebdad572f9c024f55a3aed1d9072b1d35c43756b1c9c5bfd2369fb', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"MDMS v2","enabled":false,"id":2509,"name":"MDMS v2 create","orderNumber":1,"parentModule":"","path":"","serviceCode":"MDMS v2","url":"/mdms-v2/schema/v1/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd058ba2becebdad572f9c024f55a3aed1d9072b1d35c43756b1c9c5bfd2369fb'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #43
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b8d63bb3-61d1-4d11-b932-a90a69d5a4cd'::uuid, 'pg', '03892ae8f418bf7e80bc777378fb7b29af7d623167a7ef7d1a0dcdbfd6aaf624', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"BND how it works","enabled":false,"id":2400,"name":"BND how it works","orderNumber":0,"path":"","serviceCode":"birth-death-services","url":"/filestore/v1/files/static"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '03892ae8f418bf7e80bc777378fb7b29af7d623167a7ef7d1a0dcdbfd6aaf624'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #44
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ac313e1c-7bea-4908-9032-4d2581afb65a'::uuid, 'pg', '511940f90355d827a724a3c6a7c9c77c793daa4834390a24f81fdf123126ac79', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Filestore Url","enabled":false,"id":2317,"name":"FilestoreUrl","orderNumber":1,"parentModule":"","path":"","serviceCode":"filestore url","url":"/filestore/v1/files"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '511940f90355d827a724a3c6a7c9c77c793daa4834390a24f81fdf123126ac79'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #45
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6796de8f-0d78-4bec-b77f-bead468f25e4'::uuid, 'pg', 'da0067a5e26b09a27b9aac6fdffaa1bd97ae800f29e570e076f8ec15892e3bed', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Workflow Escalation search","enabled":false,"id":2156,"name":"Workflow Escalation search","orderNumber":0,"parentModule":"","path":"","serviceCode":"egov-workflow-v2","url":"/egov-workflow-v2/egov-wf/escalate/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'da0067a5e26b09a27b9aac6fdffaa1bd97ae800f29e570e076f8ec15892e3bed'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #46
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fd6a337e-4eac-4ada-8309-75c8e59ceace'::uuid, 'pg', 'f18ccdfeff3e2828afd87dbab80af3f133a5be1662ce30573dd196bc09d17d04', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Employee Count","enabled":false,"id":2149,"name":"Employee Count","orderNumber":0,"parentModule":"egov-hrms","path":"","serviceCode":"egov-hrms","url":"/egov-hrms/employees/_count"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f18ccdfeff3e2828afd87dbab80af3f133a5be1662ce30573dd196bc09d17d04'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #47
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3c15b485-3682-462d-9784-878f26e68598'::uuid, 'pg', 'f585cdd29741f9d20b31baacb0034afff988e98e61b2c9eab8583896754efdf2', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Encrypt","enabled":false,"id":2086,"name":"Encrypt","orderNumber":1,"path":"Enc.Encrypt","serviceCode":"Enc","url":"/egov-enc-service/crypto/v1/_encrypt"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f585cdd29741f9d20b31baacb0034afff988e98e61b2c9eab8583896754efdf2'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #48
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd2242886-d042-45e3-92c9-72ee61fe2e0b'::uuid, 'pg', 'd4eeef6268adc1acabbcebf494549906ef5a625dbf9693683fbf0f2d60c1f6fd', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"MDMS GET","enabled":false,"id":2085,"name":"MDMS GET","orderNumber":0,"parentModule":"306","path":"","serviceCode":"MDMS GET","url":"/egov-mdms-service/v1/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd4eeef6268adc1acabbcebf494549906ef5a625dbf9693683fbf0f2d60c1f6fd'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #49
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0106c904-0477-4b11-b09a-2e828fa36a46'::uuid, 'pg', '776abd100cbf404fa6a8da61c4534d0bed4c0de6dbc69048be751b0d5d4875e7', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"All Complaints","enabled":false,"id":1555,"leftIcon":"custom:open-complaints","name":"AllComplaints","navigationURL":"/digit-ui/employee/pgr/inbox","orderNumber":1,"parentModule":"rainmaker-pgr","path":"AllComplaints","rightIcon":"","serviceCode":"PGR","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '776abd100cbf404fa6a8da61c4534d0bed4c0de6dbc69048be751b0d5d4875e7'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #50
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'bb2f4f4b-d71d-415c-87e5-cafbb93ac9be'::uuid, 'pg', '2a1ce72dbc025426b58f13b456a76aa623fb52eaacb3200f52d231b86ab8e54e', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"WS Payment search","enabled":false,"id":2036,"name":"WS Payment search","orderNumber":1,"parentModule":"","path":"","serviceCode":"","url":"/collection-services/payments/WS/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '2a1ce72dbc025426b58f13b456a76aa623fb52eaacb3200f52d231b86ab8e54e'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #51
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2127d544-dfcc-4c3f-a0c6-7acc6442439e'::uuid, 'pg', '68b070e0078777de4a05927e6082d2d68d9c2e98020ca76d75a17e82850bb214', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"FIRENOC Payment search","enabled":false,"id":2035,"name":"FIRENOC Payment search","orderNumber":1,"parentModule":"","path":"","serviceCode":"","url":"/collection-services/payments/FIRENOC/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '68b070e0078777de4a05927e6082d2d68d9c2e98020ca76d75a17e82850bb214'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #52
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '75056e20-4d60-4cf6-8186-1d6b634bd9f5'::uuid, 'pg', '4538f2125a64a85b0b6516924b93e8ecfdc3c8e891e243f2e2d9d9950e34c6ae', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"TL Payment search","enabled":false,"id":2034,"name":"TL Payment search","orderNumber":1,"parentModule":"","path":"","serviceCode":"","url":"/collection-services/payments/TL/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '4538f2125a64a85b0b6516924b93e8ecfdc3c8e891e243f2e2d9d9950e34c6ae'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #53
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9208fdd2-d5cb-427e-9d21-ab5d76e24757'::uuid, 'pg', '6babeb2b1ba10852d4d727a53b23408829a4d412b43f44d6b43b13503ee8e0eb', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"PT Payment search","enabled":false,"id":2033,"name":"PT Payment search","orderNumber":1,"parentModule":"","path":"","serviceCode":"","url":"/collection-services/payments/PT.MUTATION/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '6babeb2b1ba10852d4d727a53b23408829a4d412b43f44d6b43b13503ee8e0eb'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #54
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7c0e0bc1-638a-4e9e-9b8c-e169e5daa2ca'::uuid, 'pg', '3cc38ff6dd829041962c7e8fc7d54b72376c6a1e748e14bbfcf7b250b8aedbd8', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"BPA LOW Payment search","enabled":false,"id":2032,"name":"BPA LOW Payment search","orderNumber":1,"parentModule":"","path":"","serviceCode":"","url":"/collection-services/payments/BPA.LOW_RISK_PERMIT_FEE/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '3cc38ff6dd829041962c7e8fc7d54b72376c6a1e748e14bbfcf7b250b8aedbd8'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #55
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '68fea4a7-ba26-4d03-898c-0afb6356fe2c'::uuid, 'pg', '8e937caf7bbbf2c27f81929631176e57e1c6fa2ce4c7e9eab5de1bcecfdbb349', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"","displayName":"ReceiptCancellation","enabled":false,"id":2031,"leftIcon":"action:receipt","name":"ReceiptCancellation","navigationURL":"receipts/search","orderNumber":25,"parentModule":"","path":"receipts","queryParams":"","rightIcon":"","serviceCode":"","url":"card"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '8e937caf7bbbf2c27f81929631176e57e1c6fa2ce4c7e9eab5de1bcecfdbb349'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #56
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '89be7eaa-a9fa-4381-9662-0966a56b6760'::uuid, 'pg', '5170d59abc3e80c841dcd0e592f9e78c53a748d6a9ec8d31f2543dea063e63e5', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"ReceiptCancellation","enabled":false,"id":2030,"leftIcon":"action:receipt","name":"ReceiptCancellation","navigationURL":"receipts/search","orderNumber":24,"parentModule":"","path":"","serviceCode":"","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '5170d59abc3e80c841dcd0e592f9e78c53a748d6a9ec8d31f2543dea063e63e5'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #57
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '85643d9c-c22b-4f91-9784-08a25e6e7dc0'::uuid, 'pg', '86e5411e25e6407392a7574b74dc23c7ebcb9718e00a607df9e6f4b5b8f5e501', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"PT Payment search","enabled":false,"id":2029,"name":"PT Payment search","orderNumber":1,"parentModule":"","path":"","serviceCode":"","url":"/collection-services/payments/PT/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '86e5411e25e6407392a7574b74dc23c7ebcb9718e00a607df9e6f4b5b8f5e501'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #58
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '601c55b8-58a1-4ff1-9b9c-f3126917a719'::uuid, 'pg', 'cf66a328bcf1a5ded10f5e6efe3d770286cd2478cdc65e4882418e5b04ca51e4', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"PT Receipt Update","enabled":false,"id":2028,"name":"PT Receipt Update","orderNumber":1,"parentModule":"","path":"","serviceCode":"","url":"/collection-services/payments/PT/_workflow"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'cf66a328bcf1a5ded10f5e6efe3d770286cd2478cdc65e4882418e5b04ca51e4'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #59
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '02a3bf59-1ae2-4fe2-8ccc-d75c3075978e'::uuid, 'pg', '32fd518cfa5936f50f51efca5c48cdd387f35b794e03664f422abe19df473e06', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Workflow Count","enabled":false,"id":2027,"name":"WorkflowProcessCount","orderNumber":1,"parentModule":"","path":"","serviceCode":"","url":"/egov-workflow-v2/egov-wf/process/_count"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '32fd518cfa5936f50f51efca5c48cdd387f35b794e03664f422abe19df473e06'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #60
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '007cf714-c330-4dad-b506-bcfc90e45db4'::uuid, 'pg', '5938b92ef92629300659d3c8dcd64a4b087f95ee6d32a448e28dc68dfd3548c2', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"BillAmendment","enabled":false,"id":2024,"leftIcon":"action:receipt","name":"BillAmendment","navigationURL":"bill-amend/search","orderNumber":23,"parentModule":"","path":"","serviceCode":"","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '5938b92ef92629300659d3c8dcd64a4b087f95ee6d32a448e28dc68dfd3548c2'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #61
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a9b009bc-72a1-49d2-96bb-5204f4a65b21'::uuid, 'pg', 'd0723b5e3d9ac8d48065790f434833d5bd402c81b8b105b401a224f251db2b26', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Add adhoc tax","enabled":false,"id":2023,"name":"Add adhoc tax to sewerage","orderNumber":0,"path":"","serviceCode":"sw-calculator","url":"/sw-calculator/sewerageCalculator/_applyAdhocTax"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd0723b5e3d9ac8d48065790f434833d5bd402c81b8b105b401a224f251db2b26'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #62
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5fdde95d-4d61-4010-8348-adf200990c0e'::uuid, 'pg', 'ce217b6025b10ace137a2c966d14dd3b2be9561f4f0af89b1be4e9ad1145523c', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Add adhoc tax","enabled":false,"id":2022,"name":"Add adhoc tax","orderNumber":0,"path":"","serviceCode":"ws-calculator","url":"/ws-calculator/waterCalculator/_applyAdhocTax"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'ce217b6025b10ace137a2c966d14dd3b2be9561f4f0af89b1be4e9ad1145523c'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #63
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '255cdb2d-b4e1-4802-9813-979d21e4737d'::uuid, 'pg', '2e295cce3c7f2017854ffb65bd3ba0d0582106de53aa264f976e63e60d3e2560', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"PGR Report","enabled":false,"id":2021,"name":"GROPerformanceReport","orderNumber":0,"path":"PGR Report","serviceCode":"PGRReports","url":"/report/pgr/GROPerformanceReport/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '2e295cce3c7f2017854ffb65bd3ba0d0582106de53aa264f976e63e60d3e2560'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #64
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e43fc098-e28a-4bbf-b59d-b3b81c1c1658'::uuid, 'pg', '981d0e15382f0d67cec3e7970d15c556419be8be8e9256dc03a6fea90fb8a3f9', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"PGR Report","enabled":false,"id":2020,"name":"LMEPerformanceReport","orderNumber":0,"path":"PGR Report","serviceCode":"PGRReports","url":"/report/pgr/LMEPerformanceReport/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '981d0e15382f0d67cec3e7970d15c556419be8be8e9256dc03a6fea90fb8a3f9'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #65
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '144f95c1-8720-46c8-aa54-97dde13c01e8'::uuid, 'pg', 'e3bbca4bbfafde3516ab24ea59b3e251d27e1d49684073ed96e95da0e4faa444', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"PGR Report","enabled":false,"id":2019,"name":"DescriptionReport","orderNumber":0,"path":"PGR Report","serviceCode":"PGRReports","url":"/report/pgr/DescriptionReport/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e3bbca4bbfafde3516ab24ea59b3e251d27e1d49684073ed96e95da0e4faa444'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #66
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '056aadc7-c7ec-4444-a4a1-14fc5c216037'::uuid, 'pg', '07bdb9dc175e308841894d1746b1e9ae8743442c72d156f523c9379165b33a0a', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"PGR Report","enabled":false,"id":2018,"name":"ULBReport","orderNumber":0,"path":"PGR Report","serviceCode":"PGRReports","url":"/report/pgr/ULBReport/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '07bdb9dc175e308841894d1746b1e9ae8743442c72d156f523c9379165b33a0a'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #67
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '805ae7a7-916e-43d1-915b-d99c4af2a52b'::uuid, 'pg', 'd7f73f2cbab14ec87355f97fa52899ced39f9709ad828a09023d85183e71fad7', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Rainmaker PGR report","enabled":false,"id":2017,"name":"PGR-GROPerformanceReport-Metadata","orderNumber":1,"parentModule":"147","path":"PGR Report","serviceCode":"PGRReports","url":"/report/pgr/GROPerformanceReport/metadata/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd7f73f2cbab14ec87355f97fa52899ced39f9709ad828a09023d85183e71fad7'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #68
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '18cde675-4fdc-446d-817b-b0ab00aed592'::uuid, 'pg', '9d994fb376da0240b5f37e1624688991e168b14805a4b5f2b82352591b5a9382', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Rainmaker PGR report","enabled":false,"id":2016,"name":"PGR-LMEPerformanceReport-Metadata","orderNumber":1,"parentModule":"147","path":"PGR Report","serviceCode":"PGRReports","url":"/report/pgr/LMEPerformanceReport/metadata/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '9d994fb376da0240b5f37e1624688991e168b14805a4b5f2b82352591b5a9382'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #69
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4d135627-a3b1-45b5-b69c-3c089e96b125'::uuid, 'pg', '3aed961045b93d8f60be5e8f8bf22eff8734aed10a7e45b4b153bd2a7a2c33e8', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Rainmaker PGR report","enabled":false,"id":2015,"name":"PGR-ULBReport-Metadata","orderNumber":1,"parentModule":"147","path":"PGR Report","serviceCode":"PGRReports","url":"/report/pgr/ULBReport/metadata/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '3aed961045b93d8f60be5e8f8bf22eff8734aed10a7e45b4b153bd2a7a2c33e8'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #70
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '239357a8-46e2-428d-88cf-7f10259a263f'::uuid, 'pg', '87ef60971173e58d0be9ff03db6e968f496440772e71544c85c400ba010c6d7d', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Rainmaker PGR report","enabled":false,"id":2014,"name":"PGR-DescriptionReport-Metadata","orderNumber":1,"parentModule":"147","path":"PGR Report","serviceCode":"PGRReports","url":"/report/pgr/DescriptionReport/metadata/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '87ef60971173e58d0be9ff03db6e968f496440772e71544c85c400ba010c6d7d'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #71
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '10d6dcb3-621c-47fc-bf03-03d15356eb3e'::uuid, 'pg', 'e7c2ce6b9e1800bc02431457044b0c685e29c02194e8f5466dde3f9eedb06f9d', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"GRO Performance Report","enabled":false,"id":2013,"leftIcon":"action:assignment","name":"GROPerformanceReport","navigationURL":"report/pgr/GROPerformanceReport","orderNumber":6,"parentModule":"pgr","path":"Complaints.PGR Reports.GROPerformanceReport","rightIcon":"","serviceCode":"PGR","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e7c2ce6b9e1800bc02431457044b0c685e29c02194e8f5466dde3f9eedb06f9d'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #72
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8f89b756-0c41-4ba7-8d96-7f6c9667fa54'::uuid, 'pg', 'f43d8ef843489909d34e78d44c33f941e5cfa68bb20478947cd8cafeb022b925', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"LME Performance Report","enabled":false,"id":2012,"leftIcon":"action:assignment","name":"LMEPerformanceReport","navigationURL":"report/pgr/LMEPerformanceReport","orderNumber":6,"parentModule":"pgr","path":"Complaints.PGR Reports.LMEPerformanceReport","rightIcon":"","serviceCode":"PGR","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f43d8ef843489909d34e78d44c33f941e5cfa68bb20478947cd8cafeb022b925'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #73
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '883fb365-b8cf-4f48-93a8-8553ec721f79'::uuid, 'pg', 'ad515e7a5678b18bdf1f2f2a50ff363c6be01908bd5fc90486fbe0edee71d022', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Description Report","enabled":false,"id":2025,"leftIcon":"action:assignment","name":"DescriptionReport","navigationURL":"report/pgr/DescriptionReport","orderNumber":6,"parentModule":"pgr","path":"Complaints.PGR Reports.DescriptionReport","rightIcon":"","serviceCode":"PGR","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'ad515e7a5678b18bdf1f2f2a50ff363c6be01908bd5fc90486fbe0edee71d022'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #74
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c035cbc7-eee6-4520-be80-5b71f81455ba'::uuid, 'pg', 'd020b04dbabd90aae70aa05b26536c9a77c9d11bff94b53d00b8669c25a7a781', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"ULB Report","enabled":false,"id":2026,"leftIcon":"action:assignment","name":"ULBReport","navigationURL":"report/pgr/ULBReport","orderNumber":6,"parentModule":"pgr","path":"Complaints.PGR Reports.ULBReport","rightIcon":"","serviceCode":"PGR","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd020b04dbabd90aae70aa05b26536c9a77c9d11bff94b53d00b8669c25a7a781'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #75
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9ab4d2de-a4e0-423c-a046-11bfead9570a'::uuid, 'pg', '1fca001c4ac090488ff7677a1ca82ac1a98ed3e6a9d9257df2003aadd214b283', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Count PGR Request","enabled":false,"id":2009,"name":"Search PGR Request","orderNumber":0,"parentModule":"","path":"","serviceCode":"pgr-services","url":"/pgr-services/v2/request/_count"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '1fca001c4ac090488ff7677a1ca82ac1a98ed3e6a9d9257df2003aadd214b283'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #76
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '89e82efb-c5b2-45bd-a1ad-657d33fb6882'::uuid, 'pg', '09124d06961e5b657a9813fc586486be1013b693af0e6c0ec856da1c7c247e88', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search PGR Request","enabled":false,"id":2008,"name":"Search PGR Request","orderNumber":0,"parentModule":"","path":"","serviceCode":"pgr-services","url":"/pgr-services/v2/request/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '09124d06961e5b657a9813fc586486be1013b693af0e6c0ec856da1c7c247e88'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #77
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '045347e2-8d89-4b13-a9cf-c388405ad822'::uuid, 'pg', '86665da0a458a4414649bdb1d23cf43f880051987581b3794298fa3145d8f441', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update PGR Request","enabled":false,"id":2007,"name":"Update PGR Request","orderNumber":0,"parentModule":"","path":"","serviceCode":"pgr-services","url":"/pgr-services/v2/request/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '86665da0a458a4414649bdb1d23cf43f880051987581b3794298fa3145d8f441'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #78
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '40489f54-f46d-429b-901d-833f7ab14f84'::uuid, 'pg', '6db0181592a75d133170c77acfc75cd32a106aa04f4f80be894bf191e96384dd', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create PGR Request","enabled":false,"id":2006,"name":"Create PGR Request","orderNumber":0,"parentModule":"","path":"","serviceCode":"pgr-services","url":"/pgr-services/v2/request/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '6db0181592a75d133170c77acfc75cd32a106aa04f4f80be894bf191e96384dd'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #79
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b52fa966-2749-49e1-955f-65135b8f6eb6'::uuid, 'pg', 'fdbf60ec93a1e5981a867ea6f6148f3f823e7f2124ba81e1f57d72f473019281', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Noc locality searcher","enabled":false,"id":2005,"name":"Locality searcher endpoint for Noc Servcies","orderNumber":0,"path":"","serviceCode":"egov-searcher","url":"/egov-searcher/locality/noc-services/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'fdbf60ec93a1e5981a867ea6f6148f3f823e7f2124ba81e1f57d72f473019281'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #80
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '608c4390-28a6-405c-a9da-99269f0f5cd0'::uuid, 'pg', '4741cc08fb6e17aac8dd9b7d21f8daaf656e56fd756520bd67dda5f35a6d6344', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"createdBy":null,"createdDate":null,"displayName":"Search NOC Application","enabled":false,"id":2004,"lastModifiedBy":null,"lastModifiedDate":null,"leftIcon":"communication:business","name":"search NOC application","navigationURL":"noc/search","orderNumber":1,"parentModule":"","path":"Noc.Search NOC Application","queryParams":"","quickAction":false,"rightIcon":"","serviceCode":"","tenantId":"pg","url":"quickAction"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '4741cc08fb6e17aac8dd9b7d21f8daaf656e56fd756520bd67dda5f35a6d6344'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #81
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2a8ad7bd-7942-4027-887f-9b76e303381d'::uuid, 'pg', '7a996c3f381abcd68e5befdc2e90c2c90fc83d513df6e6fe899bef8aa1365cc0', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update","enabled":false,"id":2003,"name":"NOC Update","orderNumber":0,"path":"","serviceCode":"NOC","url":"/noc-services/v1/noc/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '7a996c3f381abcd68e5befdc2e90c2c90fc83d513df6e6fe899bef8aa1365cc0'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #82
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e78e51f9-5493-4471-b5cd-10e7acf53f78'::uuid, 'pg', '9325f16d80a37de13d1675a20f75eecedc9b8b40afef1dc9275e33502b89eda8', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search","enabled":false,"id":2002,"name":"NOC Search","orderNumber":0,"path":"","serviceCode":"NOC","url":"/noc-services/v1/noc/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '9325f16d80a37de13d1675a20f75eecedc9b8b40afef1dc9275e33502b89eda8'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #83
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9c45c0cd-1aff-4dbc-a86a-508e82acba18'::uuid, 'pg', 'bfb73101aab1c7e8e7dca18c5771251c971347a63aaa55ec79d511dad47a2021', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create","enabled":false,"id":2001,"name":"NOC Create","orderNumber":0,"path":"","serviceCode":"NOC","url":"/noc-services/v1/noc/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'bfb73101aab1c7e8e7dca18c5771251c971347a63aaa55ec79d511dad47a2021'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #84
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0fc8a662-1646-4ce6-9b4b-72d0efd2cbfb'::uuid, 'pg', 'f20831f23dbc05f2e199588c6c567e3762aec212a9de95bb08e69d10b4212d28', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Localization Messages Search","enabled":false,"id":2000,"name":"LocalizationMessagesSearch","orderNumber":1,"parentModule":"","path":"","serviceCode":"localisation search","url":"/localization/messages/v2/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f20831f23dbc05f2e199588c6c567e3762aec212a9de95bb08e69d10b4212d28'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #85
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4a5e3af0-8541-40ec-af37-3e4c9ed0eb3e'::uuid, 'pg', 'afa53de83b0b9087a21a9a6be61ddc3fd189904668c6956d785603d310e5ad6a', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Land Search","enabled":false,"id":1990,"name":"BPA-Land-Search","orderNumber":0,"path":"","serviceCode":"BPA","url":"/land-services/v1/land/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'afa53de83b0b9087a21a9a6be61ddc3fd189904668c6956d785603d310e5ad6a'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #86
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '92b5f6ce-3627-4e2a-b456-f0a847d6e566'::uuid, 'pg', '942993bdcc78e5f9d38b69c3f2044c143229122868135efc1e4bfcf0e14da033', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Land Update","enabled":false,"id":1989,"name":"BPA-Land-Update","orderNumber":0,"path":"","serviceCode":"BPA","url":"/land-services/v1/land/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '942993bdcc78e5f9d38b69c3f2044c143229122868135efc1e4bfcf0e14da033'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #87
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '55206cd1-cbbe-4c3a-8a84-bfc50232a788'::uuid, 'pg', '09a49349e773bbd2105e860dbf48869fbd7ee16f03c64c4f1585e486a9cb0a3f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Land Create","enabled":false,"id":1988,"name":"BPA-Land-Create","orderNumber":0,"path":"","serviceCode":"BPA","url":"/land-services/v1/land/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '09a49349e773bbd2105e860dbf48869fbd7ee16f03c64c4f1585e486a9cb0a3f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #88
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '008a647f-52c8-42ae-b095-252272bb9ae5'::uuid, 'pg', '107c4cffdbb4f6a42031f167b05f728431e8e1d641ce0e277dfc64475d87980f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"ptreceipt search","enabled":false,"id":1999,"name":"ptreceipt search","orderNumber":9,"path":"","serviceCode":"egov-pdf","url":"/egov-pdf/download/PT/ptreceipt"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '107c4cffdbb4f6a42031f167b05f728431e8e1d641ce0e277dfc64475d87980f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #89
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '01b90aea-1c46-4ca9-9940-64a700545bda'::uuid, 'pg', '26e0554bb2b40c787674651f49bad1175f9c2c633204cfc253e3c52a3fdaacd3', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"ptbill search","enabled":false,"id":1998,"name":"ptbill search","orderNumber":8,"path":"","serviceCode":"egov-pdf","url":"/egov-pdf/download/PT/ptbill"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '26e0554bb2b40c787674651f49bad1175f9c2c633204cfc253e3c52a3fdaacd3'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #90
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8f5158a7-2dcc-4927-bd31-d67111268846'::uuid, 'pg', '263b64cdf8a86d4856abf6772040a7e273d59a00688bb780984f58058f0a46fe', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"ptmutationcertificate search","enabled":false,"id":1997,"name":"ptmutationcertificate search","orderNumber":7,"path":"","serviceCode":"egov-pdf","url":"/egov-pdf/download/PT/ptmutationcertificate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '263b64cdf8a86d4856abf6772040a7e273d59a00688bb780984f58058f0a46fe'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #91
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9693d385-98dd-42f3-a4d7-03e4e87833cd'::uuid, 'pg', '067b8048393b6356491d717d86d39955e550545e15540fbdd59a34491afda15e', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"tlbill search","enabled":false,"id":1996,"name":"tlbill search","orderNumber":6,"path":"","serviceCode":"egov-pdf","url":"/egov-pdf/download/TL/tlbill"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '067b8048393b6356491d717d86d39955e550545e15540fbdd59a34491afda15e'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #92
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '905ce33a-254b-4b4d-9a75-30020f14082c'::uuid, 'pg', '0505913c0826444facde8eeea9357e1662e40ad807d14d668e083ac985cfed6d', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"tlrenewalcertificate search","enabled":false,"id":1995,"name":"tlrenewalcertificate search","orderNumber":5,"path":"","serviceCode":"egov-pdf","url":"/egov-pdf/download/TL/tlrenewalcertificate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '0505913c0826444facde8eeea9357e1662e40ad807d14d668e083ac985cfed6d'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #93
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a2147713-aeae-40a1-b95c-5b550d285cb4'::uuid, 'pg', '3396c08d8af059c311555527c9f2dec2f5713a89ce5fb598708727542f863c46', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"tlcertificate search","enabled":false,"id":1994,"name":"tlcertificate search","orderNumber":4,"path":"","serviceCode":"egov-pdf","url":"/egov-pdf/download/TL/tlcertificate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '3396c08d8af059c311555527c9f2dec2f5713a89ce5fb598708727542f863c46'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #94
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9395769c-74fb-4e4e-ac16-6b2abd5f98f3'::uuid, 'pg', 'e14f3b60123d5237931702c21189b389d5aae58b03104c48373ec9121853757e', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"tlreceipt search","enabled":false,"id":1993,"name":"tlreceipt search","orderNumber":3,"path":"","serviceCode":"egov-pdf","url":"/egov-pdf/download/TL/tlreceipt"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e14f3b60123d5237931702c21189b389d5aae58b03104c48373ec9121853757e'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #95
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6b116c44-d60c-4d38-9c30-2e4b074b5f46'::uuid, 'pg', '7ebc0a4fadda3ffaac8c7b6491441576c737b61ff746e8507ea7c587c105de43', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"consolidatedbill search","enabled":false,"id":1992,"name":"consolidatedbill search","orderNumber":2,"path":"","serviceCode":"egov-pdf","url":"/egov-pdf/download/BILL/consolidatedbill"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '7ebc0a4fadda3ffaac8c7b6491441576c737b61ff746e8507ea7c587c105de43'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #96
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fd351f62-c33f-46cc-9507-9ded2510a312'::uuid, 'pg', 'ab9c00bc8c774ceab12308526cac77567f622ff360abdad4db61ba8c9b05d144', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"consolidatedreceipt search","enabled":false,"id":1991,"name":"consolidatedreceipt search","orderNumber":1,"path":"","serviceCode":"egov-pdf","url":"/egov-pdf/download/PAYMENT/consolidatedreceipt"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'ab9c00bc8c774ceab12308526cac77567f622ff360abdad4db61ba8c9b05d144'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #97
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b703ba75-b82a-4352-aa16-f63f52af00de'::uuid, 'pg', 'e7780c627f9d23454fad7511b2ddf3530f4f7a4fe538d980a40af62e06c88af1', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"WS-Service locality searcher","enabled":false,"id":1985,"name":"Locality searcher endpoint for WS","orderNumber":0,"path":"","serviceCode":"egov-searcher","url":"/egov-searcher/locality/ws-services/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e7780c627f9d23454fad7511b2ddf3530f4f7a4fe538d980a40af62e06c88af1'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #98
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2efb0027-dc48-4a8f-987b-61754881f197'::uuid, 'pg', '6eb7d6aef91f602ecfdc7eef12ebdec11c7a103105504104c45e6173275e6530', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"SW-Service locality searcher","enabled":false,"id":1984,"name":"Locality searcher endpoint for SW","orderNumber":0,"path":"","serviceCode":"egov-searcher","url":"/egov-searcher/locality/sw-services/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '6eb7d6aef91f602ecfdc7eef12ebdec11c7a103105504104c45e6173275e6530'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #99
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '752c08ce-82c8-4cea-accc-c7a25a517122'::uuid, 'pg', '9f146af2da7d2cd84703364a32429fe7dd2e697c5b3a57b76420ec4a399617f5', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Remittance Pending Report","enabled":false,"id":1983,"leftIcon":"editor:insert-chart","name":"Remittance Pending Report","navigationURL":"services/EGF/report/remittance/pending/form","orderNumber":6,"parentModule":"","path":"Finance.Reports.Revenue Reports.Remittance Pending Report","serviceCode":"FinanceReport","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '9f146af2da7d2cd84703364a32429fe7dd2e697c5b3a57b76420ec4a399617f5'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #100
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a4f0630d-bcf4-49c3-8781-26855fcb6d24'::uuid, 'pg', '5ec49b4785bc460d261b6ae8243b09ec93cf7e3fe7bf5367857280bcb2d92c55', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Dishonored Cheque Report ","enabled":false,"id":1982,"leftIcon":"editor:insert-chart","name":"Dishonored Cheque Report ","navigationURL":"services/collection/report/dishonouredcheque/searchform","orderNumber":7,"parentModule":"","path":"Finance.Reports.MIS Reports.Dishonored Cheque Report","serviceCode":"FinanceReport","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '5ec49b4785bc460d261b6ae8243b09ec93cf7e3fe7bf5367857280bcb2d92c55'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #101
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2bd1d751-2ed2-43d2-9a3b-bd5c7291d405'::uuid, 'pg', 'ec888fb5df5c36bbb5e62ac3281e0f65c375747b6ceb3025f4aa7099549eb068', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Dishonor Cheque/DD","enabled":false,"id":1981,"leftIcon":"editor:insert-chart","name":"Dishonor Cheque/DD","navigationURL":"services/collection/dishonour/cheque/form","orderNumber":1,"parentModule":"","path":"Finance.Administration.Dishonor Cheque/DD","serviceCode":"FinanceAdmin","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'ec888fb5df5c36bbb5e62ac3281e0f65c375747b6ceb3025f4aa7099549eb068'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #102
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '42d41b67-11e5-4419-94cc-cc61515cf48b'::uuid, 'pg', '9f82520721b655c1af1293e23e25d01ccf88b276cf57f8ee6f51026c5196ae70', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"","displayName":"Localization","enabled":false,"id":1980,"leftIcon":"places:business-center","name":"rainmaker-localization-screen","navigationURL":"integration/ui-localisation/localization","orderNumber":5,"parentModule":"","path":"Localization","queryParams":"","rightIcon":"","serviceCode":"","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '9f82520721b655c1af1293e23e25d01ccf88b276cf57f8ee6f51026c5196ae70'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #103
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '369d4063-6ff0-4dcc-b9c4-6fd011ba08ce'::uuid, 'pg', '11883c487532c574a8e4926757e2b621f1190ac0b4bf44b9a0e5628e26bd7898', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Remittance Collection Report","enabled":false,"id":1979,"leftIcon":"editor:insert-chart","name":"Remittance Collection Report","navigationURL":"services/EGF/report/remittance/collection/form","orderNumber":6,"parentModule":"","path":"Finance.Reports.Revenue Reports.Remittance Collection Report","serviceCode":"FinanceReport","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '11883c487532c574a8e4926757e2b621f1190ac0b4bf44b9a0e5628e26bd7898'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #104
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4c5fd8c4-c6ae-4f6c-9ef0-5210c02a71c2'::uuid, 'pg', '89ba6a7c9544b8f0dbdef9dd8aa85ee093739a471a3b9d29e040a781f7045971', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Migrate Property v1 to v2","enabled":false,"id":1978,"name":"Migrate Property v1 to v2","orderNumber":5,"path":"","serviceCode":"property-services","url":"/property-services/property/_migration"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '89ba6a7c9544b8f0dbdef9dd8aa85ee093739a471a3b9d29e040a781f7045971'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #105
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6b66a5c4-23d0-43fa-b3bc-00e1ba22245f'::uuid, 'pg', '7e6c6979b900fc38b168c6d32cb79527767c7169a584a7426066a720caa59236', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"DSS","enabled":false,"id":1977,"name":"Dashboard Payments-v1","orderNumber":0,"parentModule":"","path":"","serviceCode":"DSS","url":"/dashboard-ingest/ingest/migrate/paymentsindex-v1/v2"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '7e6c6979b900fc38b168c6d32cb79527767c7169a584a7426066a720caa59236'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #106
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5fd4abb2-c445-480d-9837-49d5b64dcc9d'::uuid, 'pg', '50c8f964d01b8954ddf648f4c497162d7bf62a43df83230c6761926956ca0663', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"BPA locality searcher","enabled":false,"id":1976,"name":"Locality searcher endpoint for BPA","orderNumber":0,"path":"","serviceCode":"egov-searcher","url":"/egov-searcher/locality/BPAREG/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '50c8f964d01b8954ddf648f4c497162d7bf62a43df83230c6761926956ca0663'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #107
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '55f0e7e0-50f7-48d8-a079-6437ee6c7e63'::uuid, 'pg', 'ba5f68b3fe1d79179c93cb984a674980f8ab1d512e23fa95c78635e386322dc6', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"BPA locality searcher","enabled":false,"id":1975,"name":"Locality searcher endpoint for BPA","orderNumber":0,"path":"","serviceCode":"egov-searcher","url":"/egov-searcher/locality/bpa-services/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'ba5f68b3fe1d79179c93cb984a674980f8ab1d512e23fa95c78635e386322dc6'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #108
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd242fb75-6c5c-43be-9dc5-ed11298d8efb'::uuid, 'pg', '0bc960e0cbe1d9877f8176abb71e13243e64169304608f566d1fed2b0254f4f1', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Apply","enabled":false,"id":1972,"name":"BPA-PermitOrderEDCR Report","orderNumber":0,"path":"","serviceCode":"BPA","url":"/bpa-services/v1/bpa/_permitorderedcr"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '0bc960e0cbe1d9877f8176abb71e13243e64169304608f566d1fed2b0254f4f1'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #109
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8dda6e03-f5ff-4bb7-ada7-5b06095d210d'::uuid, 'pg', 'e0e68956c8af9dc87fea0560c559b54c360aa5099f2ce671d1dcc27bce2f5ed9', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Reopening Closed Period","enabled":false,"id":1971,"leftIcon":"editor:insert-chart","name":"Reopening Closed Period","navigationURL":"services/EGF/closedperiod/search/reopen","orderNumber":4,"parentModule":"","path":"Finance.Period End Activities.Close Period","serviceCode":"FinanceMaster","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e0e68956c8af9dc87fea0560c559b54c360aa5099f2ce671d1dcc27bce2f5ed9'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #110
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fa76889c-a9a1-41d7-a3a7-ccaf55f97ad5'::uuid, 'pg', 'd4f91bc74b6d0c37512faa3561b20543054269117db43195953280ddf69aea76', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"DSS","enabled":false,"id":1970,"name":"Dashboard Payments-v1","orderNumber":0,"parentModule":"","path":"","serviceCode":"DSS","url":"/dashboard-ingest/ingest/paymentsindex-v1/v2"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd4f91bc74b6d0c37512faa3561b20543054269117db43195953280ddf69aea76'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #111
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '96a8d685-a31c-4802-8863-a93dd68e4639'::uuid, 'pg', 'e144b449c8931281f342806bd4e2032dcb643ff4c40fe80e6f4554a9ce57f04e', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"PT locality searcher","enabled":false,"id":1969,"name":"Locality searcher endpoint for PT Service","orderNumber":0,"path":"","serviceCode":"egov-searcher","url":"/egov-searcher/locality/pt-services/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e144b449c8931281f342806bd4e2032dcb643ff4c40fe80e6f4554a9ce57f04e'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #112
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3c7ed834-a5ae-407f-9d57-088e204756bc'::uuid, 'pg', '879326e1d0e483d425cf8069507c4b7ae39e9c6c03899cf09d3616aeafbeafac', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"PT locality searcher","enabled":false,"id":1968,"name":"Locality searcher endpoint for PT","orderNumber":0,"path":"","serviceCode":"egov-searcher","url":"/egov-searcher/locality/PT/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '879326e1d0e483d425cf8069507c4b7ae39e9c6c03899cf09d3616aeafbeafac'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #113
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fd86ec7a-0321-4942-9060-78d175c7cf26'::uuid, 'pg', '4404becdfb295e6e3c8d58513e034ad06a25678ea278f66fab1d36afda1acfdc', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"DSS","enabled":false,"id":1965,"name":"Dashboard Api W&S to update","orderNumber":0,"parentModule":"","path":"","serviceCode":"DSS","url":"/dashboard-ingest/update/publish"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '4404becdfb295e6e3c8d58513e034ad06a25678ea278f66fab1d36afda1acfdc'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #114
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cabcccc1-42ee-4649-8876-5bd12ee09601'::uuid, 'pg', 'aff148a55b2e3d5fc086ac84dabf90d5351bd9f2df3fd75f1f218e8be79786ca', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"DSS","enabled":false,"id":1964,"name":"Dashboard Static Upload","orderNumber":0,"parentModule":"","path":"","serviceCode":"DSS","url":"/dashboard-ingest/ingest/upload"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'aff148a55b2e3d5fc086ac84dabf90d5351bd9f2df3fd75f1f218e8be79786ca'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #115
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cc97e972-ff99-41f4-ac79-0d6dc7908d53'::uuid, 'pg', 'f8b97705c03ad54ce8621e9e4460a6f90f4e23ab8b16a503dd53dcf260796133', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"DSS","enabled":false,"id":1963,"name":"Dashboard collectionsindex-v1","orderNumber":0,"parentModule":"","path":"","serviceCode":"DSS","url":"/dashboard-ingest/ingest/migrate/collectionsindex-v1/v1"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f8b97705c03ad54ce8621e9e4460a6f90f4e23ab8b16a503dd53dcf260796133'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #116
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd846be73-6700-4c06-bc5a-6c7824d79470'::uuid, 'pg', 'd1ba7c26fc75e25563dd37da68701c409c11cad1a343be4ba6d742e5f1ab4a97', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Fee Calculation For Sewerage Application","enabled":false,"id":1967,"name":"Calculate Fee For Sewerage Application","orderNumber":0,"path":"","serviceCode":"sw-calculator","url":"/sw-calculator/sewerageCalculator/_estimate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd1ba7c26fc75e25563dd37da68701c409c11cad1a343be4ba6d742e5f1ab4a97'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #117
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '34ff7c0a-606c-40f2-9d4a-cc185e203661'::uuid, 'pg', 'cc08b5937bc638db7380cd77d2cb98a7c0d54833c069504520559c0a5ff24ae4', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Fee Calculation For Water Application","enabled":false,"id":1966,"name":"Calculate Fee For Water Application","orderNumber":0,"path":"","serviceCode":"ws-calculator","url":"/ws-calculator/waterCalculator/_estimate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'cc08b5937bc638db7380cd77d2cb98a7c0d54833c069504520559c0a5ff24ae4'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #118
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f961ad5b-7d2e-4d40-9710-be21a3d2dc8d'::uuid, 'pg', 'e6caedcaf853a3c1d4930e7c18396670db753e27dca90db3ca506557372a6704', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Sewerage Bill","enabled":false,"id":1961,"name":"Search Sewerage Bill","orderNumber":2,"path":"","serviceCode":"Searcher","url":"/egov-searcher/bill-genie/seweragebills/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e6caedcaf853a3c1d4930e7c18396670db753e27dca90db3ca506557372a6704'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #119
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '798beaf6-1511-425b-8e92-af67e5dd00b7'::uuid, 'pg', '680bfbc7e508754d15af02a4e269d413c31877cd7074ed669de64f8b1d96f02c', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Water Bill","enabled":false,"id":1960,"name":"Search Water Bill","orderNumber":1,"path":"","serviceCode":"Searcher","url":"/egov-searcher/bill-genie/waterbills/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '680bfbc7e508754d15af02a4e269d413c31877cd7074ed669de64f8b1d96f02c'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #120
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '85e8a795-99d0-47cb-ad7f-04cc61e4d34e'::uuid, 'pg', 'd515c2ad87ab7ea1906095007820de8f94047b79d7e4521a9520a1f4379dc122', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Surrendered Cheque","enabled":false,"id":1959,"leftIcon":"editor:insert-chart","name":"Surrendered Cheque","navigationURL":"services/EGF/report/cheque/surrendered/form","orderNumber":6,"parentModule":"","path":"Finance.Reports.MIS Reports.Surrendered Cheque","serviceCode":"FinanceReport","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd515c2ad87ab7ea1906095007820de8f94047b79d7e4521a9520a1f4379dc122'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #121
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '474bcefb-089e-475f-9e3c-282ff92c16dc'::uuid, 'pg', '0b64afb8da01c2461b8789c91c4042bc63b39ae65dbf9c9bf5b9d2c067ec92da', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"","displayName":"SURE Dashboard","enabled":false,"id":1958,"leftIcon":"places:business-center","name":"rainmaker-common-wns","navigationURL":"integration/dss/home","orderNumber":2,"parentModule":"","path":"","queryParams":"","rightIcon":"","serviceCode":"integration","url":"card"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '0b64afb8da01c2461b8789c91c4042bc63b39ae65dbf9c9bf5b9d2c067ec92da'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #122
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5631133a-1c9f-4dd9-a68b-e0627aec1ed7'::uuid, 'pg', '3d555802754448a3de0864749845fa963ae9b4c0a5fb37b530347a3a84f409f6', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Mutation Billing Slab Update","enabled":false,"id":1956,"name":"MutationBillingSlabUpdate","orderNumber":1,"parentModule":"","path":"","serviceCode":"pt-calculator-v2","url":"/pt-calculator-v2/billingslab/mutation/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '3d555802754448a3de0864749845fa963ae9b4c0a5fb37b530347a3a84f409f6'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #123
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '461f28cc-44f2-4bdc-90c9-9b20731291c5'::uuid, 'pg', '2219641ead956d537b4f34690a5e82722ceefebd7b6824c7526bad7ce58c00b4', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Draft Search","enabled":false,"id":1955,"name":"MutationBillingSlabSearch","orderNumber":1,"parentModule":"","path":"","serviceCode":"pt-calculator-v2","url":"/pt-calculator-v2/billingslab/mutation/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '2219641ead956d537b4f34690a5e82722ceefebd7b6824c7526bad7ce58c00b4'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #124
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '549d42d5-37ab-48ba-9456-d799581b0dbd'::uuid, 'pg', '9588b0da6767a59cdfc63d7d4e9dc3d1295207bbc32938913a5d74c1d3c5a7f4', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Draft Search","enabled":false,"id":1954,"name":"MutationBillingSlabCreate","orderNumber":1,"parentModule":"","path":"","serviceCode":"pt-calculator-v2","url":"/pt-calculator-v2/billingslab/mutation/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '9588b0da6767a59cdfc63d7d4e9dc3d1295207bbc32938913a5d74c1d3c5a7f4'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #125
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'aea5104f-8f5c-4a18-a975-b4718c0f871c'::uuid, 'pg', 'bfafa4145b0897b0d79821d3bc1b0a7c15384981538969814e601c1d38140696', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"createdBy":null,"createdDate":null,"displayName":"Search Application","enabled":false,"id":1950,"lastModifiedBy":null,"lastModifiedDate":null,"leftIcon":"communication:business","name":"search BPA application","navigationURL":"egov-bpa/search","orderNumber":1,"parentModule":"","path":"Building Plan Approval.Search Application","queryParams":"","quickAction":false,"rightIcon":"","serviceCode":"","tenantId":"pg","url":"quickAction"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'bfafa4145b0897b0d79821d3bc1b0a7c15384981538969814e601c1d38140696'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #126
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'edf18d67-2907-4a92-bc26-8ff215b4a15d'::uuid, 'pg', '0372f3a4b5288fffad59bb6c2997ba9631c71abaa2cbdc0f4b71e79f4f106e5e', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Overview","enabled":false,"id":1949,"leftIcon":"places:business-center","name":"Dashboard Overview","navigationURL":"integration/dss/overview","orderNumber":3,"parentModule":"dss-dashboard","path":"Dashboard.Overview","rightIcon":"","serviceCode":"DSS","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '0372f3a4b5288fffad59bb6c2997ba9631c71abaa2cbdc0f4b71e79f4f106e5e'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #127
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2fd250d1-8857-4051-81c0-59569add468d'::uuid, 'pg', '84e1804d3687190b32c020278c7a8284d8aaca23e8a6ca94671fb39b927b9658', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"DSS","enabled":false,"id":1948,"name":"DSS Dashboard Config Overview","orderNumber":0,"parentModule":"","path":"","serviceCode":"DSS","url":"/dashboard-analytics/dashboard/getDashboardConfig/overview"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '84e1804d3687190b32c020278c7a8284d8aaca23e8a6ca94671fb39b927b9658'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #128
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '082505a9-173c-4448-87cc-5cae594055a3'::uuid, 'pg', 'e53144c1b9477037ff513cf735750a009856d899d0a76b94554442c117297963', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"","displayName":"eDCR Scrutiny","enabled":false,"id":1947,"leftIcon":"custom:edcr","name":"rainmaker-citizen-edcrscrutiny","navigationURL":"edcrscrutiny/home","orderNumber":1,"parentModule":"","path":"","queryParams":"","rightIcon":"","serviceCode":"","url":"card"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e53144c1b9477037ff513cf735750a009856d899d0a76b94554442c117297963'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #129
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '646aeb09-dd38-4468-ba32-232d8a88d611'::uuid, 'pg', '96bafbed1a33670ac21089862c7d11cbe3540a0dc6abe95be0fa275f1eaecbf9', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update Assessment Registry","enabled":false,"id":1944,"name":"Update Assessment registry","orderNumber":1,"path":"","serviceCode":"property-services","url":"/property-services/assessment/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '96bafbed1a33670ac21089862c7d11cbe3540a0dc6abe95be0fa275f1eaecbf9'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #130
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'efa06e13-a638-4709-a019-c4af9299492f'::uuid, 'pg', 'd20d2fbd70e312afe0dcfbeea1a564d16a301b9e1c97b72b6584741d14be588d', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create Assessment Registry","enabled":false,"id":1943,"name":"Create Assessment registry","orderNumber":1,"path":"","serviceCode":"property-services","url":"/property-services/assessment/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd20d2fbd70e312afe0dcfbeea1a564d16a301b9e1c97b72b6584741d14be588d'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #131
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ee93bdff-bca4-4dc2-b4a1-ae0352cd8dff'::uuid, 'pg', '6bd9b17aee1ff29763835efab3e42e8cd1b1135386b0166bf20e83befe2a5e9d', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"PGR","enabled":false,"id":1923,"leftIcon":"places:business-center","name":"Dashboard PGR","navigationURL":"integration/dss/pgr","orderNumber":6,"parentModule":"dss-dashboard","path":"Dashboard.PGR","rightIcon":"","serviceCode":"DSS","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '6bd9b17aee1ff29763835efab3e42e8cd1b1135386b0166bf20e83befe2a5e9d'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #132
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f9c532b1-abf0-4f78-9e12-3f153d19a708'::uuid, 'pg', 'a24f7136fafbdbea75536a9264406a4da063c1de6fe73e524f6bdd2d92f1c2bc', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"BPA locality searcher","enabled":false,"id":1942,"name":"Locality searcher endpoint for BPA Reg","orderNumber":0,"path":"","serviceCode":"egov-searcher","url":"/egov-searcher/locality/BPAREG/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'a24f7136fafbdbea75536a9264406a4da063c1de6fe73e524f6bdd2d92f1c2bc'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #133
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '29919993-33b1-4f84-9d33-372c661b66ec'::uuid, 'pg', '89bbb9887612ff4cb4cc95d74d9fa4e0ae9a82602b0859ce604ea749fc9f254c', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Sewerage Calculation","enabled":false,"id":1941,"name":"Sewerage Calculation","orderNumber":0,"path":"","serviceCode":"sw-calculator","url":"/sw-calculator/sewerageCalculator/_calculate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '89bbb9887612ff4cb4cc95d74d9fa4e0ae9a82602b0859ce604ea749fc9f254c'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #134
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0a1b778d-4251-49b7-a5af-70b9acec18a6'::uuid, 'pg', 'aab55ff105a51ac24c2803d123167cb576f9a195848f9dcf1f521c6a14ad18f5', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Sewerage Connection","enabled":false,"id":1940,"name":"Search Sewerage Connection","orderNumber":0,"path":"","serviceCode":"sw-services","url":"/sw-services/swc/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'aab55ff105a51ac24c2803d123167cb576f9a195848f9dcf1f521c6a14ad18f5'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #135
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1bc81e54-5610-4a39-a029-5d73ae4ec048'::uuid, 'pg', 'f57c20cd56436db45c5b00a3159afff499ae52fcc137002ecd727533c2ed8820', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update Sewerage Connection","enabled":false,"id":1939,"name":"Update Sewerage Connection","orderNumber":0,"path":"","serviceCode":"sw-services","url":"/sw-services/swc/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f57c20cd56436db45c5b00a3159afff499ae52fcc137002ecd727533c2ed8820'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #136
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ab7d88aa-3728-4fb4-b3c9-794bfaf43fa1'::uuid, 'pg', '4a50f7b69482f4c3b34db00f23f25ab1adbf5701a54b4ad2a1d2495a17269584', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create Sewerage Connection","enabled":false,"id":1938,"name":"Create Sewerage Connection","orderNumber":0,"path":"","serviceCode":"sw-services","url":"/sw-services/swc/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '4a50f7b69482f4c3b34db00f23f25ab1adbf5701a54b4ad2a1d2495a17269584'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #137
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f4c75707-76dc-4110-8a51-aeac54749da7'::uuid, 'pg', 'e28db5fa684a6e354617fdc64538d58377d156e18ba490d94561a5dba790dfbb', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Calculate Water Bill","enabled":false,"id":1937,"name":"Calculate Water Bill","orderNumber":0,"path":"","serviceCode":"ws-calculator","url":"/ws-calculator/waterCalculator/_calculate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e28db5fa684a6e354617fdc64538d58377d156e18ba490d94561a5dba790dfbb'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #138
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '65cb3139-64d2-491d-894f-1e6cd6b7b592'::uuid, 'pg', '928fff950997bf8013bc49f7ef20fb5d4dfe89755ca7b9999725a0f91934112d', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Meter Reading","enabled":false,"id":1936,"name":"Search Meter Reading","orderNumber":0,"path":"","serviceCode":"ws-calculator","url":"/ws-calculator/meterConnection/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '928fff950997bf8013bc49f7ef20fb5d4dfe89755ca7b9999725a0f91934112d'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #139
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ccc4301d-f6b8-411f-93a3-dbebadc17336'::uuid, 'pg', '85ea2a5f6762400fbc87bdbc8e7b0f71f999fd645a03c8bf5910fe9d933449b1', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Enter Meter Reading","enabled":false,"id":1935,"name":"Enter Meter Reading","orderNumber":0,"path":"","serviceCode":"ws-calculator","url":"/ws-calculator/meterConnection/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '85ea2a5f6762400fbc87bdbc8e7b0f71f999fd645a03c8bf5910fe9d933449b1'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #140
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b7ccf439-1c9c-42f8-b13e-2dae0c50428a'::uuid, 'pg', '86e20e7278924ba42975315a8dbe53907a92d8acbd4a87bc659177c2cc5b95c4', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update Water COnnection","enabled":false,"id":1901,"name":"Update Water Connection","orderNumber":0,"path":"","serviceCode":"ws-services","url":"/ws-services/wc/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '86e20e7278924ba42975315a8dbe53907a92d8acbd4a87bc659177c2cc5b95c4'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #141
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8b9b011d-bb14-4400-ad16-1b6367c307a9'::uuid, 'pg', '7fd5f1a51609443b93466f989b6595505308ecc499ad0158f0027d295cc40fee', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Water COnnection","enabled":false,"id":1900,"name":"Search Water Connection","orderNumber":0,"path":"","serviceCode":"ws-services","url":"/ws-services/wc/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '7fd5f1a51609443b93466f989b6595505308ecc499ad0158f0027d295cc40fee'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #142
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '061acf73-4fdb-4c12-84dc-c2cb9fc5c0db'::uuid, 'pg', 'f13dfb48c36bfa00ede176ad64a2484e8016d2308e419b30bc0d757537ad20ad', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create Water COnnection","enabled":false,"id":1899,"name":"Create Water Connection","orderNumber":0,"path":"","serviceCode":"ws-services","url":"/ws-services/wc/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f13dfb48c36bfa00ede176ad64a2484e8016d2308e419b30bc0d757537ad20ad'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #143
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '61ba68b6-f880-4866-813f-a514421b3161'::uuid, 'pg', 'ddedb9bfa4b36da260f12d240534e3d95c961ef1be9432fa3b0126d596dc49ec', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"FIRENOC locality searcher","enabled":false,"id":1934,"name":"Locality searcher endpoint for PT","orderNumber":0,"path":"","serviceCode":"egov-searcher","url":"/egov-searcher/locality/fireNoc/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'ddedb9bfa4b36da260f12d240534e3d95c961ef1be9432fa3b0126d596dc49ec'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #144
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ab5285ef-1b2e-4689-98d4-5f628616acc6'::uuid, 'pg', 'a035f31ae449de1759d88ab2eaf1ca0f4f7337f51ab76b02b23dc89df868e59f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"TL locality searcher","enabled":false,"id":1933,"name":"Locality searcher endpoint for TL","orderNumber":0,"path":"","serviceCode":"egov-searcher","url":"/egov-searcher/locality/tl-services/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'a035f31ae449de1759d88ab2eaf1ca0f4f7337f51ab76b02b23dc89df868e59f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #145
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c9821f41-819f-41d3-8515-da28b82b97cf'::uuid, 'pg', '076484c72c59b2b0eed70dc10efa5f7892d3e2542c6be6c5c0f02e3b857519ad', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Fire Noc","enabled":false,"id":1932,"leftIcon":"social:people","name":"FIRE-NOC","navigationURL":"fire-noc/search","orderNumber":3,"parentModule":"","path":"FIRE-NOC.Search","serviceCode":"FIRE-NOC","url":"quickAction"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '076484c72c59b2b0eed70dc10efa5f7892d3e2542c6be6c5c0f02e3b857519ad'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #146
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'aa0bde22-5d27-4a7f-bba1-d0210527a44f'::uuid, 'pg', '2e0be3469a06892cce1993e65b40d77935181c52ed172197c41f3578715a82b0', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Apply TL","enabled":false,"id":1929,"leftIcon":"places:business-center","name":"TradeLicenseApplication","navigationURL":"/digit-ui/employee/tl/new-application","orderNumber":13,"parentModule":"","path":"TradeLicense.Apply","serviceCode":"TradeLicense","url":"quickAction"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '2e0be3469a06892cce1993e65b40d77935181c52ed172197c41f3578715a82b0'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #147
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd945b5d5-952d-4575-844b-379aaec07c09'::uuid, 'pg', '9750dae737866b66b02568e1151f2a8ba83da588f4614e6b679b1458c3e3a4b3', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"","displayName":"Search TL","enabled":false,"id":1928,"leftIcon":"places:business-center","name":"rainmaker-common-tradelicence","navigationURL":"/digit-ui/employee/tl/inbox","orderNumber":2,"parentModule":"","path":"","queryParams":"","rightIcon":"","serviceCode":"","url":"quickAction"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '9750dae737866b66b02568e1151f2a8ba83da588f4614e6b679b1458c3e3a4b3'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #148
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5262530c-4338-40b3-84b9-a237678d6aa7'::uuid, 'pg', 'e638e96367b684e96357934bcf87b745e19d07be78a1f93e736d47953a5d7f10', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"","displayName":"Search Complaints","enabled":false,"id":1927,"leftIcon":"action:announcement","name":"rainmaker-common-complaints","navigationURL":"/digit-ui/employee/pgr/inbox","orderNumber":2,"parentModule":"","path":"","queryParams":"","rightIcon":"","serviceCode":"","url":"quickAction"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e638e96367b684e96357934bcf87b745e19d07be78a1f93e736d47953a5d7f10'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #149
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5949fae1-6ec7-4db9-ab8c-6df839cbed2b'::uuid, 'pg', '00a1070252bf8698c8ba093f1076cf242b9e39ae32df2333c4539681bfd20cac', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"createdBy":null,"createdDate":null,"displayName":"Search Property","enabled":false,"id":1926,"lastModifiedBy":null,"lastModifiedDate":null,"leftIcon":"communication:business","name":"Assess And Search Properties","navigationURL":"/digit-ui/employee/pt/inbox","orderNumber":1,"parentModule":"","path":"Property Tax.Assess And Search Properties","queryParams":"","quickAction":false,"rightIcon":"","serviceCode":"","tenantId":"pg","url":"quickAction"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '00a1070252bf8698c8ba093f1076cf242b9e39ae32df2333c4539681bfd20cac'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #150
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e1215c3e-97d3-4ba6-8005-603c23398079'::uuid, 'pg', 'c427ad33fe031b38b6217440b7013e76e92bb6f512c6f82137b0b8eec9d42464', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"File Complaint","enabled":false,"id":1925,"leftIcon":"content:add","name":"CreateComplaint","navigationURL":"/digit-ui/employee/pgr/complaint/create","orderNumber":1,"parentModule":"rainmaker-pgr","path":"Complaints.CreateComplaint","quickAction":false,"rightIcon":"","serviceCode":"PGR","url":"quickAction"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'c427ad33fe031b38b6217440b7013e76e92bb6f512c6f82137b0b8eec9d42464'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #151
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4a04893e-f93b-4ea7-a111-148af47c8dcb'::uuid, 'pg', '4c9ae4fcfc9a59ff114358bdcc5e252bcf2b05276e7865a992365474abba88d8', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Pdf Generator createnosave","enabled":false,"id":1872,"name":"Pdf Generator createnosave","orderNumber":3,"path":"","serviceCode":"pdf-generator-createnosave","url":"/pdf-service/v1/_createnosave"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '4c9ae4fcfc9a59ff114358bdcc5e252bcf2b05276e7865a992365474abba88d8'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #152
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '09dbb2aa-90eb-40fb-82a6-e00bcfe34a73'::uuid, 'pg', '51558f2500a39b6c2d3c48cec25189f60c7fa4903dfd33ddd42f7172a9e898f4', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Pdf Generator search","enabled":false,"id":1835,"name":"Pdf Generator search","orderNumber":2,"path":"","serviceCode":"pdf-generator-search","url":"/pdf-service/v1/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '51558f2500a39b6c2d3c48cec25189f60c7fa4903dfd33ddd42f7172a9e898f4'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #153
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '77909aec-b18d-4cb4-b2b8-2b37ed0ef6b5'::uuid, 'pg', 'b50bd96bdc8551f78f41b018919634f5fc587f7cf878a4b92aa8a3ba6019c5f0', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Pdf Generator create","enabled":false,"id":1834,"name":"Pdf Generator create","orderNumber":1,"path":"","serviceCode":"pdf-generator-create","url":"/pdf-service/v1/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'b50bd96bdc8551f78f41b018919634f5fc587f7cf878a4b92aa8a3ba6019c5f0'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #154
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '45ee2760-2d10-4df7-a7e5-89c105852ab4'::uuid, 'pg', 'f93ff574f38062371bb6d0d211e9f7023f9117de992e59d5cbb8282ae3bc6099', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"","displayName":"Complaints","enabled":false,"id":1814,"leftIcon":"custom:account-alert","name":"rainmaker-citizen-complaints","navigationURL":"/digit-ui/citizen","orderNumber":2,"parentModule":"","path":"","queryParams":"","rightIcon":"","serviceCode":"","url":"card"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f93ff574f38062371bb6d0d211e9f7023f9117de992e59d5cbb8282ae3bc6099'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #155
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '39dd18ed-4eac-4256-abda-f3a6cf4a9af1'::uuid, 'pg', '43e11f69711a115dbaa41f8e5d0d957633b164e3d370e9368f3203e76e82f928', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Trade License","enabled":false,"id":1807,"leftIcon":"places:business-center","name":"TradeLicense","navigationURL":"/digit-ui/citizen/","orderNumber":13,"parentModule":"","path":"TradeLicense","rightIcon":"","serviceCode":"TradeLicense","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '43e11f69711a115dbaa41f8e5d0d957633b164e3d370e9368f3203e76e82f928'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #156
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'bcd0c26c-b76d-4545-9315-1ebcdf16c760'::uuid, 'pg', 'fc8a9261219d08fe915a3f8c523a4361f7c1fe98efef3b9a7a45ea75dea59cad', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"displayName":"Property Tax","enabled":false,"id":1806,"leftIcon":"communication:business","name":"PropertyTax","navigationURL":"/digit-ui/citizen","orderNumber":1,"parentModule":"","path":"Property Tax","queryParams":"","rightIcon":"","serviceCode":"","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'fc8a9261219d08fe915a3f8c523a4361f7c1fe98efef3b9a7a45ea75dea59cad'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #157
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f9abcdda-e569-40ff-baa4-039b7ca67020'::uuid, 'pg', '76c73b9ca31a557ea266b0642bbbf7e125c42ffa7d57c7b22d81eb57fe74ae0a', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Complaints","enabled":false,"id":1805,"leftIcon":"custom:account-alert","name":"Complaints","navigationURL":"/digit-ui/citizen/pgr/complaints","orderNumber":1,"parentModule":"rainmaker-pgr","path":"Complaints","rightIcon":"","serviceCode":"PGR","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '76c73b9ca31a557ea266b0642bbbf7e125c42ffa7d57c7b22d81eb57fe74ae0a'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #158
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1fd2fd64-e04d-44c0-bcd6-a8abf165343a'::uuid, 'pg', 'bac1ca68c5793b62db8af146989dc134a6d30181da8a23fd7bd699a88360dc23', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"","displayName":"HRMS","enabled":false,"id":1779,"leftIcon":"social:people","name":"rainmaker-common-hrms","navigationURL":"/digit-ui/employee/hrms/inbox","orderNumber":2,"parentModule":"","path":"","queryParams":"","rightIcon":"","serviceCode":"","url":"card"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'bac1ca68c5793b62db8af146989dc134a6d30181da8a23fd7bd699a88360dc23'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #159
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'bca70bc6-3cca-47b6-aaa9-c0c2f80c21c5'::uuid, 'pg', 'b1539da723f76528c31df4fd966d45218a68680e3a916a9e80ea4c50cb680a67', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"","displayName":"Complaints","enabled":false,"id":1775,"leftIcon":"action:announcement","name":"rainmaker-common-complaints","navigationURL":"/digit-ui/employee/pgr/inbox","orderNumber":2,"parentModule":"","path":"","queryParams":"","rightIcon":"","serviceCode":"","url":"card"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'b1539da723f76528c31df4fd966d45218a68680e3a916a9e80ea4c50cb680a67'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #160
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'eb570d03-9dc1-4aef-8733-e9f69b31cb56'::uuid, 'pg', 'aed62017f4e65e8677392faeb6a62542c5e1c0394642d7d6efcfbdbe419fde45', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Employee","enabled":false,"id":1773,"leftIcon":"social:people","name":"HRMS","navigationURL":"/digit-ui/employee/hrms/inbox","orderNumber":2,"parentModule":"","path":"HRMS.Search","serviceCode":"HRMS","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'aed62017f4e65e8677392faeb6a62542c5e1c0394642d7d6efcfbdbe419fde45'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #161
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '41660bd7-286b-4db5-bd44-327eb83fe0ef'::uuid, 'pg', '478149fe1f72839f4468fa75b44f59793d5bcf7ef579352a0a8c9267989e9d99', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Employee Search","enabled":false,"id":1752,"name":"Employee Search","orderNumber":0,"parentModule":"egov-hrms","path":"","serviceCode":"egov-hrms","url":"/egov-hrms/employees/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '478149fe1f72839f4468fa75b44f59793d5bcf7ef579352a0a8c9267989e9d99'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #162
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '41447ea8-1ae5-4249-b285-ef8b6be70051'::uuid, 'pg', 'e8e63b67bf0d590aa7e563748bbf339868ee479bdd928a967f1d07a843d16ce3', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Employee Update","enabled":false,"id":1751,"name":"Employee Update","orderNumber":0,"parentModule":"egov-hrms","path":"","serviceCode":"egov-hrms","url":"/egov-hrms/employees/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e8e63b67bf0d590aa7e563748bbf339868ee479bdd928a967f1d07a843d16ce3'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #163
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6cbc21f3-1113-4fb8-91b1-a5a4a7f0500a'::uuid, 'pg', '367070852414759806765e31ee8abe4d177c73bb6b3488fb3de301597c005425', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Employee Create","enabled":false,"id":1750,"name":"Employee Create","orderNumber":0,"parentModule":"egov-hrms","path":"","serviceCode":"egov-hrms","url":"/egov-hrms/employees/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '367070852414759806765e31ee8abe4d177c73bb6b3488fb3de301597c005425'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #164
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '224db3b7-1dc9-4e24-97d9-98b7d1b3dc1c'::uuid, 'pg', 'b7daf2e7198dd244e3fbcb49b14a7ffa0531459855fb004be567d2ee4f967b3f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"BusinessService Search","enabled":false,"id":1743,"name":"BusinessService Search","orderNumber":0,"parentModule":"","path":"","serviceCode":"egov-workflow-v2","url":"/egov-workflow-v2/egov-wf/businessservice/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'b7daf2e7198dd244e3fbcb49b14a7ffa0531459855fb004be567d2ee4f967b3f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #165
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '592e864c-b0ea-40c9-a583-8b15d68109f0'::uuid, 'pg', '19184b5fee65d6e2814db761e9b4c39b3a8ef0cb9ffbe880c7da72ec066e1fac', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"BusinessService Update","enabled":false,"id":1742,"name":"BusinessService Update","orderNumber":0,"parentModule":"","path":"","serviceCode":"egov-workflow-v2","url":"/egov-workflow-v2/egov-wf/businessservice/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '19184b5fee65d6e2814db761e9b4c39b3a8ef0cb9ffbe880c7da72ec066e1fac'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #166
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '297f1b8b-aac0-44f9-904c-98b4052c2e48'::uuid, 'pg', '8c36703bc48164eea4ca018c96a9540f12592f1c7773b234421daea548f3e67a', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"BusinessService Create","enabled":false,"id":1741,"name":"BusinessService Create","orderNumber":0,"parentModule":"","path":"","serviceCode":"egov-workflow-v2","url":"/egov-workflow-v2/egov-wf/businessservice/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '8c36703bc48164eea4ca018c96a9540f12592f1c7773b234421daea548f3e67a'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #167
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c109f8a7-2953-4148-b5d8-03c646bc3044'::uuid, 'pg', '7df56f709ccdcc6d89011f62b5ad655ea15ae5ef4bdc14dd0e1b90611d65b0a5', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Localization Messages Upsert","enabled":false,"id":1734,"name":"LocalizationMessagesUpsert","orderNumber":1,"parentModule":"","path":"","serviceCode":"filestore url","url":"/localization/messages/v1/_upsert"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '7df56f709ccdcc6d89011f62b5ad655ea15ae5ef4bdc14dd0e1b90611d65b0a5'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #168
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9a0272b5-0fc4-4e6d-8b8b-f463adc9e343'::uuid, 'pg', '33b23b707006638dbda4fc0e44e076ac8057627888b29f892bef8a1920fcace1', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Workflow search","enabled":false,"id":1730,"name":"Workflow search","orderNumber":0,"parentModule":"","path":"","serviceCode":"egov-workflow-v2","url":"/egov-workflow-v2/egov-wf/process/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '33b23b707006638dbda4fc0e44e076ac8057627888b29f892bef8a1920fcace1'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #169
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7628e255-a5e3-4db3-bab1-c7edec9a3cbc'::uuid, 'pg', 'a7f4d52ce5f6d4bc89ceb84ac53594fe827f17f7b0948e0ea52e0787363652f7', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Workflow transition","enabled":false,"id":1729,"name":"Workflow transition","orderNumber":0,"parentModule":"","path":"","serviceCode":"egov-workflow-v2","url":"/egov-workflow-v2/egov-wf/process/_transition"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'a7f4d52ce5f6d4bc89ceb84ac53594fe827f17f7b0948e0ea52e0787363652f7'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #170
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '78f06d6a-4eb2-4bd1-a4cb-65f3e5854e90'::uuid, 'pg', '803bcb3e6f1d2d77607b8b5a2c4312cfc3f14aa5f74a5cfbd6a0ca1b33dff893', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update User novalidate","enabled":false,"id":1700,"name":"updateUsernovalidate","orderNumber":1,"path":"","serviceCode":"ADMIN","url":"/user/users/_updatenovalidate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '803bcb3e6f1d2d77607b8b5a2c4312cfc3f14aa5f74a5cfbd6a0ca1b33dff893'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #171
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'eb77fb21-8f99-4390-8fa5-ec9afed35a4b'::uuid, 'pg', '73cef288fe632bbf9ca116b6f0dad7d6ef00c88727642b48b9d08a80b3ce5715', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search","enabled":false,"id":1690,"leftIcon":"places:business-center","name":"TradeLicenseSearch","navigationURL":"/digit-ui/employee/tl/inbox","orderNumber":13,"parentModule":"","path":"TradeLicense.Search","serviceCode":"TradeLicense","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '73cef288fe632bbf9ca116b6f0dad7d6ef00c88727642b48b9d08a80b3ce5715'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #172
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '45c83631-cb11-4826-bf7b-66926b8b1910'::uuid, 'pg', 'f34eca3eac5ef928803da61e2889d8286d4e46cae3e497e30aef63ee81883d57', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"","enabled":false,"id":1678,"name":"businessDetails create","navigationURL":"","orderNumber":0,"parentModule":"","path":"","serviceCode":"Collections","url":"/egov-common-masters/businessDetails/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f34eca3eac5ef928803da61e2889d8286d4e46cae3e497e30aef63ee81883d57'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #173
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9fc76a6a-20c3-4697-b9be-e2cc3b092f6f'::uuid, 'pg', '5251c27b91bcb05105a0a6cab80b6384649ec53b6fc6184ac7006310f05aa513', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"business category search","enabled":false,"id":1677,"name":"business category create","navigationURL":"","orderNumber":0,"parentModule":"","path":"","serviceCode":"Collections","url":"/egov-common-masters/businessCategory/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '5251c27b91bcb05105a0a6cab80b6384649ec53b6fc6184ac7006310f05aa513'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #174
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '75c8e23b-5d31-419f-bb05-50ecaea1da2d'::uuid, 'pg', 'b1d5f336668d105e98eea4b35c9ec5c4ab012e48350c78d64484b8a9d43b4197', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"","enabled":false,"id":1676,"name":"businessDetails search","navigationURL":"","orderNumber":0,"parentModule":"","path":"","serviceCode":"Collections","url":"/egov-common-masters/businessDetails/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'b1d5f336668d105e98eea4b35c9ec5c4ab012e48350c78d64484b8a9d43b4197'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #175
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2db9d03a-3b13-48c7-aaed-e90ae986ae7b'::uuid, 'pg', '4b01bef3104280e7be499b73f07dee47255e1a62b79eda85b46e1cdccd3c943b', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"business category search","enabled":false,"id":1675,"name":"business category search","navigationURL":"","orderNumber":0,"parentModule":"","path":"","serviceCode":"Collections","url":"/egov-common-masters/businessCategory/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '4b01bef3104280e7be499b73f07dee47255e1a62b79eda85b46e1cdccd3c943b'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #176
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f5e564f3-f627-4c55-a029-6192122f34f7'::uuid, 'pg', 'fb974b22c23412d835c794068df2f48abedb3b99dc147b988f18fcc568f6a814', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"createdBy":null,"createdDate":null,"displayName":"Assess New Property","enabled":false,"id":1577,"lastModifiedBy":null,"lastModifiedDate":null,"leftIcon":"communication:business","name":"Assess New Property","navigationURL":"/digit-ui/employee/pt/inbox","orderNumber":1,"parentModule":"","path":"Property Tax.Assess New Property","queryParams":"","rightIcon":"","serviceCode":"","tenantId":"pg","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'fb974b22c23412d835c794068df2f48abedb3b99dc147b988f18fcc568f6a814'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #177
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2982b26e-805b-4884-a7a0-9cfe7300fb3d'::uuid, 'pg', 'fb001baaef647a3e75bea9e4e2c79efca3b039962b2737bfa9171a0e1a0c2a31', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create Complaint","enabled":false,"id":1559,"leftIcon":"content:add","name":"CreateComplaint","navigationURL":"/digit-ui/employee/pgr/complaint/create","orderNumber":1,"parentModule":"rainmaker-pgr","path":"Complaints.CreateComplaint","rightIcon":"","serviceCode":"PGR","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'fb001baaef647a3e75bea9e4e2c79efca3b039962b2737bfa9171a0e1a0c2a31'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #178
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a5db3d89-365b-49e9-9135-b0b20136b8a2'::uuid, 'pg', '7fd1246cff376ca86080561c10d4b31a24c48e07f634628d71415d8d0f1bedae', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Open Complaints","enabled":false,"id":1557,"leftIcon":"action:announcement","name":"OpenComplaints","navigationURL":"/digit-ui/employee/pgr/inbox","orderNumber":1,"parentModule":"rainmaker-pgr","path":"Complaints.MyComplaints","rightIcon":"","serviceCode":"PGR","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '7fd1246cff376ca86080561c10d4b31a24c48e07f634628d71415d8d0f1bedae'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #179
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6a4bf9fc-cc57-435e-8145-ba8ff2bcdc9c'::uuid, 'pg', 'effb4f795d2bc1732d6800c3c62f9c5fe0b6b84f42d8475d560e9fe8286b0765', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Home","enabled":true,"id":1556,"leftIcon":"action:home","name":"Home","navigationURL":"/digit-ui/employee","orderNumber":1,"parentModule":"rainmaker-pgr","path":"Home","rightIcon":"","serviceCode":"PGR","url":"url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'effb4f795d2bc1732d6800c3c62f9c5fe0b6b84f42d8475d560e9fe8286b0765'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #180
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '44ce28d9-841e-468e-9ea7-bb10926bf035'::uuid, 'pg', 'a0cba32aacca0fdec66a1f78e55678741397b3d0261c29f686f5e634f55aba36', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Localization Messages Search","enabled":false,"id":1531,"name":"LocalizationMessagesSearch","orderNumber":1,"parentModule":"","path":"","serviceCode":"filestore url","url":"/localization/messages/v1/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'a0cba32aacca0fdec66a1f78e55678741397b3d0261c29f686f5e634f55aba36'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #181
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0c1b564c-556d-4692-a8bb-35eb868ec87f'::uuid, 'pg', 'be9537a5361d0e9fb2fe532d15f3f7d5640eb62f5316172e9e45127bc03277ce', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Localization Messages Update","enabled":false,"id":1530,"name":"LocalizationMessagesUpdate","orderNumber":1,"parentModule":"","path":"","serviceCode":"filestore url","url":"/localization/messages/v1/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'be9537a5361d0e9fb2fe532d15f3f7d5640eb62f5316172e9e45127bc03277ce'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #182
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '92b56f4a-e8f1-4740-a86a-56811afec17a'::uuid, 'pg', 'bb83a87e9eb54ef6570e0204291eefb720b2e62ed70211f37375b8e776846016', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Localization Messages Create","enabled":false,"id":1529,"name":"LocalizationMessagesCreate","orderNumber":1,"parentModule":"","path":"","serviceCode":"filestore url","url":"/localization/messages/v1/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'bb83a87e9eb54ef6570e0204291eefb720b2e62ed70211f37375b8e776846016'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #183
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '15e1d863-ca95-4f22-ae29-d064aa85f549'::uuid, 'pg', 'af8215a2d394aa4fe8efabcb12a77e70df718dae3e84bb36f9291e6fba586db6', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Filestore Url","enabled":false,"id":1528,"name":"FilestoreUrl","orderNumber":1,"parentModule":"","path":"","serviceCode":"filestore url","url":"/filestore/v1/files/url"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'af8215a2d394aa4fe8efabcb12a77e70df718dae3e84bb36f9291e6fba586db6'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #184
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a318c0d0-ab3b-40a4-9770-edbd3115ed70'::uuid, 'pg', 'd4fb55d1b433c3920c54adbeaa2450b356d40cb5bb3651fdaf41008534c2f2a8', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Tenant Search","enabled":false,"id":1523,"name":"Resolve Tenant from Lat/Lng","orderNumber":0,"parentModule":"67","path":"Location.Search Tenant Resolve","serviceCode":"LOCATION_MS","url":"/egov-location/location/v11/tenant/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd4fb55d1b433c3920c54adbeaa2450b356d40cb5bb3651fdaf41008534c2f2a8'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #185
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f7d726bc-efa7-453b-b0a5-c6ab69240bcf'::uuid, 'pg', '4bf0a26064276c9693f000fa2cbe1aefdb0a3359a3b135499f73f6b55c8c9361', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Geographical Search","enabled":false,"id":1522,"name":"Get GeoJSON and other geographical data of requested tenant","orderNumber":0,"parentModule":"67","path":"Location.Search Geography GeoJSON","serviceCode":"LOCATION_MS","url":"/egov-location/location/v11/geography/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '4bf0a26064276c9693f000fa2cbe1aefdb0a3359a3b135499f73f6b55c8c9361'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #186
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '745d4e3a-eedb-4a2c-8fb2-7682fb2c9af1'::uuid, 'pg', 'b28d49859ed91a126b650ee453e85363ebd2cbec3af1c106ec5069bbdece6b35', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Uploaded File MetaData","enabled":false,"id":1519,"name":"Uploaded File MetaData","orderNumber":1,"parentModule":"","path":"","queryParams":null,"serviceCode":"FILE_METADATA","url":"/filestore/v1/files/metadata"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'b28d49859ed91a126b650ee453e85363ebd2cbec3af1c106ec5069bbdece6b35'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #187
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c5b77138-bc98-4429-acba-bdee36057773'::uuid, 'pg', '4cd0675c09cd9593e8bc69a6c18a66af31aa8e83edf2a25ded80a0edd56f3418', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Boundaries Mdms Search","enabled":false,"id":1429,"name":"Search Boundaries With Mdms","orderNumber":3,"parentModule":"67","path":"Location.Search Boundary","serviceCode":"LOCATION_MS","url":"/egov-location/location/v11/boundarys/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '4cd0675c09cd9593e8bc69a6c18a66af31aa8e83edf2a25ded80a0edd56f3418'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #188
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '511ffa58-a231-4a7c-890d-8e0e57003d79'::uuid, 'pg', '9b55fd5c0aea30eb0a01e82a614623e6357c9da020449c29a002110e0f656326', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"View Department","enabled":true,"id":797,"name":"View Department","orderNumber":3,"parentModule":"273","path":"Administration.Department.View Department","serviceCode":"DEPT","url":"/egov-common-masters/departments/v1/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '9b55fd5c0aea30eb0a01e82a614623e6357c9da020449c29a002110e0f656326'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #189
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '05864a09-7937-43b0-8067-eb9e9d253d69'::uuid, 'pg', 'ed423e1bb930ea262f88a9496a3ee48315571c49fb9a74e841a458ca59b74fdc', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Modify Department","enabled":true,"id":796,"name":"Modify Department","orderNumber":2,"parentModule":"273","path":"Administration.Department.Modify Department","serviceCode":"DEPT","url":"/egov-common-masters/departments/v1/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'ed423e1bb930ea262f88a9496a3ee48315571c49fb9a74e841a458ca59b74fdc'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #190
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ee1f9507-4ae8-4f7d-bcff-fbdd18faba89'::uuid, 'pg', '62d4deaa5381475cdf958c9d8838a203df60ce60e3e5b78c8a2d34a128916020', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create Department","enabled":true,"id":795,"name":"Create Department","orderNumber":1,"parentModule":"273","path":"Administration.Department.Create Department","serviceCode":"DEPT","url":"/egov-common-masters/departments/v1/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '62d4deaa5381475cdf958c9d8838a203df60ce60e3e5b78c8a2d34a128916020'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #191
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4dc0f948-c0e5-4e0f-907d-a469c1211331'::uuid, 'pg', 'ca1066bd9a1941acbd29fbb4ab5036b8042b180c3717cfe6789f8900e75447aa', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"UserRole Mapping","enabled":true,"id":697,"name":"UpdateUserWithoutValidation","orderNumber":1,"path":"Administration.UpdateUserWithoutValidation","serviceCode":"ADMIN","url":"/user/users/{id}/_updatenovalidate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'ca1066bd9a1941acbd29fbb4ab5036b8042b180c3717cfe6789f8900e75447aa'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #192
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e289a896-00ee-4a81-b4ff-5c5095853d59'::uuid, 'pg', '03f6b2109a78e9d4e5813ac8d44bd50a324d84d380f345fb9ac3c4a37e8b7a81', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"displayName":"Get Roles from MDMS","enabled":false,"id":1221,"name":"Get Roles from MDMS","orderNumber":0,"path":"AccessControl","serviceCode":"AccessControl","url":"/access/v1/roles/mdms/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '03f6b2109a78e9d4e5813ac8d44bd50a324d84d380f345fb9ac3c4a37e8b7a81'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #193
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c5e7163c-2aa0-465e-a4e3-e79aeb49e2f7'::uuid, 'pg', 'e5f9ef12d4305a503cabd7c865b359eb5db9359736903e22bcea0a74006afbb3', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get Actions from mdms","enabled":false,"id":870,"name":"Get Actions from MDMS","orderNumber":1,"parentModule":"221","path":"Access Control.Get Actions from MDMS","serviceCode":"AccessControl","url":"/access/v1/actions/mdms/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e5f9ef12d4305a503cabd7c865b359eb5db9359736903e22bcea0a74006afbb3'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #194
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b9328634-29fa-4565-946a-cfea4dce9261'::uuid, 'pg', '6e65aa8dd9544ca2cfaefb19ba2b02e4fed8a8f708db98614756b782f0740eeb', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update HierarchyType","enabled":false,"id":979,"name":"Update HierarchyType","orderNumber":1,"parentModule":"67","path":"Location.Update HierarchyType","serviceCode":"LOCATION_MS","url":"/egov-location/hierarchytypes/{code}"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '6e65aa8dd9544ca2cfaefb19ba2b02e4fed8a8f708db98614756b782f0740eeb'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #195
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '09611aee-d365-43a7-8ae4-6dfa1c88a250'::uuid, 'pg', '41c9886e7cbbf5eb4d6a2ee07b04f5d991d3b83e8af1d9b3a417c4e0e91461e6', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update CrossHierarchy","enabled":false,"id":978,"name":"Update CrossHierarchy","orderNumber":1,"parentModule":"67","path":"Location.Update CrossHierarchy","serviceCode":"LOCATION_MS","url":"/egov-location/crosshierarchys/{code}"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '41c9886e7cbbf5eb4d6a2ee07b04f5d991d3b83e8af1d9b3a417c4e0e91461e6'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #196
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '72551115-0799-4293-8623-93867afa7d5d'::uuid, 'pg', 'b4af80862c26ae83c992146a4e2288e00b1906f639dfbc3c082f7a48fb07c799', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update BoundaryType","enabled":false,"id":977,"name":"Update BoundaryType","orderNumber":1,"parentModule":"67","path":"Location.Update BoundaryType","serviceCode":"LOCATION_MS","url":"/egov-location/boundarytypes/{code}"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'b4af80862c26ae83c992146a4e2288e00b1906f639dfbc3c082f7a48fb07c799'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #197
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e494b2c2-cb1b-4e8f-b544-3d2d9c3c669b'::uuid, 'pg', '113be2b79e4df3b9ecb90ca08f217bc686a3e2c6cd543101869915de291e0caf', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update Boundary","enabled":false,"id":976,"name":"Update Boundary","orderNumber":1,"parentModule":"67","path":"Location.Update Boundary","serviceCode":"LOCATION_MS","url":"/egov-location/boundarys/{code}"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '113be2b79e4df3b9ecb90ca08f217bc686a3e2c6cd543101869915de291e0caf'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #198
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '14819bc9-d787-4b59-8724-0948ae3ae58c'::uuid, 'pg', '7d9ba9beaa8e61ab474ef44f265f50e0d8bbaaad1f798072475092e5958bf499', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"MDMS Search","enabled":false,"id":954,"name":"MDMS Search","orderNumber":0,"parentModule":"306","path":"","serviceCode":"MDMS Search","url":"/egov-mdms-service/v1/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '7d9ba9beaa8e61ab474ef44f265f50e0d8bbaaad1f798072475092e5958bf499'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #199
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '98b1cff9-88c1-41dc-a41b-9effbbc1213a'::uuid, 'pg', '8467919dcb9ee878494c2dcdc5c9fc053c7f7d10e4ace9fbb87f5639682c3589', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create HierarchyType","enabled":false,"id":948,"name":"Create HierarchyType","orderNumber":1,"parentModule":"67","path":"Location.Create HierarchyType","serviceCode":"LOCATION_MS","url":"/egov-location/hierarchytypes"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '8467919dcb9ee878494c2dcdc5c9fc053c7f7d10e4ace9fbb87f5639682c3589'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #200
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f0aef138-3fb0-4fcb-908b-675ca83f919a'::uuid, 'pg', 'b06d6dc0039ab3e29fcfd955b74047b195cf6bd5f2a828adfc128de237bc7f76', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create Boundary","enabled":false,"id":947,"name":"Create Boundary","orderNumber":1,"parentModule":"67","path":"Location.Create Boundary","serviceCode":"LOCATION_MS","url":"/egov-location/boundarys"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'b06d6dc0039ab3e29fcfd955b74047b195cf6bd5f2a828adfc128de237bc7f76'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #201
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '18c441ed-9799-4a94-ab87-44722374f873'::uuid, 'pg', 'bae47fa6e6c9fa174e308a0b46bc17d24213c2b2f7787b0f366efde7f801a14b', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Cross Hierarchys","enabled":false,"id":883,"name":"Search Cross Hierarchy","orderNumber":1,"parentModule":"67","path":"Location.Search Cross Hierarchy","serviceCode":"LOCATION_MS","url":"/egov-location/crosshierarchys/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'bae47fa6e6c9fa174e308a0b46bc17d24213c2b2f7787b0f366efde7f801a14b'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #202
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '534e6a74-454b-4243-9a5f-885b444b5b84'::uuid, 'pg', '2151b315fd4c92748a93a9927245ae63589d06ccb1c3417f618ee2877c910ff6', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search HierarchyTypes","enabled":false,"id":874,"name":"SearchHierarchyTypes","orderNumber":1,"parentModule":"67","path":"Location.SearchHierarchyTypes","serviceCode":"LOCATION_MS","url":"/egov-location/hierarchytypes/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '2151b315fd4c92748a93a9927245ae63589d06ccb1c3417f618ee2877c910ff6'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #203
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2730d640-cef7-41bf-a437-7058eb80af72'::uuid, 'pg', '66c53205a33a9d80d596f65d150496202391763d6308b51d9adb3f44ebfcdc8d', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search BoundaryType","enabled":false,"id":873,"name":"SearchBoundaryType","orderNumber":1,"parentModule":"67","path":"Location.SearchBoundaryType","serviceCode":"LOCATION_MS","url":"/egov-location/boundarytypes/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '66c53205a33a9d80d596f65d150496202391763d6308b51d9adb3f44ebfcdc8d'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #204
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '154e97a0-bc3a-47bf-ba5f-3be9f498e243'::uuid, 'pg', 'd84c22c0c4e4eaa5bb2e01437278485bcb605dcf173179dca8da7a0ef75df316', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update Department","enabled":false,"id":798,"name":"Update Department","orderNumber":2,"parentModule":"273","path":"Administration.Department.Update Department","serviceCode":"DEPT","url":"/egov-common-masters/departments/v1/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd84c22c0c4e4eaa5bb2e01437278485bcb605dcf173179dca8da7a0ef75df316'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #205
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '97c337ea-82ce-4de2-8266-34ec3bd293a0'::uuid, 'pg', '7233d9509a37bb95e6da98414ec2331c986262726408fe87c7f4f03ea7c50442', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Business Types","enabled":false,"id":789,"leftIcon":"editor:collections","name":"GetBusinessTypes","orderNumber":1,"path":"Collection.Collection Masters.GetBusinessTypes","serviceCode":"COLLECTION-MASTERS","url":"/egov-common-masters/businessDetails/_getBusinessTypes"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '7233d9509a37bb95e6da98414ec2331c986262726408fe87c7f4f03ea7c50442'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #206
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '25b7b034-1e80-4818-8e1f-79076e4555cb'::uuid, 'pg', 'eb9ae73fc2590a704c10cc9325ea7eabda23ece98350e596374d2d24b80db30f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Modules","enabled":false,"id":733,"name":"SearchModules","orderNumber":1,"path":"Employee Management.Employee Masters.SearchModules","serviceCode":"EIS Masters","url":"/egov-common-masters/modules/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'eb9ae73fc2590a704c10cc9325ea7eabda23ece98350e596374d2d24b80db30f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #207
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cccf8cfb-2348-4203-b7ca-8c55196c6739'::uuid, 'pg', '2eae7fc612b06202675a609f5682cd14b7029f410577ee1fc4003f71f8a000ce', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Is ShapeFile ExistOrNot","enabled":false,"id":732,"name":"isShapeFileExist","orderNumber":1,"parentModule":"67","path":"Location.isShapeFileExist","serviceCode":"LOCATION_MS","url":"/egov-location/boundarys/isshapefileexist"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '2eae7fc612b06202675a609f5682cd14b7029f410577ee1fc4003f71f8a000ce'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #208
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5f37c4b7-72f0-4453-91b9-e36ef6ebcddd'::uuid, 'pg', '88e74e569c78a9affbaa78a6de24ca8cb5c1469b83201ee4e554e841a12fbcb0', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update Roles","enabled":false,"id":731,"name":"updateRoles","orderNumber":1,"path":"Access Control.updateRoles","serviceCode":"AccessControl","url":"/access/v1/roles/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '88e74e569c78a9affbaa78a6de24ca8cb5c1469b83201ee4e554e841a12fbcb0'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #209
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '345c2708-1784-4ef8-b013-fb2ba39a4959'::uuid, 'pg', '42565497ef42d9615807dfef20285b7b42cf0fb09c9a9a7a5bf864b94b2509dc', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create Roles","enabled":false,"id":730,"name":"CreateRoles","orderNumber":1,"path":"Access Control.CreateRoles","serviceCode":"AccessControl","url":"/access/v1/roles/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '42565497ef42d9615807dfef20285b7b42cf0fb09c9a9a7a5bf864b94b2509dc'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #210
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9f259d9b-2818-4d82-a83d-a497984483b7'::uuid, 'pg', '96c3e4437f45b78001c3a1a9784198cdd1de1fb596b08c96b956ccb68187638c', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Roles","enabled":false,"id":729,"name":"SearchRoles","orderNumber":1,"path":"Access Control.SearchRoles","serviceCode":"AccessControl","url":"/access/v1/roles/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '96c3e4437f45b78001c3a1a9784198cdd1de1fb596b08c96b956ccb68187638c'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #211
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ac2ca75d-d6fd-4003-94ac-23e981b8dfb5'::uuid, 'pg', 'b62058f37b5f542c323b6bdf332fd58c6180933db4a3a1a7aaebb78757d687b9', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create Role actions","enabled":false,"id":728,"name":"CreateRoleActions","orderNumber":1,"path":"Access Control.CreateRoleActions","serviceCode":"AccessControl","url":"/access/v1/role-actions/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'b62058f37b5f542c323b6bdf332fd58c6180933db4a3a1a7aaebb78757d687b9'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #212
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f00e65ec-1eb1-4189-b2e0-c5f625a1f464'::uuid, 'pg', 'f189f02aba7431b5f03b5d26631f8ba1c3c54391cebdeb6c76539cecbdf3a769', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update Action","enabled":false,"id":727,"name":"UpdateActions","orderNumber":1,"path":"Access Control.UpdateActions","serviceCode":"AccessControl","url":"/access/v1/actions/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f189f02aba7431b5f03b5d26631f8ba1c3c54391cebdeb6c76539cecbdf3a769'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #213
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd51d1f86-59ff-4e78-8651-0f8364803986'::uuid, 'pg', '741ba4d97973342072e29784d4c222d6bb9443b4e91924647dfb279de7c4164f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create Action","enabled":false,"id":726,"name":"CreateActions","orderNumber":1,"path":"Access Control.CreateActions","serviceCode":"AccessControl","url":"/access/v1/actions/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '741ba4d97973342072e29784d4c222d6bb9443b4e91924647dfb279de7c4164f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #214
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0bba068a-1275-4bad-bc82-2b7fb0d35f69'::uuid, 'pg', '52f5fdee86bacee36a9ce2b146d08f0bbf40c878b5c7b5543873c97382d7c7d9', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Validate Action","enabled":false,"id":725,"name":"ValidateAction","orderNumber":1,"path":"Access Control.ValidateAction","serviceCode":"AccessControl","url":"/access/v1/actions/_validate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '52f5fdee86bacee36a9ce2b146d08f0bbf40c878b5c7b5543873c97382d7c7d9'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #215
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'db23f5e7-bd3c-4fc7-9a25-beddad00be1a'::uuid, 'pg', 'bc5e73596b99d759bc66a4b1f32cfac8cc3f55b38f7e628f13c6bbb07d51ce3a', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Actions","enabled":false,"id":724,"name":"SearchActions","orderNumber":1,"path":"Access Control.SearchActions","serviceCode":"AccessControl","url":"/access/v1/actions/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'bc5e73596b99d759bc66a4b1f32cfac8cc3f55b38f7e628f13c6bbb07d51ce3a'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #216
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b77cc9f5-5c30-4700-8f8d-950fcd7af859'::uuid, 'pg', '39f37e13f35557a8e21304c879886f9d5f8bd778e3dda21d1d1c2cebee57f483', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Delete Token","enabled":false,"id":701,"name":"Delete Token","orderNumber":1,"path":"Administration.Delete Token","serviceCode":"ADMIN","url":"/user/_logout"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '39f37e13f35557a8e21304c879886f9d5f8bd778e3dda21d1d1c2cebee57f483'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #217
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6eab9b22-60a2-4812-857d-92a1c36e5254'::uuid, 'pg', 'baa3b58c92d3aa0934ddbe2356e67450262551acc9aae4e7672ae75debcf7d88', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"UpdatePassword For NonLogged InUser","enabled":false,"id":700,"name":"UpdatePasswordForNonLoggedInUser","orderNumber":1,"path":"Administration.UpdatePasswordForNonLoggedInUser","serviceCode":"ADMIN","url":"/user/password/nologin/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'baa3b58c92d3aa0934ddbe2356e67450262551acc9aae4e7672ae75debcf7d88'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #218
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2b66d5aa-5f07-4e7e-a6a6-6b4e9172619c'::uuid, 'pg', '0c73222b145d2ea360c0bfef1991a3dba7e3b9c9e074aa555f1d6d4e40a0afb0', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Update Password","enabled":false,"id":699,"name":"Update Password","orderNumber":1,"path":"Administration.Update Password","serviceCode":"ADMIN","url":"/user/password/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '0c73222b145d2ea360c0bfef1991a3dba7e3b9c9e074aa555f1d6d4e40a0afb0'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #219
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'caaf3539-6584-4e3f-82b8-788f29075bad'::uuid, 'pg', 'd8a43731eea79e3c027c25a6e3b77f3a68626cda964b5a89a55d07b55978901c', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Profile Update","enabled":false,"id":698,"name":"Profile Update","orderNumber":1,"path":"Administration.Profile Update","serviceCode":"ADMIN","url":"/user/profile/_update"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd8a43731eea79e3c027c25a6e3b77f3a68626cda964b5a89a55d07b55978901c'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #220
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a6068356-e2a6-4b66-b76a-30273a01161f'::uuid, 'pg', '0269da81243878f4d5182c4c8e290fba40430f8ec1adc6e1c3fcac20ff49f10f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get User Details","enabled":false,"id":696,"name":"Get User","orderNumber":1,"path":"Administration.Get User","serviceCode":"ADMIN","url":"/user/_details"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '0269da81243878f4d5182c4c8e290fba40430f8ec1adc6e1c3fcac20ff49f10f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #221
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9bbacbbe-0207-46a5-8a91-28894b1cdbd9'::uuid, 'pg', '38a70d747f1e0e3a21b5b2259e887342d524c62c3ef11b866ac1ffe9791c1df8', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search User Details","enabled":false,"id":695,"name":"Search User Details","orderNumber":1,"path":"Administration.Search User Details","serviceCode":"ADMIN","url":"/user/v1/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '38a70d747f1e0e3a21b5b2259e887342d524c62c3ef11b866ac1ffe9791c1df8'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #222
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '67ca1346-e481-4df6-adb9-9d77ddcdf2cc'::uuid, 'pg', '9d7cca3c3497608c11e547e2d4c938e2c288d27cfc9174445dabb27bfd13450d', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create Citizen","enabled":false,"id":694,"name":"Create Citizen","orderNumber":1,"path":"Administration.Create Citizen","serviceCode":"ADMIN","url":"/user/citizen/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '9d7cca3c3497608c11e547e2d4c938e2c288d27cfc9174445dabb27bfd13450d'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #223
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd2107c01-e190-4693-a70c-974abfec8d8b'::uuid, 'pg', 'ad02154412f44a8df0c6aacb2a0588ea57ad2954ab6e8087725a58fa23bce3fb', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Otp","enabled":false,"id":693,"name":"SearchOtp","orderNumber":1,"parentModule":"247","path":"Otp.SearchOtp","serviceCode":"OTP","url":"/otp/v1/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'ad02154412f44a8df0c6aacb2a0588ea57ad2954ab6e8087725a58fa23bce3fb'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #224
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e594da44-f87d-446b-a653-10469a099ef8'::uuid, 'pg', '78ca406940552be3ea9a86a7cb26c891f91656896e47c7742635a088a6a8841a', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Validate Otp","enabled":false,"id":692,"name":"ValidateOtp","orderNumber":1,"parentModule":"247","path":"Otp.ValidateOtp","serviceCode":"OTP","url":"/otp/v1/_validate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '78ca406940552be3ea9a86a7cb26c891f91656896e47c7742635a088a6a8841a'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #225
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '81ed7f23-a065-498c-8f6f-1973fa0c2e39'::uuid, 'pg', '07aab54f22ffe7d17107dafd0d62107237e2d84330d4311fe79eb7aaea9f4550', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create Otp","enabled":false,"id":691,"name":"CreateOtp","orderNumber":1,"parentModule":"247","path":"Otp.CreateOtp","serviceCode":"OTP","url":"/otp/v1/_create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '07aab54f22ffe7d17107dafd0d62107237e2d84330d4311fe79eb7aaea9f4550'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #226
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b761c846-bdc2-4824-b13e-9529d376d7cd'::uuid, 'pg', '0436056fd740917f9cc4facc2d311870b979b98871c543e1b8661797edcac883', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Boundary","enabled":false,"id":627,"name":"Search Boundary","orderNumber":1,"parentModule":"67","path":"Location.Search Boundary","serviceCode":"LOCATION_MS","url":"/egov-location/boundarys/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '0436056fd740917f9cc4facc2d311870b979b98871c543e1b8661797edcac883'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #227
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cd8b78a0-67d6-4f4f-98d9-c39faf6258f1'::uuid, 'pg', '73ad0b6629cb0cd5114d2b9f73a93ee04d74efc3b3bd9ca33a4d9bc0d7711ebf', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Generate Number","enabled":false,"id":623,"name":"GenerateNumber","orderNumber":1,"path":"Administration.GenerateNumber","serviceCode":"ADMIN","url":"/egov-idgen/id/_generate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '73ad0b6629cb0cd5114d2b9f73a93ee04d74efc3b3bd9ca33a4d9bc0d7711ebf'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #228
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'acddd6a0-7079-4c52-9eb1-91e784ec26dc'::uuid, 'pg', '29455213ed309180e548b4883cf39b129a9c4757081973ebd7abd74013b6c157', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create User novalidate","enabled":false,"id":605,"name":"CreateUsernovalidate","orderNumber":1,"path":"Administration.CreateUsernovalidate","serviceCode":"ADMIN","url":"/user/users/_createnovalidate"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '29455213ed309180e548b4883cf39b129a9c4757081973ebd7abd74013b6c157'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #229
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3df4f300-a2c8-42c8-94e3-4aac3da04538'::uuid, 'pg', '314dcd2a3958c7f687d3bb95061e74f3fd0e58465d95a80caeafdb71ef32e1ff', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search User","enabled":false,"id":604,"name":"SearchUser","orderNumber":1,"path":"Administration.SearchUser","serviceCode":"ADMIN","url":"/user/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '314dcd2a3958c7f687d3bb95061e74f3fd0e58465d95a80caeafdb71ef32e1ff'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #230
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fc5c33ba-ee15-4518-827b-ada04fc752a8'::uuid, 'pg', '093882cf08f22f0907e47b292d14f59b2bfd8352462bc7ba0d052a2667fe61c6', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get All Actions","enabled":false,"id":594,"name":"Get All Actions","orderNumber":1,"path":"Access Control.Get All Actions","serviceCode":"AccessControl","url":"/access/v1/actions/_get"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '093882cf08f22f0907e47b292d14f59b2bfd8352462bc7ba0d052a2667fe61c6'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #231
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f04145bf-8d64-44b6-8645-cadbda76add5'::uuid, 'pg', '83c9f5624a3a176d7a4e40a78fc6e398331b9d07bdd7df23b73f2b75e49d5647', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Search Categories","enabled":false,"id":582,"name":"SearchCategories","orderNumber":0,"path":"Employee Management.Employee Masters.Category.SearchCategories","serviceCode":"Category","url":"/egov-common-masters/categories/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '83c9f5624a3a176d7a4e40a78fc6e398331b9d07bdd7df23b73f2b75e49d5647'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #232
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '17f49bdd-31cb-497d-9242-ed556a67f55f'::uuid, 'pg', 'd77f0afe387c98f893510a0a17e9255c8902d5474432166c998051692d822add', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"SearchRelationship","enabled":false,"id":355,"name":"SearchRelationship","orderNumber":0,"parentModule":"71","path":"Employee Management.Employee Masters.SearchRelationship","serviceCode":"EIS Masters","url":"/egov-common-masters/relationships/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd77f0afe387c98f893510a0a17e9255c8902d5474432166c998051692d822add'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #233
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8ded28a9-5270-461d-94f2-002c63bef17a'::uuid, 'pg', '853dd6d18b911a41e3810fe84bf67b1d939b115116f8c42523e85d403ebcdf0c', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"SearchGender","enabled":false,"id":353,"name":"SearchGender","orderNumber":0,"parentModule":"71","path":"Employee Management.Employee Masters.SearchGender","serviceCode":"EIS Masters","url":"/egov-common-masters/genders/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '853dd6d18b911a41e3810fe84bf67b1d939b115116f8c42523e85d403ebcdf0c'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #234
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7802578d-b6f8-4acc-ae44-e36f4221c709'::uuid, 'pg', 'f2e4bcf599bf7c0daf9709771e685dcb97df7e8fc456b3ba045da14338e00483', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"BoundarySearch","enabled":false,"id":290,"name":"BoundarySearch","orderNumber":0,"parentModule":"67","path":"Location.BoundarySearch","serviceCode":"LOCATION_MS","url":"/boundarys"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f2e4bcf599bf7c0daf9709771e685dcb97df7e8fc456b3ba045da14338e00483'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #235
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fa9c3fc9-c0ca-43aa-ba9c-1a24e5b122bb'::uuid, 'pg', 'e95b62de3637b031ea46f8d8af2c0ed364e8e5d2de200e82b838621ea67c0918', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"filesearchbytag","enabled":false,"id":278,"name":"filesearchbytag","orderNumber":1,"parentModule":"76","path":"","serviceCode":"filesearchbytag","url":"/v1/files/tag"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'e95b62de3637b031ea46f8d8af2c0ed364e8e5d2de200e82b838621ea67c0918'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #236
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '321e5b08-70a2-4ce3-8d31-10beb07c8335'::uuid, 'pg', '14e251df6791710daa3a80ea15b4d315b9cc8e4cda06b6577593a9cf8fbea12f', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"filesearch","enabled":false,"id":277,"name":"filesearch","orderNumber":1,"parentModule":"76","path":"","serviceCode":"filesearch","url":"/v1/files/id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '14e251df6791710daa3a80ea15b4d315b9cc8e4cda06b6577593a9cf8fbea12f'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #237
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd648fe47-991a-4533-b333-630fb602d5dc'::uuid, 'pg', '3e69305363cec82c3558adab90080b3953c8b03979c5ab36316ea2d0777337e7', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"uploadfiles","enabled":false,"id":276,"name":"uploadfiles","orderNumber":1,"parentModule":"76","path":"","serviceCode":"uploadfiles","url":"/v1/files"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '3e69305363cec82c3558adab90080b3953c8b03979c5ab36316ea2d0777337e7'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #238
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b04f8635-8553-4987-9170-4386c3580984'::uuid, 'pg', '5575b73f9c0cb9fd1fa2637e426b58ddb2668fb68c1140c9c8ed018c30638b61', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get Boundaries by boundarytype and hierarchy Type","enabled":false,"id":266,"name":"Get Boundaries by boundarytype and hierarchy Type","orderNumber":1,"parentModule":"67","path":"Location.Get Boundaries by boundarytype and hierarchy Type","serviceCode":"LOCATION_MS","url":"/boundarys/boundariesByBndryTypeNameAndHierarchyTypeName"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '5575b73f9c0cb9fd1fa2637e426b58ddb2668fb68c1140c9c8ed018c30638b61'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #239
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '662dec02-a543-42f0-833a-4bbe9eee4c9e'::uuid, 'pg', '267c8f3acdee0f63bf8ebec3a61aba985a104b62e4b78bc820b7bb983114a1a5', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Create Boundary Type","enabled":false,"id":265,"name":"Create Boundary Type","orderNumber":1,"parentModule":"67","path":"Location.Create Boundary Type","serviceCode":"LOCATION_MS","url":"/boundarytype/create"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '267c8f3acdee0f63bf8ebec3a61aba985a104b62e4b78bc820b7bb983114a1a5'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #240
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd2e340a7-8896-4a5e-b9a4-572a8e5397be'::uuid, 'pg', 'd10bf91a40ffea2fefe73de9bf32f482f3091a5d3c31984c44a63c84a30c04da', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get Cross Hierarchy By Code","enabled":false,"id":264,"name":"Get Cross Hierarchy By Code","orderNumber":1,"parentModule":"67","path":"Location.Get Cross Hierarchy By Code","serviceCode":"LOCATION_MS","url":"/crosshierarchys/{code}"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'd10bf91a40ffea2fefe73de9bf32f482f3091a5d3c31984c44a63c84a30c04da'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #241
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f254ee7e-b6b8-4d6a-bdf6-e9ada3045f72'::uuid, 'pg', '51217c0c2562e631e8ea2aaa09dc6351e2c8a12d14f855d6dd648adadb1b2e22', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Cross Hierarchys","enabled":false,"id":263,"name":"Cross Hierarchys","orderNumber":1,"parentModule":"67","path":"Location.Cross Hierarchys","serviceCode":"LOCATION_MS","url":"/egov-location/crosshierarchys"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '51217c0c2562e631e8ea2aaa09dc6351e2c8a12d14f855d6dd648adadb1b2e22'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #242
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c8b06b51-dafa-4d1d-9d45-e7cca731778f'::uuid, 'pg', '481bdd833693875900c08abc81f04a95a3f47323583587eb8704759f9c8b9dc2', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get Heirarchy Type By Code","enabled":false,"id":262,"name":"Get Heirarchy Type By Code","orderNumber":1,"parentModule":"67","path":"Location.Get Heirarchy Type By Code","serviceCode":"LOCATION_MS","url":"/hierarchytypes/{code}"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '481bdd833693875900c08abc81f04a95a3f47323583587eb8704759f9c8b9dc2'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #243
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '68330a97-b92e-402e-b4ec-b8de48615e35'::uuid, 'pg', 'f15d25cc20b12a77f4fdb895185ab19f2d51daf7cb877c7c32ca3ac5d2479a37', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get Heirarchy Type","enabled":false,"id":261,"name":"Get Heirarchy Type","orderNumber":1,"parentModule":"67","path":"Location.Get Heirarchy Type","serviceCode":"LOCATION_MS","url":"/hierarchytypes"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'f15d25cc20b12a77f4fdb895185ab19f2d51daf7cb877c7c32ca3ac5d2479a37'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #244
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8c606ac6-c8d8-44ba-b58d-7e1e79550895'::uuid, 'pg', '2f2ac525b419b399381f5408bb36ff2ea5c7960f27a525dea4b41ec99ba54eec', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get City By City Request","enabled":false,"id":260,"name":"Get City By City Request","orderNumber":1,"parentModule":"67","path":"Location.Get City By City Request","serviceCode":"LOCATION_MS","url":"/city/getCitybyCityRequest"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '2f2ac525b419b399381f5408bb36ff2ea5c7960f27a525dea4b41ec99ba54eec'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #245
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '44879ca3-f302-4fb9-b6c5-188df691efc8'::uuid, 'pg', '0b31f1c24a84b530c31feca9d307e523d12084c872ff622747bb57e0e4c0fcd9', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get City","enabled":false,"id":259,"name":"Get City","orderNumber":1,"parentModule":"67","path":"Location.Get City","serviceCode":"LOCATION_MS","url":"/city"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '0b31f1c24a84b530c31feca9d307e523d12084c872ff622747bb57e0e4c0fcd9'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #246
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '218102ef-0f40-4be4-a220-c15ccb3d2c13'::uuid, 'pg', '0abf7ae2c1c364c39aed397f7766e3d88c7d2e3f49947d328550ec0450006d6d', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get BoundaryTypes By Heirarchy Type","enabled":false,"id":258,"name":"Get BoundaryTypes By Heirarchy Type","orderNumber":1,"parentModule":"67","path":"Location.Get BoundaryTypes By Heirarchy Type","serviceCode":"LOCATION_MS","url":"/egov-location/boundarytypes/getByHierarchyType"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '0abf7ae2c1c364c39aed397f7766e3d88c7d2e3f49947d328550ec0450006d6d'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #247
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '52e0bd81-2be8-4975-8a49-621520ca04b1'::uuid, 'pg', '766a37c59392ead8cdd8882a17385768778cbef86aa0271ab75eb2c952080f42', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get Boundary Type","enabled":false,"id":257,"name":"Get Boundary Type","orderNumber":1,"parentModule":"67","path":"Location.Get Boundary Type","serviceCode":"LOCATION_MS","url":"/egov-location/boundarytypes"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '766a37c59392ead8cdd8882a17385768778cbef86aa0271ab75eb2c952080f42'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #248
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '394c31a3-6bc1-4562-a61f-42f93f2c95a2'::uuid, 'pg', 'ff147f0444b0c7875581bd767adace2c9e1b3b0d89a24cf2701d36461701f149', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get Boundaries by Code","enabled":false,"id":256,"name":"Get Boundaries by Code","orderNumber":1,"parentModule":"67","path":"Location.Get Boundaries by Code","serviceCode":"LOCATION_MS","url":"/boundarys/{code}"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'ff147f0444b0c7875581bd767adace2c9e1b3b0d89a24cf2701d36461701f149'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #249
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '57ecb3bb-8f10-474d-904d-fca53f85b4e8'::uuid, 'pg', '368f106f92a6e49d51fdd08afc782e6f58a7bb373545691cb99e385aca67a0ec', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get Location by Location Name","enabled":false,"id":255,"name":"Get Location by Location Name","orderNumber":1,"parentModule":"67","path":"Location.Get Location by Location Name","serviceCode":"LOCATION_MS","url":"/boundarys/getLocationByLocationName"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '368f106f92a6e49d51fdd08afc782e6f58a7bb373545691cb99e385aca67a0ec'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #250
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e1aa941a-95f8-4450-a89c-8ce12d71fcc4'::uuid, 'pg', 'fcf79ab64f6ae1246d88e5bb955d5d70331083c82767151cedf2a60ccdb06c4c', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get Child locations by Boundary","enabled":false,"id":254,"name":"Get Child locations by Boundary","orderNumber":1,"parentModule":"67","path":"Location.Get Child locations by Boundary","serviceCode":"LOCATION_MS","url":"/egov-location/boundarys/childLocationsByBoundaryId"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'fcf79ab64f6ae1246d88e5bb955d5d70331083c82767151cedf2a60ccdb06c4c'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #251
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '75c754c5-e4e6-4e97-937f-98b1d05038c8'::uuid, 'pg', 'de648bd11238776e14e64c9f2db961c9f7ebf33364945ef10ae5ca2187ae4797', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get Boundary by Boundary Type","enabled":false,"id":253,"name":"Get Boundary by Boundary Type","orderNumber":1,"parentModule":"67","path":"Location.Get Boundary by Boundary Type","serviceCode":"LOCATION_MS","url":"/egov-location/boundarys/getByBoundaryType"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'de648bd11238776e14e64c9f2db961c9f7ebf33364945ef10ae5ca2187ae4797'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #252
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1f65e6b2-899a-48b0-a8c6-00a017d4526b'::uuid, 'pg', 'c53d7098529a3f64d269d77fb0bdd964bef0d4ec0dfb42d0493e37b15cf3efbf', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"CommonDepartmentsSearch","enabled":false,"id":207,"name":"CommonDepartmentsSearch","orderNumber":0,"parentModule":"71","path":"Employee Management.Employee Masters.CommonDepartmentsSearch","serviceCode":"EIS Masters","url":"/egov-common-masters/departments/_search"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = 'c53d7098529a3f64d269d77fb0bdd964bef0d4ec0dfb42d0493e37b15cf3efbf'
);

-- data/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json :: ACCESSCONTROL-ACTIONS-TEST.actions-test entry #253
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5876c92a-73c8-4fad-ac00-f60115ddfa4d'::uuid, 'pg', '43fb7e5b2ca06fc9e9a33ad163c9d36176fa626a3d30f3b494bd25c5c298ae20', 'ACCESSCONTROL-ACTIONS-TEST.actions-test', '{"code":"null","displayName":"Get File by FileStoreId","enabled":false,"id":14,"name":"Get File by FileStoreId","orderNumber":0,"parentModule":"PGR","path":"PGR.Get File by FileStoreId","queryParams":"fileStoreId=","serviceCode":"PGR","url":"/filestore/v1/files/id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ACTIONS-TEST.actions-test' AND uniqueidentifier = '43fb7e5b2ca06fc9e9a33ad163c9d36176fa626a3d30f3b494bd25c5c298ae20'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6b477438-3ad9-43a4-a0fc-b1abf8725c0e'::uuid, 'pg', 'f9c5beb3ac6fc33f070922e5a4c40a3be5884bef72262d54d0145ff46882c312', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2568,"id":1101,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f9c5beb3ac6fc33f070922e5a4c40a3be5884bef72262d54d0145ff46882c312'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3915a0c0-453c-4309-a89e-a1a2e295d4a3'::uuid, 'pg', 'e4dcc945a036a3530864afd28e9ed6f36111784b4e072938a41fa2b11e9d7515', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2568,"id":1101,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e4dcc945a036a3530864afd28e9ed6f36111784b4e072938a41fa2b11e9d7515'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0736a6ef-66cc-4aac-a29a-3bf032dac200'::uuid, 'pg', 'b649ae9c5d44fd0774125796d7e51fd1653620bd4758e51b84066e725bb4c999', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2568,"id":1101,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b649ae9c5d44fd0774125796d7e51fd1653620bd4758e51b84066e725bb4c999'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '29aee88d-bbed-4a40-961f-8dc1634fd468'::uuid, 'pg', '79ef376ead958eb2609885beee139981c3f779d97c4dcd0982103ee395778a2d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2568,"id":1101,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '79ef376ead958eb2609885beee139981c3f779d97c4dcd0982103ee395778a2d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9aa30ed3-9ee8-4941-8176-a66e6e8d6d32'::uuid, 'pg', '692551ccc383a3525895b225a719245aaee425fc61a5d83d0512ec97ee88be0a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2567,"id":1101,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '692551ccc383a3525895b225a719245aaee425fc61a5d83d0512ec97ee88be0a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '79e55f3f-3860-4f1c-a9f7-c7c74436b269'::uuid, 'pg', 'c3bb28fa05c8d65107cbcdbad5e17a1b44e662fbabb0d17bec633e891d5347fd', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2567,"id":1101,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c3bb28fa05c8d65107cbcdbad5e17a1b44e662fbabb0d17bec633e891d5347fd'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ab062238-7227-4e33-a7f6-00d465efe246'::uuid, 'pg', '043640001d2e9c52af46b75b07bad11f1494d7d42e643116eea0efb26e16116f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2567,"id":1101,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '043640001d2e9c52af46b75b07bad11f1494d7d42e643116eea0efb26e16116f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #8
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1f1c272f-da7d-4d14-a6fb-1293a8879968'::uuid, 'pg', '7a01765a2abc197162d1e858fbad1bf97c33cfbb489438f10bb8145bf973dc35', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2567,"id":1101,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7a01765a2abc197162d1e858fbad1bf97c33cfbb489438f10bb8145bf973dc35'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #9
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9c11be8b-fcd7-4ba1-b09b-452ac4be5d55'::uuid, 'pg', 'e8f6f18ec3244e27241ae26fea8db17bf5c035e1c234e384274838aee46a49e0', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2566,"id":1101,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e8f6f18ec3244e27241ae26fea8db17bf5c035e1c234e384274838aee46a49e0'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #10
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '489d52de-d4e2-4d87-9de0-cd92d61b8f2a'::uuid, 'pg', '6b5fbcb40288b0da7975ea16ba854e0f9bdfd7802448e6d33623b2e61025b23d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2565,"id":1101,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6b5fbcb40288b0da7975ea16ba854e0f9bdfd7802448e6d33623b2e61025b23d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #11
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5d533ede-225c-413d-bcc8-ffad83ef6fac'::uuid, 'pg', '7ad1c3b8c67f934f73669be67d9604fa590dc8f4988b5e4b486b4e0fc0ce09af', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2560,"id":1101,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7ad1c3b8c67f934f73669be67d9604fa590dc8f4988b5e4b486b4e0fc0ce09af'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #12
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '54321b17-5bd4-49b0-add3-a44a375f310d'::uuid, 'pg', 'd883427cfc1778e3f49ff680d76d804bcea6ae9da034a0e40aeee20d9e9b42b4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2560,"id":1101,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'd883427cfc1778e3f49ff680d76d804bcea6ae9da034a0e40aeee20d9e9b42b4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #13
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '49dbe6d1-155b-4ba9-b643-ee3e9fe39093'::uuid, 'pg', 'ee9b72b9fcbf2dc4c8ba98447f2f4d7b4584133175f7cfd81e554152f4de060b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2560,"id":1101,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ee9b72b9fcbf2dc4c8ba98447f2f4d7b4584133175f7cfd81e554152f4de060b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #14
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3db6955d-972e-4d85-bd8d-6370d4f1d0f6'::uuid, 'pg', '886e8888edc3f3c683db0a87c7c183a4082c841fb0bef8294cafd09be0b6eb76', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2560,"id":1101,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '886e8888edc3f3c683db0a87c7c183a4082c841fb0bef8294cafd09be0b6eb76'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #15
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '57b8dc7a-7962-4fc2-9c79-ccfbc1b052d4'::uuid, 'pg', 'a5843ca89169e671f5c3d237e0767f238569e43973f92ff1369f3894479206ff', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2560,"id":1101,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a5843ca89169e671f5c3d237e0767f238569e43973f92ff1369f3894479206ff'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #16
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '51274911-6d5a-4d78-9017-d85a03e0b4da'::uuid, 'pg', '7d97ee8bc37b98dfff5c89b5716c8f2dd9b83d06fb5e8c7e37b291023855a5ea', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2559,"id":1101,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7d97ee8bc37b98dfff5c89b5716c8f2dd9b83d06fb5e8c7e37b291023855a5ea'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #17
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9e86fb9d-5b5a-4e00-9cca-5ff63bbbff1d'::uuid, 'pg', '1ff7a44227126d63f175d3d3477ef270bbae8c94d859430a47922f2988fb90e2', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2561,"id":1101,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1ff7a44227126d63f175d3d3477ef270bbae8c94d859430a47922f2988fb90e2'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #18
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4ff54c68-28b2-4865-abf1-849687cb79c0'::uuid, 'pg', 'e2575160941e17b482467bf3a72c99a166bf14f1d12f3663d864f26ad2663f96', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2562,"id":1101,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e2575160941e17b482467bf3a72c99a166bf14f1d12f3663d864f26ad2663f96'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #19
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '96a6d774-9223-4733-b13e-f5394420d5c0'::uuid, 'pg', 'b8d6b456ff3c932de1da558a93c11fd8c377d9910efd9ce755923a96cc92ab84', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2562,"id":1101,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b8d6b456ff3c932de1da558a93c11fd8c377d9910efd9ce755923a96cc92ab84'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #20
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '390bf6a7-d6d5-4730-b91d-a164ba10ddaf'::uuid, 'pg', 'b5f5128abcc67ff163d3c81b94887b5a0bde15dedf8ddfbfaa3f25f42eeb2863', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2562,"id":1101,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b5f5128abcc67ff163d3c81b94887b5a0bde15dedf8ddfbfaa3f25f42eeb2863'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #21
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7ba87297-0f7e-45a0-870f-42fdf7d90cef'::uuid, 'pg', '6b3616e93daa77e7f9b2b7a20751f7ffde0ef3ca6d39f99de673ae834a3359b6', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2562,"id":1101,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6b3616e93daa77e7f9b2b7a20751f7ffde0ef3ca6d39f99de673ae834a3359b6'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #22
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '560a78f2-ac51-4b76-b680-72e5ac50e03f'::uuid, 'pg', '6ba23b30758878220b9eda1f616f43db07bdb1de36ea71bfbfaeb440dc0db48f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2562,"id":1101,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6ba23b30758878220b9eda1f616f43db07bdb1de36ea71bfbfaeb440dc0db48f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #23
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '17256769-72fd-47e1-add2-3c832c8241ea'::uuid, 'pg', 'e4db40d456ebec1e626fe10511cf038bc3c721248f62ccdf31a59fa2cc6ca4e9', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2563,"id":1101,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e4db40d456ebec1e626fe10511cf038bc3c721248f62ccdf31a59fa2cc6ca4e9'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #24
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ae548e98-ad74-4487-8fd6-de799d0bde1c'::uuid, 'pg', 'ec28558214ee1c11d5382bc39facccecae3dde275e64c55c6c48f6f659b1700d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2564,"id":1101,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ec28558214ee1c11d5382bc39facccecae3dde275e64c55c6c48f6f659b1700d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #25
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2e8f41ec-1cdf-4907-a6bf-3c3a926db2e9'::uuid, 'pg', 'cc4258153cfae764d9d8987a206d703aa82b9696887159a4ac78d82d92f71f6b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2564,"id":1101,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'cc4258153cfae764d9d8987a206d703aa82b9696887159a4ac78d82d92f71f6b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #26
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cf706d12-6ed3-444d-b2f2-db1b03455434'::uuid, 'pg', '182a82dced440a2b855e689f5bce4fd376339c1557c990d10562fbc5a9b5f890', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2564,"id":1101,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '182a82dced440a2b855e689f5bce4fd376339c1557c990d10562fbc5a9b5f890'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #27
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4bfe8cba-1c07-4fe6-a413-2e86b4582a67'::uuid, 'pg', '17f8416d06380468761966ae3632e1cec6a09b11bef66c6bdc4ad3fabf60b910', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2564,"id":1101,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '17f8416d06380468761966ae3632e1cec6a09b11bef66c6bdc4ad3fabf60b910'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #28
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c4b21e62-c565-475a-9101-dd5deb8adf82'::uuid, 'pg', 'f18c3db0c4a39982a00b2e07400a69de8d25da2fe0c5204294c59fd3c262d771', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2564,"id":1101,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f18c3db0c4a39982a00b2e07400a69de8d25da2fe0c5204294c59fd3c262d771'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #29
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8d046bcc-4188-4f0c-af6a-82837c413361'::uuid, 'pg', '3642c4183ecf565cd359eaad81fb2a3ec7e7a0af4013df7fb6f657a7b83482eb', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2558,"id":1100,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3642c4183ecf565cd359eaad81fb2a3ec7e7a0af4013df7fb6f657a7b83482eb'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #30
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fa770ece-aa2f-4804-91fa-d627ce1fd23c'::uuid, 'pg', '82aa5fb0547acd229d8619c43444ddb75938c29ce487e10282a208e69cc7691c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2557,"id":1099,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '82aa5fb0547acd229d8619c43444ddb75938c29ce487e10282a208e69cc7691c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #31
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '35f1a557-588a-40c9-bae3-bc01fd503afe'::uuid, 'pg', 'da39c19492475aad4a6cdcbb1937e53b5c74335f3d0af14519f6c89072cba3b9', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2557,"id":1098,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'da39c19492475aad4a6cdcbb1937e53b5c74335f3d0af14519f6c89072cba3b9'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #32
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ffc3d1e5-ecf2-45d2-b43f-7a9e8c8036ba'::uuid, 'pg', '30ce82b8a2f3c241143b6a57072c3e0cadca51a98fae5f0c4dc259bc6208fe2c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2557,"id":1097,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '30ce82b8a2f3c241143b6a57072c3e0cadca51a98fae5f0c4dc259bc6208fe2c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #33
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7e68c38f-9949-404e-8b6a-a3fdbe1e9fdc'::uuid, 'pg', '7e7cffaf21529457f2dc8c7fe94284cf45a75db60b26923b195ca1855b5aa516', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2557,"id":1096,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7e7cffaf21529457f2dc8c7fe94284cf45a75db60b26923b195ca1855b5aa516'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #34
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f75d64f4-f434-479f-b59b-4c5a3dd4f290'::uuid, 'pg', '33b8120824da06a7c71dc2fbb5ff5496e04f557564ca8de944012ff5322f0569', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2556,"id":1095,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '33b8120824da06a7c71dc2fbb5ff5496e04f557564ca8de944012ff5322f0569'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #35
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'abe0500c-45a6-4390-a2f5-9e17e6396279'::uuid, 'pg', '5b355c08aecc132cebee9458c1a24c792eca30a12d9083ea0406d8a3b6c9f7fa', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2556,"id":1094,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '5b355c08aecc132cebee9458c1a24c792eca30a12d9083ea0406d8a3b6c9f7fa'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #36
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '50189638-f271-49ea-9f04-6eac1e6fe208'::uuid, 'pg', '15c33e0cfc3b40392421acc68a852935d95b627073c6c9b259521206df9d819d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2556,"id":1093,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '15c33e0cfc3b40392421acc68a852935d95b627073c6c9b259521206df9d819d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #37
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b68082a7-833f-42d8-8ab5-f5ba27a6c39f'::uuid, 'pg', 'a1dea2e39f1a7e5c56d4e6847df833b5397eb8a86a2ba5ec3065377773038df0', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2556,"id":1092,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a1dea2e39f1a7e5c56d4e6847df833b5397eb8a86a2ba5ec3065377773038df0'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #38
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd05ea37a-55a6-488e-80e6-778f0d705f24'::uuid, 'pg', '77a07de7b9790c8737f2cc2829fd731dd2b9c0f73db722aded68e39cb6024f06', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2556,"id":1091,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '77a07de7b9790c8737f2cc2829fd731dd2b9c0f73db722aded68e39cb6024f06'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #39
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6775306e-1c50-4d63-a39f-0c4b0eb38dc7'::uuid, 'pg', '5d1df909557ee337a5cbaa094f60f2e0cec29f102d57550b96d647ae01add508', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1556,"id":1087,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '5d1df909557ee337a5cbaa094f60f2e0cec29f102d57550b96d647ae01add508'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #40
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dec9a5f5-0051-4c48-b5d3-cea5f5127727'::uuid, 'pg', 'f5879df8f3cfe4a33658024652ff80d3691730f65f101b3cd784eeeaea6acbe5', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1556,"id":1085,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f5879df8f3cfe4a33658024652ff80d3691730f65f101b3cd784eeeaea6acbe5'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #41
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f163c0d0-739f-4b31-a408-36728d141619'::uuid, 'pg', '64bf6691b2533db25d429e9da842e371e61be698c26021b6d6f0e0c7b8ab1b44', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2549,"id":1084,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '64bf6691b2533db25d429e9da842e371e61be698c26021b6d6f0e0c7b8ab1b44'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #42
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a9029be7-5851-40d7-851d-c81d89803bd1'::uuid, 'pg', '240f689447ea73267ce2e8ba98801052f2822ec72a4a7ddaf4ccc81cf4248d6a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2555,"id":1083,"rolecode":"AUTO_ESCALATE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '240f689447ea73267ce2e8ba98801052f2822ec72a4a7ddaf4ccc81cf4248d6a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #43
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd462e760-bbb4-4637-b336-e2d752844ca3'::uuid, 'pg', '1c6d39a1ca9f4b4de8acd1300693274c558c2821d8bd873eaab57ce08c510fde', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1429,"id":1082,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1c6d39a1ca9f4b4de8acd1300693274c558c2821d8bd873eaab57ce08c510fde'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #44
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ba467a1c-129c-45f4-bfbe-dcab1648cd6d'::uuid, 'pg', '3bccb581a57c526b30db1f888492e94b6ddf872c09f12ee0277600836ec59de6', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2025,"id":1076,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3bccb581a57c526b30db1f888492e94b6ddf872c09f12ee0277600836ec59de6'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #45
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3d986d4d-2439-4ba2-82de-49de37a0a141'::uuid, 'pg', 'f5e8e5835d072a850655e40ae409e3658d0318a5ce95d38a8365a7665aa9fe00', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2550,"id":1074,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f5e8e5835d072a850655e40ae409e3658d0318a5ce95d38a8365a7665aa9fe00'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #46
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f943a636-b3f7-4267-9860-f12d3f356b2d'::uuid, 'pg', '719ff47440db12f6b472ea3d5b3a4233ca42f2db7684323eb4f87b53349c263e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2553,"id":1073,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '719ff47440db12f6b472ea3d5b3a4233ca42f2db7684323eb4f87b53349c263e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #47
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6a8dad28-f392-4662-98c1-ea183ff8ea21'::uuid, 'pg', 'bb0962e338095372763e9fd61d43c3e0e0b8ba1c101b1b7f5e12d758e927bd63', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2554,"id":1072,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'bb0962e338095372763e9fd61d43c3e0e0b8ba1c101b1b7f5e12d758e927bd63'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #48
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '47122397-98fb-4ccb-8cda-0db2412b316f'::uuid, 'pg', 'e2646f2c2246ce1a7e8564d355581d34544fecd37711524afb5f007379d6902e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2553,"id":1068,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e2646f2c2246ce1a7e8564d355581d34544fecd37711524afb5f007379d6902e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #49
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '79bc0d20-241a-4724-81b9-249567424135'::uuid, 'pg', '8bebc53824e6b1cffd5109e572c2aab4f4b62ff2ba0988268844d25036541392', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2553,"id":1067,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '8bebc53824e6b1cffd5109e572c2aab4f4b62ff2ba0988268844d25036541392'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #50
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5365b377-f85b-46d0-9de1-be95e612ea5c'::uuid, 'pg', '6e61bcb1f015e7c1a11fbfa7c6cb864c790f30219240756a484f1503a14bcbfb', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":604,"id":1066,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6e61bcb1f015e7c1a11fbfa7c6cb864c790f30219240756a484f1503a14bcbfb'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #51
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5c50a1b9-9193-43bd-baff-b8ed8f28a297'::uuid, 'pg', '35af067396aec87afcbf3b3616e262125ebddb838957a60bea7cc2338d2679be', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":604,"id":1065,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '35af067396aec87afcbf3b3616e262125ebddb838957a60bea7cc2338d2679be'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #52
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'aa1e99e0-15fc-46cc-94d2-e9903e5905dc'::uuid, 'pg', 'b4aa7bf205e01cea249ce2fa34bc235b08886531bc2722f6d23d4d157b5f8352', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":604,"id":1064,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b4aa7bf205e01cea249ce2fa34bc235b08886531bc2722f6d23d4d157b5f8352'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #53
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '66096ece-f15a-4425-bbca-c351a7b13f73'::uuid, 'pg', '107b3e5dcaac54caf2083031f36e4f8832125337c067402621729aa9ff9e31fc', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":604,"id":1063,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '107b3e5dcaac54caf2083031f36e4f8832125337c067402621729aa9ff9e31fc'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #54
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b3f68c6d-74bb-44b5-9661-15dea348fa5a'::uuid, 'pg', 'fca1a980bc1d8377cf64b8dcd120854100e9b4f752a00a419d7a7c74df26b842', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2551,"id":1062,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'fca1a980bc1d8377cf64b8dcd120854100e9b4f752a00a419d7a7c74df26b842'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #55
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3be00d24-c69d-4c33-a89e-7bf69b1967e6'::uuid, 'pg', '62b7a4636a35861032149427276ed0f1ad9235693aaec591e5bdd8f79b030438', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2551,"id":1061,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '62b7a4636a35861032149427276ed0f1ad9235693aaec591e5bdd8f79b030438'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #56
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '12573571-8883-4d86-99e2-c222801f9d51'::uuid, 'pg', '68f7461d4819635c8b26a95083d913e2d024894cb184ab1346d43d5f4adc8d7c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2551,"id":1060,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '68f7461d4819635c8b26a95083d913e2d024894cb184ab1346d43d5f4adc8d7c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #57
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1b68f3bc-c54b-4274-9e07-71c40dc4d61b'::uuid, 'pg', '4890a492fe0e49cc7ba3f16cd341a95a64d5bd286cb7cb66a400922b5f37d375', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2551,"id":1059,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4890a492fe0e49cc7ba3f16cd341a95a64d5bd286cb7cb66a400922b5f37d375'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #58
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '10f3eadc-6b19-4b6f-9349-b0055650e9cd'::uuid, 'pg', '637748195032a4a5f8c61540f707d0ab18f3e6085b18589a8efad1f7a4a53497', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2550,"id":1056,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '637748195032a4a5f8c61540f707d0ab18f3e6085b18589a8efad1f7a4a53497'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #59
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3bb4c840-7a15-422a-916a-0c643422b0d2'::uuid, 'pg', 'dc1a8ae84504df81e9b8ae397d9390783eb02da33555c0828c81bcf015cde03b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2550,"id":1055,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'dc1a8ae84504df81e9b8ae397d9390783eb02da33555c0828c81bcf015cde03b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #60
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5d499ea1-c7fb-4650-b117-43063d839ba6'::uuid, 'pg', '1bff3ae511041d16e10b4171340c3664de18489087f846093f381f6c27f4ba6f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2549,"id":1053,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1bff3ae511041d16e10b4171340c3664de18489087f846093f381f6c27f4ba6f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #61
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '41672ac2-cdae-4449-8a87-a02fcdf38c82'::uuid, 'pg', '2927a332c5083aceb28323a9702114740ece066dc30f65ae6229dccff6245d69', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2549,"id":1052,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '2927a332c5083aceb28323a9702114740ece066dc30f65ae6229dccff6245d69'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #62
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e420a83e-fa1c-40ab-93ab-5651937f2061'::uuid, 'pg', 'b3396b32e75b0ed4408e705d8343ef3cc96552ab7eb08d12e85ea5fff3a95083', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2548,"id":1051,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b3396b32e75b0ed4408e705d8343ef3cc96552ab7eb08d12e85ea5fff3a95083'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #63
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b46cd421-22df-44e2-aaaa-0bc1eaae338d'::uuid, 'pg', 'b9f144ea5a2fb560a7e63ea6c6583733a655ac76bf7e0367313da96a197cd8ac', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2540,"id":1050,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b9f144ea5a2fb560a7e63ea6c6583733a655ac76bf7e0367313da96a197cd8ac'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #64
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ce921ffc-9c0a-4f91-8aa4-4327081baf25'::uuid, 'pg', 'a4c06df26d9f7c396605f89c6695bae1736a6055bd4cbc7aeedae6bdd3f54611', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2539,"id":1049,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a4c06df26d9f7c396605f89c6695bae1736a6055bd4cbc7aeedae6bdd3f54611'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #65
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cbdc3661-cc43-4a0a-8842-c14852b5445b'::uuid, 'pg', '8187774c59771493a531a3fabb722af963aac0ed6c818956086cf41b96ee6bac', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2538,"id":1048,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '8187774c59771493a531a3fabb722af963aac0ed6c818956086cf41b96ee6bac'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #66
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b883b284-d61c-43d8-8afd-4847d0870534'::uuid, 'pg', '6d40628869df586a8113ff76ea74a2824b8eba668d3b995e6a93652a2e385810', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1734,"id":1047,"rolecode":"LOC_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6d40628869df586a8113ff76ea74a2824b8eba668d3b995e6a93652a2e385810'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #67
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '81c18025-15a5-495c-8eb3-9c9725567c9e'::uuid, 'pg', '9887ff7a3a1f8144862f1de7022dbc3e516caabcb29df933140e45371e2f525e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2537,"id":1046,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '9887ff7a3a1f8144862f1de7022dbc3e516caabcb29df933140e45371e2f525e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #68
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '46f4d740-0476-4ea6-a705-530a5d8a66e7'::uuid, 'pg', '3394e48823bb0f0fc3e1fc0dc34e17dee1844d502bf1909ef11c5f923e0b3518', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2536,"id":1045,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3394e48823bb0f0fc3e1fc0dc34e17dee1844d502bf1909ef11c5f923e0b3518'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #69
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7428e460-485f-4029-8d7c-0fcb2648c9c0'::uuid, 'pg', 'b9af7369130889a952ecaab9861279fcc8a5ea98a356bd2001499b0428369704', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2535,"id":1044,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b9af7369130889a952ecaab9861279fcc8a5ea98a356bd2001499b0428369704'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #70
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd503d6c1-68f7-4de2-a34f-9fe1648dd6e3'::uuid, 'pg', 'f9b96dbadfdd18f8736109526cd9d4f89c628082cd83547eeef086b8f494ba5f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2534,"id":1043,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f9b96dbadfdd18f8736109526cd9d4f89c628082cd83547eeef086b8f494ba5f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #71
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fe71a2d8-b283-4473-adc2-e410c297fd2a'::uuid, 'pg', 'db3fc37df8b4beabb31a32e4a93aeb5c777aa266b7d4fab1986a691c8693d94f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2533,"id":1042,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'db3fc37df8b4beabb31a32e4a93aeb5c777aa266b7d4fab1986a691c8693d94f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #72
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e82c248d-5040-4b32-8542-e7a4ddd2d20b'::uuid, 'pg', 'a5f7e8eb81fbefe02105d6fa84cbee38afdb620bf23c3ea03231698d0568ff44', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2532,"id":1041,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a5f7e8eb81fbefe02105d6fa84cbee38afdb620bf23c3ea03231698d0568ff44'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #73
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cafdb864-b6d2-452d-80c8-686f84ebba10'::uuid, 'pg', 'b522166df7131aa252f829026b073080b54667ccdfca1104e4d3d2fb0c3d46f7', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2531,"id":1040,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b522166df7131aa252f829026b073080b54667ccdfca1104e4d3d2fb0c3d46f7'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #74
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4e547468-63d4-4cc9-8162-30876c24be4a'::uuid, 'pg', '60c09b3171198871f657e1ff0fbbd212fdffea4d66cc929408d7a813b4782b78', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2530,"id":1039,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '60c09b3171198871f657e1ff0fbbd212fdffea4d66cc929408d7a813b4782b78'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #75
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ca395e4b-a9b5-49ea-8661-16279f92891b'::uuid, 'pg', '3668e9591672ce240dca901ff46748fa73993d87e3936d809a338dabfa54b5ff', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2529,"id":1038,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3668e9591672ce240dca901ff46748fa73993d87e3936d809a338dabfa54b5ff'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #76
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd7617c7b-6c62-4e71-8119-89bcdf590dff'::uuid, 'pg', 'f5452f3469e501186e53f1e8433d8e87eb9d9b3e5f6e9d411d92712d8ad8087f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2528,"id":1037,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f5452f3469e501186e53f1e8433d8e87eb9d9b3e5f6e9d411d92712d8ad8087f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #77
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '07060875-61c1-4a55-b782-dccfd2e38ec6'::uuid, 'pg', 'b9738ab92d130dc5d4249ae82c873bb8c893a188bb14c3b52a859836bdd0d5d8', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2527,"id":1036,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b9738ab92d130dc5d4249ae82c873bb8c893a188bb14c3b52a859836bdd0d5d8'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #78
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2edafc65-de3a-4cde-9131-3c99cf533fad'::uuid, 'pg', '7d501c8c5b86f19f176df33de0df0539871d15b3ef3b06ec02422d13aa75b56a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2526,"id":1035,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7d501c8c5b86f19f176df33de0df0539871d15b3ef3b06ec02422d13aa75b56a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #79
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '54031ad6-a8e8-41d7-9f21-c74892a7c58c'::uuid, 'pg', 'e2fb293d66322bd39338b431f828f00135af44bb1eb62b401a92c700b765cc2e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1556,"id":1034,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e2fb293d66322bd39338b431f828f00135af44bb1eb62b401a92c700b765cc2e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #80
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd746bd68-278d-4d39-a596-cd1a963bbc7a'::uuid, 'pg', '5886a56d7b352e5d0eb71e71b7940020067a2bd5cfc00bfefa2f8366d379b360', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":699,"id":1033,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '5886a56d7b352e5d0eb71e71b7940020067a2bd5cfc00bfefa2f8366d379b360'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #81
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '37c66bc8-bd32-4614-9c9c-56a9aad4b0e9'::uuid, 'pg', '558207002ff29516abf7508f8c1889ae919dce5b9f2b50fe67db612f747f37f4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":698,"id":1032,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '558207002ff29516abf7508f8c1889ae919dce5b9f2b50fe67db612f747f37f4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #82
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e3ee64c1-fb00-48a4-826d-0c08ec0c8ca0'::uuid, 'pg', '6fee2a402b3dee51168fdfb528f6982e9ef5c318f4ea8cb8bf0f36c310def685', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2516,"id":1031,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6fee2a402b3dee51168fdfb528f6982e9ef5c318f4ea8cb8bf0f36c310def685'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #83
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1af3e0b4-17fa-4284-821d-677f595bceb6'::uuid, 'pg', '7d45a8a2852315a30cf867fd25351a6bf8cb1c76e0babb04ef43b2dce7873d57', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2515,"id":1030,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7d45a8a2852315a30cf867fd25351a6bf8cb1c76e0babb04ef43b2dce7873d57'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #84
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2e17b4e9-186e-44c4-9aba-bcf5377a0f66'::uuid, 'pg', 'baf38b22737800d0233de72f8090844466ff3d5ffe6ebba40fe268b9cdc86f0b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2513,"id":1029,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'baf38b22737800d0233de72f8090844466ff3d5ffe6ebba40fe268b9cdc86f0b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #85
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b87e803d-68c1-43fb-b3d1-3086854625d7'::uuid, 'pg', 'f4685debb0ed46258d5f2715884b989eefc4e85e2e115f22c502285f9c7e669a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2510,"id":1028,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f4685debb0ed46258d5f2715884b989eefc4e85e2e115f22c502285f9c7e669a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #86
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3de2551b-66b5-4121-bed5-5210923708f5'::uuid, 'pg', 'f54dc3d29f1e933460725cc64896f530142008ac0f4d580eadd0fab91facc305', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2509,"id":1027,"rolecode":"MDMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f54dc3d29f1e933460725cc64896f530142008ac0f4d580eadd0fab91facc305'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #87
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6db6dfcf-ad7a-42d8-854d-6dbab4863251'::uuid, 'pg', 'a2d2f4c804179544054b7eb74282e3aa6bc85cb197923bf96a5ca8a2c9d73677', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":695,"id":1024,"rolecode":"REINDEXING_ROLE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a2d2f4c804179544054b7eb74282e3aa6bc85cb197923bf96a5ca8a2c9d73677'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #88
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '319d3a87-47cc-433b-a67a-1c83f3bfd2f3'::uuid, 'pg', 'a91aba9809cd5012096dc809df5ebe2d961ce90b3cbd4c5c48282c71faf0ebba', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":701,"id":990,"rolecode":"COMMON_EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a91aba9809cd5012096dc809df5ebe2d961ce90b3cbd4c5c48282c71faf0ebba'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #89
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8a0857ab-e9bf-488e-81c5-64a0471587d0'::uuid, 'pg', '1177685d29659237fb9a9442891604692f6df005cb97b2662fc1427866bd2b49', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":699,"id":989,"rolecode":"COMMON_EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1177685d29659237fb9a9442891604692f6df005cb97b2662fc1427866bd2b49'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #90
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '52d01dc8-8c35-42de-a0c9-7153f66d92f9'::uuid, 'pg', 'a21ec00481d22281b0912924b0de48925f97e05fba01aa24b4061520142a7f59', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":698,"id":988,"rolecode":"COMMON_EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a21ec00481d22281b0912924b0de48925f97e05fba01aa24b4061520142a7f59'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #91
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6371765f-f1fa-456f-9890-ebdba5a5c973'::uuid, 'pg', 'c8b78349226d9f2af49243fa0f6c5b6f0634dcd96ce2038001413b5ad38bbfd3', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":698,"id":968,"rolecode":"HRMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c8b78349226d9f2af49243fa0f6c5b6f0634dcd96ce2038001413b5ad38bbfd3'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #92
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '441d9a21-19a3-4c1a-aa78-16f85bb5421e'::uuid, 'pg', '4308b0daf92b964480e606fa8048005c83597849073bd49cca01197064b63784', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2317,"id":934,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4308b0daf92b964480e606fa8048005c83597849073bd49cca01197064b63784'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #93
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '17a826f4-ee4d-4913-94e4-e86211404c4a'::uuid, 'pg', '058dbfa1d06e9b07b5c9dc136ee5b9240b6bb006c5943ab1832225b195179dd2', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2317,"id":933,"rolecode":"HRMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '058dbfa1d06e9b07b5c9dc136ee5b9240b6bb006c5943ab1832225b195179dd2'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #94
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b17760da-ae5b-4bb5-b0dc-3974f804f84b'::uuid, 'pg', '5fd3260cce2904c956d4e1b1f3be360228b92fd2e836084e72de92c82154a23f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2317,"id":931,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '5fd3260cce2904c956d4e1b1f3be360228b92fd2e836084e72de92c82154a23f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #95
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c9b8604d-fdd9-401b-850e-a8ee2342622c'::uuid, 'pg', '8fa3a6d842b4cf3e21cf9007f49e68df46401e1b1bf58802f867d07975a6e3c4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2317,"id":930,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '8fa3a6d842b4cf3e21cf9007f49e68df46401e1b1bf58802f867d07975a6e3c4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #96
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8bc953e3-f331-40e4-9afe-b207e2991dce'::uuid, 'pg', '0e34f4757f2ecb834f32bf36d5d42e48e7185415e65c66e22146ed372b7b5064', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2317,"id":923,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '0e34f4757f2ecb834f32bf36d5d42e48e7185415e65c66e22146ed372b7b5064'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #97
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1484eda9-1fc8-46d4-968d-4b5e3b3cfdfe'::uuid, 'pg', 'ea0dd63b54e5ed2ec4824697f2df4bf96ba8ec7f630b4867e3540f207c505fcc', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2317,"id":921,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ea0dd63b54e5ed2ec4824697f2df4bf96ba8ec7f630b4867e3540f207c505fcc'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #98
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9fd3560e-8441-4124-80ba-23f8be30e66b'::uuid, 'pg', '22cc763196d451fcd6ff333cb911a7c3570774a6057e298283e20cc037ee3efe', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":699,"id":887,"rolecode":"SUPERVISOR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '22cc763196d451fcd6ff333cb911a7c3570774a6057e298283e20cc037ee3efe'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #99
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a6e3f272-a7b1-42dc-afb0-c38125370543'::uuid, 'pg', 'a8cd1535e4b1e957fe53ddb83c10b926627fa53bbfba3aad700ed42f70ebc013', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2008,"id":886,"rolecode":"SUPERVISOR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a8cd1535e4b1e957fe53ddb83c10b926627fa53bbfba3aad700ed42f70ebc013'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #100
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'df4a3238-80ea-4dbf-8af2-81a819cd7758'::uuid, 'pg', 'da95a22ba9e43566baff8bc6d614567851d657de28fe8de311a9689c0478cc32', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2007,"id":885,"rolecode":"SUPERVISOR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'da95a22ba9e43566baff8bc6d614567851d657de28fe8de311a9689c0478cc32'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #101
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c06d51c6-a72d-40e2-8461-3917ba48baed'::uuid, 'pg', '23c8ff9434e77f980410602121ddb36264c8ca6daff4a84a4f5279f6095892af', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2156,"id":877,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '23c8ff9434e77f980410602121ddb36264c8ca6daff4a84a4f5279f6095892af'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #102
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b5f9d19e-7808-46a7-b129-0910b066b62d'::uuid, 'pg', 'dccc9154a4a0b8bcd92c71aec19307a19002f7da44681d55b71051b6ff972df0', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2156,"id":852,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'dccc9154a4a0b8bcd92c71aec19307a19002f7da44681d55b71051b6ff972df0'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #103
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'bd076358-4c17-4ccc-b289-f2c35d30f0a9'::uuid, 'pg', '36d00f37f9792a202763bc6da9fffc44d2337505d79d8bc64bf438a1b225e8f0', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2156,"id":850,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '36d00f37f9792a202763bc6da9fffc44d2337505d79d8bc64bf438a1b225e8f0'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #104
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7ff7e8f6-a0c7-42de-ab75-7d2702825359'::uuid, 'pg', '0ef46324dd0c37cdb2346551e472629d9b55dee340927f6bca44e132153a1e40', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2156,"id":849,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '0ef46324dd0c37cdb2346551e472629d9b55dee340927f6bca44e132153a1e40'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #105
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0a5fa9dd-32bb-4f29-b5d0-0e32d4713897'::uuid, 'pg', '85f5babc45526c31ae9c05a91abb93f5bcd893a772c3f0f903cecd1d755edace', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2156,"id":848,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '85f5babc45526c31ae9c05a91abb93f5bcd893a772c3f0f903cecd1d755edace'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #106
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0246b82f-4a97-44e6-bb9f-09210536960c'::uuid, 'pg', '0892e16b6a7a1d8540b8c223b6d2f74e08988fd899704eef10c9f3c3ccfead93', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1750,"id":840,"rolecode":"HRMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '0892e16b6a7a1d8540b8c223b6d2f74e08988fd899704eef10c9f3c3ccfead93'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #107
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4381b765-b771-44f6-8ea6-832ca3e903b0'::uuid, 'pg', '7efca3e26355d0d20a9a38a97ead5afca3969fbddd7929349dac4f6eb397d7e4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1752,"id":839,"rolecode":"HRMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7efca3e26355d0d20a9a38a97ead5afca3969fbddd7929349dac4f6eb397d7e4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #108
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2acc943d-aba1-4a34-a3b1-00c4479ee979'::uuid, 'pg', '0659d6599378803a81d086bde669285b3f702e4e730d55239edaf74d8cdde4bd', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1752,"id":835,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '0659d6599378803a81d086bde669285b3f702e4e730d55239edaf74d8cdde4bd'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #109
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dec6db38-03d4-4f9d-b3ba-160a5ca24c4c'::uuid, 'pg', '2ef6e25e9b8cdb0225720962109de32b8912a673f88b531c823d080ff9fbccaa', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2149,"id":834,"rolecode":"HRMS_ADMIN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '2ef6e25e9b8cdb0225720962109de32b8912a673f88b531c823d080ff9fbccaa'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #110
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '89642676-906a-4367-a45e-3e9c2d02ca46'::uuid, 'pg', '7355b875c53e60faf12211bbcca0241abd1eb4891a10a59207c488ce7b7bd9c7', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2149,"id":833,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7355b875c53e60faf12211bbcca0241abd1eb4891a10a59207c488ce7b7bd9c7'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #111
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dc2492ea-07bd-467b-b763-942c7caf5918'::uuid, 'pg', '44f084778721eed4791d3e2a35fa36623bbea83aa8c6854776e6e2c974f0f48f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1991,"id":793,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '44f084778721eed4791d3e2a35fa36623bbea83aa8c6854776e6e2c974f0f48f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #112
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8cc8d7f5-68fe-4672-b564-345f496d7b0b'::uuid, 'pg', '92cd30abf4002396e106a1b4e5914cfb97cc9bec61966e11c09ddd0b669fce49', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2009,"id":746,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '92cd30abf4002396e106a1b4e5914cfb97cc9bec61966e11c09ddd0b669fce49'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #113
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9e7bb185-0f53-4b4d-b2a4-df15e8362db2'::uuid, 'pg', '3d06e685fa24791349dd98f023580cf8ac04f072bd25b8c8373f3d6cc90543f6', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1743,"id":745,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3d06e685fa24791349dd98f023580cf8ac04f072bd25b8c8373f3d6cc90543f6'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #114
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd1e8eb7a-5f9d-43d6-8af4-1a61ca7e3e60'::uuid, 'pg', 'f9787e1d703aa44fc7ae9d5139be46352d8b7d6bf89b022add4502a6f5ab0499', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1743,"id":744,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f9787e1d703aa44fc7ae9d5139be46352d8b7d6bf89b022add4502a6f5ab0499'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #115
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cf234885-6b60-4e6d-a29f-aac8c981183b'::uuid, 'pg', '4435b82b4b15621006b3d2d78ec99549ce801a6a1c7863092f5f208a74ddead5', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1743,"id":743,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4435b82b4b15621006b3d2d78ec99549ce801a6a1c7863092f5f208a74ddead5'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #116
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd24a439f-11c3-470f-a1f2-e288220a1e4d'::uuid, 'pg', 'c6d829b62bf1541f37cc79339cae65d03fab8c865d40426013e181a1f21b17a2', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1730,"id":742,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c6d829b62bf1541f37cc79339cae65d03fab8c865d40426013e181a1f21b17a2'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #117
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0aed0fc4-0a29-4046-93ca-d496e1bb0b0f'::uuid, 'pg', '4b7d7485d3f9462aebd007a328b1ddb88428968dc31db35e4e2f50639eb5c2b6', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1730,"id":741,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4b7d7485d3f9462aebd007a328b1ddb88428968dc31db35e4e2f50639eb5c2b6'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #118
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '75a9e0b2-76f9-4269-ad31-07eb648a0f6b'::uuid, 'pg', 'f3d46abd7e4b136c1f25b35d7e5e561941e842b1523335fd662771bbebef3a2e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":699,"id":713,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f3d46abd7e4b136c1f25b35d7e5e561941e842b1523335fd662771bbebef3a2e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #119
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '721941fb-cd16-40e3-8114-225f58d95621'::uuid, 'pg', 'a2dc5c9e25b022cc07c1e24ab701c4517757255ec8bffb747ac854ee53c46ee5', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":699,"id":712,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a2dc5c9e25b022cc07c1e24ab701c4517757255ec8bffb747ac854ee53c46ee5'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #120
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1cdeaf5c-e3fd-4f42-a28a-21087bdcfa17'::uuid, 'pg', '1411cc7afa4d725a90b3a42dde9e787653e46bb4b533e37875e8152e8523450a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2036,"id":601,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1411cc7afa4d725a90b3a42dde9e787653e46bb4b533e37875e8152e8523450a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #121
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '33c94d4d-e6c9-4f66-8b81-03cff6b4f46b'::uuid, 'pg', 'b8a3b5ad1f1ef8fbc5577717478d645997d003a528e652040452ee93765d06e5', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2035,"id":599,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b8a3b5ad1f1ef8fbc5577717478d645997d003a528e652040452ee93765d06e5'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #122
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '11e1dfa4-b43a-497c-92b7-2bd460bd9fca'::uuid, 'pg', '062bfb3462b38204e9ff837b2b34ac9ab886b87e465ab47b08b6f41eac1ad686', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2034,"id":594,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '062bfb3462b38204e9ff837b2b34ac9ab886b87e465ab47b08b6f41eac1ad686'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #123
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3ad14300-097d-48fb-ac65-cc31369a931c'::uuid, 'pg', '98514c685ae9bb05c9a9901a8d404cf891b882d436deba6377f822f8831622fc', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2033,"id":591,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '98514c685ae9bb05c9a9901a8d404cf891b882d436deba6377f822f8831622fc'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #124
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9c795d37-07e7-4d69-a514-a0ed0eb80777'::uuid, 'pg', '070de5bf8537139c8827e4a7978458c310181551bac0cb0072d0d1b1477cee8d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2032,"id":590,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '070de5bf8537139c8827e4a7978458c310181551bac0cb0072d0d1b1477cee8d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #125
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7276a1a8-da8f-473f-b4ac-589e9f1b7700'::uuid, 'pg', '93c46209303102433b16450a1aa4da1b4fad7a38eba250047ae7ed0f0186b745', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2030,"id":578,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '93c46209303102433b16450a1aa4da1b4fad7a38eba250047ae7ed0f0186b745'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #126
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '68a3fe98-ae68-44fa-b62f-aea0110b5c3a'::uuid, 'pg', '289522e69c9e9c202aac98e5099cee0daebbcbbcc644342fc2cc35716cee10be', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2029,"id":576,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '289522e69c9e9c202aac98e5099cee0daebbcbbcc644342fc2cc35716cee10be'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #127
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3a24f9a7-fe93-4c2b-8998-0af30e632047'::uuid, 'pg', 'f3ba6d6defce092f0e6e10e4927e57ce3665b39822eca83af01ddd3b768cd34d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2036,"id":575,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f3ba6d6defce092f0e6e10e4927e57ce3665b39822eca83af01ddd3b768cd34d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #128
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd29d78d1-a725-4393-b8a6-cbab860326f0'::uuid, 'pg', 'd1535c2f4b98bfcb9ad5f1a52254d36839246253b7e2b08a68677988d3ebed4d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2029,"id":574,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'd1535c2f4b98bfcb9ad5f1a52254d36839246253b7e2b08a68677988d3ebed4d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #129
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '45d5bbfb-46f2-4b92-8cae-7a73496017ab'::uuid, 'pg', 'c07b5f5d8e5c6bbbc868739a0b4ddb7bb7bf1cd6e0d71ecd726e23680d028095', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2021,"id":533,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c07b5f5d8e5c6bbbc868739a0b4ddb7bb7bf1cd6e0d71ecd726e23680d028095'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #130
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '70d373f3-4a36-4e83-8638-1bddad3641e8'::uuid, 'pg', '585f7ddbcb6a7f82822bc89e242e7368caf8e83fda6c8d93cc23669a969582b1', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2021,"id":532,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '585f7ddbcb6a7f82822bc89e242e7368caf8e83fda6c8d93cc23669a969582b1'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #131
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd63fa12d-26bc-4df3-8d5b-5e8e38c83263'::uuid, 'pg', 'fee7236e7e5b4ff323c4629a542ce0f4329a3a347871ec6e4d36349ea898a767', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2020,"id":531,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'fee7236e7e5b4ff323c4629a542ce0f4329a3a347871ec6e4d36349ea898a767'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #132
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '01ee8592-f90b-4f83-a4a4-2b3203e060eb'::uuid, 'pg', '902840f8f1b19d11bf2e771032261392f2371ee5de47f166255946deeb0b8725', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2020,"id":530,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '902840f8f1b19d11bf2e771032261392f2371ee5de47f166255946deeb0b8725'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #133
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd5e9cf71-aa3e-4316-a421-25aa927df987'::uuid, 'pg', 'bbb951e2a9a18c28edb4a203f1682a27e87320fa69bdc7c1f86fb498247e296f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2020,"id":529,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'bbb951e2a9a18c28edb4a203f1682a27e87320fa69bdc7c1f86fb498247e296f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #134
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dcd1e3a5-c613-4828-bfb1-38d4b1148014'::uuid, 'pg', '302f420b10ed00202ad3a7ee69f69813070b10472f27197a623afd117456bbcc', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2018,"id":527,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '302f420b10ed00202ad3a7ee69f69813070b10472f27197a623afd117456bbcc'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #135
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1b7452a3-54c5-4a6e-8527-72a6dabe4e9f'::uuid, 'pg', '7d1d8810f4e816a68500461a4b4b05548d478329e01bbd4cd33d34cec21cb581', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2018,"id":526,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7d1d8810f4e816a68500461a4b4b05548d478329e01bbd4cd33d34cec21cb581'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #136
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '66859d60-a827-4d72-85a8-34e43a1b0c24'::uuid, 'pg', '4180a608091b7806de593a512644a6c6e7f5bc3fe348eaaa145c9e8f26049b8e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2015,"id":523,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4180a608091b7806de593a512644a6c6e7f5bc3fe348eaaa145c9e8f26049b8e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #137
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7a93179d-246e-40c2-b967-c0bbfe6f775a'::uuid, 'pg', '2a13117a43b7d8f411aecd4df31d006b6616494d2c2f0d10cb2db0103d73132b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2015,"id":522,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '2a13117a43b7d8f411aecd4df31d006b6616494d2c2f0d10cb2db0103d73132b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #138
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e4ccdbb8-7e97-4c4d-956c-058e6574c8fe'::uuid, 'pg', 'ec8524ad7be665760b86301185752dc16c3bf0fb91b9bd34b3a442070893acaa', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2026,"id":519,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ec8524ad7be665760b86301185752dc16c3bf0fb91b9bd34b3a442070893acaa'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #139
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3a4cfb36-9af6-4fd2-96a3-55f3a4c248a2'::uuid, 'pg', '64cd711a9ca0318d0fb436b6b851a621926d79381c6f9a354d7d01c0056d8974', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2009,"id":517,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '64cd711a9ca0318d0fb436b6b851a621926d79381c6f9a354d7d01c0056d8974'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #140
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '07104373-fc72-443c-81e8-842634c1ce95'::uuid, 'pg', '98fc63722176ec03decd008397702e61225a2131eddfa5d88b1e3cad8a8728eb', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2009,"id":516,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '98fc63722176ec03decd008397702e61225a2131eddfa5d88b1e3cad8a8728eb'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #141
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e109971b-8491-4d67-87f3-794d97a3f29d'::uuid, 'pg', 'ce9f6c2110875a0b9ebee1257e3a60793af2a3762aaa7da0cee758eb970a02fc', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2009,"id":515,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ce9f6c2110875a0b9ebee1257e3a60793af2a3762aaa7da0cee758eb970a02fc'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #142
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e65f11ba-725e-44a5-a448-51db8733ce7c'::uuid, 'pg', '78a596a24ceaee20c010a732eebabdc02c484eefb33779066124bc47ec540c72', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2009,"id":514,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '78a596a24ceaee20c010a732eebabdc02c484eefb33779066124bc47ec540c72'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #143
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1841abdd-65ed-479a-8c3c-b042e796953a'::uuid, 'pg', '2de982f2dad239313677d6ed65bf67ea13f3dc14e69b5a19e410f4c6fb457b0a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2008,"id":499,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '2de982f2dad239313677d6ed65bf67ea13f3dc14e69b5a19e410f4c6fb457b0a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #144
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8b80962a-9f66-4550-a9c9-7ae7f4d5837d'::uuid, 'pg', 'f153dda54cbaf2f3141871c46c33d3d698af9f032bddee734959e4fde7f67333', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2007,"id":498,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f153dda54cbaf2f3141871c46c33d3d698af9f032bddee734959e4fde7f67333'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #145
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'edc7a548-9bdd-4855-beb2-3371a6081a64'::uuid, 'pg', 'e0666adeeed759d466dc5a7419c63fd23944946e3c2ebf9b270595a95cdacd2e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2008,"id":496,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e0666adeeed759d466dc5a7419c63fd23944946e3c2ebf9b270595a95cdacd2e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #146
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3ea1e843-2776-4f5c-b98f-a393b53995b7'::uuid, 'pg', 'd75de2b4deb10933ac5c84a34e769030ae8ee8513b9040ebe392eb32e4be26a7', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2008,"id":495,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'd75de2b4deb10933ac5c84a34e769030ae8ee8513b9040ebe392eb32e4be26a7'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #147
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2d7f5526-bfe1-4c21-977e-3cf6847de209'::uuid, 'pg', 'c5feb2191e372dbd5a79d08ff66c788756c1e68e308bccd92063416df129c51c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2008,"id":494,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c5feb2191e372dbd5a79d08ff66c788756c1e68e308bccd92063416df129c51c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #148
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '662b7042-d9a1-4040-9edc-0ed032c28c08'::uuid, 'pg', 'a78e5d994947cb98a0bcddc6cca3a6c59576ef6a8500ecd997c5548b72ea8423', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2007,"id":492,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a78e5d994947cb98a0bcddc6cca3a6c59576ef6a8500ecd997c5548b72ea8423'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #149
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '86d260de-8877-4a64-b84d-5c1eb7128aea'::uuid, 'pg', 'b49eb89e533a6f29e6dee5c8dc9fb57e0c93da4973a8547573e1e4d162f03caf', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2007,"id":491,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b49eb89e533a6f29e6dee5c8dc9fb57e0c93da4973a8547573e1e4d162f03caf'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #150
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'af6eeec0-3d96-4a59-bc03-6df25c3a343f'::uuid, 'pg', '12e69d2c18297df1d7eb6cac64d516fda06f8985b60f6f6903b1e83c910d7e32', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2007,"id":490,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '12e69d2c18297df1d7eb6cac64d516fda06f8985b60f6f6903b1e83c910d7e32'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #151
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '38791df0-5c1a-4322-889f-38e300ed23ea'::uuid, 'pg', 'ad4397d79c1efb8bfc7c83221c9efb2a8c537a430df2bf5a5f0d16448cd52717', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2006,"id":489,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ad4397d79c1efb8bfc7c83221c9efb2a8c537a430df2bf5a5f0d16448cd52717'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #152
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'de028871-e47c-46f9-b3ca-5091969b8167'::uuid, 'pg', '2b5606216cba0b8dd5d99a23b6b07701f46adb248e6b8b0c050fb29f5e73df7e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2006,"id":488,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '2b5606216cba0b8dd5d99a23b6b07701f46adb248e6b8b0c050fb29f5e73df7e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #153
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7e69b42e-4796-4298-b829-accdea7e1d87'::uuid, 'pg', '11e45fae976ab916ba2c563656b9cc3f39b7fcd90f33cfb5024bdebd54ee29a4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2006,"id":482,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '11e45fae976ab916ba2c563656b9cc3f39b7fcd90f33cfb5024bdebd54ee29a4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #154
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0d66efb3-13c7-477c-b086-0762d07f2df0'::uuid, 'pg', '1864cf7e9ef55084d19f18084ca781a0c0f96a265a9dfabb740bf9ba14077adf', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2006,"id":489,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1864cf7e9ef55084d19f18084ca781a0c0f96a265a9dfabb740bf9ba14077adf'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #155
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0e2599de-434d-4424-a664-2bbe5e70724c'::uuid, 'pg', 'cac2a01710591f76fb3c9f3ea397c5fb7bd010c76059aff727f203337b35f69d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":623,"id":481,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'cac2a01710591f76fb3c9f3ea397c5fb7bd010c76059aff727f203337b35f69d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #156
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '538667f5-06ee-4dfd-a84e-a77b0deb54f6'::uuid, 'pg', '86862537e5f859566c1b98ca3599f1479187951b0526ac2a8336a00e3a6c8f1c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2000,"id":480,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '86862537e5f859566c1b98ca3599f1479187951b0526ac2a8336a00e3a6c8f1c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #157
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2fc69396-226f-4bbc-8ad1-103e39c135cf'::uuid, 'pg', '9318a02e3b8ec29d326f6688f634559560811f39928afeb7e54738ce1a9efcad', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2003,"id":479,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '9318a02e3b8ec29d326f6688f634559560811f39928afeb7e54738ce1a9efcad'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #158
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5f201695-4a29-461e-82ab-8ccd42faabf4'::uuid, 'pg', 'd94a18b13df62ec9b55b378c20f61b714ab0523644dd8217adb126c91d814d84', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2001,"id":477,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'd94a18b13df62ec9b55b378c20f61b714ab0523644dd8217adb126c91d814d84'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #159
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '08547d10-25da-4464-ae1d-f3eacbd5a7d8'::uuid, 'pg', '04abb9257e7999faae967704174561b45e34d0990c2d002bc76bb9cf0bccfdf4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2000,"id":475,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '04abb9257e7999faae967704174561b45e34d0990c2d002bc76bb9cf0bccfdf4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #160
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ab0752dc-1517-4ecb-85f8-0e7e4cbc1330'::uuid, 'pg', 'be4d110166c9c4490fd086d53f33562e4bba13ccac3266dc3e65d68100b9c429', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":2000,"id":474,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'be4d110166c9c4490fd086d53f33562e4bba13ccac3266dc3e65d68100b9c429'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #161
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a918ad0e-2254-42d5-a657-6b079fbc7fbe'::uuid, 'pg', 'c5825c21ad5d0ec2600eee28b245a061a330d6a9e1e2db6c9e3466bc778c5c0e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1990,"id":464,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c5825c21ad5d0ec2600eee28b245a061a330d6a9e1e2db6c9e3466bc778c5c0e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #162
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '26cb36ad-9db6-4ab8-842b-6bfe2b6d416c'::uuid, 'pg', '56bf18aa8d2f261b1331143590371ba2421e371cbb6031eb5f479a7907df068c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1989,"id":453,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '56bf18aa8d2f261b1331143590371ba2421e371cbb6031eb5f479a7907df068c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #163
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '37951f67-e0f4-44cc-ab41-e826a5b0c50f'::uuid, 'pg', '212a078c50075fbd9567c138357a1bc468ab8e1e9d4bf60301f5fa3a47f014be', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1999,"id":450,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '212a078c50075fbd9567c138357a1bc468ab8e1e9d4bf60301f5fa3a47f014be'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #164
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd152d535-81b8-4508-a87d-99862bc25069'::uuid, 'pg', 'bab6301501ff2d3d43b8984f2567be3cfca343fafc36262bbc3574fb39bafe0a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1998,"id":434,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'bab6301501ff2d3d43b8984f2567be3cfca343fafc36262bbc3574fb39bafe0a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #165
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c12a5d74-c06d-428f-9701-2fbdaeee3fc3'::uuid, 'pg', '1ed1420c86d9d4d4ed39b6c5e6c9016252201957c595f45d7eafc154603aae2b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1997,"id":433,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1ed1420c86d9d4d4ed39b6c5e6c9016252201957c595f45d7eafc154603aae2b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #166
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '381e7d59-0115-4697-aa0b-5d37edbae60d'::uuid, 'pg', 'c31931089aa9f5a4db528fd56523a208abc69c5cb00bfde5828ffbd0a9336dae', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1996,"id":432,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c31931089aa9f5a4db528fd56523a208abc69c5cb00bfde5828ffbd0a9336dae'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #167
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8b9574d9-ea28-4ea6-a774-5237639c602a'::uuid, 'pg', '6a612e685cbee0751ad8709748e95fb79520ff6c3b4e96d1fd55b5c24986a126', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1995,"id":431,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6a612e685cbee0751ad8709748e95fb79520ff6c3b4e96d1fd55b5c24986a126'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #168
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9c3e4a82-2172-4dcb-a0d2-19b7d4a6354f'::uuid, 'pg', '0218cfed662440004b9f5e12f6304782cc4222869ff97273d91ce0ee8d79ffc2', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1994,"id":430,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '0218cfed662440004b9f5e12f6304782cc4222869ff97273d91ce0ee8d79ffc2'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #169
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'caddbab5-724a-4e75-83ec-6e2c278d3077'::uuid, 'pg', 'e982a910e2b056665fdfe543bba8922f5a53ce82e0085cce49d741379e8f46f1', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1993,"id":429,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e982a910e2b056665fdfe543bba8922f5a53ce82e0085cce49d741379e8f46f1'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #170
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e5e96102-b490-4485-8165-05c63b0b3db6'::uuid, 'pg', '18303338495b196b0fad4c21ba24a4f2238c657ce746c5236f44b1a4cbf1096d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1992,"id":428,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '18303338495b196b0fad4c21ba24a4f2238c657ce746c5236f44b1a4cbf1096d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #171
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '27ebb648-30c0-4ad6-8cff-a160f577d2eb'::uuid, 'pg', '0944ed3ebec09190d57a4c17953805e7a21a86317031797300d719568a4e0860', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1991,"id":427,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '0944ed3ebec09190d57a4c17953805e7a21a86317031797300d719568a4e0860'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #172
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5910f02e-ad98-4e67-92de-87384fe0aeb6'::uuid, 'pg', '58404bd2c2ae9b28b9f91873f664e40e95ad2f69e6fc2fe070965a597132641b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1983,"id":426,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '58404bd2c2ae9b28b9f91873f664e40e95ad2f69e6fc2fe070965a597132641b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #173
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3d12dfcb-242f-4b15-8323-a13c5069c82c'::uuid, 'pg', 'bd8efd576f846736a8f9240e6676bfef40ae45ad5b47ffe6c2d8efd690cdc392', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1982,"id":424,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'bd8efd576f846736a8f9240e6676bfef40ae45ad5b47ffe6c2d8efd690cdc392'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #174
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3b7dd977-0bc1-4935-9b8f-cc63a552f724'::uuid, 'pg', '58dc559e9db558d31a1bc79bad395e22b3405007a3a399bd06b007a75e1f77ef', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1981,"id":421,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '58dc559e9db558d31a1bc79bad395e22b3405007a3a399bd06b007a75e1f77ef'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #175
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5b8d909b-18ed-458b-b2bf-bfb7548a19ba'::uuid, 'pg', 'da557d94cc67d7ae5873e55d93f3d31e6f65ea600dc4daf0770ddca22f2c66a6', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1980,"id":420,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'da557d94cc67d7ae5873e55d93f3d31e6f65ea600dc4daf0770ddca22f2c66a6'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #176
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd0c65b2e-a781-4082-aae9-097404055163'::uuid, 'pg', 'ef94abab5f22b44887a8a3a48848f217deb21f09105a7b9918114bd37d45e197', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1979,"id":419,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ef94abab5f22b44887a8a3a48848f217deb21f09105a7b9918114bd37d45e197'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #177
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f67cd3fc-2afa-4afb-bebc-5e30c4cce348'::uuid, 'pg', '68f4a21332f3274f80a3cb29197b03488a1afd6c5a6c8d9a1f8d3c92b9ef9fc0', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1942,"id":416,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '68f4a21332f3274f80a3cb29197b03488a1afd6c5a6c8d9a1f8d3c92b9ef9fc0'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #178
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dea33765-fd54-44a6-b8b9-45f55dbcef1c'::uuid, 'pg', 'b4ea68d6e714ba87f3f7059745a67ee6327dfd44596e87edcf53e7aaadb1e0e6', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1978,"id":415,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b4ea68d6e714ba87f3f7059745a67ee6327dfd44596e87edcf53e7aaadb1e0e6'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #179
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0f28b4d6-aa11-4a13-8ae4-587f72371207'::uuid, 'pg', '920c8cdd42d9e154739e6eaa5774fb112660a87116a774836d452e9ee7a2183d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1977,"id":414,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '920c8cdd42d9e154739e6eaa5774fb112660a87116a774836d452e9ee7a2183d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #180
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '118fd055-99c9-46e0-89c1-4ee7d59aa943'::uuid, 'pg', '579b9a60e29c2748d9aff26c7ea71b597a09dd041bc5cccde6f691d8c18a1859', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1972,"id":405,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '579b9a60e29c2748d9aff26c7ea71b597a09dd041bc5cccde6f691d8c18a1859'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #181
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8ed81248-dec1-4258-b1b4-fa733b5f61f8'::uuid, 'pg', 'dc6e4fa3f140e684e5388aafa36d62950ea59eb976c9e75a3f009ed028af4770', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1971,"id":393,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'dc6e4fa3f140e684e5388aafa36d62950ea59eb976c9e75a3f009ed028af4770'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #182
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6ec3140f-834c-4161-beed-13378ebf8f8f'::uuid, 'pg', '6ab3ad0678f09a4d89702c8b5fcd430aae2ed1cdae7f3ed2acb00128724cf7b4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1970,"id":391,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6ab3ad0678f09a4d89702c8b5fcd430aae2ed1cdae7f3ed2acb00128724cf7b4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #183
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9720cb65-d4f5-465a-8173-462851a228a3'::uuid, 'pg', '68f6bd3cb3eab9bbe3fed0c61a37bcf45c744beb4c15386b5b3575db54261fd6', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1967,"id":375,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '68f6bd3cb3eab9bbe3fed0c61a37bcf45c744beb4c15386b5b3575db54261fd6'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #184
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '675f0926-0b94-413d-a33f-0c2bcac4aba2'::uuid, 'pg', '54e345a5aa4bc308db11481452de6625a33f8bd813d14985f2bfed50f59a1e31', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1966,"id":369,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '54e345a5aa4bc308db11481452de6625a33f8bd813d14985f2bfed50f59a1e31'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #185
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '48352681-f178-484e-b43a-8c990c468858'::uuid, 'pg', '1d101df41031fcf3b1efae71d1f0f4f8a4f22cf0a9cdf18cd208ab33f5068398', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1939,"id":351,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1d101df41031fcf3b1efae71d1f0f4f8a4f22cf0a9cdf18cd208ab33f5068398'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #186
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '67863ef7-1627-4ccd-9286-62f41e210a44'::uuid, 'pg', '77f84e158f71be0881bf0f69bab1b0f9e4001d2e9ea628cb465463da5be95e70', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1901,"id":338,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '77f84e158f71be0881bf0f69bab1b0f9e4001d2e9ea628cb465463da5be95e70'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #187
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'decc3a44-4934-401f-9ded-4f61396d5e5b'::uuid, 'pg', '946728ca1a929ff712c9422d4e69144eba0788340a1c8261f783d1083c88249e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1961,"id":335,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '946728ca1a929ff712c9422d4e69144eba0788340a1c8261f783d1083c88249e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #188
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '33f42403-1bbe-4fa2-a988-23aae76a08db'::uuid, 'pg', '9f851f1bba58984a684e83a33c9e2a4a4fdbea48ba083474f27e583230a99d9f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1960,"id":329,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '9f851f1bba58984a684e83a33c9e2a4a4fdbea48ba083474f27e583230a99d9f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #189
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '186a158b-386e-41ca-b035-b7f8b0595bd5'::uuid, 'pg', '684d1cddaa29f974fad9d42d0ef3c1b5c5cf056f86465f8152c8db4150a6b3ed', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1959,"id":323,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '684d1cddaa29f974fad9d42d0ef3c1b5c5cf056f86465f8152c8db4150a6b3ed'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #190
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f817f565-2581-4625-8d3c-48c0ac2148fc'::uuid, 'pg', '3bb4d4f36498b20a2d3945dd85121af4fec202086445aab91820088f93b4f688', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1956,"id":320,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3bb4d4f36498b20a2d3945dd85121af4fec202086445aab91820088f93b4f688'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #191
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'daf88ce7-e1ea-4c8d-9cfc-9d1508a13b0e'::uuid, 'pg', '1eb3705fc08a3bfc1c03421f3e601fb00afb4696a364919e40e11ecb035e629c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1955,"id":319,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1eb3705fc08a3bfc1c03421f3e601fb00afb4696a364919e40e11ecb035e629c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #192
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1d6a6f6e-00c8-4289-9689-796d51a79fa0'::uuid, 'pg', 'cbc1311b5ff8550b3d6ec862078b446747ad680d8b63c03e487649b54a6bef9e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1955,"id":317,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'cbc1311b5ff8550b3d6ec862078b446747ad680d8b63c03e487649b54a6bef9e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #193
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5c68ff5f-2eb8-40b4-b44e-8ac06eee8aa6'::uuid, 'pg', '3663f05d985693fa226eee2a1a7ba355bcb15b6a7f7a6d99f75fb8ede1087af7', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1954,"id":316,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3663f05d985693fa226eee2a1a7ba355bcb15b6a7f7a6d99f75fb8ede1087af7'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #194
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5f22ed25-5632-45dc-b26c-1b50e3571ccc'::uuid, 'pg', '25e311b5f4c378a97f594d6516fd1ad26d7bcebb66a46d76b0d2be67ed52610c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1944,"id":309,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '25e311b5f4c378a97f594d6516fd1ad26d7bcebb66a46d76b0d2be67ed52610c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #195
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '88f4ff71-1e06-477b-92f4-31fd89ddf301'::uuid, 'pg', '6dc95f330b701d0a2fd50e2974656e8fef343ba5b041ee3ccd2d1c1e36790dd6', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1943,"id":308,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6dc95f330b701d0a2fd50e2974656e8fef343ba5b041ee3ccd2d1c1e36790dd6'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #196
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '65ad366e-025d-44e9-beed-b930a64185e8'::uuid, 'pg', '5f8e22b06b8f6ce4ead4e235f83bb810a364342ca2b6a2546f33636342c9575a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1944,"id":305,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '5f8e22b06b8f6ce4ead4e235f83bb810a364342ca2b6a2546f33636342c9575a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #197
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '195951ce-4cd8-42d5-85e4-89a78d10087b'::uuid, 'pg', '6856041ae2fef6d527d991ba563031f6c97d2bc171f38ec7dd66c4f3660c09e3', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1943,"id":304,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6856041ae2fef6d527d991ba563031f6c97d2bc171f38ec7dd66c4f3660c09e3'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #198
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '877d9e63-9dc9-4c99-8c1a-86939677ebbf'::uuid, 'pg', '0ccb0b085a865ce1ad3277d2bfac7e33ac765e8a9828729ba55183a51f42b6f6', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1942,"id":303,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '0ccb0b085a865ce1ad3277d2bfac7e33ac765e8a9828729ba55183a51f42b6f6'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #199
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '760e4ee0-aa99-4d08-af23-99e0059672ce'::uuid, 'pg', '01bcaa995e6f9057405ad16bdac6be12eb122f27b2ca091b89a0b63175bfd510', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1940,"id":297,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '01bcaa995e6f9057405ad16bdac6be12eb122f27b2ca091b89a0b63175bfd510'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #200
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e1dfb54f-dcce-417f-95d2-bba9a350b3db'::uuid, 'pg', '9a1a6631f4b0af9e27fe9d468085a87dafec3edac99cb3366959776623c8320d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1938,"id":296,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '9a1a6631f4b0af9e27fe9d468085a87dafec3edac99cb3366959776623c8320d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #201
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8174b778-6379-4a0c-b005-9b6830916306'::uuid, 'pg', '1b011e1eb61321ca638fc40793c8d06fc65967289c324627994e67ed46526fcf', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1936,"id":294,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1b011e1eb61321ca638fc40793c8d06fc65967289c324627994e67ed46526fcf'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #202
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd1fbebdc-f019-40b5-9aee-bfff164bfd4c'::uuid, 'pg', 'e566e031731e9cdb524cb2be1a77939289082de4ab7bcde842b629b0550348c4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1899,"id":289,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e566e031731e9cdb524cb2be1a77939289082de4ab7bcde842b629b0550348c4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #203
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'aab6cbe8-36ec-4372-9d69-77336e65a61d'::uuid, 'pg', '82834b1923bf308a482d557b812acabce156fa3f524159c14ae5f50904e2d751', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1900,"id":288,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '82834b1923bf308a482d557b812acabce156fa3f524159c14ae5f50904e2d751'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #204
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '560f0c78-5b06-414c-9ad7-4f75c49139ce'::uuid, 'pg', '75faa04b9f5f1d584e14ebc27b8b31e7fabadb15be4be68514b0c933f1fde5ac', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1934,"id":287,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '75faa04b9f5f1d584e14ebc27b8b31e7fabadb15be4be68514b0c933f1fde5ac'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #205
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c7112637-afe4-4332-a780-924929dc49b1'::uuid, 'pg', '507ab91f9277be444207894955a481e976fb3dc69e8a1f2b1862272c91e9005a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1934,"id":286,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '507ab91f9277be444207894955a481e976fb3dc69e8a1f2b1862272c91e9005a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #206
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '98e7570e-d9cc-432a-b041-c505a336bd73'::uuid, 'pg', '1c88937cc450385bc3bb8a88f4ecf516f86a3bb4d77b86f6f589d68f7a90517a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1933,"id":285,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1c88937cc450385bc3bb8a88f4ecf516f86a3bb4d77b86f6f589d68f7a90517a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #207
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'eec85ffc-f950-4112-b6dc-308fb6999b03'::uuid, 'pg', '285ef660b8c101086b3e790eb07c7853b23f9031ac3d47f35eaf06ab669da774', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1927,"id":278,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '285ef660b8c101086b3e790eb07c7853b23f9031ac3d47f35eaf06ab669da774'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #208
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f61deeaa-4d87-4b8a-936b-f5fd7b21a349'::uuid, 'pg', '1c560b3bdb814d9e98e4b4146da71c98676c2cac9727d232a2c26e2553fec37b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1925,"id":277,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1c560b3bdb814d9e98e4b4146da71c98676c2cac9727d232a2c26e2553fec37b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #209
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '42a4580c-d515-43e5-b5f4-6a6fcaf279c5'::uuid, 'pg', 'ba0291bbe1736fe7b731e690bb0ed220bcd5977bedba70ba4f6b9f3f829e3438', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1872,"id":269,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ba0291bbe1736fe7b731e690bb0ed220bcd5977bedba70ba4f6b9f3f829e3438'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #210
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f14a8e0a-4db1-4a32-abc6-5c8312af6053'::uuid, 'pg', '7df23c9facbcab32f0832a87927c4f468f74843a6ed603fbbfb83a1ed79a1409', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1835,"id":268,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7df23c9facbcab32f0832a87927c4f468f74843a6ed603fbbfb83a1ed79a1409'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #211
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6647f12a-87dc-42de-98eb-b8f93c665280'::uuid, 'pg', 'f388e704eeefcc8c18e33b74189565d62f44a599dc6f654aae13552d16cc62bf', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1834,"id":267,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f388e704eeefcc8c18e33b74189565d62f44a599dc6f654aae13552d16cc62bf'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #212
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '65776480-2e86-4f81-b285-a2bdbc3e95dc'::uuid, 'pg', 'de7da79a016e7f0e844cb5c0a8d41c32b9ca49f2d6e2fe75bf388c2cb096886c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1872,"id":266,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'de7da79a016e7f0e844cb5c0a8d41c32b9ca49f2d6e2fe75bf388c2cb096886c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #213
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '44ef4ed1-2a65-43f8-9cfe-af662e5ec1d7'::uuid, 'pg', '6338e242b3ffb76efac7f63f1f3cafc0967e90466c9fdedd32eb65d350bc04ae', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1872,"id":265,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6338e242b3ffb76efac7f63f1f3cafc0967e90466c9fdedd32eb65d350bc04ae'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #214
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9cccc9aa-4968-4879-a7ef-f456f336a5b3'::uuid, 'pg', '592a431317305e8fb48c9d6876025389c9bdb271b354104ea3f526337c5471de', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":701,"id":260,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '592a431317305e8fb48c9d6876025389c9bdb271b354104ea3f526337c5471de'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #215
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '46cb1b4b-5aa9-4e15-abc2-c9f62660062f'::uuid, 'pg', 'de3aaa89edcc37ef5c916f04128c0802efcb1aa11c45a238798988dd38970deb', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1835,"id":259,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'de3aaa89edcc37ef5c916f04128c0802efcb1aa11c45a238798988dd38970deb'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #216
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7c126637-0d48-4de9-b225-d98c87f5fe64'::uuid, 'pg', '48451589ae5af98aab0d1cba9f7e19905f69c385c9fb892f9a810c783094d675', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1835,"id":258,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '48451589ae5af98aab0d1cba9f7e19905f69c385c9fb892f9a810c783094d675'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #217
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f82e9df6-5bc6-45d0-ab18-565fdba40b7c'::uuid, 'pg', '8add9d6cfd8b2ac20018cba1e81c517a8b5451241cdbf398b6c66a99aa61b73c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1834,"id":257,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '8add9d6cfd8b2ac20018cba1e81c517a8b5451241cdbf398b6c66a99aa61b73c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #218
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ed73889e-8920-48e9-9906-ce0080bfaa07'::uuid, 'pg', 'ad9a01413fde10f5e769eab192fc6a2c060398e5c16d4b2b34d64d8a8187923e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1834,"id":256,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ad9a01413fde10f5e769eab192fc6a2c060398e5c16d4b2b34d64d8a8187923e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #219
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '288a1884-b798-4bc6-983e-b3a69af33cfc'::uuid, 'pg', 'f4e20b67651ca9d59187770659ebbec93d6d72cb252d42d5c4bc3cddfdcb0a21', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1814,"id":255,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f4e20b67651ca9d59187770659ebbec93d6d72cb252d42d5c4bc3cddfdcb0a21'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #220
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ccc2908c-b41f-463b-a629-84b7c5290adf'::uuid, 'pg', '82b0f917a46e9c13e1888d0e8f27105a3137a1fef0bae29c1cab2ec02b4274ed', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1807,"id":254,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '82b0f917a46e9c13e1888d0e8f27105a3137a1fef0bae29c1cab2ec02b4274ed'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #221
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dacb5aa7-ea52-460b-bc69-7f9a6a8f430e'::uuid, 'pg', '1b000626227e7ceb2baa419cfae42596cf6e6dcb79f1a4cccd0651ec8ddc920d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1806,"id":253,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1b000626227e7ceb2baa419cfae42596cf6e6dcb79f1a4cccd0651ec8ddc920d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #222
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '61eb48ad-82b5-4250-b0ff-22e30984fc94'::uuid, 'pg', 'eda43897690d8910c97d1d09ade50433f0e1fa3afeadf2ef8975199552990b22', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1805,"id":252,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'eda43897690d8910c97d1d09ade50433f0e1fa3afeadf2ef8975199552990b22'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #223
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c2060700-dd93-40d9-b381-0854c81beaea'::uuid, 'pg', '788ef87cedfb8862dc6041c4a35889e0cb351b312b3d5fbc8a5e068718e31d29', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1752,"id":251,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '788ef87cedfb8862dc6041c4a35889e0cb351b312b3d5fbc8a5e068718e31d29'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #224
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3e7b22f5-3905-451e-8fbf-4eeae950483d'::uuid, 'pg', '655d5700044d129a729919661888830b97f0da5859bdce18d335c21209daeab3', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1779,"id":249,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '655d5700044d129a729919661888830b97f0da5859bdce18d335c21209daeab3'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #225
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1be96620-5c46-43e2-a99f-2ce47143b7bc'::uuid, 'pg', '85e275b778c92c5df8e345336893b6247e661213fae3f896fd068edf23dc286b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1775,"id":247,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '85e275b778c92c5df8e345336893b6247e661213fae3f896fd068edf23dc286b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #226
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '92e8ed6d-5332-420e-bd07-37816cc2c678'::uuid, 'pg', '768d4a841c0a94acf7d7e50ebf45b696fbafaf5764cc7160c059ce5e51715b40', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1752,"id":246,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '768d4a841c0a94acf7d7e50ebf45b696fbafaf5764cc7160c059ce5e51715b40'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #227
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '11a14c67-ce19-4b90-b6b5-b025b95d0ab9'::uuid, 'pg', '5195d59e0093c16a07c8eb501c1f8efa2ff922b124bd2bc46ce8ea0f70d1f881', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1775,"id":245,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '5195d59e0093c16a07c8eb501c1f8efa2ff922b124bd2bc46ce8ea0f70d1f881'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #228
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e44a7b05-a52a-40d0-a95c-6051fbe77527'::uuid, 'pg', 'b951ec009e482735658278929d5a674b0ef0ff4a58c26c6c19b4186ef2595477', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1775,"id":244,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b951ec009e482735658278929d5a674b0ef0ff4a58c26c6c19b4186ef2595477'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #229
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8db4faaa-37da-4c16-84ae-d9df50774e2f'::uuid, 'pg', '4d335d921c533481d62c5dd1bc039851ff310db3a46536b2acd3f9336f6b7cb1', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1773,"id":243,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4d335d921c533481d62c5dd1bc039851ff310db3a46536b2acd3f9336f6b7cb1'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #230
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '94e7e64a-a09a-46ba-b170-6288d4cc41b5'::uuid, 'pg', '6f936ebf89d5dc7460bf7356d2ee5886bd5de9386ede896d3777326c4a726eee', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1752,"id":242,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6f936ebf89d5dc7460bf7356d2ee5886bd5de9386ede896d3777326c4a726eee'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #231
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9080be0c-c337-44cb-bb5e-b39e87d3af75'::uuid, 'pg', '3b5f4377334d91f5c36e9bceb340aa897bcd6a22c307ba413b8d5ead398b83f3', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1752,"id":241,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3b5f4377334d91f5c36e9bceb340aa897bcd6a22c307ba413b8d5ead398b83f3'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #232
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd2a98276-49b4-4f64-9353-c995cd1e8cfe'::uuid, 'pg', '1669c2f82c6a43f8daab0999925872cc88ef0ac92df753cc477e76d2c483f9b9', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1752,"id":240,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1669c2f82c6a43f8daab0999925872cc88ef0ac92df753cc477e76d2c483f9b9'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #233
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dca7ba65-1736-42fe-ac05-339bad32953e'::uuid, 'pg', 'e83beb96af63b362d346459eb5b22c82298036c8c569c911851c7cb618c85809', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1751,"id":239,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e83beb96af63b362d346459eb5b22c82298036c8c569c911851c7cb618c85809'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #234
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '645230a1-a316-4026-bb50-1535b7e55ce4'::uuid, 'pg', '2f27b582ae91ed5dbdf42931eb9133b755002fe5e0f477b33ec8ad17984f716d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1751,"id":238,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '2f27b582ae91ed5dbdf42931eb9133b755002fe5e0f477b33ec8ad17984f716d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #235
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '05953518-8980-4e48-89e4-b1bf9e383364'::uuid, 'pg', 'bb6d27aee86cbe3d797a2d18f5046296863581647a1cfe8aa19414f1e549d847', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1750,"id":237,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'bb6d27aee86cbe3d797a2d18f5046296863581647a1cfe8aa19414f1e549d847'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #236
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'af0d9045-40d2-4e19-9f3e-8107b2d1b057'::uuid, 'pg', '9dc06bd7fcd94602bd5591262aecf68d2cda3a8a10f543d1a317b7ba77c7a6ac', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1743,"id":236,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '9dc06bd7fcd94602bd5591262aecf68d2cda3a8a10f543d1a317b7ba77c7a6ac'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #237
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0ee25e71-7584-4e95-9b4e-bbeaa8774705'::uuid, 'pg', 'a3d7c7cd40a4889445cb81661a4d574253014ff224423b9ec6b5998a25f4cf70', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1743,"id":235,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a3d7c7cd40a4889445cb81661a4d574253014ff224423b9ec6b5998a25f4cf70'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #238
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '902bdd23-48a6-4d54-bca7-f5d08e4a9c7f'::uuid, 'pg', 'f4250cf5dbd771dc90183be90a7f63160f326a006abac504f86fd365320e2a8d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1743,"id":234,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f4250cf5dbd771dc90183be90a7f63160f326a006abac504f86fd365320e2a8d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #239
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2cfed482-3c96-41e2-b3b7-d58f03593417'::uuid, 'pg', '35b322c4173b7626953ff3c2da355a5fa7247dff25ec87f0a873c9b1828bc169', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1742,"id":233,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '35b322c4173b7626953ff3c2da355a5fa7247dff25ec87f0a873c9b1828bc169'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #240
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '259f704a-3508-4936-a360-22f35e4d00d0'::uuid, 'pg', '13b1a73f06a15123d9eff848c29a05c8535a2b9c84561e9dfb02bc8955bd9285', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1741,"id":232,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '13b1a73f06a15123d9eff848c29a05c8535a2b9c84561e9dfb02bc8955bd9285'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #241
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6314e808-b3f5-4293-a03c-f7311d42389c'::uuid, 'pg', '9dff66e56269fb58218cfbe4cafa5c186f5f8b9284e0e0f99657b1e60fac1c81', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1734,"id":231,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '9dff66e56269fb58218cfbe4cafa5c186f5f8b9284e0e0f99657b1e60fac1c81'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #242
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '546015d7-03bd-4e91-a6d2-581221a3957e'::uuid, 'pg', 'fe7695ce209f3d628934d3b15d4544c4131d82bb0bd21335e310e8a18480c11a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1730,"id":230,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'fe7695ce209f3d628934d3b15d4544c4131d82bb0bd21335e310e8a18480c11a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #243
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fb043c00-6079-43a1-b863-1dbd14ea9ecb'::uuid, 'pg', '23663c8ad8655aaf915b31b7b113e28fdc6284a48a23597c60dd5135ce3c2362', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1730,"id":229,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '23663c8ad8655aaf915b31b7b113e28fdc6284a48a23597c60dd5135ce3c2362'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #244
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '50ab5639-22b1-40d6-a84a-77dd05b3de67'::uuid, 'pg', 'a496dbbd73abf15a3c45ab3ab3e236a9b4ff304281795b132690a4f002c81be7', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1730,"id":228,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a496dbbd73abf15a3c45ab3ab3e236a9b4ff304281795b132690a4f002c81be7'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #245
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0501e939-4a01-4aca-98b2-17449cb7dd9b'::uuid, 'pg', '9d26a1c74ca14cba5c39fe1599bf8f7313e97d7caf87245b399402f8f8dae534', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1730,"id":227,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '9d26a1c74ca14cba5c39fe1599bf8f7313e97d7caf87245b399402f8f8dae534'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #246
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fc824842-65c0-46c2-8a9c-a2a998055182'::uuid, 'pg', 'c6a6c9ea184f3bdc08f62fa156923f0658554daa34ce6f72771d0701fc44dd95', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1729,"id":226,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c6a6c9ea184f3bdc08f62fa156923f0658554daa34ce6f72771d0701fc44dd95'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #247
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'bb1f3db6-8968-4b5b-ba1a-318c10737ec9'::uuid, 'pg', '43635504c726bfb86f49fcad5cb2f084c3d5719207a829b87bc774801b0b667b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1729,"id":225,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '43635504c726bfb86f49fcad5cb2f084c3d5719207a829b87bc774801b0b667b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #248
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e3de64a5-bc6b-4f73-8138-bc9949b7d85e'::uuid, 'pg', 'eb43cdc9f58483e4761702c94734bc99fa9b3e00a723e3f2403b2c9d606d272d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1729,"id":224,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'eb43cdc9f58483e4761702c94734bc99fa9b3e00a723e3f2403b2c9d606d272d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #249
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f73d5207-e8c7-49bd-ba6d-cef2782c3806'::uuid, 'pg', 'ea71ba74972ca8a67de79a0517013c3790d10be37720bd9ece967fe05ff0d98e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1700,"id":223,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ea71ba74972ca8a67de79a0517013c3790d10be37720bd9ece967fe05ff0d98e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #250
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e0c65186-fb5d-4be9-97f6-f9ab1fc50ad7'::uuid, 'pg', '66abdafe33a7a3164e0971010084eaf42e7f7f4bd057cd31b4ec588765637fb2', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1678,"id":188,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '66abdafe33a7a3164e0971010084eaf42e7f7f4bd057cd31b4ec588765637fb2'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #251
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '16400267-0388-4b3b-b8ba-048097a3fe7e'::uuid, 'pg', '57bd52fa26ecf45bebade604ee97c76d31ea67f7b2d92fa133c14c85a6123278', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1677,"id":187,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '57bd52fa26ecf45bebade604ee97c76d31ea67f7b2d92fa133c14c85a6123278'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #252
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a5133266-03ed-464f-9d1e-2e6b9a62eed5'::uuid, 'pg', 'd7798d16a7ce78fda0a613c9330dbcf9129bbe049889696ad87665c44ba6bbed', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1676,"id":186,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'd7798d16a7ce78fda0a613c9330dbcf9129bbe049889696ad87665c44ba6bbed'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #253
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7ea83a66-8e75-4fc4-8e63-33db2ff0f5cc'::uuid, 'pg', '2c575ae1d2e28cd48f2b49fa611b780bfb241d560f9acf43a85839deea099e78', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1675,"id":185,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '2c575ae1d2e28cd48f2b49fa611b780bfb241d560f9acf43a85839deea099e78'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #254
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5e271f2d-7bff-4147-9862-d965bd7c9a41'::uuid, 'pg', 'bcc63e185d849d7a28b47782fe17eb9df9cac9251282675357cf7200893bab32', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1556,"id":183,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'bcc63e185d849d7a28b47782fe17eb9df9cac9251282675357cf7200893bab32'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #255
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a3c47d82-de66-4d25-b25f-c1cbada8702e'::uuid, 'pg', '3cb216ba483fa1f6d6c1f3e0388cf6c47d1615d71cbeb4842ef2feeac3f8ec82', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1556,"id":182,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3cb216ba483fa1f6d6c1f3e0388cf6c47d1615d71cbeb4842ef2feeac3f8ec82'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #256
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd10e0057-5100-4aed-882d-807df362537f'::uuid, 'pg', '87ad61b8ce0ce0bab7f71d1f7286f31a713adaf73e2d974a13305ab725cc6235', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1577,"id":180,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '87ad61b8ce0ce0bab7f71d1f7286f31a713adaf73e2d974a13305ab725cc6235'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #257
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8c04a98e-ed29-411d-8998-abf4251e64e7'::uuid, 'pg', 'a423d4118eeeddcf044699ea5e6c01f9a4db096a1aa3db01ed8f0db19af50102', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":870,"id":172,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a423d4118eeeddcf044699ea5e6c01f9a4db096a1aa3db01ed8f0db19af50102'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #258
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7afdac55-35d8-4896-a427-ec8c40525031'::uuid, 'pg', '2d793b41ccb779a65249d1fb6a06ad378af24ede152d7f6a744657cd2f8a68e1', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":870,"id":171,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '2d793b41ccb779a65249d1fb6a06ad378af24ede152d7f6a744657cd2f8a68e1'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #259
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b21371a3-b67d-4692-9a44-6c7e600fd3c0'::uuid, 'pg', '4782d0f3edd0b18b6b267e19178f9892a4d4b123584f26f62a9c5b9112f7b078', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":870,"id":169,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4782d0f3edd0b18b6b267e19178f9892a4d4b123584f26f62a9c5b9112f7b078'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #260
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f10971de-dc18-4042-b399-14ef7cc78351'::uuid, 'pg', '5fc8152c4d216dac8deaeb179746bf78e1f218cc0a35c859ffd4d9d6e0a0effd', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":870,"id":168,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '5fc8152c4d216dac8deaeb179746bf78e1f218cc0a35c859ffd4d9d6e0a0effd'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #261
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4eb1e541-03b5-4300-8ba6-a2b11ca9d792'::uuid, 'pg', 'ac3644a94f6ed7516c030a2ed4750cbbab2a1fd77ca3abfd6d00d277818504a8', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1559,"id":167,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ac3644a94f6ed7516c030a2ed4750cbbab2a1fd77ca3abfd6d00d277818504a8'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #262
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4a5f186b-b4ae-4ac2-9593-861b3e62dfc2'::uuid, 'pg', '840190c425244af2edfaa6e81adbc0d82803bdc472f347d86755071e257d4193', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1556,"id":166,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '840190c425244af2edfaa6e81adbc0d82803bdc472f347d86755071e257d4193'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #263
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f80f986b-b90f-4e31-b94e-0eae49a336b4'::uuid, 'pg', '8387dd9c7eb2dda24a486a0a7c0d1ffb00dcec0da47e4dcfb775c58e318ef429', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1557,"id":165,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '8387dd9c7eb2dda24a486a0a7c0d1ffb00dcec0da47e4dcfb775c58e318ef429'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #264
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '493c2bed-8590-4833-9807-7da378321f7a'::uuid, 'pg', '3e3a57d8ecf61b9b1fb4093d8ccfe017b26d62fb12c600cf6128c3945d13fecc', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1557,"id":163,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3e3a57d8ecf61b9b1fb4093d8ccfe017b26d62fb12c600cf6128c3945d13fecc'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #265
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '66c0a73a-33eb-4a93-9471-c0a888c0e1ba'::uuid, 'pg', '470c42903f05b5bb8d426d6366e2265ff154ad3dd72c535cac03c11e5f238995', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1429,"id":162,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '470c42903f05b5bb8d426d6366e2265ff154ad3dd72c535cac03c11e5f238995'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #266
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4c5e2fce-3861-484d-859f-a4d418288c9f'::uuid, 'pg', 'd79c18d03695e8f79094ff55e94d0f5aa0a61fe349e5160d514e33a8076d7b36', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1429,"id":161,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'd79c18d03695e8f79094ff55e94d0f5aa0a61fe349e5160d514e33a8076d7b36'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #267
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '10739322-7b51-4801-944e-6ecedd09bec5'::uuid, 'pg', 'dc290263d886d02847c6989e6cd44efc664d29f512771851a08c282a3e2a843a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1429,"id":160,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'dc290263d886d02847c6989e6cd44efc664d29f512771851a08c282a3e2a843a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #268
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dcb18b73-f057-437a-94e7-24e43055d175'::uuid, 'pg', '65e09f1f79c4ef462ffeaee35464f21b2b6dfb3acdf525d0de1a73e77213a30a', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1429,"id":159,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '65e09f1f79c4ef462ffeaee35464f21b2b6dfb3acdf525d0de1a73e77213a30a'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #269
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b81a40ac-8097-4883-93c0-35b989660d5b'::uuid, 'pg', '071444ece26facafcf650a825070d13f519a89f4b0f6b47d68564f486412ffdc', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":698,"id":158,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '071444ece26facafcf650a825070d13f519a89f4b0f6b47d68564f486412ffdc'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #270
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7b05d432-4afe-4c14-a43d-39fd4b332269'::uuid, 'pg', 'c266f828430713ed52abc04c017ef14d468b50e692d3787875366b1dfa350aab', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":695,"id":157,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c266f828430713ed52abc04c017ef14d468b50e692d3787875366b1dfa350aab'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #271
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '133d68b7-846f-4afc-8169-2e3c8e29d842'::uuid, 'pg', '68b36244167c5d7f0b957fb930aee3ab6190e989cbd77729b1c03de44a977fff', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1523,"id":156,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '68b36244167c5d7f0b957fb930aee3ab6190e989cbd77729b1c03de44a977fff'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #272
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b787ba73-6641-48de-9362-ab56b4fa5293'::uuid, 'pg', '36af90b8168ce0cbcee77b6edebb8d99b0943789ce4a66aa07426dda2afb4c56', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":605,"id":155,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '36af90b8168ce0cbcee77b6edebb8d99b0943789ce4a66aa07426dda2afb4c56'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #273
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '64a10d79-701e-43ee-bb7c-e8da0da5e74f'::uuid, 'pg', '093e0407cc8ff8662a7c5be4c2f45f7aef7d022b4c194fd8a9db6a85c2c60d3e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":700,"id":153,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '093e0407cc8ff8662a7c5be4c2f45f7aef7d022b4c194fd8a9db6a85c2c60d3e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #274
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2e1476b2-e960-492f-8142-b3ddb14ff41d'::uuid, 'pg', 'ff64eb0a07fe77eab8ff6778e4861dcb91d510d13ee96ed55ea42eeb49c92d56', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":700,"id":152,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ff64eb0a07fe77eab8ff6778e4861dcb91d510d13ee96ed55ea42eeb49c92d56'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #275
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ec3a41e6-1785-410d-84c0-4e2f32b2f885'::uuid, 'pg', '1b7fc4f23d1209215a52a0b3e52c424b08795878a0982f9150bfe53041e0286d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":700,"id":151,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1b7fc4f23d1209215a52a0b3e52c424b08795878a0982f9150bfe53041e0286d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #276
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4ed22839-8118-45d4-b9eb-ae421ff885f2'::uuid, 'pg', 'd0a599d8a026246b36a7dc0cc048e175e9806ad9e0b6261b4adc7c29053748c3', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":699,"id":149,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'd0a599d8a026246b36a7dc0cc048e175e9806ad9e0b6261b4adc7c29053748c3'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #277
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd1a88240-7067-47d1-9718-f772456c2ffc'::uuid, 'pg', 'e1ee818f929d54e792df288986751073eceae59501b23db0c2c64ea408c187d2', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":699,"id":148,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e1ee818f929d54e792df288986751073eceae59501b23db0c2c64ea408c187d2'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #278
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1138b9c0-b25b-4c85-8346-35399f6a8fbb'::uuid, 'pg', '2c2b2de7b3a17d4fc8d3750d112cbb000dbd1f0fbc685deae010be27b73b6cb2', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":699,"id":147,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '2c2b2de7b3a17d4fc8d3750d112cbb000dbd1f0fbc685deae010be27b73b6cb2'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #279
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b77dd822-c8db-49e6-9c93-19c991f3900a'::uuid, 'pg', '5cdeb7d9f00639c90670066e088e167f3b842106818a94c967273c2715bb060b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":695,"id":145,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '5cdeb7d9f00639c90670066e088e167f3b842106818a94c967273c2715bb060b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #280
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'aeadc90d-3d88-4e6b-9e7f-e9902d7e5505'::uuid, 'pg', 'cf12aa740a79133a0e846e5ed5a02f5f54488390f865d0fe920d6d7b18bedac9', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":695,"id":144,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'cf12aa740a79133a0e846e5ed5a02f5f54488390f865d0fe920d6d7b18bedac9'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #281
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c909ec8e-0106-45f7-b249-fe16a9a1795b'::uuid, 'pg', 'aee59fb0469570966291b46e9ff9cedfe846d951b90efe6141cdf07d1dc24a57', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":698,"id":142,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'aee59fb0469570966291b46e9ff9cedfe846d951b90efe6141cdf07d1dc24a57'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #282
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'bcbccb4f-a9ee-4bce-9f9d-1ef6329c1a10'::uuid, 'pg', '1f5d45c020d68e4b5b8635e170129604eec17fa78e90487c9d6457b05eddf5c0', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":701,"id":140,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1f5d45c020d68e4b5b8635e170129604eec17fa78e90487c9d6457b05eddf5c0'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #283
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b347159c-7d65-4250-9980-7353999480f8'::uuid, 'pg', 'c3976c0ff9fa475dcc1f1fb4effd95bd867721fbc8ce055e028e65f3ebe3ba77', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":697,"id":139,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c3976c0ff9fa475dcc1f1fb4effd95bd867721fbc8ce055e028e65f3ebe3ba77'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #284
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'aeb2bc0d-0bf9-4997-ac20-2694df5ff8f7'::uuid, 'pg', '97aa25e99e64a12fc90db6eed3f87948574672c2fde9181299c7b5be51fe65cf', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1531,"id":134,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '97aa25e99e64a12fc90db6eed3f87948574672c2fde9181299c7b5be51fe65cf'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #285
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1fce699b-89e4-4efc-ad75-4e6e50f1ef47'::uuid, 'pg', '32dd487a93495d99e9a05e7186f7bded025cda48fd3fccf8a6d798f07f13b694', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1530,"id":133,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '32dd487a93495d99e9a05e7186f7bded025cda48fd3fccf8a6d798f07f13b694'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #286
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9329157d-57ae-4caa-8232-aee425bf429d'::uuid, 'pg', 'f1a051c4b95c1bd9d238357f15fb24a3978021c188b156d6f234dfd28398b369', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1529,"id":132,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f1a051c4b95c1bd9d238357f15fb24a3978021c188b156d6f234dfd28398b369'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #287
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e0981b34-6ce7-46ba-b7c6-9f46eb416115'::uuid, 'pg', '034a0d4e6db6d200dd63252127595c595baa5e92e5c48c62be4a40e28cc5edd7', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1528,"id":131,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '034a0d4e6db6d200dd63252127595c595baa5e92e5c48c62be4a40e28cc5edd7'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #288
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '97f1f803-dc41-4cca-9352-43a1870ddf6a'::uuid, 'pg', 'b02754bffdea64628fd292f54cfd528fab3163df846c322786025d1777ff0ca4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1531,"id":130,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b02754bffdea64628fd292f54cfd528fab3163df846c322786025d1777ff0ca4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #289
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '977cc318-c36b-4f01-80ac-717652ae436a'::uuid, 'pg', '8921e15d06101997c986792dec53676bc2f2467243de4d1ae9080810e75e0bca', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1529,"id":129,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '8921e15d06101997c986792dec53676bc2f2467243de4d1ae9080810e75e0bca'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #290
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '63adc1f9-61e9-444d-81d0-24ae0a7cdb21'::uuid, 'pg', 'c4fe9c44894a1909801cc765b0eff94350fbcb39666d382a7a1e125d31f40315', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1528,"id":128,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c4fe9c44894a1909801cc765b0eff94350fbcb39666d382a7a1e125d31f40315'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #291
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ee05dbd9-4ce5-4e40-b301-29270eacfcbc'::uuid, 'pg', '8f7fb1bf6b542d358dc546837f5e37fa100fc0d6ab5b16d8b05531a1da5b8460', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1531,"id":127,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '8f7fb1bf6b542d358dc546837f5e37fa100fc0d6ab5b16d8b05531a1da5b8460'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #292
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9c087e9e-36d3-4328-a5a3-8dd4a4bf8fa4'::uuid, 'pg', '1b7d57e78c4838b86ff055ba389e69071f735477c78d3d5bb240ed42b0079f87', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1530,"id":126,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1b7d57e78c4838b86ff055ba389e69071f735477c78d3d5bb240ed42b0079f87'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #293
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '39a0ceab-3ce5-4ce5-b79d-7c447630ec19'::uuid, 'pg', 'ef4fcde6f88a9c94fa5ff59fde22f1fac0722132f5928c15c9ce4f0f86faff53', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1529,"id":125,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ef4fcde6f88a9c94fa5ff59fde22f1fac0722132f5928c15c9ce4f0f86faff53'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #294
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2cd644b8-8e2e-49ee-986a-d2fc1dfd3643'::uuid, 'pg', 'b579eaa8307645c9f242a4df69c8f8218d8a13b1e6bb5935b484d3c1ba418e10', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1528,"id":124,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b579eaa8307645c9f242a4df69c8f8218d8a13b1e6bb5935b484d3c1ba418e10'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #295
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'da9efa0b-fb70-43fc-ba9a-00750aacc19e'::uuid, 'pg', '8d2748e8156b4441c2f039a1cb1f7b2d805f0c68e825af22604ebe8ea215c224', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1531,"id":123,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '8d2748e8156b4441c2f039a1cb1f7b2d805f0c68e825af22604ebe8ea215c224'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #296
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '12bef83d-87a0-40ff-8694-b7ea54ec80e2'::uuid, 'pg', '090f707f142da43e86e8273002c1af333e7e54bfb9a3719dd211a8edb2525173', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1530,"id":122,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '090f707f142da43e86e8273002c1af333e7e54bfb9a3719dd211a8edb2525173'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #297
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ea88e62f-8619-4fa3-acb3-30a38bd61afd'::uuid, 'pg', '84e08f4fe9eeefd973d38e8311938fa68a79d414f588abed4fb28f89efaea3f9', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1529,"id":121,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '84e08f4fe9eeefd973d38e8311938fa68a79d414f588abed4fb28f89efaea3f9'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #298
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '487aff72-7286-4840-959a-be120cb8b905'::uuid, 'pg', 'db5447b39677fae4fa2190aed6ca2050e3d9d4bee0bedb27d773d91df34dda4d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1528,"id":120,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'db5447b39677fae4fa2190aed6ca2050e3d9d4bee0bedb27d773d91df34dda4d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #299
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '89b3208e-48ce-4fa6-bf68-eeb8f1332b6f'::uuid, 'pg', 'b64b73bb336946ab77ca6e04c4785a36e64258dba822fbc990dee1fb39ce7a13', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1523,"id":119,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b64b73bb336946ab77ca6e04c4785a36e64258dba822fbc990dee1fb39ce7a13'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #300
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7312c09d-bb5f-4b13-8f06-d7f1732504e1'::uuid, 'pg', '8359190d58279f4b6b2736c8f9869ce7661878b2e5cd4e3f86cf1dcb14e9a5a2', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1522,"id":118,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '8359190d58279f4b6b2736c8f9869ce7661878b2e5cd4e3f86cf1dcb14e9a5a2'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #301
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3ef2c291-c7ab-445b-a1d6-ba152bd960ee'::uuid, 'pg', '4ff53f55b5ff6679adf447213effca76bd493b5ca532fcdab46b45ce17437dbb', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1523,"id":117,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4ff53f55b5ff6679adf447213effca76bd493b5ca532fcdab46b45ce17437dbb'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #302
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '29b369a0-d5e8-432f-baf4-ce4351d09967'::uuid, 'pg', 'e08c9c09860521a23dc866c5a6b53b849ab51d4707e4ef354492f85bd6aa68ba', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1522,"id":116,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e08c9c09860521a23dc866c5a6b53b849ab51d4707e4ef354492f85bd6aa68ba'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #303
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4d82dd83-f7e4-4e5f-8a49-5f6c56862bc7'::uuid, 'pg', '95267a8049e2ebd2dbdf604eddfc035610a81e606e2d5f026bee4c1f0b2442db', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":698,"id":115,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '95267a8049e2ebd2dbdf604eddfc035610a81e606e2d5f026bee4c1f0b2442db'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #304
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9c15750e-8a0a-4024-bcac-24068015cf58'::uuid, 'pg', 'f7d9f4b291a6f3674f969ecc5273324b0e57814e65b93c2ed15b9b03c3c5b6f1', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":698,"id":114,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f7d9f4b291a6f3674f969ecc5273324b0e57814e65b93c2ed15b9b03c3c5b6f1'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #305
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f5d7da1f-cc5a-49b5-af5c-3d450deb2b6e'::uuid, 'pg', 'd6528d5bef28bb201e3c9205158099ce61fd65984396bca3d1cfb5b4cd616a13', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1519,"id":113,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'd6528d5bef28bb201e3c9205158099ce61fd65984396bca3d1cfb5b4cd616a13'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #306
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2b91352e-3d97-4f42-8c39-5698a6192d76'::uuid, 'pg', 'cad3db417d2505d17a0e4f0f5abf9c2ad1cc5c643287b5c5fe2f6f79403ceefb', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1429,"id":101,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'cad3db417d2505d17a0e4f0f5abf9c2ad1cc5c643287b5c5fe2f6f79403ceefb'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #307
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '44845418-006c-4e48-9a98-4da0a46ffcf8'::uuid, 'pg', '414e2e5498fd92710982544e5c565c16c752e05aac3dc89c4e7335403bdeeda7', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1221,"id":100,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '414e2e5498fd92710982544e5c565c16c752e05aac3dc89c4e7335403bdeeda7'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #308
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b75a629d-a2ec-4370-8857-23530cce9b89'::uuid, 'pg', '387f3281b3404f039dbfbf47987222fcb95fb5dcd0fe05a41f7a1a39cfc39f17', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":979,"id":98,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '387f3281b3404f039dbfbf47987222fcb95fb5dcd0fe05a41f7a1a39cfc39f17'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #309
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '397fff0f-f739-44d1-8161-4fde3d6a02c6'::uuid, 'pg', '4f4bd84dcb7b36371e6a15e72d05abe8f76e767607f2e52075cc344315d4eee4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":978,"id":97,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4f4bd84dcb7b36371e6a15e72d05abe8f76e767607f2e52075cc344315d4eee4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #310
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0f183e83-e31d-4afe-bab1-258e63e13146'::uuid, 'pg', '0f82b462dbf88b13478454b96125f43202a8c3c3370fd5700f0ed65b98d7dd71', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":977,"id":96,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '0f82b462dbf88b13478454b96125f43202a8c3c3370fd5700f0ed65b98d7dd71'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #311
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cfb5c7e0-3ee9-40af-8959-948d6ba82019'::uuid, 'pg', '8282af95d445a2dd45e40c311a8e5442621c1ba22248ffbf83ba6286336253e8', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":976,"id":95,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '8282af95d445a2dd45e40c311a8e5442621c1ba22248ffbf83ba6286336253e8'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #312
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '33a8deeb-7f4a-48e1-955b-7e4bf8fad857'::uuid, 'pg', 'a28e83151caa6a93b6a67499b17bcf6c1ba7219cfc07670f609e1e106f116611', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":954,"id":94,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a28e83151caa6a93b6a67499b17bcf6c1ba7219cfc07670f609e1e106f116611'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #313
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '46d7c52b-1556-4b23-bf27-14833f506079'::uuid, 'pg', 'c08f5bbde9281181d2984ebb03991ef833eb5477ec33240c43663b1592dbf296', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":948,"id":93,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c08f5bbde9281181d2984ebb03991ef833eb5477ec33240c43663b1592dbf296'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #314
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '84eed12e-6401-4624-bbd8-e85e07ea11a8'::uuid, 'pg', 'b0d5eeb75c2fa92db4b1909f101574b5960c057faf4b0cd33edcc2168b8bc808', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":947,"id":92,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b0d5eeb75c2fa92db4b1909f101574b5960c057faf4b0cd33edcc2168b8bc808'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #315
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cf04ea6e-b868-485d-9fe1-8a45f0bceabc'::uuid, 'pg', '3e628f34be49249ccb0d758a8f0a05825f2242c338a0a9569676fe74108b5a40', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":883,"id":91,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3e628f34be49249ccb0d758a8f0a05825f2242c338a0a9569676fe74108b5a40'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #316
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7d06969c-4bcb-4fa3-842c-7788c9677be8'::uuid, 'pg', 'be90656c605397a5ca68c801f6d8416f045db0d2daae7656ac75df61ccf3d71b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":874,"id":90,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'be90656c605397a5ca68c801f6d8416f045db0d2daae7656ac75df61ccf3d71b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #317
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '107feb82-aaa0-4586-9fea-3001bf6e7ae9'::uuid, 'pg', '026f82311f0c8c694cfcba2f04dc2df745d4bd4b0dfab81c298feca6f2040d21', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":873,"id":89,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '026f82311f0c8c694cfcba2f04dc2df745d4bd4b0dfab81c298feca6f2040d21'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #318
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a284af11-a228-4100-b391-de24243d8f8f'::uuid, 'pg', 'effcb050bc5d96d2caf18c2c9b8e7b34de14adc080929c1ddb61d6e7e53efeaf', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":353,"id":88,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'effcb050bc5d96d2caf18c2c9b8e7b34de14adc080929c1ddb61d6e7e53efeaf'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #319
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a5dc1933-c132-486e-88a4-e7814977e4ca'::uuid, 'pg', '0ecc8c98700380cbd5b3e326a6e63a7a39fbc7fc02fd1f15ab1faf08351a2f2f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":627,"id":87,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '0ecc8c98700380cbd5b3e326a6e63a7a39fbc7fc02fd1f15ab1faf08351a2f2f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #320
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e6233c0c-a9c6-4432-9038-f8a6834abd0f'::uuid, 'pg', 'a65e99f5bfb999712f21d9a983b1b45c3b144df031412c98be0c653f9d7a1bf4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":870,"id":83,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a65e99f5bfb999712f21d9a983b1b45c3b144df031412c98be0c653f9d7a1bf4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #321
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e0987485-c078-43f1-9226-4eb16c835390'::uuid, 'pg', '57b848fedfcb095b5a1740d2403f7132f8227cb59c0a73381011648b04dc2f58', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":701,"id":82,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '57b848fedfcb095b5a1740d2403f7132f8227cb59c0a73381011648b04dc2f58'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #322
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ac69a32f-0144-4dc0-b684-e45cd8e529a4'::uuid, 'pg', 'ae1eb762577fd0b4f61dae04fde183f6fdd9b09c805547ada18663697fdc7509', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":701,"id":81,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ae1eb762577fd0b4f61dae04fde183f6fdd9b09c805547ada18663697fdc7509'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #323
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b95524e4-2767-4569-a7b3-0eaa43e49a33'::uuid, 'pg', 'de436521fe0c59f952dd822f504722c25d9d4fa0af6711d80278c9ceed0751c0', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":798,"id":80,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'de436521fe0c59f952dd822f504722c25d9d4fa0af6711d80278c9ceed0751c0'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #324
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2b099472-0774-46c4-9ee7-d08f1879a001'::uuid, 'pg', 'e3cb47bba7ad2b9df292c7884db75a641be7ffd05766f28a67004a6e4c94b884', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":797,"id":79,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e3cb47bba7ad2b9df292c7884db75a641be7ffd05766f28a67004a6e4c94b884'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #325
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a2506feb-87ff-4801-84db-111820417d8e'::uuid, 'pg', '84d64efd7ac9289d88c48307e47b8495ec74e9e2d9f84ec5f0c320a2d0b103c4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":796,"id":78,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '84d64efd7ac9289d88c48307e47b8495ec74e9e2d9f84ec5f0c320a2d0b103c4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #326
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '960e9760-5a22-439a-a30e-e207c39e2903'::uuid, 'pg', '1c9ed0afede14311cd463636123809b7a89eb461f528c988076e6180ac9844fb', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":795,"id":77,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1c9ed0afede14311cd463636123809b7a89eb461f528c988076e6180ac9844fb'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #327
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '64bf51ea-434f-41d9-b0a0-4460844c6384'::uuid, 'pg', '7fabea114ea9d070e19ee85286a2c853f07bc013c165aa5e289103530906cec2', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":733,"id":76,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7fabea114ea9d070e19ee85286a2c853f07bc013c165aa5e289103530906cec2'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #328
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '043922f6-fd3d-4760-8854-90bc4d3b8b7d'::uuid, 'pg', '2cd5237ea87f47f89eab1c60214da5ee1ebcaf6c6cf2da747f904a704c937676', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":732,"id":75,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '2cd5237ea87f47f89eab1c60214da5ee1ebcaf6c6cf2da747f904a704c937676'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #329
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dfc729bb-db90-4ccf-bdde-93314ef4f734'::uuid, 'pg', 'c196f73371e57f206949d3d60bbf624a9448cca3cef2a7bc5c2ed136773854a0', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":731,"id":74,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c196f73371e57f206949d3d60bbf624a9448cca3cef2a7bc5c2ed136773854a0'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #330
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5ed24b69-c56d-42ac-831a-57134a12771f'::uuid, 'pg', '300dba4ce8ceb2eb782f024172a56e4472076cf07e05816db9fb28becada98de', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":730,"id":73,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '300dba4ce8ceb2eb782f024172a56e4472076cf07e05816db9fb28becada98de'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #331
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '16c11555-59a3-4736-b395-5e3cfe4c3087'::uuid, 'pg', '7fdfb048a6e732b85ff41021cb62bcb332d4e45757d32639509ecd56e2acbce7', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":729,"id":72,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7fdfb048a6e732b85ff41021cb62bcb332d4e45757d32639509ecd56e2acbce7'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #332
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6652acfd-b9e6-4547-b3dd-215bc12d25a4'::uuid, 'pg', 'b0e2a0dd9ec3212f82e14ddfd6e685e133ecc27d306b238ff0d3c3bb2bf19f3e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":728,"id":71,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'b0e2a0dd9ec3212f82e14ddfd6e685e133ecc27d306b238ff0d3c3bb2bf19f3e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #333
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '00a5f35e-9693-476c-8b95-c8834b99125e'::uuid, 'pg', '24e3fe04a0e001589822c1fb88188d84f17cbaf42a262416bd5bc32e21b44f84', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":727,"id":70,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '24e3fe04a0e001589822c1fb88188d84f17cbaf42a262416bd5bc32e21b44f84'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #334
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a52a38dd-e63d-4998-904e-335ff6f5a459'::uuid, 'pg', '6c821606fe8f3ca682be00e9e9e0a4b6482b34109619692d7e2bb596b918e792', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":726,"id":69,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6c821606fe8f3ca682be00e9e9e0a4b6482b34109619692d7e2bb596b918e792'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #335
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f4aacd11-407d-4402-a468-bbda600d75ff'::uuid, 'pg', 'd0fb3c5623ec9538db082f9a9fd5e6e82d386eb21ed432a5d942b96e514d37bf', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":725,"id":68,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'd0fb3c5623ec9538db082f9a9fd5e6e82d386eb21ed432a5d942b96e514d37bf'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #336
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '59d8d637-1ac8-4829-84fa-0984a6278168'::uuid, 'pg', '8deef8bbe7b5f37ecc5a5eb3efd88f2969437f425d6f55a17b3464f3ba89a998', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":724,"id":67,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '8deef8bbe7b5f37ecc5a5eb3efd88f2969437f425d6f55a17b3464f3ba89a998'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #337
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '09c29b4f-4480-4ed6-9f3a-a6445fd16c82'::uuid, 'pg', 'dda909e163d71df6c4a929d4bfbeb08520c1ba34c3aab2e820e5310c8730d720', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":627,"id":66,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'dda909e163d71df6c4a929d4bfbeb08520c1ba34c3aab2e820e5310c8730d720'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #338
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f58efa7c-4120-40ea-89db-a12ea8aacedf'::uuid, 'pg', '1cde343daa87308ab4d9cd9ff71898694e76496a4bd2e8c76148749fecb61bf6', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":623,"id":65,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1cde343daa87308ab4d9cd9ff71898694e76496a4bd2e8c76148749fecb61bf6'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #339
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2677f8f0-8286-4733-bb0c-dd303439d624'::uuid, 'pg', '6e7911b124577e981c71357cbb0d09551aa282c6f4b49bab8041966276688aec', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":254,"id":64,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6e7911b124577e981c71357cbb0d09551aa282c6f4b49bab8041966276688aec'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #340
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1cc0758c-25c9-4f03-b22d-d58af0683ec9'::uuid, 'pg', '1ed1d61d04816b289dea0c6276336e62a95fe2ad0642ad6c731ef8b5b28991df', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":254,"id":63,"rolecode":"GRO","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '1ed1d61d04816b289dea0c6276336e62a95fe2ad0642ad6c731ef8b5b28991df'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #341
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '32142e73-6d79-422b-885e-7a6dddcee0ff'::uuid, 'pg', '519918cb19cfed9b0ca53ecb445d07f3dab75b72aade3a161daedb1eb588a44c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":582,"id":61,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '519918cb19cfed9b0ca53ecb445d07f3dab75b72aade3a161daedb1eb588a44c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #342
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd6b2c1dc-d519-4c71-80aa-c35d5d23ed81'::uuid, 'pg', '5f420d84baef2eb7a295a33d09f386512945bc960a2b76b2497947f84b904481', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":604,"id":60,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '5f420d84baef2eb7a295a33d09f386512945bc960a2b76b2497947f84b904481'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #343
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '170d7f77-e479-456d-b7ff-e625430432f2'::uuid, 'pg', 'ab6e876102a7723ab57e6892f60be96625bc255dea2523373fb3f4af33937fcd', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":605,"id":59,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'ab6e876102a7723ab57e6892f60be96625bc255dea2523373fb3f4af33937fcd'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #344
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2f4ef09e-ed52-48d3-810b-2d9d6bee5b6b'::uuid, 'pg', '4828b3ab3c1143d393b29c4ad6597813dd408d4f04f35f479460f56bb44ab1e3', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":594,"id":58,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4828b3ab3c1143d393b29c4ad6597813dd408d4f04f35f479460f56bb44ab1e3'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #345
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e566a754-8424-49cd-af8e-6e6b5ff3d4d2'::uuid, 'pg', 'fb19ff3824ad3a9f1cda8ed892a08ddc5e1548855df75290a6652224b9e17758', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":594,"id":57,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'fb19ff3824ad3a9f1cda8ed892a08ddc5e1548855df75290a6652224b9e17758'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #346
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '800d1463-7022-4c3a-b20e-54f11ff60486'::uuid, 'pg', '5be4e6cfe9d42b567ab23b1f69699e5ce6a28b43cb3af80c032b8a9f3c43be07', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":695,"id":56,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '5be4e6cfe9d42b567ab23b1f69699e5ce6a28b43cb3af80c032b8a9f3c43be07'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #347
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '521a123e-9fc1-4b48-bfd6-1617d2d12fe5'::uuid, 'pg', '59733f844ea6cd15e5bc10e4ec0d3e0ba0117097528e193c3bec6f70d23b3aa5', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":355,"id":55,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '59733f844ea6cd15e5bc10e4ec0d3e0ba0117097528e193c3bec6f70d23b3aa5'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #348
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0159fb6c-4fdb-4a93-b561-bd4148faab70'::uuid, 'pg', '44408ddacc1523f31e7aab5132383114e7875f8736f465af6346801214d4ff9c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":353,"id":54,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '44408ddacc1523f31e7aab5132383114e7875f8736f465af6346801214d4ff9c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #349
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '06224f4a-0dac-4885-b117-f8b83ef73807'::uuid, 'pg', '81ce38d5774d369963689ba610c4079b913d4d7847c9855b7cfe32dc19f3c11d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":355,"id":51,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '81ce38d5774d369963689ba610c4079b913d4d7847c9855b7cfe32dc19f3c11d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #350
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd47b53cf-3c09-4b48-b00b-36b8e23bf550'::uuid, 'pg', '4aa3083b498bb8f0624f023dd52f830f4964ed8e8405e69a1a37196817005f3d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":353,"id":50,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4aa3083b498bb8f0624f023dd52f830f4964ed8e8405e69a1a37196817005f3d'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #351
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8042c791-0488-48eb-a4d6-92e055d58368'::uuid, 'pg', 'd2d1b6d7788b51354db921a37f8ca2d71f277eaeb53782011c20480f289916cd', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":207,"id":49,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'd2d1b6d7788b51354db921a37f8ca2d71f277eaeb53782011c20480f289916cd'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #352
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b2429f5b-b20c-4c55-a374-aa6c18522eab'::uuid, 'pg', '34ac0aa26a61e90c2ce156fe8d488d0dfc50e822366891cb6120c72a407bdc35', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":258,"id":48,"rolecode":"EMPLOYEE","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '34ac0aa26a61e90c2ce156fe8d488d0dfc50e822366891cb6120c72a407bdc35'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #353
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '59fd1f6d-cf34-4416-bca4-28c10c7576fe'::uuid, 'pg', '2011cef2acf81b01d8e724e4bea1b517fbfa5357bba3d87ad000fa20bae916df', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":701,"id":38,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '2011cef2acf81b01d8e724e4bea1b517fbfa5357bba3d87ad000fa20bae916df'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #354
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6f10da07-0a18-4b0e-ab65-d57598cc6431'::uuid, 'pg', 'f7d63ac6019718be1b199d5ec1199f4aaf16de5e6f4bb6538dc4155dd66c1b62', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":700,"id":37,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'f7d63ac6019718be1b199d5ec1199f4aaf16de5e6f4bb6538dc4155dd66c1b62'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #355
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fcefb4c8-e0b0-405f-a6d3-e0289d0edf30'::uuid, 'pg', '4f6e497ebd38943bf06890d621dc6e359a4ab0152f0f481f0fcdcf9d836ebce6', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":699,"id":36,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4f6e497ebd38943bf06890d621dc6e359a4ab0152f0f481f0fcdcf9d836ebce6'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #356
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fef9f53e-ac30-4d3b-baef-af01d3986d93'::uuid, 'pg', '9da9430f426b9dc2697c3661abe29933ad446355b41aec27b7fd5e05f9a8e1d3', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":698,"id":35,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '9da9430f426b9dc2697c3661abe29933ad446355b41aec27b7fd5e05f9a8e1d3'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #357
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6b3e163e-b490-477c-bfb9-52ed7dc1b284'::uuid, 'pg', 'dbf15e5ce5f2320f796debc64b9c47a5e96687de1f66191fbcfa884697714672', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":697,"id":34,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'dbf15e5ce5f2320f796debc64b9c47a5e96687de1f66191fbcfa884697714672'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #358
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6bf4b903-d729-42a9-9895-acfab4b6039c'::uuid, 'pg', '3d2f4a7ea87c6966983f258b448ce27f515f6878cc9acf8e65bae597ff28a2cc', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":290,"id":32,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3d2f4a7ea87c6966983f258b448ce27f515f6878cc9acf8e65bae597ff28a2cc'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #359
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '111856d8-94b8-4cd1-b7dd-6289e2779e78'::uuid, 'pg', '07a75de8afcbdb2d36f41e69bafa1d647dca7c086c7fddb8335de4bfdfc28130', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":696,"id":31,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '07a75de8afcbdb2d36f41e69bafa1d647dca7c086c7fddb8335de4bfdfc28130'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #360
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cf5a3be5-aee2-4bbf-b827-3d96fa2b2fa9'::uuid, 'pg', '4b095ad4b9e3cee9b8839c599e6676a691210a18434c84fa01807b8f2e87f42f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":695,"id":30,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4b095ad4b9e3cee9b8839c599e6676a691210a18434c84fa01807b8f2e87f42f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #361
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a9a72574-a8b4-4471-ad06-463e1288ca97'::uuid, 'pg', 'a38dfb73178f5ba0ad16e70fe4ca7d84409d6b2aeb0ff2735dab9a994fc41937', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":694,"id":29,"rolecode":"CITIZEN","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a38dfb73178f5ba0ad16e70fe4ca7d84409d6b2aeb0ff2735dab9a994fc41937'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #362
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '84730a36-aa9f-4c9d-a44f-cd3537567fc6'::uuid, 'pg', '894590cd99ab5b21d885646d48d6f765763435b1e3ccdff56e38b8d7e1aea341', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":694,"id":28,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '894590cd99ab5b21d885646d48d6f765763435b1e3ccdff56e38b8d7e1aea341'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #363
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '10e654aa-8165-4f5a-8ecb-3b2dfdd115c1'::uuid, 'pg', 'dae86604fd0c9c28f54df276e4cd164d8decc97e603b00687f1e398dae3e496e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":278,"id":27,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'dae86604fd0c9c28f54df276e4cd164d8decc97e603b00687f1e398dae3e496e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #364
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4c289693-fdfb-44a8-9185-e389ebc0af02'::uuid, 'pg', '7be519455d11bc5abfca3dabf03c80fd87f4d9bf27fdbad96dff04d116109e53', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":277,"id":26,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '7be519455d11bc5abfca3dabf03c80fd87f4d9bf27fdbad96dff04d116109e53'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #365
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '87e6811d-63e2-4524-a95c-995532aef756'::uuid, 'pg', '73ab871f0b4e4e10e6b8c9b4df71ac872afc7ab35e770859b74f7c10c8cb6fe4', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":276,"id":25,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '73ab871f0b4e4e10e6b8c9b4df71ac872afc7ab35e770859b74f7c10c8cb6fe4'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #366
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0163dc88-658a-4a90-bf04-437693ae20df'::uuid, 'pg', 'd8bb15207f561146bade59c5b9c119c78c9e84cb37762eb277db1f9f2044197e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":693,"id":24,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'd8bb15207f561146bade59c5b9c119c78c9e84cb37762eb277db1f9f2044197e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #367
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2237e329-41d0-48bb-9d0c-1650cbb925d4'::uuid, 'pg', '665f5a2567412d5a9f3458717eaafdf899b134bb6a8f093e81ce36081877bdf7', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":692,"id":23,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '665f5a2567412d5a9f3458717eaafdf899b134bb6a8f093e81ce36081877bdf7'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #368
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '00cb785a-ff3e-488f-84e4-0178e02dadc7'::uuid, 'pg', '88774c86d81965fa8b698f930e5833420b6032871f39e5a639deb3a19059a535', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":691,"id":22,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '88774c86d81965fa8b698f930e5833420b6032871f39e5a639deb3a19059a535'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #369
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '536e3465-146c-4eec-85b6-a7f4242209cb'::uuid, 'pg', 'a9396bbe82261342ab00656f70d5e134025219622ff09e63374b03f80f4c1906', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":266,"id":14,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'a9396bbe82261342ab00656f70d5e134025219622ff09e63374b03f80f4c1906'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #370
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fec05394-8526-4cab-bfe2-ef5940497f13'::uuid, 'pg', '317fab4299ac00aeda2cca310a496db8c9470591e4dc952cf32200c5a9c0df7b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":265,"id":13,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '317fab4299ac00aeda2cca310a496db8c9470591e4dc952cf32200c5a9c0df7b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #371
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2c390854-5f02-487a-aefc-c7205901617c'::uuid, 'pg', '5e2cbc60c13e78f8827ce8cabfe24b1b1ce82151510c35475fa61cf241396339', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":264,"id":12,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '5e2cbc60c13e78f8827ce8cabfe24b1b1ce82151510c35475fa61cf241396339'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #372
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7ad898c8-d612-4794-8702-7aaae304a165'::uuid, 'pg', '90a05af4415f4e0b9c7294006f6aa57fea724b71182205748e296cc46567284b', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":263,"id":11,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '90a05af4415f4e0b9c7294006f6aa57fea724b71182205748e296cc46567284b'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #373
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0a6f0bd1-d7d1-478c-a7bc-c0b42299060b'::uuid, 'pg', '69c91950970ef5f523f5c3774cfaaa90de5a7474846d11544b26b2f472cbab27', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":262,"id":10,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '69c91950970ef5f523f5c3774cfaaa90de5a7474846d11544b26b2f472cbab27'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #374
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7b15568f-065f-48b9-aa26-08a862c6be61'::uuid, 'pg', '9a040b8c57198e3872e56d3439b1a10839ccae95ad0a5739bae9fecfc11fced8', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":261,"id":9,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '9a040b8c57198e3872e56d3439b1a10839ccae95ad0a5739bae9fecfc11fced8'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #375
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'bfec03e8-100e-41ac-a60b-7c2580c53d1a'::uuid, 'pg', 'c7293e03d1c57b3b06c7cdb8f5d35ecf831d9bfebfccdeb3df5482e4ac3c546c', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":260,"id":8,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'c7293e03d1c57b3b06c7cdb8f5d35ecf831d9bfebfccdeb3df5482e4ac3c546c'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #376
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '35877794-a25c-4c63-ba96-ab0a14c91cbe'::uuid, 'pg', '3953e45c4818d6415a6ba61eb437e883d69a43fa4e9a216ec7354e31c30cf142', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":259,"id":7,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '3953e45c4818d6415a6ba61eb437e883d69a43fa4e9a216ec7354e31c30cf142'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #377
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ed926875-2fc6-4329-981d-53ca0ada6aec'::uuid, 'pg', 'd6235f1643cc129c098667f5607510e823987de3e8128051cde98e5ca1a0decd', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":258,"id":6,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'd6235f1643cc129c098667f5607510e823987de3e8128051cde98e5ca1a0decd'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #378
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0b42c38c-53e2-428b-84dd-ec7666ff33a6'::uuid, 'pg', 'e8c6483d851045e99fc9c49e351705d1d2d8b130b571f033571189436b9407ac', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":257,"id":5,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'e8c6483d851045e99fc9c49e351705d1d2d8b130b571f033571189436b9407ac'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #379
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4d290990-fed7-4bd5-a600-61ffb9a8e70a'::uuid, 'pg', '802f4156070f544fc8275700639447133441521f41708979d698b82d1719e971', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":256,"id":4,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '802f4156070f544fc8275700639447133441521f41708979d698b82d1719e971'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #380
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '32686b39-5d73-49a2-9a54-8d41c2113202'::uuid, 'pg', '809bc952c69458e2eeeadc72fa3f95503036ab3f731ba77e7ef69281ee36fe9e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":255,"id":3,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '809bc952c69458e2eeeadc72fa3f95503036ab3f731ba77e7ef69281ee36fe9e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #381
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f6fb944b-4951-4ced-b751-de3ee002381d'::uuid, 'pg', '4a1428bccb2a51bf081bd0d28200c6b9924199cd743381a76ae055536b3dcc27', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":254,"id":2,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '4a1428bccb2a51bf081bd0d28200c6b9924199cd743381a76ae055536b3dcc27'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #382
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '85c9775e-162d-4939-ac0b-cb970715d365'::uuid, 'pg', 'be3e69c8552865b8313cea62c896b79d08158d943882b5b2e9e8bf19ad0f4b8f', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":253,"id":1,"rolecode":"SUPERUSER","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = 'be3e69c8552865b8313cea62c896b79d08158d943882b5b2e9e8bf19ad0f4b8f'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #383
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a62b33dd-60ee-45f4-afa5-31d2256f5b37'::uuid, 'pg', '6e83e179fe2463785fc6df459d4598e30bcf8831609c45ddccb653b59e45b68e', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1729,"id":745,"rolecode":"CSR","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6e83e179fe2463785fc6df459d4598e30bcf8831609c45ddccb653b59e45b68e'
);

-- data/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json :: ACCESSCONTROL-ROLEACTIONS.roleactions entry #384
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b26379b1-b047-4f51-9127-a8e6be6d7df9'::uuid, 'pg', '6d4ccbfafc7de1eef40b4be4934ba5217bb12a3b37e30082e62ad7009552f60d', 'ACCESSCONTROL-ROLEACTIONS.roleactions', '{"actioncode":"","actionid":1729,"id":745,"rolecode":"PGR_LME","tenantId":"pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLEACTIONS.roleactions' AND uniqueidentifier = '6d4ccbfafc7de1eef40b4be4934ba5217bb12a3b37e30082e62ad7009552f60d'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e98cfee6-3dc6-42ab-a1dd-49e8c2f3af0e'::uuid, 'pg', '157863b908edfe94c6b767c0315165f84d26ce20b708db8af19766a96f975bb9', 'ACCESSCONTROL-ROLES.roles', '{"code":"TICKET_REPORT_VIEWER","description":"One who will view the reports of tickets","name":"Report Viewer"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '157863b908edfe94c6b767c0315165f84d26ce20b708db8af19766a96f975bb9'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a8c939bb-6108-4994-aac5-84398ece1f2d'::uuid, 'pg', '47170e983c27408b53a065cf954ae439c7500c22ee96751d30cba07a2eee966d', 'ACCESSCONTROL-ROLES.roles', '{"code":"PGR_LME","description":"One who will resolve complaints","name":"Complaint Resolver"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '47170e983c27408b53a065cf954ae439c7500c22ee96751d30cba07a2eee966d'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ee732c43-4367-4706-88df-f92730f37902'::uuid, 'pg', 'aba232a466c823afa382219cdbae7ed87cbc8046f9747a9571f22bcb915d0e91', 'ACCESSCONTROL-ROLES.roles', '{"code":"GRO","description":"One who will assess & assign complaints","name":"Complaint Assessor"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = 'aba232a466c823afa382219cdbae7ed87cbc8046f9747a9571f22bcb915d0e91'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1a6fe2cf-2f77-4ae5-ab7b-907bff2c03ac'::uuid, 'pg', '272689c4e9576e424df20bca09339e1d993cfed8aa154395d85acaedbc0cec5e', 'ACCESSCONTROL-ROLES.roles', '{"code":"CSR","description":"One who will create complaints","name":"Complainant"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '272689c4e9576e424df20bca09339e1d993cfed8aa154395d85acaedbc0cec5e'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '02ac2515-0145-4487-9d0a-f6e04cec99a6'::uuid, 'pg', '7f555489f87b3e530966b2a11d7ae6e048ef90c7c8da0504d61fcb5004e9ac1d', 'ACCESSCONTROL-ROLES.roles', '{"code":"LOC_ADMIN","description":"LOC_ADMIN","name":"Localisation admin"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '7f555489f87b3e530966b2a11d7ae6e048ef90c7c8da0504d61fcb5004e9ac1d'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '49c99b1a-71d1-4e0a-8b56-698b9b96c099'::uuid, 'pg', '1bcaf9ad6d80439df411f35e7f74cf8be7c1c1de7e3b0ff5cc436a3d9951ce37', 'ACCESSCONTROL-ROLES.roles', '{"code":"MDMS_ADMIN","description":"MDMS User that can create and search schema","name":"MDMS ADMIN"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '1bcaf9ad6d80439df411f35e7f74cf8be7c1c1de7e3b0ff5cc436a3d9951ce37'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3853e856-ec41-491a-8b55-dce9b06efcc6'::uuid, 'pg', '202f1c86d385a0cfd04a96061a0312ff02e1614f90117eec61390b8a63b5bd3f', 'ACCESSCONTROL-ROLES.roles', '{"code":"REINDEXING_ROLE","description":"Role for reindexing for encrypted data access","name":"Reindexing Role"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '202f1c86d385a0cfd04a96061a0312ff02e1614f90117eec61390b8a63b5bd3f'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #8
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '037ebe29-3d4b-483e-b0e9-c263a3c4a5a9'::uuid, 'pg', '0c576081018117feddfc49892374a0b8a549f7bc17a3878386d236677e3550de', 'ACCESSCONTROL-ROLES.roles', '{"code":"INTERNAL_MICROSERVICE_ROLE","description":"Internal role for plain access","name":"Internal Microservice Role"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '0c576081018117feddfc49892374a0b8a549f7bc17a3878386d236677e3550de'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #9
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1fcc7212-2320-4cf1-8ad2-1b0af20445fd'::uuid, 'pg', '9c31f533fa0d4cd87baa88455501751d8a126b325269d41060d6e8bd4319276f', 'ACCESSCONTROL-ROLES.roles', '{"code":"COMMON_EMPLOYEE","description":"Basic employee roles","name":"Basic employee roles"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '9c31f533fa0d4cd87baa88455501751d8a126b325269d41060d6e8bd4319276f'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #10
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9beb4f33-b1b2-44f9-a0a2-83f9a238b6f8'::uuid, 'pg', '39aada8cc74c13cfc6696d1437c6b3d3311e53a98a8bb312a5997436e27cb342', 'ACCESSCONTROL-ROLES.roles', '{"code":"SYSTEM","description":"System user role","name":"System user"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '39aada8cc74c13cfc6696d1437c6b3d3311e53a98a8bb312a5997436e27cb342'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #11
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a6674ce0-467f-4a9a-a085-602ef597415b'::uuid, 'pg', 'd7537d03da2078f117e306de760e0ee9a50d7734aca62d32b60dba90d2147696', 'ACCESSCONTROL-ROLES.roles', '{"code":"SUPERVISOR","description":"Escalation to particular role","name":"Auto Escalation Supervisor"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = 'd7537d03da2078f117e306de760e0ee9a50d7734aca62d32b60dba90d2147696'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #12
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8a9fc579-7458-4d57-970c-204986e64a4d'::uuid, 'pg', 'adf5c5e0f94708983358f0fe3b1f8498fdc12a3615ee5c4d97fcffbe691ef0a7', 'ACCESSCONTROL-ROLES.roles', '{"code":"AUTO_ESCALATE","description":"Auto Escalation Employee","name":"Auto Escalation Employee"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = 'adf5c5e0f94708983358f0fe3b1f8498fdc12a3615ee5c4d97fcffbe691ef0a7'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #13
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'de576462-abb3-4168-b4eb-15d74f9db209'::uuid, 'pg', '9574fd7c89a20234e602b4c9cea820e0cdcdd812b0bfad5c3032b9c121665e9e', 'ACCESSCONTROL-ROLES.roles', '{"code":"QA_AUTOMATION","description":"QA Automation","name":"QA Automation"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '9574fd7c89a20234e602b4c9cea820e0cdcdd812b0bfad5c3032b9c121665e9e'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #14
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd4a3e927-4b72-4484-8935-e697db84990d'::uuid, 'pg', '285381ae0f9e3b68ad1c794cc86cd0f19f4a05e1d00f82862428701515513fe3', 'ACCESSCONTROL-ROLES.roles', '{"code":"HRMS_ADMIN","description":"HRMS Admin","name":"HRMS Admin"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '285381ae0f9e3b68ad1c794cc86cd0f19f4a05e1d00f82862428701515513fe3'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #15
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '75b8cb6b-5ed1-4602-bb7b-aee8f722780e'::uuid, 'pg', 'd152fb9523c59ec39759522de322e178c585e7644e69ccbbf77c2b3b0f20c724', 'ACCESSCONTROL-ROLES.roles', '{"code":"SUPERUSER","description":"System Administrator. Can change all master data and has access to all the system screens.","name":"Super User"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = 'd152fb9523c59ec39759522de322e178c585e7644e69ccbbf77c2b3b0f20c724'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #16
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7c1e0cfe-79a8-45c4-a4db-3d965f1d403e'::uuid, 'pg', 'df87a9ba264c01321ac243ad46add4787ad13c9a13b7a45823ede3f6444852a4', 'ACCESSCONTROL-ROLES.roles', '{"code":"EMPLOYEE","description":"Default role for all employees","name":"Employee"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = 'df87a9ba264c01321ac243ad46add4787ad13c9a13b7a45823ede3f6444852a4'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #17
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd2a106d8-005e-4ef3-8104-fba93d0c247e'::uuid, 'pg', '0b303dd0ce3ab27c557c65acf9d9071ac97bf0846d3ae5a5cb15253cb697ea99', 'ACCESSCONTROL-ROLES.roles', '{"code":"CITIZEN","description":"Citizen who can raise complaint","name":"Citizen"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '0b303dd0ce3ab27c557c65acf9d9071ac97bf0846d3ae5a5cb15253cb697ea99'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #18
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '94251dd5-b2c7-4cfe-af56-a91f09c8329d'::uuid, 'pg', '456b68a3345b31a74bfde1d2ebe00a602bbbe4b4d8369896e76ed4d5e102502a', 'ACCESSCONTROL-ROLES.roles', '{"code":"ANONYMOUS","description":"Anonymous User to be used in case of no auth","name":"Anonymous User"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '456b68a3345b31a74bfde1d2ebe00a602bbbe4b4d8369896e76ed4d5e102502a'
);

-- data/ACCESSCONTROL-ROLE/ACCESSCONTROL-ROLES.roles.json :: ACCESSCONTROL-ROLES.roles entry #19
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '76927703-a6fd-4192-afc6-9c7ba40afb23'::uuid, 'pg', '9be5a187689c51d1b1e1f7e451adcffa2c3bfad1bedcf3ab47d4cd536f113d2d', 'ACCESSCONTROL-ROLES.roles', '{"code":"WORKFLOW_ADMIN","description":"WORKFLOW User that can create and search Workflow","name":"WORKFLOW ADMIN"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'ACCESSCONTROL-ROLES.roles' AND uniqueidentifier = '9be5a187689c51d1b1e1f7e451adcffa2c3bfad1bedcf3ab47d4cd536f113d2d'
);

-- data/common-masters/common-masters.CronJobAPIConfig.json :: common-masters.CronJobAPIConfig entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2072e3f4-7d38-4354-a872-eee2fce2c424'::uuid, 'pg', '512e82bda8b6f6b2ff9d2da7a48dd8c3e18045fa2ddc8b720ca975fda616dfc4', 'common-masters.CronJobAPIConfig', '{"active":"true","header":{"Content-Type":"application/json"},"jobName":"daily","method":"POST","payload":{"RequestInfo":"{DEFAULT_REQUESTINFO}"},"url":"http://egov-workflow-v2.core-dev:8080/egov-workflow-v2/egov-wf/auto/Incident/_escalate?tenantId=pg"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.CronJobAPIConfig' AND uniqueidentifier = '512e82bda8b6f6b2ff9d2da7a48dd8c3e18045fa2ddc8b720ca975fda616dfc4'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f9a95453-6dc7-42ae-86ee-38828a66ecb3'::uuid, 'pg', '1581687d089a7044945893b1057bd7f773b6071fdd0b31bc3614b3528b00a274', 'common-masters.Department', '{"active":true,"code":"DEPT_35","name":"Works Branch"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = '1581687d089a7044945893b1057bd7f773b6071fdd0b31bc3614b3528b00a274'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6c851c0d-c6d9-4b1c-9519-7b493b3e604d'::uuid, 'pg', '2077db0dc42216b15b87845ccf6b7c1397d25143c23bb472698121f68e0a829b', 'common-masters.Department', '{"active":true,"code":"DEPT_25","name":"Accounts Branch"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = '2077db0dc42216b15b87845ccf6b7c1397d25143c23bb472698121f68e0a829b'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f3ae8004-fed9-4faf-b471-5cd7ecb24e20'::uuid, 'pg', '0e8a47c93e4dbfde067de263b0338894fbb9191bf6ac42b1f4391070273af040', 'common-masters.Department', '{"active":true,"code":"DEPT_13","name":"Tax Branch"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = '0e8a47c93e4dbfde067de263b0338894fbb9191bf6ac42b1f4391070273af040'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e0ca5a4b-1c6d-4a0d-bcb3-8a35a536d432'::uuid, 'pg', 'e5367372f16225688160bfe165c369b01d7953ba5185b750a948176eece45199', 'common-masters.Department', '{"active":true,"code":"DEPT_10","name":"Others"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = 'e5367372f16225688160bfe165c369b01d7953ba5185b750a948176eece45199'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '881ad6ca-e3bd-4e20-ad2f-fbf837a7fe0f'::uuid, 'pg', 'bb4102ae4e081bba8db633f1e67e12178bda2abbfcdf29aac6361d26b06a82dd', 'common-masters.Department', '{"active":true,"code":"DEPT_9","name":"Executive Branch"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = 'bb4102ae4e081bba8db633f1e67e12178bda2abbfcdf29aac6361d26b06a82dd'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '89055c18-9ff9-4176-8e79-fda7c05effb1'::uuid, 'pg', '612f0f4e10c58f9407e3fca0583460f72a756d1097e2f84c24cbdd39a4ae0dd2', 'common-masters.Department', '{"active":true,"code":"DEPT_8","name":"Complaint Cell"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = '612f0f4e10c58f9407e3fca0583460f72a756d1097e2f84c24cbdd39a4ae0dd2'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f3cc59b0-3a06-402f-a01f-c5bf58e54774'::uuid, 'pg', '427ca9e96b12e231545b6338b0f073a7226862d06bb2cb983134453b99185298', 'common-masters.Department', '{"active":true,"code":"DEPT_7","name":"Citizen service desk"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = '427ca9e96b12e231545b6338b0f073a7226862d06bb2cb983134453b99185298'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #8
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '79ff23af-181f-4ba6-9901-1d839c2eb18b'::uuid, 'pg', '9cfbef0b27d99611c963ab216d2334096529485feb7814af1e7cc01de43c3b29', 'common-masters.Department', '{"active":true,"code":"DEPT_6","name":"Building Branch"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = '9cfbef0b27d99611c963ab216d2334096529485feb7814af1e7cc01de43c3b29'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #9
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '61939e69-e22f-41bc-a5cc-b710bd491246'::uuid, 'pg', '7f473c526ede2226e73444e158e560e01becd63add6c9adb7ab99311d935162b', 'common-masters.Department', '{"active":true,"code":"DEPT_5","name":"Horticulture"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = '7f473c526ede2226e73444e158e560e01becd63add6c9adb7ab99311d935162b'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #10
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ece3df34-d94e-40cd-8a9c-3dacdcc1d75b'::uuid, 'pg', '1a0b0de482db70e82c5fe4edf8a3c6e64da8e7a7ae2539fb3632dabe7264d969', 'common-masters.Department', '{"active":true,"code":"DEPT_4","name":"Operation & Maintenance"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = '1a0b0de482db70e82c5fe4edf8a3c6e64da8e7a7ae2539fb3632dabe7264d969'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #11
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '88012fc8-4b0f-4f1f-b26d-c1e2842ffe9e'::uuid, 'pg', '0d21d3cf4407791da7317dc1655ad0d72ef874fa0840ef0b01b3d9a69f08788f', 'common-masters.Department', '{"active":true,"code":"DEPT_3","name":"Health & Sanitation"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = '0d21d3cf4407791da7317dc1655ad0d72ef874fa0840ef0b01b3d9a69f08788f'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #12
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2a347e81-352a-4174-80a6-73c34dc4c081'::uuid, 'pg', '3e5c25ba3e4d54e398e66d78b7e72ab486a510927d496b0f291733dd96ca524f', 'common-masters.Department', '{"active":true,"code":"DEPT_2","name":"Building & Roads"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = '3e5c25ba3e4d54e398e66d78b7e72ab486a510927d496b0f291733dd96ca524f'
);

-- data/common-masters/common-masters.Department.json :: common-masters.Department entry #13
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'acd76f05-53d8-4591-8fbf-0c0c7c88ca6c'::uuid, 'pg', 'f9b627638c1f81ded623cfa9d1b268f08b3d89e11d72480844e37a52cee39d63', 'common-masters.Department', '{"active":true,"code":"DEPT_1","name":"Street Lights"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Department' AND uniqueidentifier = 'f9b627638c1f81ded623cfa9d1b268f08b3d89e11d72480844e37a52cee39d63'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8a6b9737-9c20-4213-909c-6dd162d1afca'::uuid, 'pg', '702f50156ef6805e5b3bfb0fb6674f857fa0989c49a9ad53c9fc671dbe0d5a67', 'common-masters.Designation', '{"active":true,"code":"COMM","description":"Commissioner","name":"Commissioner"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '702f50156ef6805e5b3bfb0fb6674f857fa0989c49a9ad53c9fc671dbe0d5a67'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '53d31eee-a325-43f5-9d28-8f8e1dbf913c'::uuid, 'pg', '767b88cc670c250cd88120299975d535fd14aa781dd9d65f70800c1230e87ea5', 'common-masters.Designation', '{"active":true,"code":"AO","description":"Accounts Officer","name":"Accounts Officer"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '767b88cc670c250cd88120299975d535fd14aa781dd9d65f70800c1230e87ea5'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3624d04e-b628-4f83-9c21-c595b26d9378'::uuid, 'pg', '7e8bce2cedcdebe7feee53c1fea611c729db827b1434b655621140b7bb8a5e59', 'common-masters.Designation', '{"active":true,"code":"DESIG_47","description":"Superintendent","name":"Superintendent"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '7e8bce2cedcdebe7feee53c1fea611c729db827b1434b655621140b7bb8a5e59'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9563a16a-8c11-42a3-9e29-6505538bbb8f'::uuid, 'pg', '9c82d648076eb1a3a99f66296e7161c8b685a5e66f8d3c058a39e32435c8ea27', 'common-masters.Designation', '{"active":true,"code":"DESIG_24","description":"Assistant Commissioner","name":"Assistant Commissioner"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '9c82d648076eb1a3a99f66296e7161c8b685a5e66f8d3c058a39e32435c8ea27'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '823b45cd-982d-4110-9352-632404271d9e'::uuid, 'pg', 'be194d24ca9ce324a1451a209566d2529e43746fa55c6e35c51967c9ff043e0f', 'common-masters.Designation', '{"active":true,"code":"DESIG_58","description":"Accountant","name":"Accountant"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = 'be194d24ca9ce324a1451a209566d2529e43746fa55c6e35c51967c9ff043e0f'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ec4d523f-d9e3-4d4c-a2a6-f0e236003209'::uuid, 'pg', '9d1b398bf912c0814a5d603bf22a036bf7d941f8412c31494516319ffde82203', 'common-masters.Designation', '{"active":true,"code":"DESIG_1001","description":"Deputy Controller Finance and Accounts","name":"Deputy Controller Finance and Accounts"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '9d1b398bf912c0814a5d603bf22a036bf7d941f8412c31494516319ffde82203'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5b4acb4e-3332-490f-ba1f-0cf12f614816'::uuid, 'pg', 'ebe74b9260cf081bf6313ae7614bc0656c55023ebceb9a407ce18fe2f04d9eb1', 'common-masters.Designation', '{"active":true,"code":"DESIG_23","description":"Citizen service representative","name":"Citizen service representative"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = 'ebe74b9260cf081bf6313ae7614bc0656c55023ebceb9a407ce18fe2f04d9eb1'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #8
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1e40cdc4-c22e-4e57-93e2-95ad595569b3'::uuid, 'pg', '911e6ae7553f028ab94526515ffb7771dc8232780ab9aa2fbc7cb65593006d04', 'common-masters.Designation', '{"active":true,"code":"DESIG_22","description":"Junior Enginer ( Horticulutre)","name":"Junior Enginer ( Horticulutre)"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '911e6ae7553f028ab94526515ffb7771dc8232780ab9aa2fbc7cb65593006d04'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #9
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7b146864-dd76-48ec-aa88-68302f5349d4'::uuid, 'pg', 'ec87733e492efeda95f0a67c16b7657a8bc5e1b2e522018d0adb3f990997dca1', 'common-masters.Designation', '{"active":true,"code":"DESIG_21","description":"Building Inspector","name":"Building Inspector"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = 'ec87733e492efeda95f0a67c16b7657a8bc5e1b2e522018d0adb3f990997dca1'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #10
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c2b0d2c8-5ad2-4440-a3b5-33451874801a'::uuid, 'pg', '0bceb0e7b21aed5c79279c106ef8600f111946dc3009c54b080d48ff267dd660', 'common-masters.Designation', '{"active":true,"code":"DESIG_20","description":"Asst. Town Planner","name":"Asst. Town Planner"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '0bceb0e7b21aed5c79279c106ef8600f111946dc3009c54b080d48ff267dd660'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #11
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '49ab1135-3e09-4f4a-9696-67339204caa3'::uuid, 'pg', '834f2c0fefd971cc97cc18b1ae08f736208c09d69c4c7a696803c54a2bf6eb3e', 'common-masters.Designation', '{"active":true,"code":"DESIG_19","description":"Municipal Town Planner","name":"Municipal Town Planner"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '834f2c0fefd971cc97cc18b1ae08f736208c09d69c4c7a696803c54a2bf6eb3e'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #12
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ae364560-d861-47d4-9066-ebe227f51f47'::uuid, 'pg', '2d03a820ecee6be42c1dcec2297d92e1c9c124ba97b1e91567cf92c14ef382b5', 'common-masters.Designation', '{"active":true,"code":"DESIG_18","description":"Senior Town Planner","name":"Senior Town Planner"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '2d03a820ecee6be42c1dcec2297d92e1c9c124ba97b1e91567cf92c14ef382b5'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #13
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '368df2bf-eb15-42fb-b75d-4de297ec6ad6'::uuid, 'pg', '0844ed76abdbc40c891c5f8d64aee60f21aa8e66b756c7c6f887028fbf9bcfa2', 'common-masters.Designation', '{"active":true,"code":"DESIG_17","description":"Accountant","name":"Sainitary Supervisor"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '0844ed76abdbc40c891c5f8d64aee60f21aa8e66b756c7c6f887028fbf9bcfa2'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #14
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd9a862a9-87a8-4506-bcbc-be6ca3853d1d'::uuid, 'pg', 'bda5561b333067c5adb5c9fa64c3f4a45a5c6231fadfa1ae0c7ce48425f88372', 'common-masters.Designation', '{"active":true,"code":"DESIG_16","description":"Clerk","name":"Sainitary Inspector"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = 'bda5561b333067c5adb5c9fa64c3f4a45a5c6231fadfa1ae0c7ce48425f88372'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #15
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a636f085-aac1-4c6f-baa2-1fceef76f862'::uuid, 'pg', '75c3bef2d08a5eea42af7e7427543211e23834f7e52b1e9fbe60b58b9de2702d', 'common-masters.Designation', '{"active":true,"code":"DESIG_15","description":"Mechanical Oversear","name":"Chief Sanitary Inspector"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '75c3bef2d08a5eea42af7e7427543211e23834f7e52b1e9fbe60b58b9de2702d'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #16
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ec979553-13f8-4753-a070-cb5765c8ccdb'::uuid, 'pg', '51ceed4144a6bf8e600d70cc01052cfcb19934dc11487e9e033948e4b2183897', 'common-masters.Designation', '{"active":true,"code":"DESIG_14","description":"Medical Officer","name":"Medical Officer"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '51ceed4144a6bf8e600d70cc01052cfcb19934dc11487e9e033948e4b2183897'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #17
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd711b66c-cf00-43c7-a3d8-514bab2d8e17'::uuid, 'pg', 'a761e2b06aad1d499e6adc02a43d338a455d80a1b475da3e2eed82f0af98d54e', 'common-masters.Designation', '{"active":true,"code":"DESIG_13","description":"Health Officer","name":"Health Officer"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = 'a761e2b06aad1d499e6adc02a43d338a455d80a1b475da3e2eed82f0af98d54e'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #18
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ae447194-eba6-4dfb-8304-e8f0053b04f5'::uuid, 'pg', '3e81204574c3aa4f9f63e8f1b5e31929ef6c4ce2a8bec6f0de6f18e8f6decf1d', 'common-masters.Designation', '{"active":true,"code":"DESIG_12","description":"Junior Engineer ( Light)","name":"Junior Engineer ( Light)"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '3e81204574c3aa4f9f63e8f1b5e31929ef6c4ce2a8bec6f0de6f18e8f6decf1d'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #19
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a6bcd204-724e-4b39-a23f-fede827b24fc'::uuid, 'pg', 'e79235bf2d751486197b38ad21e370022b0506c8e9058a4745018898810ad544', 'common-masters.Designation', '{"active":true,"code":"DESIG_11","description":"Corporation Engineer (Light)","name":"Corporation Engineer (Light)"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = 'e79235bf2d751486197b38ad21e370022b0506c8e9058a4745018898810ad544'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #20
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dbd5cc3e-21c0-4e46-90b2-67e879392f6a'::uuid, 'pg', 'a2d61ea8c09624b87390c29bcd19563621afaa20e909eebca64e395421a0ab9e', 'common-masters.Designation', '{"active":true,"code":"DESIG_10","description":"Superintending Engineer ( Light)","name":"Superintending Engineer ( Light)"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = 'a2d61ea8c09624b87390c29bcd19563621afaa20e909eebca64e395421a0ab9e'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #21
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0e201f4b-a824-44f0-bf08-5f5151b206fc'::uuid, 'pg', '9c8371236173af1c9fb81896e3f462038fcac13ee86c14385b704c745f3ca39c', 'common-masters.Designation', '{"active":true,"code":"DESIG_09","description":"Junior Engineer ( O&M)","name":"Junior Engineer ( O&M)"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '9c8371236173af1c9fb81896e3f462038fcac13ee86c14385b704c745f3ca39c'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #22
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b112f3e4-1b28-405d-a2cb-bea4f25b4f17'::uuid, 'pg', '90c1fd04416e30b994f8ed077d0e6ef3be4890f30a24e232721e32af05afbbbc', 'common-masters.Designation', '{"active":true,"code":"DESIG_08","description":"Asst. Engineer ( O&M)","name":"Asst. Engineer ( O&M)"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '90c1fd04416e30b994f8ed077d0e6ef3be4890f30a24e232721e32af05afbbbc'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #23
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3483dc66-3eb1-46c5-87bd-d9c0a177a7c1'::uuid, 'pg', 'a9bf383b9646933a5b65286b6d0ebee914ce46ba7a9c614407d4c05f6bce3e59', 'common-masters.Designation', '{"active":true,"code":"DESIG_07","description":"Corporation Engineer (O&M)","name":"Corporation Engineer (O&M)"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = 'a9bf383b9646933a5b65286b6d0ebee914ce46ba7a9c614407d4c05f6bce3e59'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #24
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3969bbb5-16bc-425a-87d6-fae84c3b4c7d'::uuid, 'pg', '1de82de5581717715dde437f2c309c8e426cb1101feba79f41bf49f13154aff3', 'common-masters.Designation', '{"active":true,"code":"DESIG_06","description":"Superintending Engineer ( O&M)","name":"Superintending Engineer ( O&M)"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '1de82de5581717715dde437f2c309c8e426cb1101feba79f41bf49f13154aff3'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #25
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9ca77b70-ab27-4b84-a707-09de40940e84'::uuid, 'pg', '1c9b8998c8ce170a11eb3fe59ff3222b22c457495b3c4952913f073ab5dba329', 'common-masters.Designation', '{"active":true,"code":"DESIG_05","description":"Land Scape Officer","name":"Land Scape Officer"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '1c9b8998c8ce170a11eb3fe59ff3222b22c457495b3c4952913f073ab5dba329'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #26
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '92232e71-e34e-4892-8de5-680a4e586a6e'::uuid, 'pg', '954945b251dfc3039bce1877987ba9885fa8499706ed6c83a32413557a0b9217', 'common-masters.Designation', '{"active":true,"code":"DESIG_04","description":"Junior Engineer ( B&R)","name":"Junior Engineer ( B&R)"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = '954945b251dfc3039bce1877987ba9885fa8499706ed6c83a32413557a0b9217'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #27
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3c80948e-df80-46bd-b749-6bbb3fc7d54b'::uuid, 'pg', 'e6a27767516f62f7a748b2c7abb7b252f7f574fc479a3bd7bd1d41e55fe90f85', 'common-masters.Designation', '{"active":true,"code":"DESIG_03","description":"Asst. Engineer ( B&R)","name":"Asst. Engineer ( B&R)"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = 'e6a27767516f62f7a748b2c7abb7b252f7f574fc479a3bd7bd1d41e55fe90f85'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #28
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5b1c7080-c0ad-488b-8ada-58e207b2edda'::uuid, 'pg', 'f795cc71c5b1a6d86add6ee93161a24371a57b870a4a8fb55cc75794ce186f80', 'common-masters.Designation', '{"active":true,"code":"DESIG_02","description":"Corporation Engineer (B&R)","name":"Corporation Engineer (B&R)"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = 'f795cc71c5b1a6d86add6ee93161a24371a57b870a4a8fb55cc75794ce186f80'
);

-- data/common-masters/common-masters.Designation.json :: common-masters.Designation entry #29
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ad605df4-2d37-48b8-9a02-92da168c4cc9'::uuid, 'pg', 'ba6c65a27ec4e000665e685b4d0a2ba93df6e058fd655616f4d896fa19adbd7c', 'common-masters.Designation', '{"active":true,"code":"DESIG_01","description":"Superintending Engineer ( B&R)","name":"Superintending Engineer ( B&R)"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.Designation' AND uniqueidentifier = 'ba6c65a27ec4e000665e685b4d0a2ba93df6e058fd655616f4d896fa19adbd7c'
);

-- data/common-masters/common-masters.GenderType.json :: common-masters.GenderType entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ebe9c7d6-8b94-470f-8e4a-60f02158a402'::uuid, 'pg', 'cd109a200d8b97e0de3855e8128ffe1e7ffeccb8ab6b1f9f0225a997ba295f49', 'common-masters.GenderType', '{"active":true,"code":"MALE"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.GenderType' AND uniqueidentifier = 'cd109a200d8b97e0de3855e8128ffe1e7ffeccb8ab6b1f9f0225a997ba295f49'
);

-- data/common-masters/common-masters.GenderType.json :: common-masters.GenderType entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8a4eb565-fb52-4a76-a050-72d8a6fab681'::uuid, 'pg', '25f1014a1655b088fefdf9243db06ea4cdf35afe8a57023fd9b7015af0331e58', 'common-masters.GenderType', '{"active":true,"code":"FEMALE"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.GenderType' AND uniqueidentifier = '25f1014a1655b088fefdf9243db06ea4cdf35afe8a57023fd9b7015af0331e58'
);

-- data/common-masters/common-masters.GenderType.json :: common-masters.GenderType entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0d646692-c356-4e1b-a31c-2ff44043b13c'::uuid, 'pg', '31cc7c129034c3f79d01aa2b202382087810c43fafa06dfe0e810b80cfd1dcd8', 'common-masters.GenderType', '{"active":true,"code":"TRANSGENDER"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.GenderType' AND uniqueidentifier = '31cc7c129034c3f79d01aa2b202382087810c43fafa06dfe0e810b80cfd1dcd8'
);

-- data/common-masters/common-masters.GenderType.json :: common-masters.GenderType entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '58fae0c2-1491-4814-bd9b-47f4ce1c4abd'::uuid, 'pg', 'f6734ad57526435f866e443ea1b3f2a7464b8a5544b71106237893313a4bd272', 'common-masters.GenderType', '{"active":false,"code":"OTHERS"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.GenderType' AND uniqueidentifier = 'f6734ad57526435f866e443ea1b3f2a7464b8a5544b71106237893313a4bd272'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7a8c90a7-6920-49ca-b0f3-7f2cb578b56d'::uuid, 'pg', 'e943b1a935a0f7905e87c6bf12a981654fa0aa57ea63410aa53062594ada701c', 'common-masters.IdFormat', '{"format":"[CITY.CODE]-[SEQ_EGOV_COMMON_[TENANT_ID]]","idname":"im.incidentId"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'e943b1a935a0f7905e87c6bf12a981654fa0aa57ea63410aa53062594ada701c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9696efea-3e89-4c59-830e-0f01f79a8551'::uuid, 'pg', '2f322e4db5570f96c5abb7ad20f113178fc6879c7eeb37041aa09c52f62b7957', 'common-masters.IdFormat', '{"format":"SW_AP/[CITY.CODE]/[fy:yyyy-yy]/DC-[SEQ_SW_APP_[TENANT_ID]]","idname":"sewerageservice.disconnection.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '2f322e4db5570f96c5abb7ad20f113178fc6879c7eeb37041aa09c52f62b7957'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7e7361da-6e6e-41b1-9a00-80ed7becde14'::uuid, 'pg', 'e805056cc2c704ca2c2f7e0afe94ff1189f50de848d0106176dcdd3b035972ff', 'common-masters.IdFormat', '{"format":"WS_AP/[CITY.CODE]/[fy:yyyy-yy]/DC-[SEQ_WS_APP_[TENANT_ID]]","idname":"waterservice.disconnection.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'e805056cc2c704ca2c2f7e0afe94ff1189f50de848d0106176dcdd3b035972ff'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5f34ff73-8808-4fe6-b305-f6d039421ee1'::uuid, 'pg', 'cacd20eedda34571505935f30fc142c7393de5dfba1fb0a376ffeb73fca7c518', 'common-masters.IdFormat', '{"format":"DT/[CITY.CODE]/[cb.name]/[fy:yyyy]/[SEQ_EGOV_COMMON]","idname":"death_cert.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'cacd20eedda34571505935f30fc142c7393de5dfba1fb0a376ffeb73fca7c518'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b4d4907f-b943-48a3-8977-1136e0a04454'::uuid, 'pg', '07012be27768de88aa411d12bb8b16f5b2ccaba1bf6ed00e16c89cadd84eec14', 'common-masters.IdFormat', '{"format":"BR/[CITY.CODE]/[cb.name]/[fy:yyyy]/[SEQ_EGOV_COMMON]","idname":"birth_cert.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '07012be27768de88aa411d12bb8b16f5b2ccaba1bf6ed00e16c89cadd84eec14'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8c5eec74-27ec-475f-a637-cc0b19d70505'::uuid, 'pg', '3679ab8544554bc0a964c7ba2054f0e8787914035ebbc47658a347b1b1fd8bfc', 'common-masters.IdFormat', '{"format":"PG-BP-[cy:yyyy-MM-dd]-[SEQ_EG_BP_PN]","idname":"bpa.permitnumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '3679ab8544554bc0a964c7ba2054f0e8787914035ebbc47658a347b1b1fd8bfc'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6f2c872f-a8dd-44af-90d6-79cabd8cd6fe'::uuid, 'pg', '45ad94c26d6ac3d6477c9ff48a8cb2fa3fa5eb2bd913a92a872ccec1632f95ab', 'common-masters.IdFormat', '{"format":"PG-BP-[cy:yyyy-MM-dd]-[SEQ_EG_BP_APN]","idname":"bpa.aplnumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '45ad94c26d6ac3d6477c9ff48a8cb2fa3fa5eb2bd913a92a872ccec1632f95ab'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #8
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '01c841f3-54de-488d-9e3a-cf748040762e'::uuid, 'pg', '96efcb22b85b21feeec751aa440aaf8efeba46b0bacfc2d4a8530ad18fecb335', 'common-masters.IdFormat', '{"format":"PG-SK-[cy:yyyy-MM-dd]-[SEQ_EG_PT_LN]","idname":"bpareg.licensenumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '96efcb22b85b21feeec751aa440aaf8efeba46b0bacfc2d4a8530ad18fecb335'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #9
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '812f280d-80df-42af-8c43-d50d1f420702'::uuid, 'pg', '711142638e04806c1d8e010c9a3c83d4a356a940d6e4b828cc28931324d04061', 'common-masters.IdFormat', '{"format":"PG-SK-[cy:yyyy-MM-dd]-[SEQ_EG_TL_APL]","idname":"bpareg.aplnumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '711142638e04806c1d8e010c9a3c83d4a356a940d6e4b828cc28931324d04061'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #10
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '62ec82a9-3f3b-461b-ab4a-325fc8ca0a2e'::uuid, 'pg', '61ae877a52bb381fb512e783bfd483bd9367cbd3601d4a6cef7f30949a58170c', 'common-masters.IdFormat', '{"format":"DOC-[cy:yyyy-MM-dd]-[SEQ_EG_DOC_ID]","idname":"du.documentid"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '61ae877a52bb381fb512e783bfd483bd9367cbd3601d4a6cef7f30949a58170c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #11
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1dd2ee4a-666f-4c1d-aad1-94ec54d65931'::uuid, 'pg', 'b039ad1681c6c09391bbf2c27613c7c59651036cec21b87e6f058b6b37cf770d', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"lcf.trade_license_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'b039ad1681c6c09391bbf2c27613c7c59651036cec21b87e6f058b6b37cf770d'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #12
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8e905a06-9672-413b-9934-6fe40bcc4f33'::uuid, 'pg', 'e9818b5c833991d9a6bbbdbe357c2f4c34491208b9ad0c358e364bb64e2b543b', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"lcf.rehri_rickshaw_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'e9818b5c833991d9a6bbbdbe357c2f4c34491208b9ad0c358e364bb64e2b543b'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #13
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1e77e215-6493-42c8-890e-02c2d3fdd0ba'::uuid, 'pg', '5d1e80c351ccf39f9b2b1d45257bd56fdbcaabafc43e56af59337bf9c44ad5d5', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.swimming_pool_and_gymnactics_hall_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '5d1e80c351ccf39f9b2b1d45257bd56fdbcaabafc43e56af59337bf9c44ad5d5'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #14
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '81afb7c1-e0b4-4e6e-ba6e-59f1cc433a31'::uuid, 'pg', 'dc1ece05578249f479c46d28b621ac1d8005f8708597261538d691ec78a02fdb', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.dog_registration.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'dc1ece05578249f479c46d28b621ac1d8005f8708597261538d691ec78a02fdb'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #15
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '461d032f-d76a-40f0-adf7-5f2935e59578'::uuid, 'pg', 'f5e5bf1e41e3c0719e76838178a73550f8e62fca0c55ed47b7921360b0f8e77c', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.sale_of_recyclable_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'f5e5bf1e41e3c0719e76838178a73550f8e62fca0c55ed47b7921360b0f8e77c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #16
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8b24ac42-bfdf-46af-a8db-b33ee4c3ae1a'::uuid, 'pg', 'fa9b01fd6e7af761fde35bfef1c79ce5e470f9b97811e7fd986bd92c2f2a1fbe', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.sale_of_compost_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'fa9b01fd6e7af761fde35bfef1c79ce5e470f9b97811e7fd986bd92c2f2a1fbe'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #17
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f7a8b812-cef7-494a-9f4b-6e8914c43dfa'::uuid, 'pg', 'c324d81d76c9d92ec62ce74c66b521f3cc52a84ac77ccaf33ceb782a88400a54', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.street_light_pole_transfer_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'c324d81d76c9d92ec62ce74c66b521f3cc52a84ac77ccaf33ceb782a88400a54'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #18
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7a4a1bb1-f7d7-40a1-9b72-6c759aa0ecee'::uuid, 'pg', '39481012e1e12a7519006b18929b031417ecbcd2a7db53e84b053921ca16e600', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.conservancy_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '39481012e1e12a7519006b18929b031417ecbcd2a7db53e84b053921ca16e600'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #19
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '05a51a3f-37f3-494c-9b9c-6fdfd43c0bc4'::uuid, 'pg', '5cddd16eaa97c197e897f44f9e1d214be00bac505d092d85656cc4692526f435', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.candy_fee_slaughter_house.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '5cddd16eaa97c197e897f44f9e1d214be00bac505d092d85656cc4692526f435'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #20
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b86be8f9-8701-4153-b125-f11b4d6cb8dd'::uuid, 'pg', 'c8ba693e2d1355f4e0691cc2bb0307075dd93e593d5283ec4e5d78f6019692e5', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.license_fee_slaughter_house.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'c8ba693e2d1355f4e0691cc2bb0307075dd93e593d5283ec4e5d78f6019692e5'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #21
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '479fbbc0-c0fb-4467-b935-2f861794d6c4'::uuid, 'pg', '03c2cc3b90e0c04f5024d1db1bdccfc01673812fee6e316ac36cb2a27c07002a', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.dispensary_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '03c2cc3b90e0c04f5024d1db1bdccfc01673812fee6e316ac36cb2a27c07002a'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #22
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '45e27127-1ac6-400d-8c64-5fa369d8d4e4'::uuid, 'pg', '555d13bfb7ead1a62eb9dc9c73729383dc8d40a18dee6080751202c44e7dee35', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.building_safety_certificate_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '555d13bfb7ead1a62eb9dc9c73729383dc8d40a18dee6080751202c44e7dee35'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #23
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1811a1fe-6595-4baf-a6e9-749a38e22071'::uuid, 'pg', 'b6568ca045932965228f116ddf9ed4d3057b2d2b5fbbaccce7b2e494a4cea812', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.information_certificate_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'b6568ca045932965228f116ddf9ed4d3057b2d2b5fbbaccce7b2e494a4cea812'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #24
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c4c0715e-ddf6-4739-8e71-36d5120618a0'::uuid, 'pg', '417f96f0cb6d8849fdfc61657ef63e20e92ea56860a0dcae8d8fd1631aa1d610', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.sub_division_charges_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '417f96f0cb6d8849fdfc61657ef63e20e92ea56860a0dcae8d8fd1631aa1d610'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #25
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '21f1ecd8-9a6f-4cc4-abdb-1a0f001d256d'::uuid, 'pg', 'af6224a5b961b55c226873e79935f1f699b05c24da38ad54f4de974a6965fb9a', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ch.burning_of_waste_challan_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'af6224a5b961b55c226873e79935f1f699b05c24da38ad54f4de974a6965fb9a'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #26
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '824c430b-853c-459f-bc15-f0e378c61f61'::uuid, 'pg', '69a3ee99d80a1f861f805fd1e12c0260b68c370f48f576ffd792652514823166', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ch.collection_and_demolition_waste_challan_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '69a3ee99d80a1f861f805fd1e12c0260b68c370f48f576ffd792652514823166'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #27
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd1814e6d-84d0-4a74-a64a-f37127b335f2'::uuid, 'pg', '0e7028d4c955198fa272ba49297b3d31e9dfdb807ed7bf48f299638b6431764a', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"fn.security_deposit_fee_refundable fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '0e7028d4c955198fa272ba49297b3d31e9dfdb807ed7bf48f299638b6431764a'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #28
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '72a8191b-b061-4c08-9d1a-3fd38c67c40f'::uuid, 'pg', 'fd2e2165ced5f75d0a39d8cf8cc1e65a8be92c310a19abebef7dc7fd6dc444b8', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"fn.tender_earnest_money_deposit_refundable fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'fd2e2165ced5f75d0a39d8cf8cc1e65a8be92c310a19abebef7dc7fd6dc444b8'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #29
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '235636f2-abb0-47d7-b0e6-ad220ecb6b7f'::uuid, 'pg', '4e23509096d9e86ead307e95c18e012ef082b535df13e450cff05e0dde30e46f', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.street_vendor_icard_certificate_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '4e23509096d9e86ead307e95c18e012ef082b535df13e450cff05e0dde30e46f'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #30
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '27307359-d8e9-4d42-8cf8-a513ece07e2d'::uuid, 'pg', '2a30f59c5ebac7c72f18dc1ee70a215919ea247dfc2c4c81876ae9eea5043be3', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.service_tax_gst_of_rent_of_mc_properties.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '2a30f59c5ebac7c72f18dc1ee70a215919ea247dfc2c4c81876ae9eea5043be3'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #31
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fdf47cb7-d5a9-4656-b99f-311c772ad3c5'::uuid, 'pg', 'a0f28c1bdb99fefe2700bdf8e7109fb0d9ff9800e9a3664fed1278ec8c35746d', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.sale_of_land.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'a0f28c1bdb99fefe2700bdf8e7109fb0d9ff9800e9a3664fed1278ec8c35746d'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #32
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '45ed66ae-342c-4d3b-9192-ff0ac8f3149b'::uuid, 'pg', 'de35ab2503fcda3be1b929257b5d9d2fdc09f113c307003189810d6d0e4369d9', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tx.property tax_dishonoured_cheque_payment.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'de35ab2503fcda3be1b929257b5d9d2fdc09f113c307003189810d6d0e4369d9'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #33
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd29c2ffd-d0d6-4c3c-af83-a7bb176a7af1'::uuid, 'pg', 'efd0c2fce5e823a6d867857a988ef3a6430a08b61d961d7301576cfe91e1cd3b', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tx.property_tax_2013_14.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'efd0c2fce5e823a6d867857a988ef3a6430a08b61d961d7301576cfe91e1cd3b'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #34
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd18d0e60-2400-457a-938e-0a1ad62df489'::uuid, 'pg', '55598e1d4884d0878b6e0140caa9be0ddb6c3bd0de3c6365cf92171e1a33b43f', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"advt.gas_balloon_advertisement.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '55598e1d4884d0878b6e0140caa9be0ddb6c3bd0de3c6365cf92171e1a33b43f'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #35
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e61a5cce-6c5d-4939-83a9-10618e16c074'::uuid, 'pg', '8f78719c2ab885c386885a1c579641282ffbb62b972f459dc94cd71a49a5063c', 'common-masters.IdFormat', '{"format":"PG-CH-[cy:yyyy-MM-dd]-[SEQ_EG_CH_APL]","idname":"echallan.aplnumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '8f78719c2ab885c386885a1c579641282ffbb62b972f459dc94cd71a49a5063c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #36
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '91d7b654-69dc-4a00-baba-06ec3480007b'::uuid, 'pg', '89308384b79b068ec98a3ed2c673546a5a38b81d6a3435b0e30ea310a195d75a', 'common-masters.IdFormat', '{"format":"[CITY.CODE]-FSM-[cy:yyyy-MM-dd]-[SEQ_EGOV_FSM]","idname":"fsm.aplnumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '89308384b79b068ec98a3ed2c673546a5a38b81d6a3435b0e30ea310a195d75a'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #37
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dddb0dc7-9704-41ea-b7e5-94c9fe734b74'::uuid, 'pg', 'a167340366efcb04001c0b432cbbcdb5f88ea179e07e8ced87d4832a2295b1fd', 'common-masters.IdFormat', '{"format":"FSM/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON[TENANT_ID]]","idname":"fsm.trip_charges.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'a167340366efcb04001c0b432cbbcdb5f88ea179e07e8ced87d4832a2295b1fd'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #38
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6fa2c87c-a913-40f9-ab1a-0ad6ec8254ca'::uuid, 'pg', 'cf3fa24642ff42fafa6ed2c4ab631b91a14f471afa367cc3e90731a87c557fd6', 'common-masters.IdFormat', '{"format":"NOTETYPE-CONSUMERCODE-[SEQ_BS_MUTATION_[tenant_id]]","idname":"bs.amendment.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'cf3fa24642ff42fafa6ed2c4ab631b91a14f471afa367cc3e90731a87c557fd6'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #39
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '67bac536-5402-4871-a8f0-be5360200cf3'::uuid, 'pg', '99ca5739ac392cbd869fbbc0d24c8b8240e3f89b13233fc545cca81cbaf47101', 'common-masters.IdFormat', '{"format":"PG-PGR-[cy:yyyy-MM-dd]-[SEQ_EG_PGR_ID]","idname":"pgr.servicerequestid"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '99ca5739ac392cbd869fbbc0d24c8b8240e3f89b13233fc545cca81cbaf47101'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #40
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6a9b1b1b-2a49-4c39-9e1b-0dc9e125f67f'::uuid, 'pg', '2f030290a24b9abb8f5c1efd978061b7167ceadf658fc82e5e78c203b076734c', 'common-masters.IdFormat', '{"format":"PG-NOCSRV-[cy:yyyy-MM-dd]-[SEQ_EG_NOC_APN]","idname":"noc.application.number"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '2f030290a24b9abb8f5c1efd978061b7167ceadf658fc82e5e78c203b076734c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #41
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '813c6397-4909-4af5-81a6-060abac719c9'::uuid, 'pg', '999bfe1427d5f45f3e6992f3f134a681bf883120ddc99226562a7f1b8ae3d842', 'common-masters.IdFormat', '{"format":"BPA/OC/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"bpa.nc_oc_san_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '999bfe1427d5f45f3e6992f3f134a681bf883120ddc99226562a7f1b8ae3d842'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #42
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f57cafbc-7508-4676-84e0-742caccd9605'::uuid, 'pg', '01c0c40d683cb380cecbd98b037d5fee445c3517441bcfbfeaf504442327f0c8', 'common-masters.IdFormat', '{"format":"BPA/OC/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"bpa.nc_oc_app_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '01c0c40d683cb380cecbd98b037d5fee445c3517441bcfbfeaf504442327f0c8'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #43
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd5905e2f-917b-487f-807a-f7db987f4da2'::uuid, 'pg', '31f2f2827804590633a35ce18c26a0dd7c9cc08bf3a5518764532f4bcc0f7b47', 'common-masters.IdFormat', '{"format":"PG-BP-[cy:yyyy-MM-dd]-[SEQ_EG_BP_APN]","idname":"bpa.low_risk_permit_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '31f2f2827804590633a35ce18c26a0dd7c9cc08bf3a5518764532f4bcc0f7b47'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #44
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0d2afe08-f8c7-4636-90b0-4adfccf83119'::uuid, 'pg', '490f1c37fac62b76329f5088f416c8fb9a6d5098d75af1b9b0e3573d0616c779', 'common-masters.IdFormat', '{"format":"SW.OTP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_SW_FEE_RCPT_[TENANT_ID]]","idname":"sw.one_time_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '490f1c37fac62b76329f5088f416c8fb9a6d5098d75af1b9b0e3573d0616c779'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #45
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ec0929f8-e911-4df4-9ce3-9ee9a139ac16'::uuid, 'pg', '961d367f9eb5f382773ef0ed330523ea3bd81fe3f57adcf75b60ea0b4075304b', 'common-masters.IdFormat', '{"format":"WS.OTP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_WS_FEE_RCPT_[TENANT_ID]]","idname":"ws.one_time_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '961d367f9eb5f382773ef0ed330523ea3bd81fe3f57adcf75b60ea0b4075304b'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #46
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2c3007c1-41b4-48fb-a594-4aa12a4b325b'::uuid, 'pg', '9922bca69505e4398ba04c73261f2c6805ec7ed2c3d6fd4665bdead6996e97d5', 'common-masters.IdFormat', '{"format":"SW_AP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_SW_APP_[TENANT_ID]]","idname":"sewerageservice.application.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '9922bca69505e4398ba04c73261f2c6805ec7ed2c3d6fd4665bdead6996e97d5'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #47
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '41bb02e1-d30c-4f30-aa4f-56111244a547'::uuid, 'pg', 'fb2600f74c12485b29a3e2347d78e3b75951f5bd11c27f0425889fdb97f2e76f', 'common-masters.IdFormat', '{"format":"WS_AP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_WS_APP_[TENANT_ID]]","idname":"waterservice.application.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'fb2600f74c12485b29a3e2347d78e3b75951f5bd11c27f0425889fdb97f2e76f'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #48
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1d3f45cd-baac-479c-911b-07c7406e9566'::uuid, 'pg', '9c21dcd054e033d002ebb1f09b12d72a0017a0e10555cae3b82b2ea0f0759c86', 'common-masters.IdFormat', '{"format":"SW/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_SW_BILL_RCPT_[TENANT_ID]]","idname":"sw.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '9c21dcd054e033d002ebb1f09b12d72a0017a0e10555cae3b82b2ea0f0759c86'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #49
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '530028cf-2b14-48e4-b9b3-b3bf2d777a9a'::uuid, 'pg', '9db8b2306373347fc63ed807817ed19c2f3b7ae9365747e185389ca72d423419', 'common-masters.IdFormat', '{"format":"WS/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_WS_BILL_RCPT_[TENANT_ID]]","idname":"ws.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '9db8b2306373347fc63ed807817ed19c2f3b7ae9365747e185389ca72d423419'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #50
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9ec26591-86d9-41c2-b010-2a9dbe8f23f6'::uuid, 'pg', '8e156056e39420642ca110b2c2898a674fe3cd64a8970645812254db48d8d18c', 'common-masters.IdFormat', '{"format":"SW/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_SW_CON_[TENANT_ID]]","idname":"sewerageservice.connection.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '8e156056e39420642ca110b2c2898a674fe3cd64a8970645812254db48d8d18c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #51
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f5c52e42-2d24-42aa-af78-38435e52d0e9'::uuid, 'pg', '402ac3bbd9f94de5c76f6d0e4eb89dd41764abd3b66130caa7ebbe79968c983f', 'common-masters.IdFormat', '{"format":"WS/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_WS_CON_[TENANT_ID]]","idname":"waterservice.connection.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '402ac3bbd9f94de5c76f6d0e4eb89dd41764abd3b66130caa7ebbe79968c983f'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #52
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c5f0e3d5-8799-4504-9f5b-61d75cb9803c'::uuid, 'pg', '2305af5e2362d9734897e4d94711ab9a36c780c1fa13dcdf86759fd18f6747f4', 'common-masters.IdFormat', '{"format":"PG-MT-[CITY]-[SEQ_EG_PT_MUTATION]","idname":"pt.mutation.number"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '2305af5e2362d9734897e4d94711ab9a36c780c1fa13dcdf86759fd18f6747f4'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #53
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a1e5eb06-a08a-4917-8507-59a4636529a4'::uuid, 'pg', '95242d9e9604ddb8324257e53a6bdc9c47316c9128417e7825e8caedc7d0195b', 'common-masters.IdFormat', '{"format":"PG-MU-[cy:yyyy-MM-dd]-[SEQ_EG_PT_ASSM]","idname":"pt.mutation.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '95242d9e9604ddb8324257e53a6bdc9c47316c9128417e7825e8caedc7d0195b'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #54
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5c50dbab-64ed-495a-98f0-6da2cc5a1bab'::uuid, 'pg', 'c045980618297bcb42ccb00594c0c69f06b97ff2d29cb82705affd8a657c4d53', 'common-masters.IdFormat', '{"format":"BPA/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"bpa.nc_san_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'c045980618297bcb42ccb00594c0c69f06b97ff2d29cb82705affd8a657c4d53'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #55
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0aca36d6-96d7-43a3-89f6-ea3e60614c12'::uuid, 'pg', '9b380ce793216129ab1b0636016f41b7cda82897db5b66d0d54140008c22ceea', 'common-masters.IdFormat', '{"format":"BPA/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"bpa.nc_app_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '9b380ce793216129ab1b0636016f41b7cda82897db5b66d0d54140008c22ceea'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #56
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b3662cdf-3917-4490-996f-ba37cb968dad'::uuid, 'pg', 'f9701e67e31560dd4704f0bd9fb38f57324340812d6d94ba285df49cea2c49ac', 'common-masters.IdFormat', '{"format":"BPAREG/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"bpareg.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'f9701e67e31560dd4704f0bd9fb38f57324340812d6d94ba285df49cea2c49ac'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #57
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8a5f2984-233d-417e-ad29-fedb62d5dd97'::uuid, 'pg', 'e59f9662e9b4b9cccfa5bd866ddc19a9664a6c36b1acb2a612d0fd6bab844c9b', 'common-masters.IdFormat', '{"format":"BR/BLD/[cy:yyyy]/[SEQ_EG_PT_LN]","idname":"egov.idgen.bpa.bdlicensenumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'e59f9662e9b4b9cccfa5bd866ddc19a9664a6c36b1acb2a612d0fd6bab844c9b'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #58
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '19258190-69c3-4567-bea8-2b0aed2b3860'::uuid, 'pg', 'fc96b12d38e6d0e43e6bfb6baf4ea2aa9ee92fa92455186f98cc17d1c759f066', 'common-masters.IdFormat', '{"format":"BR/ARCT/[cy:yyyy]/[SEQ_EG_PT_LN]","idname":"egov.idgen.bpa.arlicensenumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'fc96b12d38e6d0e43e6bfb6baf4ea2aa9ee92fa92455186f98cc17d1c759f066'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #59
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a4805e92-9585-41d6-a82a-871c3d6dcebf'::uuid, 'pg', 'ffdfcde58990cabe5de4a4a88444e4f6bf9b27c22ff83db6a3a728a588ddd25c', 'common-masters.IdFormat', '{"format":"BR/SUP/[cy:yyyy]/[SEQ_EG_PT_LN]","idname":"egov.idgen.bpa.suplicensenumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'ffdfcde58990cabe5de4a4a88444e4f6bf9b27c22ff83db6a3a728a588ddd25c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #60
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '74bad3d6-f0bc-46a8-8cd2-3b1bafb39878'::uuid, 'pg', '5994e2bb90a7f07e6def800b6a1394ac9d74e41c5402092b3531186969dbc5c0', 'common-masters.IdFormat', '{"format":"BR/TP/[cy:yyyy]/[SEQ_EG_PT_LN]","idname":"egov.idgen.bpa.tplicensenumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '5994e2bb90a7f07e6def800b6a1394ac9d74e41c5402092b3531186969dbc5c0'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #61
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f3c8dd35-72a9-4354-8ba4-b2e95424520c'::uuid, 'pg', '10139e0b429aab54e2dfdce22f013ff89dc56be760415e960b2c9c3d1a7b8239', 'common-masters.IdFormat', '{"format":"BR/STR/[cy:yyyy]/[SEQ_EG_PT_LN]","idname":"egov.idgen.bpa.strlicensenumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '10139e0b429aab54e2dfdce22f013ff89dc56be760415e960b2c9c3d1a7b8239'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #62
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a736c034-195f-4692-8208-dee0cfc83433'::uuid, 'pg', 'bc9c50b691d31868b140db56143cfbaab03cf8c91f78939a6943227ae52533bb', 'common-masters.IdFormat', '{"format":"BR/ENG/[cy:yyyy]/[SEQ_EG_PT_LN]","idname":"egov.idgen.bpa.englicensenumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'bc9c50b691d31868b140db56143cfbaab03cf8c91f78939a6943227ae52533bb'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #63
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '84806e83-9d34-4cc4-9952-c09d56800845'::uuid, 'pg', '5d2b60c41550ada5b81f59ef16fdda0b07bdaf42f36a21bfda4a0f6b57e47152', 'common-masters.IdFormat', '{"format":"PG-BP-[cy:yyyy-MM-dd]-[SEQ_EG_BP_APN]","idname":"egov.idgen.bpa.applicationNum"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '5d2b60c41550ada5b81f59ef16fdda0b07bdaf42f36a21bfda4a0f6b57e47152'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #64
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '05024202-a6fe-4201-9afa-f44df7ef0afa'::uuid, 'pg', 'bc8a5b89c9a0ba51971058b24c84bb0d52cf33e126381396213aa61b406f8823', 'common-masters.IdFormat', '{"format":"PG-PT-[cy:yyyy-MM-dd]-[SEQ_EG_PT_PTID]","idname":"pt.propertyid"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'bc8a5b89c9a0ba51971058b24c84bb0d52cf33e126381396213aa61b406f8823'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #65
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '86ae06f7-b0cc-48c8-b61d-ef0a8a7bf637'::uuid, 'pg', '67107a4ff6cda728196c62f7e23e9a0d224d95939cc7a0a1e85ae6fbc3d606b7', 'common-masters.IdFormat', '{"format":"PG-AS-[cy:yyyy-MM-dd]-[SEQ_EG_PT_ASSM]","idname":"pt.assessmentnumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '67107a4ff6cda728196c62f7e23e9a0d224d95939cc7a0a1e85ae6fbc3d606b7'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #66
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e34b73f6-6f05-44c3-bab6-9965acdb81e8'::uuid, 'pg', '4358a46a08206f100ee7f616f2745f61d243bca9dbe90bff2aa881ba220229ec', 'common-masters.IdFormat', '{"format":"PG-AC-[cy:yyyy-MM-dd]-[SEQ_EG_PT_ACK]","idname":"pt.acknowledgementnumber"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '4358a46a08206f100ee7f616f2745f61d243bca9dbe90bff2aa881ba220229ec'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #67
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2a1cf2e6-d165-4641-9d7e-040ca1b8c218'::uuid, 'pg', '98851afd4070e40fd73950b731063dc7111919c5b39502ecd2a8943cbdec23d1', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.rain_harvesting_charges.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '98851afd4070e40fd73950b731063dc7111919c5b39502ecd2a8943cbdec23d1'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #68
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5a42a503-e3cb-41f1-8b00-d6a132beb3ee'::uuid, 'pg', '5f380f9dca1af442c49761cf69103924fe9c175db68154b73c53f2744eef738a', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.bus_adda_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '5f380f9dca1af442c49761cf69103924fe9c175db68154b73c53f2744eef738a'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #69
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e05e0f14-25d1-476a-871a-448231021207'::uuid, 'pg', '06d9c5396b9ff3e53d565b5b4afa21f2aebe37d257e08ce2b52803215cb64d4d', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.fire_noc_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '06d9c5396b9ff3e53d565b5b4afa21f2aebe37d257e08ce2b52803215cb64d4d'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #70
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ec90a92f-0082-47ea-9451-406360793b86'::uuid, 'pg', '31fea66053548d07e60a49a027c2f44db920f14039077780c2f3cb74159399f8', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.fire_call_report_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '31fea66053548d07e60a49a027c2f44db920f14039077780c2f3cb74159399f8'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #71
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9c515b40-9910-4512-bb54-40b1e58ff471'::uuid, 'pg', '5707279f9b8d11cedaa034fe4808db27ca62ea9cc43588e1b33282355dcb863c', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.fire_tender_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '5707279f9b8d11cedaa034fe4808db27ca62ea9cc43588e1b33282355dcb863c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #72
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6fc8dcbc-f6a1-4dbd-b991-b23e5766c322'::uuid, 'pg', '3cc0e94e45ca485531172a4fa11e5db9469a83dd97392abf3eff0bcb098fe5b8', 'common-masters.IdFormat', '{"format":"[cy:MM]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON","idname":"rev_grants.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '3cc0e94e45ca485531172a4fa11e5db9469a83dd97392abf3eff0bcb098fe5b8'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #73
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ec5464bd-30c9-4e0b-ac51-ae4f4bb81070'::uuid, 'pg', 'fed5369c10dc5ed23adc4152f095244c4e12b6ca2846c94130e1918662691f8a', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.noc_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'fed5369c10dc5ed23adc4152f095244c4e12b6ca2846c94130e1918662691f8a'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #74
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7931386b-930a-4709-9e27-01989781963f'::uuid, 'pg', '79fa9c624c750ce284aa111be0a6468ccc6131e72b78f79094ffd3893229a26a', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tx.property_tax_2013-14.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '79fa9c624c750ce284aa111be0a6468ccc6131e72b78f79094ffd3893229a26a'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #75
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '95a33f6d-6830-4264-aaf0-d4fbf549627a'::uuid, 'pg', 'c23739e98862c66b594637c2767b085577f00b24a118a16b4d19c94fd9d4e1b7', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"advt.test_munadi_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'c23739e98862c66b594637c2767b085577f00b24a118a16b4d19c94fd9d4e1b7'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #76
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dcf8d7c0-c085-402b-b531-6d065e526900'::uuid, 'pg', '0f5ce9fbc28c1d98c4c006d3b7aed394dcf8ec22e22d4cec822e1ed86bb1fb56', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"advt.outdoor_media_display_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '0f5ce9fbc28c1d98c4c006d3b7aed394dcf8ec22e22d4cec822e1ed86bb1fb56'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #77
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5184b1c2-1958-448d-b4d3-03960214de58'::uuid, 'pg', '82cf4344340b07ce4d7f7d1d6466669904e2dc48b5078961b8b9d10baddb749b', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"advt.canopy_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '82cf4344340b07ce4d7f7d1d6466669904e2dc48b5078961b8b9d10baddb749b'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #78
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd1d19f48-545a-4db6-8c8e-9272d1c9629c'::uuid, 'pg', '890d42c8fade800970e13c2af5c43676caa66590ceaa11bf9360fecbda159ae6', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"admn.parking_booking_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '890d42c8fade800970e13c2af5c43676caa66590ceaa11bf9360fecbda159ae6'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #79
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '08c3da87-c678-4d8f-a1d2-581de7e2a6f9'::uuid, 'pg', '10e3cd67d1cb3b68a32e1364e6024503f6c70dfacfeafc795d56bcce1ae64dd2', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"om.road_cut_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '10e3cd67d1cb3b68a32e1364e6024503f6c70dfacfeafc795d56bcce1ae64dd2'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #80
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '33743b08-24bd-4173-9fd9-6cd86370dba9'::uuid, 'pg', 'eb543baf7971c2644ddb8a60718cceade883a646934ece05e10366f024388161', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.building_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'eb543baf7971c2644ddb8a60718cceade883a646934ece05e10366f024388161'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #81
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b1b2d71c-e315-4fe5-a458-e40dded1b590'::uuid, 'pg', '1fc02b429f5358d10fc0d0af813a80f5e8d3c62102f6b3af670834d51f19c190', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.boundary_wall_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '1fc02b429f5358d10fc0d0af813a80f5e8d3c62102f6b3af670834d51f19c190'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #82
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b259090c-7268-4136-ac6e-ef50cac7961b'::uuid, 'pg', '43ae9fdc15f5fafa99d7e9615f7e088d811b5e3508aea95abdb70466c0e52ec1', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.malba_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '43ae9fdc15f5fafa99d7e9615f7e088d811b5e3508aea95abdb70466c0e52ec1'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #83
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9179b29e-7984-4b24-af71-445265a9a6ec'::uuid, 'pg', '5667429ca2325fedfbb34f4bc097e947db237c18c85d189f86f75d5b09317b8b', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.development_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '5667429ca2325fedfbb34f4bc097e947db237c18c85d189f86f75d5b09317b8b'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #84
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cb8f12e0-65f6-4dbd-a992-5e4084abe65a'::uuid, 'pg', '65d4d845bea37f4b648ed1c6ec18ef06b8ba87b00f6281e96cebcd20b72c0936', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.change_of_land_use_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '65d4d845bea37f4b648ed1c6ec18ef06b8ba87b00f6281e96cebcd20b72c0936'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #85
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6af8a3f8-197c-4c64-b421-e95464283f8d'::uuid, 'pg', 'df6ab9f4f7a4da1f6d3ea5a1f0324c641c80403399dc2cb828a7893f6abcd252', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.under_development_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'df6ab9f4f7a4da1f6d3ea5a1f0324c641c80403399dc2cb828a7893f6abcd252'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #86
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7b3633fc-b31d-415f-a54a-8fcc929e1665'::uuid, 'pg', 'e1b7b972e7bf5712dba978ddd3ece1d58bfcf463d268de1524d545843e45c2bb', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.water_charges.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'e1b7b972e7bf5712dba978ddd3ece1d58bfcf463d268de1524d545843e45c2bb'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #87
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2234af41-3d0f-49e5-97d2-e57eb7bb1c37'::uuid, 'pg', '330d956f36263ff1acfd25dc31fb96cb6937051ac38a60e2c16037c3d972322a', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.others_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '330d956f36263ff1acfd25dc31fb96cb6937051ac38a60e2c16037c3d972322a'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #88
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ed549f8e-85e8-4abe-8bff-05eeb0aa2fc3'::uuid, 'pg', 'fb483ccce9b5326d2ef59ceeed9c5a0083d0da0757ef9020fa48a55e5d80bc35', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"css.labor_cess.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'fb483ccce9b5326d2ef59ceeed9c5a0083d0da0757ef9020fa48a55e5d80bc35'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #89
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1120a38f-0c9e-4934-a67d-027a3d0f02fc'::uuid, 'pg', '8a6fa3d9f82b674628841120b61ee9a588e976b45ee99605c796ceae470bcea4', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"fn.provident_fund_processing_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '8a6fa3d9f82b674628841120b61ee9a588e976b45ee99605c796ceae470bcea4'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #90
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '78efaf7a-7e06-4875-b37f-95ab48d0171b'::uuid, 'pg', 'dd3cddd6853276f9ac39635109653734ad029c25c35b123de6346d59f1689486', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"om.sewerage_disconnection_connection_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'dd3cddd6853276f9ac39635109653734ad029c25c35b123de6346d59f1689486'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #91
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a02fe75a-2f1f-48fb-81dc-e4378939dfb0'::uuid, 'pg', 'd5440a6cdfe8be68420601148f652bbad11bea2e81dc20bc67a01719a2681ea2', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.economics_weaker_section_projects_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'd5440a6cdfe8be68420601148f652bbad11bea2e81dc20bc67a01719a2681ea2'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #92
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3efc338b-a3e3-43c6-af2c-b6682739369f'::uuid, 'pg', '3196fe61d95bd3b9f7eafdf13557553c3aacf29fd3f5edc9ff8428164887bbf9', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.economics_weaker_section_scheme_charges.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '3196fe61d95bd3b9f7eafdf13557553c3aacf29fd3f5edc9ff8428164887bbf9'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #93
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f024cebd-c713-4440-b45f-aa5753930f30'::uuid, 'pg', '02ea139dd286836403d4daf787e8f3c0328406344c473c70f36b3661eb6f73fd', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"wf.ofc_permission_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '02ea139dd286836403d4daf787e8f3c0328406344c473c70f36b3661eb6f73fd'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #94
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6ed09ec9-052c-4005-ab72-ae4b81865a8d'::uuid, 'pg', '50686b4e59bf4278689029e4aea56050ecb064ce58773541c910209d3bafb40a', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.naksha_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '50686b4e59bf4278689029e4aea56050ecb064ce58773541c910209d3bafb40a'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #95
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9bc4b100-578b-4562-9472-c8de17354b8e'::uuid, 'pg', '0198084db59505022cecf50fb134967ef4c97702493d49c2c6f6d3d402bff429', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.colony_sambandhi_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '0198084db59505022cecf50fb134967ef4c97702493d49c2c6f6d3d402bff429'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #96
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '99effddf-7713-4b92-9703-f15490f73cc3'::uuid, 'pg', 'fdcdecdd2b3e8e3a14713e28a6da711ba2f60ed71da694d1950ea7e83e399aba', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.no_due_certificate_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'fdcdecdd2b3e8e3a14713e28a6da711ba2f60ed71da694d1950ea7e83e399aba'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #97
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3b5ebb57-e756-44a9-bde6-ef4cd40f2e59'::uuid, 'pg', '4a08a2d29fb07c9d88db15c8a9332b7d144accf012e5d139859ddbff868fe851', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.hadud_certificate_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '4a08a2d29fb07c9d88db15c8a9332b7d144accf012e5d139859ddbff868fe851'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #98
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1408c0e9-4514-4c07-a644-8edf13645d4f'::uuid, 'pg', '2085e222ed0d5a841f49b74986619db74ba2a1496aeab1c3d9be74199a76161f', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tx.house_tax.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '2085e222ed0d5a841f49b74986619db74ba2a1496aeab1c3d9be74199a76161f'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #99
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '41e4b527-137f-4f3d-9e07-f265a0296e6f'::uuid, 'pg', '622848ad2f2d6304a5b83e57466a372c743ce30cb2811d4f4608ba804681c55c', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"fn.recovery_employee_contractor.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '622848ad2f2d6304a5b83e57466a372c743ce30cb2811d4f4608ba804681c55c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #100
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '25d25df4-93db-4b94-97f1-8ceb0636f176'::uuid, 'pg', '2cc0031a3bdfe1a165826f6b4d4a6a5b265628bd300131875735a5d942eb4021', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.noc_completion_of_building_approval.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '2cc0031a3bdfe1a165826f6b4d4a6a5b265628bd300131875735a5d942eb4021'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #101
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '17c607af-03b5-4ee8-91fc-f9e6b6f463e9'::uuid, 'pg', '28a663b51b55816e742454427f439323ced034969f3b9afbcbd10f73788158aa', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"om.water_connection_disconnection_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '28a663b51b55816e742454427f439323ced034969f3b9afbcbd10f73788158aa'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #102
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4adf9d9a-df61-4506-9b49-fc01e243e12b'::uuid, 'pg', 'bce429a2c591b7321b17496d2719619a4758344e80cce748df397825bb4cb08e', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"advt.wall_paint_advertisement.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'bce429a2c591b7321b17496d2719619a4758344e80cce748df397825bb4cb08e'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #103
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7a15385b-ca44-4cab-89ab-cc4b87f74815'::uuid, 'pg', '3360deaaec552ec35ac619b357d016365ed6d57a9deb857e46f19ddb0fcca3bd', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"advt.light_wala_board.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '3360deaaec552ec35ac619b357d016365ed6d57a9deb857e46f19ddb0fcca3bd'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #104
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3499ee47-1796-4846-91c7-6bdab7c757c2'::uuid, 'pg', 'd086d899fe020fd25751b4397edad7b765c305674dcd83d62d0a3985b618e7ef', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"om.plumber_license_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'd086d899fe020fd25751b4397edad7b765c305674dcd83d62d0a3985b618e7ef'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #105
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '57f74af6-5af4-4761-b1a4-256a480a2804'::uuid, 'pg', '0ac9109575b754fc4aa5a0f00beef0a58b636f0b6b9ebd59b4107c73c4d3a87e', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"snt.clean_safai_sanitation.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '0ac9109575b754fc4aa5a0f00beef0a58b636f0b6b9ebd59b4107c73c4d3a87e'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #106
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a09b82c6-1fa3-4fa4-9c9b-5bfe75580757'::uuid, 'pg', 'c4733cce1ce08b662392d63d87e75de86583119641897543aa7e9b9ae6616113', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ftp.demolition_waste.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'c4733cce1ce08b662392d63d87e75de86583119641897543aa7e9b9ae6616113'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #107
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0309f2c6-f80e-4965-950d-ff8da6c0380b'::uuid, 'pg', '4369ac23ff142becb4c16f60ab174a4a22ecf2dd7014487ff1ea02ed8607f217', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ftp.construction_waste.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '4369ac23ff142becb4c16f60ab174a4a22ecf2dd7014487ff1ea02ed8607f217'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #108
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5f3b93aa-3613-4963-a05c-76b0b3383a82'::uuid, 'pg', '57925020e67b2d1c8bc6294914e56eb0992d6f46333f18c4db901c207b3c8603', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.street_vendor.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '57925020e67b2d1c8bc6294914e56eb0992d6f46333f18c4db901c207b3c8603'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #109
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cb7a4277-e6c4-4348-aeea-8b00e1ebc9c7'::uuid, 'pg', '7abc0d52a6e9e69651b496f619f81bd26b29ee7486b141d14927022bb0dbec8a', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.commercial_use_of_municipal_land.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '7abc0d52a6e9e69651b496f619f81bd26b29ee7486b141d14927022bb0dbec8a'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #110
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '510ff279-848e-4603-b74a-852685356ac1'::uuid, 'pg', 'aa908a2503e71933f233b9e34f096e451111947541e77ab909b7d03c49bee130', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.community_centre_booking_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'aa908a2503e71933f233b9e34f096e451111947541e77ab909b7d03c49bee130'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #111
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7a0e1bd6-65c3-4988-8b4c-83b0c3f832cb'::uuid, 'pg', '3873a4ca01e3dd8dc5a916a8aafde8048eaebf05252f9004e9007b2bb4830d12', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ch.bidi_&_cigrette_challan.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '3873a4ca01e3dd8dc5a916a8aafde8048eaebf05252f9004e9007b2bb4830d12'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #112
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '02eff04f-e653-4119-8a53-8a5ab629bc93'::uuid, 'pg', 'be80519f9a5b6dfbebc38943c0b6185489d4a3f9bb86d250f92c0cc09a240851', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ch.dairy_animals_challan.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'be80519f9a5b6dfbebc38943c0b6185489d4a3f9bb86d250f92c0cc09a240851'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #113
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd426e7f3-4428-4501-bd53-7abfc8714a4a'::uuid, 'pg', '33f167afb3924fa71dcefc849946943577fcd0b5b0aafbc9534ef3ee3d7530f9', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"lcf.manual_rikshaw.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '33f167afb3924fa71dcefc849946943577fcd0b5b0aafbc9534ef3ee3d7530f9'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #114
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0c5b89d5-2b11-4efd-ba81-3df30c8c52ed'::uuid, 'pg', 'a70eee3d3a198f6cf06d3f9c09b818d35b983ee8e2c7e239ead8aeb512fb2ea5', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tb.rehri_challan.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'a70eee3d3a198f6cf06d3f9c09b818d35b983ee8e2c7e239ead8aeb512fb2ea5'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #115
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5ccc1740-d044-498b-b185-71a5d6654f96'::uuid, 'pg', '92418ce386226596382e6503b194db40422f3aaa0e4f160253873a13850e3991', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ch.cattle_challan.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '92418ce386226596382e6503b194db40422f3aaa0e4f160253873a13850e3991'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #116
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '50ae5e41-0828-4f59-b47c-79cc34d7f58c'::uuid, 'pg', 'bad9d8c2964d9950751d6c479dedd6cf7e9f4152a548f37ae7d61ac52b5a4d78', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"css.cow_cess.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'bad9d8c2964d9950751d6c479dedd6cf7e9f4152a548f37ae7d61ac52b5a4d78'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #117
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a77f8df4-5780-4977-9f58-842b84d5d787'::uuid, 'pg', '8cbee7a1b4c45cf5edb303413dbf2391b69ca805ab744936b97e65ca06ea5e9b', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.tower_annual_rent.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '8cbee7a1b4c45cf5edb303413dbf2391b69ca805ab744936b97e65ca06ea5e9b'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #118
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '73a78e64-4bd0-49b9-bf09-8eb6c25852a9'::uuid, 'pg', '1a75d511c0656c2e2d0b5b712ecfc8297e1153f112e1574a5636c287d4c60813', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.tower_installation.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '1a75d511c0656c2e2d0b5b712ecfc8297e1153f112e1574a5636c287d4c60813'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #119
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '77c820cd-cd18-4136-93c8-5da5909b1df5'::uuid, 'pg', '7d8e7dcb4d07bca18329849a39abdfda96bc28607cd4a19662e77d855dbe9303', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"fn.cpf_received_check.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '7d8e7dcb4d07bca18329849a39abdfda96bc28607cd4a19662e77d855dbe9303'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #120
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '19f881a7-b490-44bd-b741-6bf4f04b2204'::uuid, 'pg', '1ac1eb17139e3324d8b0979f332ad58aaf6838ca23465158e194a6523f0f12b0', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"fn.gpf.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '1ac1eb17139e3324d8b0979f332ad58aaf6838ca23465158e194a6523f0f12b0'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #121
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '53c2c7ea-cdc6-4aa2-a7e1-8fb39b0fc4eb'::uuid, 'pg', '45d5f5e0b948a4d6a513493730f9cce45164beabf55ec7cce0459b5e30c85a92', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"snt.dead_animals_contract.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '45d5f5e0b948a4d6a513493730f9cce45164beabf55ec7cce0459b5e30c85a92'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #122
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0a586b90-93e1-4645-b3e7-1db85d9439d0'::uuid, 'pg', 'b92854eb5ed5f3668efdbc71549f65381a353146fd0abbd62400560315b5b12d', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ch.sbm_garbage_plastic_polythene_challan.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'b92854eb5ed5f3668efdbc71549f65381a353146fd0abbd62400560315b5b12d'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #123
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '627917cc-c5d4-4516-b4ae-191d39133224'::uuid, 'pg', '058868945498672d375cfe95c92fa54c7a9d5ca8bc3ab308f33a61ed1ccd4a4a', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.registery_and_bank_loan.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '058868945498672d375cfe95c92fa54c7a9d5ca8bc3ab308f33a61ed1ccd4a4a'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #124
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'df4e0a0b-82a4-443b-a83e-b576d5bac6b8'::uuid, 'pg', '6e2ea9fdec56dcbbafbe32dd19af2764cc67085f0f0eba2dc1bb9b7a94cf8853', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.no_due_certificate_electriCITY.CODE.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '6e2ea9fdec56dcbbafbe32dd19af2764cc67085f0f0eba2dc1bb9b7a94cf8853'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #125
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '77959f56-bcc1-475a-9f3d-175c9001af2a'::uuid, 'pg', 'bf1a037699fe82295c8d89c3dce2dbfc64bf12b7ab5aa9e924dc215de933d532', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"fn.grants_cheque.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'bf1a037699fe82295c8d89c3dce2dbfc64bf12b7ab5aa9e924dc215de933d532'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #126
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '859451da-4cc8-4871-909d-3675d082ebff'::uuid, 'pg', 'ba632a4fb62cf21e18f1cc4b383bdbf9879dcfb3b96266fea9835b0d1e1a93e4', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tb.challan_under_section_156.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'ba632a4fb62cf21e18f1cc4b383bdbf9879dcfb3b96266fea9835b0d1e1a93e4'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #127
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0da8e223-3f4d-4ea2-b6ee-4307f43e52d7'::uuid, 'pg', 'd82c21a126b3ebbc44b59199ea409b70d38d6328ba82ab2c5c031ee87d575446', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ftp.architect_license_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'd82c21a126b3ebbc44b59199ea409b70d38d6328ba82ab2c5c031ee87d575446'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #128
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b135379f-0c88-499f-97ca-2113915c637a'::uuid, 'pg', 'd8789baefba2d58a5094728fe8946def79852c484662e9faddf13a54c7e47e00', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"admn.no_dues_certificate.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'd8789baefba2d58a5094728fe8946def79852c484662e9faddf13a54c7e47e00'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #129
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '369a18cb-b138-4b81-a68c-551dcf2cc554'::uuid, 'pg', 'e00ef63ab8cedd676abf2200e81452968a8a318910277ca6bafdda351b572d51', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"admn.rti.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'e00ef63ab8cedd676abf2200e81452968a8a318910277ca6bafdda351b572d51'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #130
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '21597663-3df7-4a0a-b902-df1e87553b91'::uuid, 'pg', 'ef0ac4d20a5b2b5cbfef97ce47b29559f1050deb2c7336d041bf989a648f2e73', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tx.transfer_property_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'ef0ac4d20a5b2b5cbfef97ce47b29559f1050deb2c7336d041bf989a648f2e73'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #131
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '373669b2-8513-4739-9d42-6b521ec2e5fa'::uuid, 'pg', 'a30a622017ea0087a1297f1fab744e8d0e6b83bbb6a64d6d0b5e8b34bd68838b', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tx.ts1_copy_register_for_old_survey.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'a30a622017ea0087a1297f1fab744e8d0e6b83bbb6a64d6d0b5e8b34bd68838b'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #132
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dc76d2f3-a1bf-40f9-a7cc-8a28bc139f80'::uuid, 'pg', 'a3377668f615eb333dd997764a2f8e0d4c89e840ee6a3a4e905677758d553b51', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"fn.pf_transfer_(accounts).receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'a3377668f615eb333dd997764a2f8e0d4c89e840ee6a3a4e905677758d553b51'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #133
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '103a478d-1149-4636-93a6-f73447b44711'::uuid, 'pg', '9b5aa500f133b804075229f737850ae28220102c1a561d85303ade799b3f8be6', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tb.tehbazaari.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '9b5aa500f133b804075229f737850ae28220102c1a561d85303ade799b3f8be6'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #134
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '88b6f23a-219d-4017-baba-0dc0a8d3d386'::uuid, 'pg', '1921346fc4fcd5455c9001218f4395e7f94fa11245ab7d6306202bcb7fe0eea1', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tb.advertisement_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '1921346fc4fcd5455c9001218f4395e7f94fa11245ab7d6306202bcb7fe0eea1'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #135
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd3e446a5-eb63-46f1-8510-e3d4f651e786'::uuid, 'pg', '546c062f893164256df202d41840c7089a6c664361d33affb48e01cccd992fdc', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"wf.tenderformfee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '546c062f893164256df202d41840c7089a6c664361d33affb48e01cccd992fdc'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #136
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c213ef1f-4bae-4775-bc99-0d4cd8e0360a'::uuid, 'pg', '87418da26196bbd4e9efa6e253886fe7170b7240fb9a70c25a129a8da47c5e66', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"wf.contractor_enlistment.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '87418da26196bbd4e9efa6e253886fe7170b7240fb9a70c25a129a8da47c5e66'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #137
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '115e6f90-423c-4a17-a1dd-0ca479cb4f5c'::uuid, 'pg', '1fcb20193720af8e2847ec2dbccec766233dc861dbf6cd047b3f30d0d011a870', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.regularisation_of_buildings.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '1fcb20193720af8e2847ec2dbccec766233dc861dbf6cd047b3f30d0d011a870'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #138
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a0a6e529-3d4b-476c-a50c-7267acb8b4ce'::uuid, 'pg', 'eca62b5216bd8da9fa6ecd828580043b59003c596e1de699afbda8e1e4d59ad3', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"other.misc_challans.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'eca62b5216bd8da9fa6ecd828580043b59003c596e1de699afbda8e1e4d59ad3'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #139
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7af3d506-138a-43fa-950e-fd3efc74618f'::uuid, 'pg', '8baf9b4f1652d8bc8bcdc0a52a01c9a0957b13ea8a3adf249a28a4a4cc17a3fb', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"snt.licence_pure_food.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '8baf9b4f1652d8bc8bcdc0a52a01c9a0957b13ea8a3adf249a28a4a4cc17a3fb'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #140
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9ef4f7ca-8c49-40b2-aa57-cd1de26865b5'::uuid, 'pg', '6d95772378f84d8159e1ef35a4cbd87e84d047d973c60cf9450bb989310b96a3', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ch.littering_challan.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '6d95772378f84d8159e1ef35a4cbd87e84d047d973c60cf9450bb989310b96a3'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #141
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f57fdb35-bf93-494d-9d2b-7d679e388b5e'::uuid, 'pg', '9bd15147e7c42cc742e909254dc4c17c3a386d30d917a6c8ddcc0a1bc3ba0730', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ch.dengue_challan.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '9bd15147e7c42cc742e909254dc4c17c3a386d30d917a6c8ddcc0a1bc3ba0730'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #142
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6f60e512-f387-4c32-bc60-6247a93f7a1c'::uuid, 'pg', 'edc770b3d198a2a9558b074e5e2715156d55fa06509dac674b0be1c7d00922a0', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ch.challan_for_misuse_of_water.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'edc770b3d198a2a9558b074e5e2715156d55fa06509dac674b0be1c7d00922a0'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #143
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '784a768b-bfd6-4391-9239-db8429918e8b'::uuid, 'pg', 'a9737226d0fecc780efe98cc180ea03acddd58c1e71f5fa05e933d56b6b49aa6', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ch.rehri_challan.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'a9737226d0fecc780efe98cc180ea03acddd58c1e71f5fa05e933d56b6b49aa6'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #144
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8b1984e3-ad4a-4552-a866-31e2b2ea050b'::uuid, 'pg', 'fc57df37000f86480ce6a1b1abd7d51ad797fab52addfb4a9f8485d9c33b9618', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ch.plastic_challan.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'fc57df37000f86480ce6a1b1abd7d51ad797fab52addfb4a9f8485d9c33b9618'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #145
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0ab470e6-2ac5-4590-a4bd-16fe4eae1dd4'::uuid, 'pg', 'dc5005262598abd8161765bb276bac76c8c6a6c95eb3745522072da5b55ef012', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ftp.leave_encashment_and_gratuty.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'dc5005262598abd8161765bb276bac76c8c6a6c95eb3745522072da5b55ef012'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #146
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '53708d46-e33e-4840-950c-e41f9ac26d4d'::uuid, 'pg', 'ccb6185e1fff31d2087df9e5bd5cfd605b8a13cb47a5d24040a3eb3c45dfb82f', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.2_year_time_limit_of_renewal_building_naksha.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'ccb6185e1fff31d2087df9e5bd5cfd605b8a13cb47a5d24040a3eb3c45dfb82f'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #147
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2fd11c8b-69d2-4883-8bbd-b51f9ba01ada'::uuid, 'pg', '7c254d2ea68c248fbcee69c20daadc4c2d6d6a44be9446ef2ad06c6ffbc37446', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.alteration_additional_charge.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '7c254d2ea68c248fbcee69c20daadc4c2d6d6a44be9446ef2ad06c6ffbc37446'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #148
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2d334236-e082-4aa4-a374-09af16bf505f'::uuid, 'pg', 'ea215030b4b75e8edeb2ccc92c2fd768d9967acbdc2c5e2adce5a40b3f49a2b2', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.naksha_renew_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'ea215030b4b75e8edeb2ccc92c2fd768d9967acbdc2c5e2adce5a40b3f49a2b2'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #149
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7bd32727-5a25-4cd5-bd79-ff0d4ab4fdb5'::uuid, 'pg', '8e6f31f2ba7290d58295daa686d4a996cb19d892b527b9246a128245e5c81f15', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ftp.license_fees_building_branch.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '8e6f31f2ba7290d58295daa686d4a996cb19d892b527b9246a128245e5c81f15'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #150
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '78e1fd09-d85c-410d-b6d0-5cb0dc0f9116'::uuid, 'pg', 'f80636c8b9c2cb70da0c58ad21d67b0be6d77db73f08298e13f7893e8c550f0c', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.naksha_changes.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'f80636c8b9c2cb70da0c58ad21d67b0be6d77db73f08298e13f7893e8c550f0c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #151
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7baa50e2-bdfe-4d7f-8d2d-1924bebe4ffc'::uuid, 'pg', '622ce08fab5c9ce968cd9a0527f58df655685505c6f7baae017feb89071bbbc4', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"nks.naksha_samjota_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '622ce08fab5c9ce968cd9a0527f58df655685505c6f7baae017feb89071bbbc4'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #152
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'df6e3ab4-a7d1-4e9c-9fa5-91a400ced978'::uuid, 'pg', 'a055ba78c5fe50f5305b787e135095fa3894f7c1fe3b230c8c93dd64c0962e72', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ftp.building_planner_renew.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'a055ba78c5fe50f5305b787e135095fa3894f7c1fe3b230c8c93dd64c0962e72'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #153
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'db52bc33-a73a-4882-ad4a-89e84043e147'::uuid, 'pg', '6aae5370367fa17636f4927334fe7c06da89283eb7b57ebad9e3cdc66974e023', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ftp.compremasing_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '6aae5370367fa17636f4927334fe7c06da89283eb7b57ebad9e3cdc66974e023'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #154
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd1c9c5fd-1767-4b40-b850-0e7ee37c58af'::uuid, 'pg', '2dad0966dba4f8fd96c99dfadfea0e77e9fb074a9254c0accfa2314fb770fd30', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ftp.draftsmen_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '2dad0966dba4f8fd96c99dfadfea0e77e9fb074a9254c0accfa2314fb770fd30'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #155
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c13e5ff8-8ee2-4e52-91de-5d33862ef3af'::uuid, 'pg', 'c9623f058e787e1597d89aa572b508bec3bfde766d31ef62b7a8b8f27f1bea3c', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tx.electricity.code_chungi.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'c9623f058e787e1597d89aa572b508bec3bfde766d31ef62b7a8b8f27f1bea3c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #156
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4cf44421-c207-4b2f-9e0c-1cb84771338d'::uuid, 'pg', '5cb63e3d56c3a3d5ec61ac9eec2b915f5d5881687f386a87ca1b762d91306d5b', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ftp.telecom_tower_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '5cb63e3d56c3a3d5ec61ac9eec2b915f5d5881687f386a87ca1b762d91306d5b'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #157
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '18f6918a-e37f-4eeb-975b-7c606690d164'::uuid, 'pg', 'aeb22f937bc52cd70f41381b30f9b6ca116e30ce046db2f2d3aab86fc4dd4854', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"ch.santitation_dumping_garbage.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'aeb22f937bc52cd70f41381b30f9b6ca116e30ce046db2f2d3aab86fc4dd4854'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #158
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1ce47c4f-18af-417c-a126-17bbc25ecae0'::uuid, 'pg', '674e42f98c9558fbbeb7e566da1c147b60e8c876177017609e1b858b5fc58bcb', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"st.expenditure_santitation_not_income.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '674e42f98c9558fbbeb7e566da1c147b60e8c876177017609e1b858b5fc58bcb'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #159
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8857b034-f1d3-4788-9a79-e4b8b2148405'::uuid, 'pg', 'b4b4bcfa068d625487d1879b3ff299d2b08984b4e8e2759985d3e62702a4b8d6', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"st.stationary_not_income.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'b4b4bcfa068d625487d1879b3ff299d2b08984b4e8e2759985d3e62702a4b8d6'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #160
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '85deb3f3-0801-4877-a32b-2f4c9bb4f18b'::uuid, 'pg', 'c628709f33c033322c23d6124da734559602aa9676d096a3269881f085944410', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"fn.advance_provident_fund.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'c628709f33c033322c23d6124da734559602aa9676d096a3269881f085944410'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #161
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a3230a92-37ac-4034-bbe8-ede665b5177a'::uuid, 'pg', 'da5253f60647daa591dea5edfe80a9c738453ef3fb168c1402b9848630064eff', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"admn.road_show.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'da5253f60647daa591dea5edfe80a9c738453ef3fb168c1402b9848630064eff'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #162
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b3c58c21-9a28-4f70-8353-cd2eae6c4935'::uuid, 'pg', '64efccbd8b59da04cde218c1d3ffb1cdd881058f3aa07495fd486bd2ce04f271', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"admn.parking_during_election.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '64efccbd8b59da04cde218c1d3ffb1cdd881058f3aa07495fd486bd2ce04f271'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #163
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4e95b6e4-9bcd-418b-9c32-6f46a636d866'::uuid, 'pg', '704a553fd304d1712d111f4045eb3f8bd2c71ee30c4e72131db60c24a3704f7e', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"admn.election_rally_fees.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '704a553fd304d1712d111f4045eb3f8bd2c71ee30c4e72131db60c24a3704f7e'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #164
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '21e966ff-c16d-4f03-af4d-6d671196bba7'::uuid, 'pg', 'c06cb116eb013c16f4ad17e418acd39db807163260af0c8d0ac40f4d6f8c712f', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.jamin_theka.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'c06cb116eb013c16f4ad17e418acd39db807163260af0c8d0ac40f4d6f8c712f'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #165
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '870b3d1f-1ad5-4611-bc50-9e1ce1db84fb'::uuid, 'pg', '55d578c433e2bd6718083fb0bd97c8444c6d6b34754c24e48fdcf8b77a612db1', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.parking_fee.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '55d578c433e2bd6718083fb0bd97c8444c6d6b34754c24e48fdcf8b77a612db1'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #166
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9caec134-47f3-468a-9391-94d9a59a464c'::uuid, 'pg', 'd2a87393cfe929bad9b90e7c7428689b63a68669a5ecb73e1f65896d0a61a915', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.tower_rent.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'd2a87393cfe929bad9b90e7c7428689b63a68669a5ecb73e1f65896d0a61a915'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #167
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fdd95277-2620-41e9-bf65-5070f60116e8'::uuid, 'pg', '688b616248ad530f16a8e8af984c44c6dfbaefe521746e036858d38291d9e454', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.land_rent.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '688b616248ad530f16a8e8af984c44c6dfbaefe521746e036858d38291d9e454'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #168
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '534c0753-1f74-4a8d-ab23-703134bb3246'::uuid, 'pg', 'ff4c65b8acef8c45a76da28f3db43a76176ca638765a7250d015556134c27b5d', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"rt.municipal_shops_rent.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'ff4c65b8acef8c45a76da28f3db43a76176ca638765a7250d015556134c27b5d'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #169
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e0e309c7-d98b-4e35-9f55-e145cc0df90d'::uuid, 'pg', '8cdf92aba2685143f3479719e081a673a6fd700deef9e4575ec1ab6009b5f80b', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"advt.unipolls.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '8cdf92aba2685143f3479719e081a673a6fd700deef9e4575ec1ab6009b5f80b'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #170
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '26fcf099-2d54-47ae-a6dc-c76ce09b15d7'::uuid, 'pg', 'e0508f2cfee4097a6da55bc4379a4b665b296c251bb57c2f0eabd48a36b302ad', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"advt.hoardings.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'e0508f2cfee4097a6da55bc4379a4b665b296c251bb57c2f0eabd48a36b302ad'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #171
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c781ea56-a10c-4663-885e-fdd2dd9394a0'::uuid, 'pg', '6ed570bfa900a4b9ccc71782f3d0ab356620222f4529cbeb93efd48c59d529ee', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tx.electricity_chungi.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '6ed570bfa900a4b9ccc71782f3d0ab356620222f4529cbeb93efd48c59d529ee'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #172
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '89783973-c7f0-4c43-9e16-bada9e6af28c'::uuid, 'pg', '7c4fdc9bf96ef1f14592ddb3e5b4e7ffcf6bc03e4e8ee38f53a8a1182d887712', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tx.no_dues_certificate.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '7c4fdc9bf96ef1f14592ddb3e5b4e7ffcf6bc03e4e8ee38f53a8a1182d887712'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #173
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6a246725-2a30-41fb-8568-2d2cd395098f'::uuid, 'pg', '3655c73a92f813feee65b9fb9e9e88c3a38a2fc68ebcc691c8f309890eeb974f', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"firenoc.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '3655c73a92f813feee65b9fb9e9e88c3a38a2fc68ebcc691c8f309890eeb974f'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #174
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '841f55e8-3d95-48e3-bdf2-069ed836e8b1'::uuid, 'pg', 'd0746903df0397820f0830019f8b0f3483e810e7199f9534db86e842b9b1653c', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"watercharges.nonmetered.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'd0746903df0397820f0830019f8b0f3483e810e7199f9534db86e842b9b1653c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #175
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2fd5b545-55ea-4858-883b-bf9c3ad5e66b'::uuid, 'pg', '1df55509c7f3eb6bd174059a7b42777e2ddc47b2672dd72461f67a57428c5596', 'common-masters.IdFormat', '{"format":"TL/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"tl.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '1df55509c7f3eb6bd174059a7b42777e2ddc47b2672dd72461f67a57428c5596'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #176
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b2c51be0-2f87-40e9-8cad-a7702bde70be'::uuid, 'pg', 'fc528cea62ecfe835605d41ed7adde43545ee193b4fe2aba88e3007340e5ce6b', 'common-masters.IdFormat', '{"format":"PT/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"pt.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'fc528cea62ecfe835605d41ed7adde43545ee193b4fe2aba88e3007340e5ce6b'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #177
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '20c24e6c-42e6-426b-b0a6-cd3bb0d15ed2'::uuid, 'pg', 'fc0de4b31a6d0bd855c7b082ebef7368c2b4b66bd205967981c518015f10cb2c', 'common-masters.IdFormat', '{"format":"BILL-[SEQ_EGOV_COMMON_TEST_AUTOCRE]","idname":"billnumberid"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = 'fc0de4b31a6d0bd855c7b082ebef7368c2b4b66bd205967981c518015f10cb2c'
);

-- data/common-masters/common-masters.IdFormat.json :: common-masters.IdFormat entry #178
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '38f44914-8507-4509-8707-69d3bd89b7d5'::uuid, 'pg', '1ae60d60013e6b133f1bff8d20b1f80c7e622d3333c77136a5471fadc65593fc', 'common-masters.IdFormat', '{"format":"MP/[CITY.CODE]/[fy:yyyy-yy]/[SEQ_EGOV_COMMON]","idname":"watercharges.metered.receipt.id"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.IdFormat' AND uniqueidentifier = '1ae60d60013e6b133f1bff8d20b1f80c7e622d3333c77136a5471fadc65593fc'
);

-- data/common-masters/common-masters.StateInfo.json :: common-masters.StateInfo entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '467ecb87-9be4-4044-89a6-16d45f6adcc3'::uuid, 'pg', '2fd45638617790334c8733991fb1d798a2f1f2b683239a8c67ad2ac6c8fdb74b', 'common-masters.StateInfo', '{"bannerUrl":"https://s3.ap-south-1.amazonaws.com/pb-egov-assets/pb.testing/Punjab-bg-QA.jpg","code":"pg","defaultUrl":{"citizen":"/user/register","employee":"/user/login"},"hasLocalisation":true,"languages":[{"label":"ENGLISH","value":"en_IN"},{"label":"ಕನ್ನಡ","value":"ka_IN"}],"localizationModules":[{"label":"rainmaker-abg","value":"rainmaker-abg"},{"label":"rainmaker-common","value":"rainmaker-common"},{"label":"rainmaker-noc","value":"rainmaker-noc"},{"label":"rainmaker-pt","value":"rainmaker-pt"},{"label":"rainmaker-uc","value":"rainmaker-uc"},{"label":"rainmaker-pgr","value":"rainmaker-pgr"},{"label":"rainmaker-tl","value":"rainmaker-tl"},{"label":"rainmaker-hr","value":"rainmaker-hr"},{"label":"rainmaker-test","value":"rainmaker-test"},{"label":"finance-erp","value":"finance-erp"},{"label":"rainmaker-receipt","value":"rainmaker-receipt"},{"label":"rainmaker-dss","value":"rainmaker-dss"},{"label":"rainmaker-fsm","value":"rainmaker-fsm"},{"label":"rainmaker-workbench","value":"rainmaker-workbench"},{"label":"rainmaker-schema","value":"rainmaker-schema"},{"label":"rainmaker-mdms","value":"rainmaker-mdms"},{"label":"rainmaker-im","value":"rainmaker-im"}],"logoUrl":"https://s3.ap-south-1.amazonaws.com/works-dev-asset/mseva-white-logo.png","logoUrlWhite":"https://egov-dev-assets.s3.ap-south-1.amazonaws.com/digit.png","name":"Demo","qrCodeURL":"https://lh3.googleusercontent.com/-311gz2-xcHw/X6KRNSQTkWI/AAAAAAAAAKU/JmHSj-6rKPMVFbo6oL5x4JhYTTg8-UHmwCK8BGAsYHg/s0/2020-11-04.png","statelogo":"https://s3.ap-south-1.amazonaws.com/pg-egov-assets/pg.citya/logo.png"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.StateInfo' AND uniqueidentifier = '2fd45638617790334c8733991fb1d798a2f1f2b683239a8c67ad2ac6c8fdb74b'
);

-- data/common-masters/common-masters.uiHomePage.json :: common-masters.uiHomePage entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dcb3f5bc-167f-468d-aecd-ad9f66a4c1af'::uuid, 'pg', 'a31482c78e570b4458d2a380c2f1854461d4ef7e100f88e43349debfb946d4eb', 'common-masters.uiHomePage', '{"appBannerDesktop":{"bannerUrl":"https://s3.ap-south-1.amazonaws.com/egov-qa-assets/app-banner-web.jpg","code":"APP_BANNER_DESKTOP","enabled":true,"name":"App Banner Desktop View"},"appBannerMobile":{"bannerUrl":"https://s3.ap-south-1.amazonaws.com/egov-qa-assets/app-banner-mobile.jpg","code":"APP_BANNER_MOBILE","enabled":true,"name":"App Banner Mobile View"},"citizenServicesCard":{"code":"HOME_CITIZEN_SERVICES_CARD","enabled":true,"headerLabel":"DASHBOARD_CITIZEN_SERVICES_LABEL","name":"Home Citizen services Card","props":[{"code":"ACTION_TEST_MCOLLECT","enabled":true,"label":"ACTION_TEST_MCOLLECT","name":"Miscellaneous Collection","navigationUrl":"/digit-ui/citizen/mcollect-home"},{"code":"CITIZEN_SERVICE_PT","enabled":true,"label":"MODULE_PT","name":"Property Tax","navigationUrl":"/digit-ui/citizen/pt-home"},{"code":"CITIZEN_SERVICE_TL","enabled":true,"label":"MODULE_TL","name":"Trade Licence","navigationUrl":"/digit-ui/citizen/tl-home"},{"code":"ACTION_TEST_BPA_STAKEHOLDER_HOME","enabled":true,"label":"ACTION_TEST_BPA_STAKEHOLDER_HOME","name":"Online Building Permit System","navigationUrl":"/digit-ui/citizen/obps-home"},{"code":"ACTION_TEST_WATER_AND_SEWERAGE","enabled":true,"label":"ACTION_TEST_WATER_AND_SEWERAGE","name":"Water & Sewerage","navigationUrl":"/digit-ui/citizen/ws-home"},{"code":"ACTION_TEST_FIRE_NOC","enabled":true,"label":"ACTION_TEST_FIRE_NOC","name":"Fire No Objection Certificate","navigationUrl":"/citizen/fire-noc/home"},{"code":"ACTION_TEST_BIRTH_CERTIFICATE","enabled":true,"label":"ACTION_TEST_BIRTH_CERTIFICATE","name":"Birth Certificate","navigationUrl":"/digit-ui/citizen/birth-citizen/home"},{"code":"ACTION_TEST_DEATH_CERTIFICATE","enabled":true,"label":"ACTION_TEST_DEATH_CERTIFICATE","name":"Death Certificate","navigationUrl":"/digit-ui/citizen/death-citizen/home"}],"sideOption":{"enabled":true,"name":"DASHBOARD_VIEW_ALL_LABEL","navigationUrl":"/digit-ui/citizen/all-services"}},"informationAndUpdatesCard":{"code":"HOME_CITIZEN_INFO_UPDATE_CARD","enabled":true,"headerLabel":"CS_COMMON_DASHBOARD_INFO_UPDATES","name":"Home Citizen Information and Updates card","props":[{"code":"CITIZEN_MY_CITY","enabled":true,"label":"CS_HEADER_MYCITY","name":"My City","navigationUrl":""},{"code":"CITIZEN_EVENTS","enabled":true,"label":"EVENTS_EVENTS_HEADER","name":"Events","navigationUrl":"/digit-ui/citizen/engagement/events"},{"code":"CITIZEN_DOCUMENTS","enabled":true,"label":"CS_COMMON_DOCUMENTS","name":"Documents","navigationUrl":"/digit-ui/citizen/engagement/docs"},{"code":"CITIZEN_SURVEYS","enabled":true,"label":"CS_COMMON_SURVEYS","name":"Surveys","navigationUrl":"/digit-ui/citizen/engagement/surveys/list"}],"sideOption":{"enabled":true,"name":"DASHBOARD_VIEW_ALL_LABEL","navigationUrl":""}},"redirectURL":"all-services","whatsAppBannerDesktop-disabled":{"bannerUrl":"https://s3.ap-south-1.amazonaws.com/egov-qa-assets/whatsapp-web.jpg","code":"WHATSAPP_BANNER_DESKTOP","enabled":true,"name":"WhatsApp Banner Desktop View","navigationUrl":"https://api.whatsapp.com/send?phone=918744060444&text=mSeva"},"whatsAppBannerMobile-disabled":{"bannerUrl":"https://s3.ap-south-1.amazonaws.com/egov-qa-assets/whatsapp-mobile.jpg","code":"WHATSAPP_BANNER_MOBILE","enabled":true,"name":"WhatsApp Banner Mobile View","navigationUrl":"https://api.whatsapp.com/send?phone=918744060444&text=mSeva"},"whatsNewSection-disabled":{"code":"WHATSNEW","enabled":true,"headerLabel":"DASHBOARD_WHATS_NEW_LABEL","name":"What''s New","sideOption":{"enabled":true,"name":"DASHBOARD_VIEW_ALL_LABEL","navigationUrl":"/digit-ui/citizen/engagement/whats-new"}}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.uiHomePage' AND uniqueidentifier = 'a31482c78e570b4458d2a380c2f1854461d4ef7e100f88e43349debfb946d4eb'
);

-- data/common-masters/common-masters.wfSlaConfig.json :: common-masters.wfSlaConfig entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b6928999-d759-467c-ac31-5ae772e78de6'::uuid, 'pg', '1a2bb136332122036861aec3d0c05826795bc6a12c46d44fe53d61e2b8e5a0bd', 'common-masters.wfSlaConfig', '{"middleSlabColor":"#EEA73A","negativeSlabColor":"#F44336","positiveSlabColor":"#4CAF50","slotPercentage":33}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'common-masters.wfSlaConfig' AND uniqueidentifier = '1a2bb136332122036861aec3d0c05826795bc6a12c46d44fe53d61e2b8e5a0bd'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8d9ceb48-cd82-433a-9050-5bad05d0533b'::uuid, 'pg', '4b1465267d8ab974aa43a1a7ce811cb7779c2fd728e8dd810fc0d13c9eceae55', 'DataSecurity.DecryptionABAC', '{"key":"WnsDefaulterReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '4b1465267d8ab974aa43a1a7ce811cb7779c2fd728e8dd810fc0d13c9eceae55'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dda3b327-0b15-400e-b51e-49b39f087e10'::uuid, 'pg', 'bc9f83d413ebc54510204c0bf45eef646c27f813c89e85d86479fb9ec8d2aaf3', 'DataSecurity.DecryptionABAC', '{"key":"BndDetail","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileno","maskingTechnique":"mobile"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailid"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/aadharno"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/icdcode"}}],"roleCode":"CITIZEN"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileno","maskingTechnique":"mobile"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailid"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/aadharno"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/icdcode"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = 'bc9f83d413ebc54510204c0bf45eef646c27f813c89e85d86479fb9ec8d2aaf3'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ca3f59f4-8273-416b-93ba-ba154d5ab40d'::uuid, 'pg', '8082f212928fa48515a34917dd28ea3138aa329c620965b5af09e8b7e0347699', 'DataSecurity.DecryptionABAC', '{"key":"WnsCollectionRegisterReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '8082f212928fa48515a34917dd28ea3138aa329c620965b5af09e8b7e0347699'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '89cc9c36-04b3-4162-806d-6c531140b75f'::uuid, 'pg', '03655440bda914dfdd8c7f227c03b4e43ac577b49f17d6624a97e5df8137290b', 'DataSecurity.DecryptionABAC', '{"key":"WnsReceiptRegisterReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '03655440bda914dfdd8c7f227c03b4e43ac577b49f17d6624a97e5df8137290b'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a2068aae-0a9f-4c63-9415-61efb8ea6efa'::uuid, 'pg', '12a748da128adf9502496d639ff95788e5728ab5d71c1b51722f02ea5b7c7132', 'DataSecurity.DecryptionABAC', '{"key":"TLRenewalPendingReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobilenumber","maskingTechnique":"mobile"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '12a748da128adf9502496d639ff95788e5728ab5d71c1b51722f02ea5b7c7132'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cf5b0273-0a79-47a3-8588-4eb4e6a787cc'::uuid, 'pg', '463175b9042f6bb975ef5d6eb857e8c69d63f817f75afd92e9b9d3501d1df3b6', 'DataSecurity.DecryptionABAC', '{"key":"TLRegistryReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '463175b9042f6bb975ef5d6eb857e8c69d63f817f75afd92e9b9d3501d1df3b6'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '066639d7-fb97-483e-bf83-31cd20ae7cbf'::uuid, 'pg', 'f4dbbb7ece09789091c5a08405224ef058a6fa388b8de6d466361c3f959b9a3e', 'DataSecurity.DecryptionABAC', '{"key":"TLApplicationStatusReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = 'f4dbbb7ece09789091c5a08405224ef058a6fa388b8de6d466361c3f959b9a3e'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #8
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '16e0ee1e-33d4-42d2-999c-7e65f4d4bd76'::uuid, 'pg', '2a90b241427014b42cf58e8c4520e6c1c51073d668dfff42be3e0f891389fbe2', 'DataSecurity.DecryptionABAC', '{"key":"TradeLicenseDailyCollectionReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/userName"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '2a90b241427014b42cf58e8c4520e6c1c51073d668dfff42be3e0f891389fbe2'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #9
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '51cf33e3-034d-459f-bb30-a1512351e3b4'::uuid, 'pg', '36f14d7cc678416796d3c6c724f3c868adea8ee46e4ffb4806b54865e7e41f25', 'DataSecurity.DecryptionABAC', '{"key":"MCollectReceiptRegister","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '36f14d7cc678416796d3c6c724f3c868adea8ee46e4ffb4806b54865e7e41f25'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #10
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '519dde7b-4aed-459d-a740-bae00ace7d85'::uuid, 'pg', 'f261ded3bd13621feff89010b3beb423633eca86d8d71d3124d0036e2257c534', 'DataSecurity.DecryptionABAC', '{"key":"DefaulterReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}}],"roleCode":"PT_CEMP"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = 'f261ded3bd13621feff89010b3beb423633eca86d8d71d3124d0036e2257c534'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #11
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6006b06f-4dde-44aa-ad5d-2f1faf4655db'::uuid, 'pg', '4b931dbdcf6775641d15936d7af8f4176a73157729c266cf0dbb0022d44f20b6', 'DataSecurity.DecryptionABAC', '{"key":"PTReceiptRegister","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}}],"roleCode":"PT_CEMP"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '4b931dbdcf6775641d15936d7af8f4176a73157729c266cf0dbb0022d44f20b6'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #12
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '47c33fc7-fb5f-4ee5-a8e2-a76c1b9ec9e6'::uuid, 'pg', '09bb6e3691592f9f7d82eeef3dfd6abb35c4e06cb5eaf6dfe64579c645eaff70', 'DataSecurity.DecryptionABAC', '{"key":"PTCollectionReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}}],"roleCode":"PT_CEMP"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '09bb6e3691592f9f7d82eeef3dfd6abb35c4e06cb5eaf6dfe64579c645eaff70'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #13
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3e702e81-ff5d-4fca-878c-aedfe2f0b186'::uuid, 'pg', '6aad2ddf8cb8b78732007c082e44fb55a7cc4c9778c1c1d2f155d82d594d0296', 'DataSecurity.DecryptionABAC', '{"key":"MCollectCollectionReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '6aad2ddf8cb8b78732007c082e44fb55a7cc4c9778c1c1d2f155d82d594d0296'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #14
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '926063e5-3e9f-4f34-9929-866693e67b5c'::uuid, 'pg', '81b86d79b4a173e801b9f339e405808aee54ac11a791cfe3702f324a84d91e2b', 'DataSecurity.DecryptionABAC', '{"key":"FSMDailyCollectionReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}}],"roleCode":"FSM_REPORT_VIEWER"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '81b86d79b4a173e801b9f339e405808aee54ac11a791cfe3702f324a84d91e2b'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #15
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'eb5da1e6-f644-4112-9e80-57fe9448d060'::uuid, 'pg', '9829de864164ee14f614b58125f7a6377fb9726140de9905364f38ab3aeb38a9', 'DataSecurity.DecryptionABAC', '{"key":"UserListOtherIndividual","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"NONE","attribute":{"jsonPath":"*/emailId"}},{"accessType":"NONE","attribute":{"jsonPath":"*/username"}},{"accessType":"NONE","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"NONE","attribute":{"jsonPath":"*/pan"}},{"accessType":"NONE","attribute":{"jsonPath":"*/aadhaarNumber"}},{"accessType":"NONE","attribute":{"jsonPath":"*/guardian"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/permanentAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/correspondenceAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/addresses/*/address"}}],"roleCode":"EMPLOYEE"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailId"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/username"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/guardian"}}],"roleCode":"SUPERUSER"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}}],"roleCode":"GRO"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}}],"roleCode":"DGRO"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}}],"roleCode":"CSR"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}}],"roleCode":"PGR-ADMIN"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailId"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/pan"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/aadhaarNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/guardian"}}],"roleCode":"TL_CEMP"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailId"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/pan"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/aadhaarNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/guardian"}}],"roleCode":"TL_APPROVER"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailId"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/pan"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/aadhaarNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/guardian"}}],"roleCode":"TL_DOC_VERIFIER"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailId"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/pan"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/aadhaarNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/guardian"}}],"roleCode":"TL_FIELD_INSPECTOR"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailId"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/pan"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/guardian"}}],"roleCode":"CEMP"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailId"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/pan"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/aadhaarNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/guardian"}}],"roleCode":"FEMP"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"MASK","attribute":{"jsonPath":"*/mobileNumber","maskingTechnique":"mobile"}}],"roleCode":"STADMIN"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '9829de864164ee14f614b58125f7a6377fb9726140de9905364f38ab3aeb38a9'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #16
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'dbe08068-8150-407b-958b-024677602d35'::uuid, 'pg', 'cce7f67c8606278f0e90c67f99840dc3290e0546c4d12085017f1f73180f6370', 'DataSecurity.DecryptionABAC', '{"key":"UserListOtherBulk","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"NONE","attribute":{"jsonPath":"*/emailId"}},{"accessType":"NONE","attribute":{"jsonPath":"*/username"}},{"accessType":"NONE","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"NONE","attribute":{"jsonPath":"*/pan"}},{"accessType":"NONE","attribute":{"jsonPath":"*/aadhaarNumber"}},{"accessType":"NONE","attribute":{"jsonPath":"*/guardian"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/permanentAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/correspondenceAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/addresses/*/address"}}],"roleCode":"EMPLOYEE"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}}],"roleCode":"SUPERUSER"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"MASK","attribute":{"jsonPath":"*/mobileNumber","maskingTechnique":"mobile"}}],"roleCode":"GRO"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"MASK","attribute":{"jsonPath":"*/mobileNumber","maskingTechnique":"mobile"}}],"roleCode":"DGRO"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"MASK","attribute":{"jsonPath":"*/mobileNumber","maskingTechnique":"mobile"}}],"roleCode":"CSR"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"MASK","attribute":{"jsonPath":"*/mobileNumber","maskingTechnique":"mobile"}}],"roleCode":"PGR-ADMIN"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"MASK","attribute":{"jsonPath":"*/mobileNumber","maskingTechnique":"mobile"}}],"roleCode":"TL_CEMP"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"MASK","attribute":{"jsonPath":"*/mobileNumber","maskingTechnique":"mobile"}}],"roleCode":"TL_APPROVER"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"MASK","attribute":{"jsonPath":"*/mobileNumber","maskingTechnique":"mobile"}}],"roleCode":"TL_DOC_VERIFIER"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}}],"roleCode":"TL_FIELD_INSPECTOR"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"MASK","attribute":{"jsonPath":"*/mobileNumber","maskingTechnique":"mobile"}}],"roleCode":"CEMP"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}}],"roleCode":"FEMP"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"MASK","attribute":{"jsonPath":"*/mobileNumber","maskingTechnique":"mobile"}}],"roleCode":"STADMIN"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = 'cce7f67c8606278f0e90c67f99840dc3290e0546c4d12085017f1f73180f6370'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #17
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9ab0bcf9-d75f-41cc-9815-6507faf66161'::uuid, 'pg', '5871c0303cc454c69d70b7c44f847a8ac8569130d8f6605d7e2de445110d067b', 'DataSecurity.DecryptionABAC', '{"key":"UserListSelf","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailId"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/username"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/pan"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/aadhaarNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/guardian"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/permanentAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/correspondenceAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/addresses/*/address"}}],"roleCode":"CITIZEN"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailId"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/username"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/pan"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/aadhaarNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/guardian"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/permanentAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/correspondenceAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/addresses/*/address"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '5871c0303cc454c69d70b7c44f847a8ac8569130d8f6605d7e2de445110d067b'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #18
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '91aab037-c104-4fc9-8727-b1fdcd369f85'::uuid, 'pg', 'e94e430212b4327c2b9f55c55e71bd3b8b620e478be266fcf5d017276eeb5971', 'DataSecurity.DecryptionABAC', '{"key":"StateLevelTradeLicenseRegistryReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobilenumber","maskingTechnique":"mobile"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = 'e94e430212b4327c2b9f55c55e71bd3b8b620e478be266fcf5d017276eeb5971'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #19
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8db59125-f868-4483-a8f1-f0d3ec128034'::uuid, 'pg', '6fb6dc7b821505c77e6e45bde28a24f35eb655597913b8ae68945e51df687360', 'DataSecurity.DecryptionABAC', '{"key":"TradeLicenseRegistryReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobilenumber","maskingTechnique":"mobile"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '6fb6dc7b821505c77e6e45bde28a24f35eb655597913b8ae68945e51df687360'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #20
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3712a92c-813e-4b14-a97e-2e0eaaa90654'::uuid, 'pg', '6fbc98f42b7fff53c41ad3c8f41f158906c01775a10b6112d6dcd1eeae8c1343', 'DataSecurity.DecryptionABAC', '{"key":"GROPerformanceReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/employee"}}],"roleCode":"SUPERUSER"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/employee"}}],"roleCode":"GRO"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/employee"}}],"roleCode":"PGR_LME"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '6fbc98f42b7fff53c41ad3c8f41f158906c01775a10b6112d6dcd1eeae8c1343'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #21
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '89a28e52-b04a-4191-a4ce-5dddaaa2a2c3'::uuid, 'pg', 'ce2f158a544c1eac01ef0a9c9a0ce0380812410cbf2a903985b514f6fce46279', 'DataSecurity.DecryptionABAC', '{"key":"LMEPerformanceReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/employee"}}],"roleCode":"SUPERUSER"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/employee"}}],"roleCode":"GRO"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/employee"}}],"roleCode":"PGR_LME"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = 'ce2f158a544c1eac01ef0a9c9a0ce0380812410cbf2a903985b514f6fce46279'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #22
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6bf05eea-508b-4b6b-bc0b-c7fc752be865'::uuid, 'pg', '0e0ac497383ad912837ee0dd462a2b6222d633a1865dc46ee2d865f596693d4b', 'DataSecurity.DecryptionABAC', '{"key":"ULBEmployeeWiseReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/employee"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '0e0ac497383ad912837ee0dd462a2b6222d633a1865dc46ee2d865f596693d4b'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #23
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c4ea070b-c39c-473c-98f3-30b0b4572f91'::uuid, 'pg', 'b3e2d38fa3a618d4232c3757e20e73d80c631f0a79401a9f9d0d77dc3bba4f87', 'DataSecurity.DecryptionABAC', '{"key":"EmployeeReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = 'b3e2d38fa3a618d4232c3757e20e73d80c631f0a79401a9f9d0d77dc3bba4f87'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #24
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7c6512cb-7905-4d2d-a347-138c503ae47a'::uuid, 'pg', '8bde1b68980057c9f9c78dace7b533e2a16d3b34b3fad4d1ea1f8c5ab8f93b29', 'DataSecurity.DecryptionABAC', '{"key":"DescriptionReport","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/lastassignedto"}}],"roleCode":"PGR_LME"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/lastassignedto"}}],"roleCode":"GRO"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/lastassignedto"}}],"roleCode":"SUPERUSER"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '8bde1b68980057c9f9c78dace7b533e2a16d3b34b3fad4d1ea1f8c5ab8f93b29'
);

-- data/DataSecurity/DataSecurity.DecryptionABAC.json :: DataSecurity.DecryptionABAC entry #25
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f40e49dd-c51a-4895-b9c6-a4403f652b98'::uuid, 'pg', '882faa006ea7dae884b7b8e2909ca8ad5c7bdbc3c1fa78a8b64194759d62c004', 'DataSecurity.DecryptionABAC', '{"key":"ALL_ACCESS","roleAttributeAccessList":[{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}}],"roleCode":"SYSTEM"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailId"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/username"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/pan"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/aadhaarNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/guardian"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/permanentAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/correspondenceAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/addresses/*/address"}}],"roleCode":"CITIZEN"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailId"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/username"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/pan"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/aadhaarNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/guardian"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/permanentAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/correspondenceAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/addresses/*/address"}}],"roleCode":"ANONYMOUS"},{"attributeAccessList":[{"accessType":"PLAIN","attribute":{"jsonPath":"*/name"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/mobileNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/emailId"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/username"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/altContactNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/pan"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/aadhaarNumber"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/guardian"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/permanentAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/correspondenceAddress/address"}},{"accessType":"PLAIN","attribute":{"jsonPath":"*/addresses/*/address"}}],"roleCode":"EMPLOYEE"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.DecryptionABAC' AND uniqueidentifier = '882faa006ea7dae884b7b8e2909ca8ad5c7bdbc3c1fa78a8b64194759d62c004'
);

-- data/DataSecurity/DataSecurity.EncryptionPolicy.json :: DataSecurity.EncryptionPolicy entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '370477e8-8a3f-42a0-8e42-8a2c4116ca3c'::uuid, 'pg', 'b7885b77139c4c138a872adc7d5e8738d46e1295451aae62ee4fbe9a05b3af85', 'DataSecurity.EncryptionPolicy', '{"attributeList":[{"jsonPath":"mobileno","type":"Normal"},{"jsonPath":"emailid","type":"Normal"},{"jsonPath":"aadharno","type":"Normal"},{"jsonPath":"icdcode","type":"Normal"}],"key":"BndDetail"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.EncryptionPolicy' AND uniqueidentifier = 'b7885b77139c4c138a872adc7d5e8738d46e1295451aae62ee4fbe9a05b3af85'
);

-- data/DataSecurity/DataSecurity.EncryptionPolicy.json :: DataSecurity.EncryptionPolicy entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd5648939-aa2f-4f3b-8825-955da74efeef'::uuid, 'pg', 'f7cd9c1fda54fb870a2c44c536e74ad01551872667957cb4c408e27638903237', 'DataSecurity.EncryptionPolicy', '{"attributeList":[{"jsonPath":"userName","type":"Normal"},{"jsonPath":"name","type":"Normal"},{"jsonPath":"mobileNumber","type":"Normal"},{"jsonPath":"aadhaarNumber","type":"Normal"},{"jsonPath":"pan","type":"Normal"},{"jsonPath":"emailId","type":"Normal"}],"key":"UserSearchCriteria"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.EncryptionPolicy' AND uniqueidentifier = 'f7cd9c1fda54fb870a2c44c536e74ad01551872667957cb4c408e27638903237'
);

-- data/DataSecurity/DataSecurity.EncryptionPolicy.json :: DataSecurity.EncryptionPolicy entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5af13532-4f93-421e-98d4-45372f3eae25'::uuid, 'pg', '94ed5340ba6419c9c24a5d55e8e1a1238faae9517f4830b3e269808d1e5af8c2', 'DataSecurity.EncryptionPolicy', '{"attributeList":[{"jsonPath":"name","type":"Normal"},{"jsonPath":"mobileNumber","type":"Normal"},{"jsonPath":"emailId","type":"Normal"},{"jsonPath":"username","type":"Normal"},{"jsonPath":"altContactNumber","type":"Normal"},{"jsonPath":"pan","type":"Normal"},{"jsonPath":"aadhaarNumber","type":"Normal"},{"jsonPath":"guardian","type":"Normal"},{"jsonPath":"permanentAddress/address","type":"Normal"},{"jsonPath":"correspondenceAddress/address","type":"Normal"},{"jsonPath":"addresses/*/address","type":"Normal"}],"key":"User"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.EncryptionPolicy' AND uniqueidentifier = '94ed5340ba6419c9c24a5d55e8e1a1238faae9517f4830b3e269808d1e5af8c2'
);

-- data/DataSecurity/DataSecurity.MaskingPatterns.json :: DataSecurity.MaskingPatterns entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '04a817b3-d240-4715-9a46-fa4d69368f0d'::uuid, 'pg', '77a9086de2d30ae55ad67c5c02c1c460fcdbb2dbc32ca389ed807a8eec0033f1', 'DataSecurity.MaskingPatterns', '{"pattern":".(?=.{4})","patternId":"001"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.MaskingPatterns' AND uniqueidentifier = '77a9086de2d30ae55ad67c5c02c1c460fcdbb2dbc32ca389ed807a8eec0033f1'
);

-- data/DataSecurity/DataSecurity.MaskingPatterns.json :: DataSecurity.MaskingPatterns entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '89f20fc3-29f8-4552-a44a-2e34de034414'::uuid, 'pg', '17961e0d591c4f8e4442ebdaf2c5153cf12d5e0448ffc61439f2c9877a571dac', 'DataSecurity.MaskingPatterns', '{"pattern":"\\B[a-zA-Z0-9]","patternId":"002"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.MaskingPatterns' AND uniqueidentifier = '17961e0d591c4f8e4442ebdaf2c5153cf12d5e0448ffc61439f2c9877a571dac'
);

-- data/DataSecurity/DataSecurity.MaskingPatterns.json :: DataSecurity.MaskingPatterns entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c7e368f2-d9b2-4114-b0ff-9f2de076a576'::uuid, 'pg', '64262585c15089ca9e752acc791e490fbd21042d2a8f3257ef56aa89fbc9ec0c', 'DataSecurity.MaskingPatterns', '{"pattern":".(?=.{2})","patternId":"003"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.MaskingPatterns' AND uniqueidentifier = '64262585c15089ca9e752acc791e490fbd21042d2a8f3257ef56aa89fbc9ec0c'
);

-- data/DataSecurity/DataSecurity.MaskingPatterns.json :: DataSecurity.MaskingPatterns entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5be91eb0-92b7-42bf-8662-47e8faafe0fb'::uuid, 'pg', '6d817663848da54e6a1d486d89921bb2a79a9d11f1124abee17a43b4dfa2d850', 'DataSecurity.MaskingPatterns', '{"pattern":"(?<=.)[^@\\n](?=[^@\\n]*?@)|(?:(?<=@.)|(?!^)\\G(?=[^@\\n]*$)).(?!$)","patternId":"004"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.MaskingPatterns' AND uniqueidentifier = '6d817663848da54e6a1d486d89921bb2a79a9d11f1124abee17a43b4dfa2d850'
);

-- data/DataSecurity/DataSecurity.MaskingPatterns.json :: DataSecurity.MaskingPatterns entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fbc34d61-c246-45f5-a797-5c62a73a9bc6'::uuid, 'pg', '205b7a5fd55a4c43399091bbe32fe53da2d90d29e97769901df3de62c166c2ac', 'DataSecurity.MaskingPatterns', '{"pattern":"[A-Za-zÀ-ȕ0-9(),-_., ]","patternId":"005"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.MaskingPatterns' AND uniqueidentifier = '205b7a5fd55a4c43399091bbe32fe53da2d90d29e97769901df3de62c166c2ac'
);

-- data/DataSecurity/DataSecurity.MaskingPatterns.json :: DataSecurity.MaskingPatterns entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b63995f5-7283-4077-9e03-07af7c3f13ab'::uuid, 'pg', '3fa4041866ad41d2bd1b29b85ef91bfc5d9484e5423476bd0f9a0409f44c6133', 'DataSecurity.MaskingPatterns', '{"pattern":"\\w(?=(?:[ \\w]*\\w){2}$)","patternId":"006"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.MaskingPatterns' AND uniqueidentifier = '3fa4041866ad41d2bd1b29b85ef91bfc5d9484e5423476bd0f9a0409f44c6133'
);

-- data/DataSecurity/DataSecurity.MaskingPatterns.json :: DataSecurity.MaskingPatterns entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '64f363e5-6874-4e1c-b2d4-e345dc0d1fdc'::uuid, 'pg', 'c0ca642bc5822bebba40e7d387b89e5fc7376a45362f6288cb59fa7ee7a11af4', 'DataSecurity.MaskingPatterns', '{"pattern":"(?<=.).(?=.{3})","patternId":"007"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.MaskingPatterns' AND uniqueidentifier = 'c0ca642bc5822bebba40e7d387b89e5fc7376a45362f6288cb59fa7ee7a11af4'
);

-- data/DataSecurity/DataSecurity.MaskingPatterns.json :: DataSecurity.MaskingPatterns entry #8
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '760750b8-5157-4a63-a6c5-2f18aed01435'::uuid, 'pg', 'f1e3a37458d82c11be8ee10bd28afdb02b0307c2b6ca63e618181aa72a1c4826', 'DataSecurity.MaskingPatterns', '{"pattern":"(?<=.).(?=.{2})","patternId":"008"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.MaskingPatterns' AND uniqueidentifier = 'f1e3a37458d82c11be8ee10bd28afdb02b0307c2b6ca63e618181aa72a1c4826'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a5164fd2-4be2-46dd-865d-955dc0a79271'::uuid, 'pg', 'd7a6c5c44337b462e9131339366d50f9308ff8bbd4cc396f5af99b475630ea3b', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"},{"defaultVisibility":"PLAIN","jsonPath":"mobileNumber","name":"mobileNumber","patternId":"001"},{"defaultVisibility":"PLAIN","jsonPath":"emailId","name":"emailId","patternId":"004"},{"defaultVisibility":"PLAIN","jsonPath":"username","name":"username","patternId":"002"},{"defaultVisibility":"PLAIN","jsonPath":"altContactNumber","name":"altContactNumber","patternId":"001"},{"defaultVisibility":"PLAIN","jsonPath":"alternatemobilenumber","name":"alternatemobilenumber","patternId":"001"},{"defaultVisibility":"PLAIN","jsonPath":"pan","name":"pan","patternId":"001"},{"defaultVisibility":"PLAIN","jsonPath":"aadhaarNumber","name":"aadhaarNumber","patternId":"001"},{"defaultVisibility":"PLAIN","jsonPath":"guardian","name":"guardian","patternId":"002"},{"defaultVisibility":"PLAIN","jsonPath":"permanentAddress/address","name":"permanentAddress","patternId":"005"},{"defaultVisibility":"PLAIN","jsonPath":"correspondenceAddress/address","name":"correspondenceAddress","patternId":"005"},{"defaultVisibility":"PLAIN","jsonPath":"fatherOrHusbandName","name":"fatherOrHusbandName","patternId":"002"},{"defaultVisibility":"PLAIN","jsonPath":"userName","name":"searchUsername","patternId":"002"}],"model":"User","roleBasedDecryptionPolicy":[{"attributeAccessList":[],"roles":["REINDEXING_ROLE"]},{"attributeAccessList":[],"roles":["WS_CEMP","WS_DOC_VERIFIER","WS_FIELD_INSPECTOR","WS_APPROVER","WS_CLERK","SW_CEMP","SW_DOC_VERIFIER","SW_FIELD_INSPECTOR","SW_APPROVER","SW_CLERK"]},{"attributeAccessList":[{"attribute":"mobileNumber","firstLevelVisibility":"PLAIN","secondLevelVisibility":"PLAIN"},{"attribute":"fatherOrHusbandName","firstLevelVisibility":"PLAIN","secondLevelVisibility":"PLAIN"},{"attribute":"correspondenceAddress","firstLevelVisibility":"PLAIN","secondLevelVisibility":"PLAIN"},{"attribute":"name","firstLevelVisibility":"PLAIN","secondLevelVisibility":"PLAIN"},{"attribute":"emailId","firstLevelVisibility":"PLAIN","secondLevelVisibility":"PLAIN"},{"attribute":"permanentAddress","firstLevelVisibility":"PLAIN","secondLevelVisibility":"PLAIN"},{"attribute":"username","firstLevelVisibility":"PLAIN","secondLevelVisibility":"PLAIN"},{"attribute":"altContactNumber","firstLevelVisibility":"PLAIN","secondLevelVisibility":"PLAIN"},{"attribute":"alternatemobilenumber","firstLevelVisibility":"PLAIN","secondLevelVisibility":"PLAIN"},{"attribute":"pan","firstLevelVisibility":"PLAIN","secondLevelVisibility":"PLAIN"},{"attribute":"aadhaarNumber","firstLevelVisibility":"PLAIN","secondLevelVisibility":"PLAIN"},{"attribute":"guardian","firstLevelVisibility":"PLAIN","secondLevelVisibility":"PLAIN"}],"roles":["INTERNAL_MICROSERVICE_ROLE"]}],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = 'd7a6c5c44337b462e9131339366d50f9308ff8bbd4cc396f5af99b475630ea3b'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '304c24ed-86b6-4bdf-84bd-c9a69ec30566'::uuid, 'pg', '438b44be5e95785f453ce99d53b52a2d262f657b5afa255d33bdbad655b7a3fe', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":null},{"defaultVisibility":"PLAIN","jsonPath":"mobileNumber","name":"mobileNumber","patternId":null},{"defaultVisibility":"PLAIN","jsonPath":"emailId","name":"emailId","patternId":null},{"defaultVisibility":"PLAIN","jsonPath":"username","name":"username","patternId":null},{"defaultVisibility":"PLAIN","jsonPath":"altContactNumber","name":"altContactNumber","patternId":null},{"defaultVisibility":"PLAIN","jsonPath":"alternatemobilenumber","name":"alternatemobilenumber","patternId":null},{"defaultVisibility":"PLAIN","jsonPath":"pan","name":"pan","patternId":null},{"defaultVisibility":"PLAIN","jsonPath":"aadhaarNumber","name":"aadhaarNumber","patternId":null},{"defaultVisibility":"PLAIN","jsonPath":"guardian","name":"guardian","patternId":null},{"defaultVisibility":"PLAIN","jsonPath":"permanentAddress/address","name":"permanentAddress","patternId":null},{"defaultVisibility":"PLAIN","jsonPath":"correspondenceAddress/address","name":"correspondenceAddress","patternId":null},{"defaultVisibility":"PLAIN","jsonPath":"fatherOrHusbandName","name":"fatherOrHusbandName","patternId":null}],"model":"UserSelf","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '438b44be5e95785f453ce99d53b52a2d262f657b5afa255d33bdbad655b7a3fe'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ce52f0ee-e75c-4d41-b628-13b664413d59'::uuid, 'pg', '5d5a0fb10fe5af578b94a7cf27bf734863defffaf249e24e9633359138d0e9bf', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"EmployeeReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '5d5a0fb10fe5af578b94a7cf27bf734863defffaf249e24e9633359138d0e9bf'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ac6ccc42-91cc-43a6-b1bd-8290e7e671ba'::uuid, 'pg', '8354af0a6ae5784ff423e0a228c5f221cdec50b1fa1dd4ba49cff88bb2b39ffd', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"waterOpenSearch","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '8354af0a6ae5784ff423e0a228c5f221cdec50b1fa1dd4ba49cff88bb2b39ffd'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e0a46285-9bd6-4d2a-9746-fa8e26dcbcb1'::uuid, 'pg', 'f1071d5522254e096fbb88f3a7c2989e77504f9d2333ca6d4802c30f53cc2264', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"DescriptionReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/user_uuid","name":"user_uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = 'f1071d5522254e096fbb88f3a7c2989e77504f9d2333ca6d4802c30f53cc2264'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '41528a10-1ae0-4495-920b-3aa7e32d2384'::uuid, 'pg', 'eb639e24c92912332c57c660af3d2a9a1a21fc9255af96816109e520ecbdd799', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"employee","name":"employee","patternId":"002"}],"model":"LMEPerformanceReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/user_uuid","name":"user_uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = 'eb639e24c92912332c57c660af3d2a9a1a21fc9255af96816109e520ecbdd799'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7207a5a1-3710-4064-a61e-7d6cdfef7aaf'::uuid, 'pg', 'e9fc2099cbaa7ebe4c6a75e3133ecb34b8dce3469a2dac3280261880af0664d2', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"employee","name":"employee","patternId":"002"}],"model":"GROPerformanceReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/user_uuid","name":"user_uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = 'e9fc2099cbaa7ebe4c6a75e3133ecb34b8dce3469a2dac3280261880af0664d2'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #8
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '202e6a7d-8895-4855-a7c6-313b53a5a7ec'::uuid, 'pg', '3774b103620d4500b9b437630b550eed4a2a6dd4fa6e9fe4bcf0cc6e25d2f75c', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"sample","name":"sample","patternId":null}],"model":"Property","roleBasedDecryptionPolicy":[{"attributeAccessList":[],"roles":["WS_CEMP","WS_DOC_VERIFIER","WS_FIELD_INSPECTOR","WS_APPROVER","WS_CLERK","SW_CEMP","SW_DOC_VERIFIER","SW_FIELD_INSPECTOR","SW_APPROVER","SW_CLERK","PT_APPROVER","PT_CEMP","PT_COLLECTION_EMP","PT_FIELD_INSPECTOR","PT_DOC_VERIFIER"]},{"attributeAccessList":[],"roles":["REINDEXING_ROLE"]}],"uniqueIdentifier":{"jsonPath":"/owners/0/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '3774b103620d4500b9b437630b550eed4a2a6dd4fa6e9fe4bcf0cc6e25d2f75c'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #9
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f86cfaac-63c1-455b-9ca9-3eb4dbc13b7e'::uuid, 'pg', '07e28e7f3e7af61784c2f2d5c066501af263974b087e032dc2dd45b1739e695c', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"sample","name":"sample","patternId":null}],"model":"WnSConnection","roleBasedDecryptionPolicy":[{"attributeAccessList":[],"roles":["WS_CEMP","WS_DOC_VERIFIER","WS_FIELD_INSPECTOR","WS_APPROVER","WS_CLERK","SW_CEMP","SW_DOC_VERIFIER","SW_FIELD_INSPECTOR","SW_APPROVER","SW_CLERK"]},{"attributeAccessList":[],"roles":["REINDEXING_ROLE"]}],"uniqueIdentifier":{"jsonPath":"/connectionHolders/0/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '07e28e7f3e7af61784c2f2d5c066501af263974b087e032dc2dd45b1739e695c'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #10
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7bf203cc-e614-483f-b563-9e61c1c2816d'::uuid, 'pg', 'e8750101e34df9349c2b093560e799f215a0b7c522ddba09a22fd4cc20099d06', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"sample","name":"sample","patternId":null}],"model":"WnSConnectionOwner","roleBasedDecryptionPolicy":[{"attributeAccessList":[],"roles":["WS_CEMP","WS_DOC_VERIFIER","WS_FIELD_INSPECTOR","WS_APPROVER","WS_CLERK","SW_CEMP","SW_DOC_VERIFIER","SW_FIELD_INSPECTOR","SW_APPROVER","SW_CLERK"]},{"attributeAccessList":[],"roles":["REINDEXING_ROLE"]}],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = 'e8750101e34df9349c2b093560e799f215a0b7c522ddba09a22fd4cc20099d06'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #11
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7be6219a-4cd5-41fa-a977-9599d9239530'::uuid, 'pg', 'df429d39bf348b09cfe96aca5f7bf59db072cca79372b20535bbed2a05b72d4d', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"},{"defaultVisibility":"PLAIN","jsonPath":"currentowner","name":"currentowner","patternId":"002"}],"model":"ObpsApplicationStatusReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = 'df429d39bf348b09cfe96aca5f7bf59db072cca79372b20535bbed2a05b72d4d'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #12
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'eec5dac1-42b6-40e7-b96e-4f92f300fb4b'::uuid, 'pg', '1e49ee9237518a70017f644bc0494b6a07d1e7b41c2442f06503dc772dfa6f15', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"ObpsDailyCollectionReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '1e49ee9237518a70017f644bc0494b6a07d1e7b41c2442f06503dc772dfa6f15'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #13
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1c331420-d9bc-40e0-b756-5e4e566ed8f7'::uuid, 'pg', '88ab7c93779089de939b7c917ab19d87d2e088b2028efd6496d3b0dcf6b6d346', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"WnsReceiptRegisterReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '88ab7c93779089de939b7c917ab19d87d2e088b2028efd6496d3b0dcf6b6d346'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #14
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '688e9ddb-d30f-4cf8-a8db-4550aa3dcba7'::uuid, 'pg', '13b301891e4fa6a617524f03758e36a5677569ee093b46dd77c4ce2cdb454ee1', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"WnsCollectionRegisterReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '13b301891e4fa6a617524f03758e36a5677569ee093b46dd77c4ce2cdb454ee1'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #15
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '41742e77-0eb3-4aea-96d2-963d46e4c187'::uuid, 'pg', '69872e8adf7e75ccb252ec8ac6b7968467bde3fedb0186484c12f494cf67c92d', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"WnsDefaulterReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '69872e8adf7e75ccb252ec8ac6b7968467bde3fedb0186484c12f494cf67c92d'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #16
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a6218abe-793e-4f6c-a3bb-2aed398cb142'::uuid, 'pg', '9f59d9b58398c5d4712a4ec5dcf5b09cd175c0615075cb9afb2c1ebb77b873ec', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"sample","name":"sample","patternId":null}],"model":"InboxWnS","roleBasedDecryptionPolicy":[{"attributeAccessList":[],"roles":["WS_CEMP","WS_DOC_VERIFIER","WS_FIELD_INSPECTOR","WS_APPROVER","WS_CLERK","SW_CEMP","SW_DOC_VERIFIER","SW_FIELD_INSPECTOR","SW_APPROVER","SW_CLERK"]}],"uniqueIdentifier":{"jsonPath":"applicationNo","name":"applicationNo"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '9f59d9b58398c5d4712a4ec5dcf5b09cd175c0615075cb9afb2c1ebb77b873ec'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #17
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '63887e3e-32e6-466b-83d9-5c7bf31a95ec'::uuid, 'pg', 'd50303f1a886bc80a63d52bd31f23946fd67902a7174cfeb1322840d9adad562', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"PTReceiptRegister","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/user_uuid","name":"user_uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = 'd50303f1a886bc80a63d52bd31f23946fd67902a7174cfeb1322840d9adad562'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #18
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '96110d11-eb98-4898-aafc-73410a12da65'::uuid, 'pg', 'f13a1ec13f9e875e9284a7c357148eb6cbdd91767884e1b97bb42113bb8b8ff9', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"PTCollectionReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/user_uuid","name":"user_uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = 'f13a1ec13f9e875e9284a7c357148eb6cbdd91767884e1b97bb42113bb8b8ff9'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #19
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '19afdac8-4720-4419-bb6e-4087997c65d7'::uuid, 'pg', '8888aa80b658db69156301f4815ec5871dd7d2539738db93fa1d85bd89463608', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"DefaulterReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/user_uuid","name":"user_uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '8888aa80b658db69156301f4815ec5871dd7d2539738db93fa1d85bd89463608'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #20
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'bca49cf3-5a2e-4b2d-ae10-16a086544743'::uuid, 'pg', 'b3c23ad8bbf50bcc7b12a4deb6558f94f39f6a2aa4f39b2df687fe16d9ea09ca', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"sample","name":"sample","patternId":null}],"model":"PropertyDecrypDisabled","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/propertyId","name":"propertyId"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = 'b3c23ad8bbf50bcc7b12a4deb6558f94f39f6a2aa4f39b2df687fe16d9ea09ca'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #21
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '026890a6-82db-48df-bdef-9fcb8216c713'::uuid, 'pg', 'fa5c6dcf25fe497fca1478c8b7da6fb94f0b0601e66926ec19269ece44b6c407', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"sample","name":"sample","patternId":null}],"model":"WnSConnectionDecrypDisabled","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/connectionHolders/0/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = 'fa5c6dcf25fe497fca1478c8b7da6fb94f0b0601e66926ec19269ece44b6c407'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #22
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b6cd81fa-050b-4d64-a1fc-bf6af2bad2de'::uuid, 'pg', '9c330cf1dbcaa868d35683117f638ca7e9526980dcb5a71620fa7463e5467828', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"sample","name":"sample","patternId":null}],"model":"WnSConnectionOwnerDecrypDisabled","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '9c330cf1dbcaa868d35683117f638ca7e9526980dcb5a71620fa7463e5467828'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #23
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd11615ae-2949-4839-ba28-9993eeec0aae'::uuid, 'pg', 'a60d7d36c626ad45645859e759c33993b632c43653238e065345b4fb9cdae181', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"TradeLicenseRegistryReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = 'a60d7d36c626ad45645859e759c33993b632c43653238e065345b4fb9cdae181'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #24
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '767ba0a5-45ba-424d-bfe7-f73bc5fe334b'::uuid, 'pg', '75d01747dd30f6524b8d623a1b61b8677699b0f1f16e6afeda01de1682dea60b', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"StateTradeLicenseCancelledRegistryReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '75d01747dd30f6524b8d623a1b61b8677699b0f1f16e6afeda01de1682dea60b'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #25
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '39df0787-0e3a-444b-a266-79e537798b7f'::uuid, 'pg', '89a90918ed113cd5ccaf0bc4ff4cdc98bc6e6f30f0e74267abd1a7f803e8e8d6', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"TradeLicenseCancelledRegistryReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '89a90918ed113cd5ccaf0bc4ff4cdc98bc6e6f30f0e74267abd1a7f803e8e8d6'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #26
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '96bee208-58b9-4108-9944-cecc9da0ec03'::uuid, 'pg', '0711a521344b31c054a74bae38d6b99109a677adedec0edb8cab5c60b3f86608', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"StateLevelTradeLicenseRegistryReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '0711a521344b31c054a74bae38d6b99109a677adedec0edb8cab5c60b3f86608'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #27
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e484e596-9465-4a46-a386-fa49bc973eba'::uuid, 'pg', '3142ea6c26bccdc743b49f65185fd326e42c81b336d5d5441f2c59e681b621a8', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"},{"defaultVisibility":"PLAIN","jsonPath":"username","name":"username","patternId":"002"}],"model":"TradeLicenseDailyCollectionReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '3142ea6c26bccdc743b49f65185fd326e42c81b336d5d5441f2c59e681b621a8'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #28
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '21ec2e66-5083-4895-b243-316d898ae4fa'::uuid, 'pg', 'bb6ce0953b3ef2c69a194eb71c5755a99a258b334b32fa5e3ff1d3c2e177da2b', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"},{"defaultVisibility":"PLAIN","jsonPath":"currentowner","name":"currentowner","patternId":"002"}],"model":"TLApplicationStatusReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = 'bb6ce0953b3ef2c69a194eb71c5755a99a258b334b32fa5e3ff1d3c2e177da2b'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #29
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1ca48fc2-5f74-44d5-95d9-de20a0fb1a61'::uuid, 'pg', '163065512806cca9bc90d05f6f76ce9cdcf4dc81f2586f4845e0bd28d91baf5e', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"}],"model":"TLRegistryReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '163065512806cca9bc90d05f6f76ce9cdcf4dc81f2586f4845e0bd28d91baf5e'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #30
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6e837412-8011-4f99-a5e2-dca7dfe5c9e7'::uuid, 'pg', '7899426fae48eca12854c1506804db889cf573e21b7b84bf4071b76fb71744b6', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"name","name":"name","patternId":"002"},{"defaultVisibility":"PLAIN","jsonPath":"mobilenumber","name":"mobilenumber","patternId":"002"}],"model":"TLRenewalPendingReport","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/uuid","name":"uuid"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '7899426fae48eca12854c1506804db889cf573e21b7b84bf4071b76fb71744b6'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #31
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '853a9876-07ef-44fe-ba3e-723adabc8fc5'::uuid, 'pg', '3e20b4fc0b259edf3d6797a0378967df143ecab9941f7e3b282f453f1ec33d4d', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"sample","name":"sample","patternId":null}],"model":"WnSConnectionPlumber","roleBasedDecryptionPolicy":[{"attributeAccessList":[],"roles":["WS_CEMP","WS_DOC_VERIFIER","WS_FIELD_INSPECTOR","WS_APPROVER","WS_CLERK","SW_CEMP","SW_DOC_VERIFIER","SW_FIELD_INSPECTOR","SW_APPROVER","SW_CLERK"]},{"attributeAccessList":[],"roles":["REINDEXING_ROLE"]}],"uniqueIdentifier":{"jsonPath":"/applicationNo","name":"applicationNo"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '3e20b4fc0b259edf3d6797a0378967df143ecab9941f7e3b282f453f1ec33d4d'
);

-- data/DataSecurity/DataSecurity.SecurityPolicy.json :: DataSecurity.SecurityPolicy entry #32
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'eac4200b-7a90-4c98-b58a-677c8273a354'::uuid, 'pg', '198eb7cc6b0a11f293b663bd99bdf5ab9b2bb558639a6bdf7006438cbf32bcf1', 'DataSecurity.SecurityPolicy', '{"attributes":[{"defaultVisibility":"PLAIN","jsonPath":"sample","name":"sample","patternId":null}],"model":"WnSConnectionPlumberDecrypDisabled","roleBasedDecryptionPolicy":[],"uniqueIdentifier":{"jsonPath":"/applicationNo","name":"applicationNo"}}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'DataSecurity.SecurityPolicy' AND uniqueidentifier = '198eb7cc6b0a11f293b663bd99bdf5ab9b2bb558639a6bdf7006438cbf32bcf1'
);

-- data/egov-hrms/egov-hrms.DeactivationReason.json :: egov-hrms.DeactivationReason entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '13fbdb93-904b-4235-8e37-b196b4824786'::uuid, 'pg', '1cb6c2ba6cf789f083588eefdf3cb32179ea203803027ecb674c127bd451b088', 'egov-hrms.DeactivationReason', '{"active":true,"code":"OTHERS"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.DeactivationReason' AND uniqueidentifier = '1cb6c2ba6cf789f083588eefdf3cb32179ea203803027ecb674c127bd451b088'
);

-- data/egov-hrms/egov-hrms.DeactivationReason.json :: egov-hrms.DeactivationReason entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'af056165-4ac5-420d-ae99-da7607bbb4b3'::uuid, 'pg', '809e8672d4aa45315c892efdb2e3913ac2590bdc4d30973e5e3e501f2795e097', 'egov-hrms.DeactivationReason', '{"active":true,"code":"ORDERBYCOMMISSIONER"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.DeactivationReason' AND uniqueidentifier = '809e8672d4aa45315c892efdb2e3913ac2590bdc4d30973e5e3e501f2795e097'
);

-- data/egov-hrms/egov-hrms.Degree.json :: egov-hrms.Degree entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'eb3eb801-86f6-4ad3-a628-45d8fc4f77a6'::uuid, 'pg', '71e3ba2f621a40b58555d7f6234911cf0718b3dc06fb85543e93635d04338548', 'egov-hrms.Degree', '{"active":true,"code":"MATRICULATION"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.Degree' AND uniqueidentifier = '71e3ba2f621a40b58555d7f6234911cf0718b3dc06fb85543e93635d04338548'
);

-- data/egov-hrms/egov-hrms.Degree.json :: egov-hrms.Degree entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5ad3df1e-f0c3-4e8f-a858-f8c5b0c25164'::uuid, 'pg', '5630a0605e577dbb9b4a76648c6dfde85aca2912effb793dce6b27761596039a', 'egov-hrms.Degree', '{"active":true,"code":"10+2/EQUIVALENTDIPLOMA"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.Degree' AND uniqueidentifier = '5630a0605e577dbb9b4a76648c6dfde85aca2912effb793dce6b27761596039a'
);

-- data/egov-hrms/egov-hrms.Degree.json :: egov-hrms.Degree entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a6a2ef0c-efab-4166-8611-b1b833a85a49'::uuid, 'pg', 'a3bd8357a82ff729164bc295497c6ebda1bc6c62803d6f3c3d6d82e652264926', 'egov-hrms.Degree', '{"active":true,"code":"B.A/B.SC./B.COM/BBA"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.Degree' AND uniqueidentifier = 'a3bd8357a82ff729164bc295497c6ebda1bc6c62803d6f3c3d6d82e652264926'
);

-- data/egov-hrms/egov-hrms.Degree.json :: egov-hrms.Degree entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '45a1e960-5fef-4b39-8c72-c7a8c2e1a613'::uuid, 'pg', '2316bdafeb0a39c99e31bbfe849612e77c6a52d35c753aed828424b14978f0f0', 'egov-hrms.Degree', '{"active":true,"code":"LLB/LLM"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.Degree' AND uniqueidentifier = '2316bdafeb0a39c99e31bbfe849612e77c6a52d35c753aed828424b14978f0f0'
);

-- data/egov-hrms/egov-hrms.Degree.json :: egov-hrms.Degree entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e46bc463-dab0-42c8-a9ed-9e88b94c6f53'::uuid, 'pg', '9936d7ef572848d2de5277009738078d2b03ac79672a5df2d8c507845f61e45d', 'egov-hrms.Degree', '{"active":true,"code":"B.E/B.TECH."}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.Degree' AND uniqueidentifier = '9936d7ef572848d2de5277009738078d2b03ac79672a5df2d8c507845f61e45d'
);

-- data/egov-hrms/egov-hrms.Degree.json :: egov-hrms.Degree entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b9757844-0e6f-4a4d-830b-1e422b02a7b0'::uuid, 'pg', 'b2809648abbce98a1dc8d9d5d2ad74a3a7691cbc9d086a4f54732fd83ff3c4bb', 'egov-hrms.Degree', '{"active":true,"code":"M.A/M.COM./M.SC."}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.Degree' AND uniqueidentifier = 'b2809648abbce98a1dc8d9d5d2ad74a3a7691cbc9d086a4f54732fd83ff3c4bb'
);

-- data/egov-hrms/egov-hrms.Degree.json :: egov-hrms.Degree entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e7e97848-bb1f-4296-9a2f-b91f927fa8a9'::uuid, 'pg', '7c0e68dcb015611f4f8dbe2c2783d2648cdbb1526f6096bf21a990e9ab4f0f2f', 'egov-hrms.Degree', '{"active":true,"code":"M.E/M.TECH."}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.Degree' AND uniqueidentifier = '7c0e68dcb015611f4f8dbe2c2783d2648cdbb1526f6096bf21a990e9ab4f0f2f'
);

-- data/egov-hrms/egov-hrms.Degree.json :: egov-hrms.Degree entry #8
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7e25b246-566e-4a3b-a696-66c5afe34dd5'::uuid, 'pg', '99f048938981f201fd17749059149f7a84e1d666dcf8148e5e300a79064d032d', 'egov-hrms.Degree', '{"active":true,"code":"MBA/PGDM"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.Degree' AND uniqueidentifier = '99f048938981f201fd17749059149f7a84e1d666dcf8148e5e300a79064d032d'
);

-- data/egov-hrms/egov-hrms.Degree.json :: egov-hrms.Degree entry #9
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8319fbcf-f953-4937-90a6-9fa48e72844a'::uuid, 'pg', '8d8ea339f664379d2bed11843310d6a2d0730ff301c7232b0090b43a68bdb4c9', 'egov-hrms.Degree', '{"active":true,"code":"DOCTORATE"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.Degree' AND uniqueidentifier = '8d8ea339f664379d2bed11843310d6a2d0730ff301c7232b0090b43a68bdb4c9'
);

-- data/egov-hrms/egov-hrms.Degree.json :: egov-hrms.Degree entry #10
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ba2656ff-031b-454c-b919-2ce1802f47eb'::uuid, 'pg', '4e9a04fd6b4b85999100b17d07177db10c98aa73705cf661d6d5d5a3583bc2eb', 'egov-hrms.Degree', '{"active":true,"code":"OTHER"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.Degree' AND uniqueidentifier = '4e9a04fd6b4b85999100b17d07177db10c98aa73705cf661d6d5d5a3583bc2eb'
);

-- data/egov-hrms/egov-hrms.EmployeeStatus.json :: egov-hrms.EmployeeStatus entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cd9a9c7f-3584-4382-ac32-b91976b03c28'::uuid, 'pg', '8b411c00de85db3d1d4d80b70aba5249a8dc0dd7f7f60de90aa76f7298f9d8de', 'egov-hrms.EmployeeStatus', '{"active":true,"code":"EMPLOYED"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmployeeStatus' AND uniqueidentifier = '8b411c00de85db3d1d4d80b70aba5249a8dc0dd7f7f60de90aa76f7298f9d8de'
);

-- data/egov-hrms/egov-hrms.EmployeeStatus.json :: egov-hrms.EmployeeStatus entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '225b32ed-8cd1-4848-9ddd-b0e31256ddf2'::uuid, 'pg', '8664f8ef4381c13badcb369b7dd65b5d49fd144af905711a3a42c17485d7a3c4', 'egov-hrms.EmployeeStatus', '{"active":true,"code":"RETIRED"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmployeeStatus' AND uniqueidentifier = '8664f8ef4381c13badcb369b7dd65b5d49fd144af905711a3a42c17485d7a3c4'
);

-- data/egov-hrms/egov-hrms.EmployeeStatus.json :: egov-hrms.EmployeeStatus entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0fa12710-5c99-4a23-8782-bb35f65155e7'::uuid, 'pg', 'a8b8663396602477fcdfc56b1e48c616e3e7eb4a161b5e1ec60dfd72ae00e66c', 'egov-hrms.EmployeeStatus', '{"active":true,"code":"RESIGNED"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmployeeStatus' AND uniqueidentifier = 'a8b8663396602477fcdfc56b1e48c616e3e7eb4a161b5e1ec60dfd72ae00e66c'
);

-- data/egov-hrms/egov-hrms.EmployeeStatus.json :: egov-hrms.EmployeeStatus entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '625af874-de45-4efe-911e-060c0d68d312'::uuid, 'pg', '7dd579237c4fd4692186342416cfa2eb56a47c596cdf6f59798ea4457a69d111', 'egov-hrms.EmployeeStatus', '{"active":true,"code":"TERMINATED"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmployeeStatus' AND uniqueidentifier = '7dd579237c4fd4692186342416cfa2eb56a47c596cdf6f59798ea4457a69d111'
);

-- data/egov-hrms/egov-hrms.EmployeeStatus.json :: egov-hrms.EmployeeStatus entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '1cc0642c-4ffe-4333-a39a-c8baf33c2b28'::uuid, 'pg', '23e5afe43927be2db2956474caeb24032cfa17cf67e71767e241528933cf808e', 'egov-hrms.EmployeeStatus', '{"active":true,"code":"DECEASED"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmployeeStatus' AND uniqueidentifier = '23e5afe43927be2db2956474caeb24032cfa17cf67e71767e241528933cf808e'
);

-- data/egov-hrms/egov-hrms.EmployeeStatus.json :: egov-hrms.EmployeeStatus entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '94c6f8d3-7273-4fa8-8f63-fd413b7818c3'::uuid, 'pg', '9ca26b0b653416a237fd2763994ffce4f77e52610e5fb85ee380fa2d2724bbd9', 'egov-hrms.EmployeeStatus', '{"active":true,"code":"SUSPENDED"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmployeeStatus' AND uniqueidentifier = '9ca26b0b653416a237fd2763994ffce4f77e52610e5fb85ee380fa2d2724bbd9'
);

-- data/egov-hrms/egov-hrms.EmployeeStatus.json :: egov-hrms.EmployeeStatus entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '616e7fe2-7e3e-43e9-8330-bcf98e32d9b9'::uuid, 'pg', '76aa8231df2aa6682f49228aa1a1cea2e582b8430a9465148b026596924ab317', 'egov-hrms.EmployeeStatus', '{"active":true,"code":"TRANSFERRED"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmployeeStatus' AND uniqueidentifier = '76aa8231df2aa6682f49228aa1a1cea2e582b8430a9465148b026596924ab317'
);

-- data/egov-hrms/egov-hrms.EmployeeType.json :: egov-hrms.EmployeeType entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f7150848-3fc8-4209-97fe-d7b7edc37993'::uuid, 'pg', '2693ed6075326fa5afd36b63114b278bbe935d9616cc19a068106cf8c3d6011e', 'egov-hrms.EmployeeType', '{"active":true,"code":"PERMANENT"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmployeeType' AND uniqueidentifier = '2693ed6075326fa5afd36b63114b278bbe935d9616cc19a068106cf8c3d6011e'
);

-- data/egov-hrms/egov-hrms.EmployeeType.json :: egov-hrms.EmployeeType entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6a7d6544-717b-4fef-9c68-95222c2e9f6e'::uuid, 'pg', 'c919fff63c191a6083878f03e8a8ecb7d9484f36e13a89780ae992507048e54f', 'egov-hrms.EmployeeType', '{"active":true,"code":"TEMPORARY"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmployeeType' AND uniqueidentifier = 'c919fff63c191a6083878f03e8a8ecb7d9484f36e13a89780ae992507048e54f'
);

-- data/egov-hrms/egov-hrms.EmployeeType.json :: egov-hrms.EmployeeType entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ff3764ff-3f27-492d-a86b-aba01f4359b3'::uuid, 'pg', '37ae153e3a32d927f9d7ffe84a53886bb41dbccbaa0814186f3758645d5c9f40', 'egov-hrms.EmployeeType', '{"active":true,"code":"DAILYWAGES"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmployeeType' AND uniqueidentifier = '37ae153e3a32d927f9d7ffe84a53886bb41dbccbaa0814186f3758645d5c9f40'
);

-- data/egov-hrms/egov-hrms.EmployeeType.json :: egov-hrms.EmployeeType entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b9a3710f-9f98-4c93-b51f-3a8d036fc919'::uuid, 'pg', 'e0955c00cee8595331fc3dd3ba0e9f80245fbee0c530f8d44d5c0c045246ed9b', 'egov-hrms.EmployeeType', '{"active":true,"code":"CONTRACT"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmployeeType' AND uniqueidentifier = 'e0955c00cee8595331fc3dd3ba0e9f80245fbee0c530f8d44d5c0c045246ed9b'
);

-- data/egov-hrms/egov-hrms.EmployeeType.json :: egov-hrms.EmployeeType entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'aae3f98d-7012-4b87-b60a-fdb6c132d591'::uuid, 'pg', '80ec82fb712442603a5a492f23fccac277323025739565479212186fa8f53f5b', 'egov-hrms.EmployeeType', '{"active":true,"code":"DEPUTATION"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmployeeType' AND uniqueidentifier = '80ec82fb712442603a5a492f23fccac277323025739565479212186fa8f53f5b'
);

-- data/egov-hrms/egov-hrms.EmploymentTest.json :: egov-hrms.EmploymentTest entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'd25ccf9a-c14b-42cb-b220-f5f814ef9b7f'::uuid, 'pg', 'c8b7dc6d1eaa4b45fd95b1edea21a01572097078dcc698700b68f62d054b90f9', 'egov-hrms.EmploymentTest', '{"active":true,"code":"PRELIMS"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmploymentTest' AND uniqueidentifier = 'c8b7dc6d1eaa4b45fd95b1edea21a01572097078dcc698700b68f62d054b90f9'
);

-- data/egov-hrms/egov-hrms.EmploymentTest.json :: egov-hrms.EmploymentTest entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '5772e22a-b7e3-41a9-b3be-2f6173af11f3'::uuid, 'pg', 'ee1782e561e09eaac0046a0f250eaf78b6a144be6e5624f19d3d30013a253d49', 'egov-hrms.EmploymentTest', '{"active":true,"code":"APTITUDETEST"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmploymentTest' AND uniqueidentifier = 'ee1782e561e09eaac0046a0f250eaf78b6a144be6e5624f19d3d30013a253d49'
);

-- data/egov-hrms/egov-hrms.EmploymentTest.json :: egov-hrms.EmploymentTest entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8012b7e0-73dc-4b73-9209-366b822b52d9'::uuid, 'pg', 'b93a4314629dcd424d712e750bcebf718b9c8ea82bfa9240d9af8240b14973d8', 'egov-hrms.EmploymentTest', '{"active":true,"code":"MAINS"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.EmploymentTest' AND uniqueidentifier = 'b93a4314629dcd424d712e750bcebf718b9c8ea82bfa9240d9af8240b14973d8'
);

-- data/egov-hrms/egov-hrms.Specalization.json :: egov-hrms.Specalization entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e71837f1-b810-4fcc-ad15-d14df78c9735'::uuid, 'pg', '7b478258536577d39e5db64bce94ca34c40d25f19a1eee0402afdfa32ad42821', 'egov-hrms.Specalization', '{"active":true,"code":"ARTS"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.Specalization' AND uniqueidentifier = '7b478258536577d39e5db64bce94ca34c40d25f19a1eee0402afdfa32ad42821'
);

-- data/egov-hrms/egov-hrms.Specalization.json :: egov-hrms.Specalization entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '33ad5e8c-4599-403d-9efe-d1ec3b039f85'::uuid, 'pg', '526bf7290e8e640c695326eac7e244445f71ca423d14e8b4a79a19e7db74a22c', 'egov-hrms.Specalization', '{"active":true,"code":"SCIENCE"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'egov-hrms.Specalization' AND uniqueidentifier = '526bf7290e8e640c695326eac7e244445f71ca423d14e8b4a79a19e7db74a22c'
);

-- data/inbox-v2/INBOX.InboxQueryConfiguration.json :: INBOX.InboxQueryConfiguration entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '80d0d0f6-0521-4f99-bde0-1926e51b35f7'::uuid, 'pg', 'b7963f8371fea0aae1fb0be623c75d72ec11bfb258fbf2824e6bdae4b3378d99', 'INBOX.InboxQueryConfiguration', '{"allowedSearchCriteria":[{"isMandatory":false,"name":"area","operator":"EQUAL","path":"Data.service.address.locality.code.keyword"},{"isMandatory":false,"name":"status","operator":"EQUAL","path":"Data.currentProcessInstance.state.uuid.keyword"},{"isMandatory":false,"name":"assignedToMe","operator":"EQUAL","path":"Data.workflow.assignes.*.uuid.keyword"},{"isMandatory":false,"name":"fromDate","operator":"GTE","path":"Data.service.auditDetails.createdTime"},{"isMandatory":false,"name":"toDate","operator":"LTE","path":"Data.service.auditDetails.createdTime"},{"isMandatory":false,"name":"complaintNumber","operator":"EQUAL","path":"Data.service.serviceRequestId.keyword"},{"isMandatory":false,"name":"mobileNumber","operator":"EQUAL","path":"Data.service.citizen.mobileNumber.keyword"},{"isMandatory":false,"name":"tenantId","operator":"EQUAL","path":"Data.service.tenantId.keyword"},{"isMandatory":false,"name":"assignee","operator":"EQUAL","path":"Data.currentProcessInstance.assignes.uuid.keyword"}],"index":"inbox-pgr-services","module":"RAINMAKER-PGR","sortBy":{"defaultOrder":"ASC","path":"Data.service.auditDetails.createdTime"},"sourceFilterPathList":["Data.currentProcessInstance","Data.service.serviceRequestId","Data.service.address.locality.code","Data.service.applicationStatus","Data.service.citizen","Data.service.auditDetails.createdTime","Data.auditDetails","Data.tenantId"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'INBOX.InboxQueryConfiguration' AND uniqueidentifier = 'b7963f8371fea0aae1fb0be623c75d72ec11bfb258fbf2824e6bdae4b3378d99'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '0eb85ed7-fb61-4d86-a803-08ab1e4d86e6'::uuid, 'pg', '618236d9e50cae30d3ffc09509cce2d23c2f63cea5a2c402ef1022a634c5a928', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_10","keywords":"other, miscellaneous,ad,playgrounds,burial,slaughterhouse, misc, tax, revenue","menuPath":"","name":"Others","order":6,"serviceCode":"Others","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '618236d9e50cae30d3ffc09509cce2d23c2f63cea5a2c402ef1022a634c5a928'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '200a5d2c-6326-4465-ad50-1028ed9973d7'::uuid, 'pg', '3209714d2eb0424463febe037709d1a05dadcb2d44c56fac7ab0b2eb63f61b57', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_5","keywords":"open, defecation, waste, human, privy, toilet","menuPath":"Parks","name":"Park requires maintenance","serviceCode":"ParkRequiresMaintenance","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '3209714d2eb0424463febe037709d1a05dadcb2d44c56fac7ab0b2eb63f61b57'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4dddf16f-bb81-4b95-9aa6-a92fe084d9ba'::uuid, 'pg', '8b75d2734e008e4eeb3c01eb19b9fd620efc211c30f2528d07d6c5212074cc96', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_3","keywords":"open, defecation, waste, human, privy, toilet","menuPath":"OpenDefecation","name":"Open Defecation","serviceCode":"OpenDefecation","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '8b75d2734e008e4eeb3c01eb19b9fd620efc211c30f2528d07d6c5212074cc96'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '86cc3524-d84d-449a-93f2-2cb69c396bc1'::uuid, 'pg', 'fde2581b6ae874a3ebfc7292873e1520d170d9bfda54b601b7bc132ecc12545a', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_5","keywords":"tree, remove, trim, fallen, cut, plant, branch","menuPath":"Trees","name":"Cutting/trimming of tree required","serviceCode":"CuttingOrTrimmingOfTreeRequired","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'fde2581b6ae874a3ebfc7292873e1520d170d9bfda54b601b7bc132ecc12545a'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3b801a2f-6a60-4174-8123-ebc770f0bb75'::uuid, 'pg', 'c4c18a87679b920a67de5e2bcef58f2bf53cdc69b8007e69f1414dfa24e85283', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_5","keywords":"tree, cut, illegal, unathourized, remove, plant","menuPath":"Trees","name":"Illegal Cutting of trees","serviceCode":"IllegalCuttingOfTrees","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'c4c18a87679b920a67de5e2bcef58f2bf53cdc69b8007e69f1414dfa24e85283'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b7a02ea9-0715-4901-be05-87f13ddf123d'::uuid, 'pg', 'd13784be2b06cb1f1fd02aaaf3955221081e1ea6cefc785b4331598489954a1c', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_6","keywords":"illegal, parking, car, vehicle, space, removal, road, street, vehicle","menuPath":"LandViolations","name":"Illegal parking","serviceCode":"IllegalParking","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'd13784be2b06cb1f1fd02aaaf3955221081e1ea6cefc785b4331598489954a1c'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a7b5ddea-e0e4-41d5-9e87-b914d8e9d254'::uuid, 'pg', 'acfc88dcf316fb72ea7b8e7ab2fb75f3c9fd27d09da48ef948a9bb05f3e4f8cc', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_6","keywords":"illegal, violation, property, public, space, land, unathourised, site, construction, wrong, build","menuPath":"LandViolations","name":"Illegal constructions","serviceCode":"IllegalConstructions","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'acfc88dcf316fb72ea7b8e7ab2fb75f3c9fd27d09da48ef948a9bb05f3e4f8cc'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #8
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4fc80e51-0213-4f32-9ad4-f5f7afe2f0c9'::uuid, 'pg', '08bcfcc187c07ab8360741ce8b415933386610b616aaa7b5a8e79e6215bd8e11', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_6","keywords":"illegal, shop, footpath, violation, property, public, space, land, unathourised, site, construction, wrong","menuPath":"LandViolations","name":"Illegal shops on footpath","serviceCode":"IllegalShopsOnFootPath","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '08bcfcc187c07ab8360741ce8b415933386610b616aaa7b5a8e79e6215bd8e11'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #9
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '457ca570-3057-46f7-b393-ba9edddbdee5'::uuid, 'pg', '52c5dfbce2e9c8b2bd1a163fce7eedadba2c3ada55c2fa7dc60dda6c381c41ed', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_3","keywords":"toilet, public, restroom, bathroom, urinal, electricity, water, working","menuPath":"PublicToilets","name":"No water/electricity in public toilet","serviceCode":"NoWaterOrElectricityinPublicToilet","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '52c5dfbce2e9c8b2bd1a163fce7eedadba2c3ada55c2fa7dc60dda6c381c41ed'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #10
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'db69c436-afe4-415c-b769-98c42faa296f'::uuid, 'pg', '71a153d1fead021601206a7f75819c1290727db0480fff4362725cde18a28ccb', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_3","keywords":"toilet, public, restroom, bathroom, urinal, block, working","menuPath":"PublicToilets","name":"Public toilet damaged","serviceCode":"PublicToiletIsDamaged","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '71a153d1fead021601206a7f75819c1290727db0480fff4362725cde18a28ccb'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #11
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '6289c23e-abde-4841-8c03-e967f73caa79'::uuid, 'pg', '98028661d2544afb899cfef5b3801d13d351f443affd7d21fc25077d3d923e57', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_3","keywords":"toilet, public, restroom, bathroom, urinal, smell, dirty","menuPath":"PublicToilets","name":"Dirty/smelly public toilet","serviceCode":"DirtyOrSmellyPublicToilets","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '98028661d2544afb899cfef5b3801d13d351f443affd7d21fc25077d3d923e57'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #12
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7d5c2e51-e2e2-44a1-993b-0d955e880471'::uuid, 'pg', 'cd31f8eabdd1453409c4438fef3b64ad5a4537292442d6db0def4f3ead948d3b', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_3","keywords":"stray, cow, cows, cattle, bull, bulls, graze, grazing, dung, menace","menuPath":"Animals","name":"Dead animals","serviceCode":"DeadAnimals","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'cd31f8eabdd1453409c4438fef3b64ad5a4537292442d6db0def4f3ead948d3b'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #13
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e2e4f1d4-2d36-43ec-bd4c-896aa60653f7'::uuid, 'pg', '6437703971569eb090fe603cdb6cf8d172e83eebb2d814089f330c68a90fe89c', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_3","keywords":"stray, dog, dogs, menace, animal, animals, attack, attacking, bite, biting, bark, barking","menuPath":"Animals","name":"Stray animals","serviceCode":"StrayAnimals","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '6437703971569eb090fe603cdb6cf8d172e83eebb2d814089f330c68a90fe89c'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #14
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '567adebd-9cab-4c22-b180-72fa99844167'::uuid, 'pg', '3b99e7f9ef22310d79294d0882ba37fdcdc5758912d9b52a4a367aa67eb69a8b', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_3","keywords":"mosquito, menace, fog, spray, kill, health, dengue, malaria, disease, clean","menuPath":"Mosquitos","name":"Request spraying/ fogging operations","serviceCode":"RequestSprayingOrFoggingOperation","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '3b99e7f9ef22310d79294d0882ba37fdcdc5758912d9b52a4a367aa67eb69a8b'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #15
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '4a3a727a-59be-45cf-a4e1-15ef1a153cf1'::uuid, 'pg', '7369b4e6aaaac7c675933f7b6ed83ae430a7e838910ddff84593d97b776545f8', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"illegal, shop, footpath, walk, remove, occupy, path","menuPath":"RoadsAndFootpaths","name":"Construction material lying on the road","serviceCode":"ConstructionMaterialLyingOntheRoad","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '7369b4e6aaaac7c675933f7b6ed83ae430a7e838910ddff84593d97b776545f8'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #16
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cdcb74eb-81f0-4170-a6dd-c575537c52fc'::uuid, 'pg', '605198eb5c17c2730aaeda35f8e08af766816edc20108b2fa9e881737f4641a5', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"footpath, repair, broken, surface, damage, patch, hole, maintenance, walk, path","menuPath":"RoadsAndFootpaths","name":"Damaged/blocked footpath","serviceCode":"DamagedOrBlockedFootpath","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '605198eb5c17c2730aaeda35f8e08af766816edc20108b2fa9e881737f4641a5'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #17
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2bea4554-0271-4eb6-86d0-5bbada247c50'::uuid, 'pg', '5108cd9845f39676ca27c01c9318e9bfa8f94b04e7134bfeb8a2021fce17e07a', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"road, street, manhole, hole, cover, lid, footpath, open, man, drainage, damage, repair, fix","menuPath":"RoadsAndFootpaths","name":"Manhole cover is missing/damaged","serviceCode":"ManholeCoverMissingOrDamaged","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '5108cd9845f39676ca27c01c9318e9bfa8f94b04e7134bfeb8a2021fce17e07a'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #18
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fe672748-67f4-4bd9-8088-6b0963d66703'::uuid, 'pg', 'a8e2093b11f4cf933c4793a107ee653069283ac886abc462ff157ac7169c6307', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"road, drainage, water, block, puddle, street, flood, overflow, rain","menuPath":"RoadsAndFootpaths","name":"Water logged road","serviceCode":"WaterLoggedRoad","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'a8e2093b11f4cf933c4793a107ee653069283ac886abc462ff157ac7169c6307'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #19
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '55c86529-f026-435a-94df-1c3fd9ad13a1'::uuid, 'pg', 'dbd2af1cf0ecbcd6c1cc0ac53eb99e7189637d77bc978122a66806476d12cb26', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"road, damage, hole, surface, repair, patch, broken, maintenance, street, construction, fix","menuPath":"RoadsAndFootpaths","name":"Damaged road","serviceCode":"DamagedRoad","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'dbd2af1cf0ecbcd6c1cc0ac53eb99e7189637d77bc978122a66806476d12cb26'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #20
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'fb47bf88-b426-42e4-87dc-32099b2bd608'::uuid, 'pg', 'c1509b5e9b213a67458a8cf5e73b4442c48db2158f94e1da655d2f2064c61048', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"water, supply, connection, damage, repair, broken, pipe, piping, tap","menuPath":"WaterandSewage","name":"Water pressure is very less","serviceCode":"WaterPressureisVeryLess","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'c1509b5e9b213a67458a8cf5e73b4442c48db2158f94e1da655d2f2064c61048'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #21
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'cebb1165-5568-469f-b23a-9dff215f7d2d'::uuid, 'pg', 'acb340a9ff7ae2d77259c882dda51c5abc8bb142b486b1f26b1072e4cf8a8a44', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"water, supply, connection, damage, repair, broken, pipe, piping, tap","menuPath":"WaterandSewage","name":"Broken water pipe / Leakage","order":3,"serviceCode":"BrokenWaterPipeOrLeakage","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'acb340a9ff7ae2d77259c882dda51c5abc8bb142b486b1f26b1072e4cf8a8a44'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #22
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '3c57b210-9bf8-4e1e-a7df-e168db07c59c'::uuid, 'pg', 'b5fb30535085de936a29538389630800739f8722ee3c60457a4bfc1e4b886b7c', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"water, supply, connection, drink, dirty, contaminated, impure, health, clean","menuPath":"WaterandSewage","name":"Dirty water supply","serviceCode":"DirtyWaterSupply","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'b5fb30535085de936a29538389630800739f8722ee3c60457a4bfc1e4b886b7c'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #23
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '9ac108de-8a8a-4784-bd26-3c285bb35038'::uuid, 'pg', 'e546182e78b1205318256ac994a0f202f36b3ba4bbbe3bf06a165777fd34dc1b', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"water, supply, connection, drink, tap","menuPath":"WaterandSewage","name":"No water supply","serviceCode":"NoWaterSupply","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'e546182e78b1205318256ac994a0f202f36b3ba4bbbe3bf06a165777fd34dc1b'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #24
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '73a53952-75a2-435a-a54d-da5dedad4366'::uuid, 'pg', '8172c4f6af02aa670ff3988527fdd8e2431c493488d162d743f95ed91ce28cfb', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"water, supply, shortage, drink, tap, connection,leakage,less","menuPath":"WaterandSewage","name":"Shortage of water","serviceCode":"ShortageOfWater","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '8172c4f6af02aa670ff3988527fdd8e2431c493488d162d743f95ed91ce28cfb'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #25
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '13a41f7e-65a7-4c45-87a8-b62ce3c327a4'::uuid, 'pg', 'eaf8f7b12778e92822bc189d66eb68d32cf5452501a6f754a78d912fc9d8357e', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"water, supply, connection, damage, repair, broken, pipe, piping, tap","menuPath":"WaterandSewage","name":"Block / Overflowing sewage","order":2,"serviceCode":"BlockOrOverflowingSewage","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'eaf8f7b12778e92822bc189d66eb68d32cf5452501a6f754a78d912fc9d8357e'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #26
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'ce628b6c-6391-43d4-9f98-b38aefd8bf85'::uuid, 'pg', 'e2fa26754783d193afe9f910b5552cdf8a7f4dba65500faa8ae4152c70424a93', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"water, supply, connection, damage, repair, broken, pipe, piping, tap","menuPath":"WaterandSewage","name":"Illegal discharge of sewage","serviceCode":"illegalDischargeOfSewage","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'e2fa26754783d193afe9f910b5552cdf8a7f4dba65500faa8ae4152c70424a93'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #27
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '38f3867d-b46a-4827-8084-6a94e66b3f53'::uuid, 'pg', 'fe3cc5febeca4a53e4d15fa0e81be3d6c69b5d5a8f466d3abb74eda04fbf827a', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_4","keywords":"drain, block, clean, debris, silt, drainage, water, clean, roadside, flow, remove, waste, garbage, clear, overflow, canal, fill, stagnate, rain, sanitation, sand, pipe, clog, stuck","menuPath":"Drains","name":"Overflowing/Blocked drain","serviceCode":"OverflowingOrBlockedDrain","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'fe3cc5febeca4a53e4d15fa0e81be3d6c69b5d5a8f466d3abb74eda04fbf827a'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #28
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '78a8ff27-6009-43ba-99d7-8a2f8e517fc5'::uuid, 'pg', 'be5eda57a41acf74b015df1a4b24e5a175eda088833515ec7825788715820de2', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_3","keywords":"garbage, remove, burn, fire, health, waste, smoke, plastic, illegal","menuPath":"Garbage","name":"Burning of garbage","serviceCode":"BurningOfGarbage","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'be5eda57a41acf74b015df1a4b24e5a175eda088833515ec7825788715820de2'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #29
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8dc80e12-47c3-4abf-a460-304cf979e8d8'::uuid, 'pg', 'd0d9fb62d6848179c23f4e4c9f0ff09f2156a1b47fe5b39b4e2a346056670f88', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_3","keywords":"garbage, waste, bin, dustbin, clean, remove, sanitation, overflow, smell, health, throw, dispose","menuPath":"Garbage","name":"Damaged garbage bin","serviceCode":"DamagedGarbageBin","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'd0d9fb62d6848179c23f4e4c9f0ff09f2156a1b47fe5b39b4e2a346056670f88'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #30
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '49e6b340-f4b7-47dc-9f19-9917af943dd8'::uuid, 'pg', 'e9a1b5b0512ce027fa62d39b67900dd216bd582ca85d08535f66ef4f45afe878', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_3","keywords":"garbage, collect, litter, clean, door, waste, remove, sweeper, sanitation, dump, health, debris, throw","menuPath":"Garbage","name":"Garbage needs to be cleared","order":4,"serviceCode":"GarbageNeedsTobeCleared","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'e9a1b5b0512ce027fa62d39b67900dd216bd582ca85d08535f66ef4f45afe878'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #31
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c8e54525-c25a-4424-bb74-00e7429fb0fb'::uuid, 'pg', 'e950e23e70f51e054882787770097f64e41352a334f02eb8d0545a57bf98a67c', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_1","keywords":"streetlight, light, repair, work, pole, electric, power, repair, fix","menuPath":"StreetLights","name":"Streetlight not working","order":1,"serviceCode":"StreetLightNotWorking","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'e950e23e70f51e054882787770097f64e41352a334f02eb8d0545a57bf98a67c'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #32
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7117299d-5a8d-4617-8657-8ec06368bca1'::uuid, 'pg', 'b222848808278f4f692118befce1e677df2c27e5bb963220aabacb88e0ecde48', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_3","keywords":"garbage, collect, litter, clean, door, waste, remove, sweeper, sanitation, dump, health, debris, throw","menuPath":"Garbage","name":"Non sweeping of road","order":5,"serviceCode":"NonSweepingOfRoad","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = 'b222848808278f4f692118befce1e677df2c27e5bb963220aabacb88e0ecde48'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json :: RAINMAKER-PGR.ServiceDefs entry #33
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '344495fc-c324-4923-b8b4-b8f44eda6093'::uuid, 'pg', '49b2ab679a5b95b6334884b2b0391f1cdd7cdab8dd476be8380a8c22f23e481a', 'RAINMAKER-PGR.ServiceDefs', '{"active":true,"department":"DEPT_1","keywords":"streetlight, light, repair, work, pole, electric, power, repair, damage, fix","menuPath":"StreetLights","name":"No streetlight","serviceCode":"NoStreetlight","slaHours":336}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.ServiceDefs' AND uniqueidentifier = '49b2ab679a5b95b6334884b2b0391f1cdd7cdab8dd476be8380a8c22f23e481a'
);

-- data/RAINMAKER-PGR/RAINMAKER-PGR.UIConstants.json :: RAINMAKER-PGR.UIConstants entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'bcbaec41-909d-47ff-b495-c43cd90f0095'::uuid, 'pg', 'cc59ecfba912b1fa3df332fbf36038931503b17dfc8398bf2e04c35431d7bf0e', 'RAINMAKER-PGR.UIConstants', '{"REOPENSLA":432000000}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'RAINMAKER-PGR.UIConstants' AND uniqueidentifier = 'cc59ecfba912b1fa3df332fbf36038931503b17dfc8398bf2e04c35431d7bf0e'
);

-- data/tenant/tenant.citymodule.json :: tenant.citymodule entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '8dc76ad4-dfc4-4ba6-9bb6-1b026ef1c69f'::uuid, 'pg', '43b53bde3abdfb2f034bbd43e5705add60fbdf6dafdd6201f021adbdca907834', 'tenant.citymodule', '{"active":true,"code":"Workbench","module":"Workbench","order":13,"tenants":[{"code":"pg.cityb"},{"code":"pg.cityc"},{"code":"pg.citya"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'tenant.citymodule' AND uniqueidentifier = '43b53bde3abdfb2f034bbd43e5705add60fbdf6dafdd6201f021adbdca907834'
);

-- data/tenant/tenant.citymodule.json :: tenant.citymodule entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'b9e3602f-93a4-4bff-a33d-13c7a37d6ddd'::uuid, 'pg', 'd9868411078f0cb5f54bbb65772a65786ad585ec888bdc465545205c6da22b1f', 'tenant.citymodule', '{"active":true,"code":"PGR","module":"PGR","order":2,"tenants":[{"code":"pg.citya"},{"code":"pg.cityb"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'tenant.citymodule' AND uniqueidentifier = 'd9868411078f0cb5f54bbb65772a65786ad585ec888bdc465545205c6da22b1f'
);

-- data/tenant/tenant.citymodule.json :: tenant.citymodule entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'abfd3107-2234-4df7-921b-dc270dbcecbb'::uuid, 'pg', 'e8e4c0b369aec423c9f50a87e2e8adfb84115951ccb375583435681ea9a57158', 'tenant.citymodule', '{"active":true,"code":"HRMS","module":"HRMS","order":2,"tenants":[{"code":"pg"},{"code":"pg.citya"},{"code":"pg.cityb"}]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'tenant.citymodule' AND uniqueidentifier = 'e8e4c0b369aec423c9f50a87e2e8adfb84115951ccb375583435681ea9a57158'
);

-- data/tenant/tenant.tenants.json :: tenant.tenants entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'aa330faa-55c0-4b96-a936-b796f37a090a'::uuid, 'pg', '5190036c90bc19082e2a1cda0c8e3b30e40fbce184cebc12fac476dae11eaa88', 'tenant.tenants', '{"OfficeTimings":{"Mon - Fri":"9.00 AM - 6.00 PM"},"address":"City A Municipal Corporation","city":{"captcha":null,"code":"1013","ddrName":"DDR A","districtCode":"CITYA","districtName":null,"districtTenantCode":"pg.citya","latitude":31.3260152,"localName":null,"longitude":75.5761829,"name":"City A","regionName":null,"shapeFileLocation":null,"ulbGrade":"Municipal Corporation"},"code":"pg.citya","contactNumber":"001-2345876","description":"City A","domainUrl":"https://www.egovernments.org","emailId":"citya@gmail.com","facebookUrl":null,"imageId":null,"logoId":"https://s3.ap-south-1.amazonaws.com/pg-egov-assets/pg.citya/logo.png","name":"City A","pincode":[143001,143002,143003,143004,143005],"twitterUrl":null,"type":"CITY"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'tenant.tenants' AND uniqueidentifier = '5190036c90bc19082e2a1cda0c8e3b30e40fbce184cebc12fac476dae11eaa88'
);

-- data/tenant/tenant.tenants.json :: tenant.tenants entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'c484e9d2-acf9-4aad-8af7-802f3e2771ac'::uuid, 'pg', '33552d7944d29db95d3abfda24a528d39c715f4852c7e4181f62271ccdc8c6ef', 'tenant.tenants', '{"OfficeTimings":{"Mon - Fri":"9.00 AM - 6.00 PM","Sat":"9.00 AM - 12.00 PM"},"address":"City B Municipal Corporation Address","city":{"captcha":null,"code":"107","ddrName":"DDR A","districtCode":"CITYB","districtName":null,"districtTenantCode":"pg.cityb","latitude":31.6339793,"localName":null,"longitude":74.8722642,"name":"City B","regionName":null,"shapeFileLocation":null,"ulbGrade":"Municipal Corporation"},"code":"pg.cityb","contactNumber":"0978-7645345","description":null,"domainUrl":"https://www.egovernments.org","emailId":"cityb@gmail.com","facebookUrl":null,"helpLineNumber":"0654-8734567","imageId":null,"logoId":"https://s3.ap-south-1.amazonaws.com/pg-egov-assets/pg.cityb/logo.png","name":"City B","pincode":[143006,143007,143008,143009,143010],"twitterUrl":null,"type":"CITY"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'tenant.tenants' AND uniqueidentifier = '33552d7944d29db95d3abfda24a528d39c715f4852c7e4181f62271ccdc8c6ef'
);

-- data/Workflow/Workflow.AutoEscalation.json :: Workflow.AutoEscalation entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'a574ffa2-7fc8-4e3e-ad5e-1ad471102e7f'::uuid, 'pg', '2969fb4c4ae232596b22164079ca4cf380f19e374c4c77e7ed6464940f48fb88', 'Workflow.AutoEscalation', '{"action":"CLOSE","active":"true","businessSLA":3456,"businessService":"Incident_Low","module":"im-services","state":"RESOLVED","stateSLA":3.0,"topic":"im-auto-escalation"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.AutoEscalation' AND uniqueidentifier = '2969fb4c4ae232596b22164079ca4cf380f19e374c4c77e7ed6464940f48fb88'
);

-- data/Workflow/Workflow.AutoEscalation.json :: Workflow.AutoEscalation entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7a7009c6-cf3a-4432-8784-4ab98d507e1c'::uuid, 'pg', '98959aa499a61bbc80622b6da60518575c9f9c51e44b3e4d28e7b5908c3360a0', 'Workflow.AutoEscalation', '{"action":"CLOSE","active":"true","businessSLA":3456,"businessService":"Incident_High","module":"im-services","state":"RESOLVED","stateSLA":3.0,"topic":"im-auto-escalation"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.AutoEscalation' AND uniqueidentifier = '98959aa499a61bbc80622b6da60518575c9f9c51e44b3e4d28e7b5908c3360a0'
);

-- data/Workflow/Workflow.AutoEscalation.json :: Workflow.AutoEscalation entry #3
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'e62a9d33-fcfd-4082-bf7c-f6f790ba299f'::uuid, 'pg', '786866b748f890543815efaa9eb51e4ef8202b1ef6c7e9e7e74d6cf7fee2db8e', 'Workflow.AutoEscalation', '{"action":"CLOSE","active":"true","businessSLA":3456,"businessService":"Incident_Medium","module":"im-services","state":"RESOLVED","stateSLA":3.0,"topic":"im-auto-escalation"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.AutoEscalation' AND uniqueidentifier = '786866b748f890543815efaa9eb51e4ef8202b1ef6c7e9e7e74d6cf7fee2db8e'
);

-- data/Workflow/Workflow.AutoEscalation.json :: Workflow.AutoEscalation entry #4
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '17f89aa7-914b-4d6e-9a9b-9f1275e5239e'::uuid, 'pg', '7393b27167aba1ffd72c39f23f716e9abe0fb8df087986132a2913070a6b7435', 'Workflow.AutoEscalation', '{"action":"CLOSE","active":"true","businessSLA":3456,"businessService":"Incident_Medium","module":"im-services","state":"REJECTED","stateSLA":3.0,"topic":"im-auto-escalation"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.AutoEscalation' AND uniqueidentifier = '7393b27167aba1ffd72c39f23f716e9abe0fb8df087986132a2913070a6b7435'
);

-- data/Workflow/Workflow.AutoEscalation.json :: Workflow.AutoEscalation entry #5
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '2d51fab4-1680-4299-b686-4393c6746b9a'::uuid, 'pg', '368fdd609141af0607041efc8aa5c78e72728b454d1fb097fe27e9bbd698cc96', 'Workflow.AutoEscalation', '{"action":"CLOSE","active":"true","businessSLA":3456,"businessService":"Incident_High","module":"im-services","state":"REJECTED","stateSLA":3.0,"topic":"im-auto-escalation"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.AutoEscalation' AND uniqueidentifier = '368fdd609141af0607041efc8aa5c78e72728b454d1fb097fe27e9bbd698cc96'
);

-- data/Workflow/Workflow.AutoEscalation.json :: Workflow.AutoEscalation entry #6
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'f2cfe0ad-559c-4db3-917d-33e6a48279f4'::uuid, 'pg', 'c22b9381989ae635ef9656d04e51cee93eb21e605377ed07fba1c416b500d987', 'Workflow.AutoEscalation', '{"action":"CLOSE","active":"true","businessSLA":3456,"businessService":"Incident_Low","module":"im-services","state":"REJECTED","stateSLA":3.0,"topic":"im-auto-escalation"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.AutoEscalation' AND uniqueidentifier = 'c22b9381989ae635ef9656d04e51cee93eb21e605377ed07fba1c416b500d987'
);

-- data/Workflow/Workflow.AutoEscalation.json :: Workflow.AutoEscalation entry #7
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT 'efd2a7b4-d741-4e2b-9e34-8ad0750f05a3'::uuid, 'pg', '3105717cefc051556656659c6cd1ffcd94eec00ab897f600301fd9b917ef8a37', 'Workflow.AutoEscalation', '{"action":"CLOSE","active":"true","businessSLA":3456,"businessService":"Incident","module":"im-services","state":"REJECTED","stateSLA":3.0,"topic":"im-auto-escalation"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.AutoEscalation' AND uniqueidentifier = '3105717cefc051556656659c6cd1ffcd94eec00ab897f600301fd9b917ef8a37'
);

-- data/Workflow/Workflow.AutoEscalation.json :: Workflow.AutoEscalation entry #8
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '518f9fab-271b-47bd-bdd0-c387b1634b1b'::uuid, 'pg', 'cbe1dba7315c3461fe04a85c8bee4931e5980df926646856a43954079b466fff', 'Workflow.AutoEscalation', '{"action":"CLOSE","active":"true","businessSLA":3456,"businessService":"Incident","module":"im-services","state":"RESOLVED","stateSLA":3.0,"topic":"im-auto-escalation"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.AutoEscalation' AND uniqueidentifier = 'cbe1dba7315c3461fe04a85c8bee4931e5980df926646856a43954079b466fff'
);

-- data/Workflow/Workflow.AutoEscalationStatesToIgnore.json :: Workflow.AutoEscalationStatesToIgnore entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '56039d41-c9f5-42f0-823c-8112e69fcc45'::uuid, 'pg', 'c38ce6813d86df987616cc4d1a80b301c3141b0b71b73d76734e5beeda4fe3fc', 'Workflow.AutoEscalationStatesToIgnore', '{"businessService":"NewTL","module":"TL","state":["INITIATED","PENDINGAPPROVAL"]}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.AutoEscalationStatesToIgnore' AND uniqueidentifier = 'c38ce6813d86df987616cc4d1a80b301c3141b0b71b73d76734e5beeda4fe3fc'
);

-- data/Workflow/Workflow.BusinessService.json :: Workflow.BusinessService entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '47215ddc-cdc9-4021-81ef-9b6137c9123a'::uuid, 'pg', 'e08f0fc8b81e33183a57e2d0fdf93aefb2a75b1c10208502e948a55ea39cd673', 'Workflow.BusinessService', '{"businessService":"NewTL","getUri":"","postUri":"","states":[{"UpdateAllowed":"false","actions":[{"action":"APPLY","nextStateId":"bf5fd8c8-f7df-11e8-8eb2-f2801f1b9fd1","roles":"CITIZEN,TL_CEMP","stateId":"bf5fd4f4-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd0f10a-f7d3-11e8-8eb2-f2801f1b9fd1"}],"applicableActions":"INITIATE","applicableNextStates":"APPLIED","businessServiceId":"NewTL","docUploadRequired":"false","isStartState":"true","isTerminateState":"false","state":"INITIATED","tenantId":"pg","uuid":"bf5fd4f4-f7df-11e8-8eb2-f2801f1b9fd1"},{"UpdateAllowed":"true","actions":[{"action":"PAY","nextStateId":"bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1","roles":"SYSTEM_PAYMENT","stateId":"bf5fd8c8-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd0f2a4-f7d3-11e8-8eb2-f2801f1b9fd1"},{"action":"CANCEL","nextStateId":"bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1","roles":"CLERK","stateId":"bf5fd8c8-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd0f3ee-f7d3-11e8-8eb2-f2801f1b9fd1"},{"action":"REJECT","nextStateId":"bf5fe318-f7df-11e8-8eb2-f2801f1b9fd1","roles":"CLERK","stateId":"bf5fd8c8-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd0f524-f7d3-11e8-8eb2-f2801f1b9fd1"},{"action":"APPROVE","nextStateId":"bf5fdfbc-f7df-11e8-8eb2-f2801f1b9fd1","roles":"TL_APPROVER","stateId":"bf5fe444-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"543f802e-f952-11e8-8eb2-f2801f1b9fd1"}],"applicableActions":"Reject,Pay,Cancel,Mark","applicableNextStates":"Paid,Cancelled,Rejected","businessServiceId":"NewTL","docUploadRequired":"false","isStartState":"false","isTerminateState":"false","state":"APPLIED","tenantId":"pg","uuid":"bf5fd8c8-f7df-11e8-8eb2-f2801f1b9fd1"},{"UpdateAllowed":"true","actions":[{"action":"CANCEL","nextStateId":"bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1","roles":"CLERK","stateId":"bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd0faa6-f7d3-11e8-8eb2-f2801f1b9fd1"},{"action":"REJECT","nextStateId":"bf5fe318-f7df-11e8-8eb2-f2801f1b9fd1","roles":"CLERK","stateId":"bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd0fc54-f7d3-11e8-8eb2-f2801f1b9fd1"},{"action":"MARK","nextStateId":"bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1","roles":"CLERK","stateId":"bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd0feac-f7d3-11e8-8eb2-f2801f1b9fd1"},{"action":"FORWARD","nextStateId":"bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1","roles":"CLERK","stateId":"bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd10136-f7d3-11e8-8eb2-f2801f1b9fd1"}],"applicableActions":"Approve,Cancel,Reject,Mark","applicableNextStates":"Intermediate","businessServiceId":"NewTL","docUploadRequired":"false","isStartState":"false","isTerminateState":"false","state":"PAID","tenantId":"pg","uuid":"bf5fdaee-f7df-11e8-8eb2-f2801f1b9fd1"},{"UpdateAllowed":"","actions":[{"action":"CANCEL","nextStateId":"bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1","roles":"TL_FIELD_INSPECTOR","stateId":"bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd1041a-f7d3-11e8-8eb2-f2801f1b9fd1"},{"action":"REJECT","nextStateId":"bf5fe318-f7df-11e8-8eb2-f2801f1b9fd1","roles":"TL_FIELD_INSPECTOR","stateId":"bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd1064a-f7d3-11e8-8eb2-f2801f1b9fd1"},{"action":"MARK","nextStateId":"bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1","roles":"TL_FIELD_INSPECTOR","stateId":"bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd108ac-f7d3-11e8-8eb2-f2801f1b9fd1"},{"action":"FORWARD","nextStateId":"bf5fe444-f7df-11e8-8eb2-f2801f1b9fd1","roles":"TL_FIELD_INSPECTOR","stateId":"bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd10de8-f7d3-11e8-8eb2-f2801f1b9fd1"}],"applicableActions":"","applicableNextStates":"Approved,Cancelled,Rejected","businessServiceId":"NewTL","docUploadRequired":"","isStartState":"false","isTerminateState":"false","state":"FIELDINSPECTION","tenantId":"pg","uuid":"bf5fdd28-f7df-11e8-8eb2-f2801f1b9fd1"},{"UpdateAllowed":"true","actions":[{"action":"CANCEL","nextStateId":"bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1","roles":"TL_APPROVER","stateId":"bf5fdfbc-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd11770-f7d3-11e8-8eb2-f2801f1b9fd1"}],"applicableActions":"CANCEL","applicableNextStates":"","businessServiceId":"NewTL","docUploadRequired":"true","isStartState":"false","isTerminateState":"true","state":"APPROVED","tenantId":"pg","uuid":"bf5fdfbc-f7df-11e8-8eb2-f2801f1b9fd1"},{"UpdateAllowed":"true","actions":[{"action":"","nextStateId":"","roles":"","stateId":"bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd112e8-f7d3-11e8-8eb2-f2801f1b9fd1"}],"applicableActions":"","applicableNextStates":"","businessServiceId":"NewTL","docUploadRequired":"false","isStartState":"false","isTerminateState":"true","state":"CANCELLED","tenantId":"pg","uuid":"bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1"},{"UpdateAllowed":"true","actions":[{"action":"REINITIATE","nextStateId":"bf5fd4f4-f7df-11e8-8eb2-f2801f1b9fd1","roles":"CITIZEN,TL_CEMP","stateId":"bf5fe318-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd115fe-f7d3-11e8-8eb2-f2801f1b9fd1"}],"applicableActions":"Reapply","applicableNextStates":"Initiated","businessServiceId":"NewTL","docUploadRequired":"true","isStartState":"false","isTerminateState":"true","state":"REJECTED","tenantId":"pg","uuid":"bf5fe318-f7df-11e8-8eb2-f2801f1b9fd1"},{"UpdateAllowed":"","actions":[{"action":"APPROVE","nextStateId":"bf5fdfbc-f7df-11e8-8eb2-f2801f1b9fd1","roles":"TL_APPROVER","stateId":"bf5fe444-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd10f50-f7d3-11e8-8eb2-f2801f1b9fd1"},{"action":"CANCEL","nextStateId":"bf5fe0fc-f7df-11e8-8eb2-f2801f1b9fd1","roles":"TL_APPROVER","stateId":"bf5fe444-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd11086-f7d3-11e8-8eb2-f2801f1b9fd1"},{"action":"REJECT","nextStateId":"bf5fe318-f7df-11e8-8eb2-f2801f1b9fd1","roles":"TL_APPROVER","stateId":"bf5fe444-f7df-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"4bd111a8-f7d3-11e8-8eb2-f2801f1b9fd1"}],"applicableActions":"","applicableNextStates":"","businessServiceId":"NewTL","docUploadRequired":"","isStartState":"false","isTerminateState":"false","state":"PENDINGAPPROVAL","tenantId":"pg","uuid":"bf5fe444-f7df-11e8-8eb2-f2801f1b9fd1"},{"UpdateAllowed":"true","actions":[{"action":"INITIATE","nextStateId":"bf5fd4f4-f7df-11e8-8eb2-f2801f1b9fd1","roles":"CITIZEN,TL_CEMP","stateId":"9d458700-f894-11e8-8eb2-f2801f1b9fd1","tenantId":"pg","uuid":"2efb9036-f895-11e8-8eb2-f2801f1b9fd1"}],"applicableActions":"INITIATE","applicableNextStates":"Initiated","businessServiceId":"NewTL","docUploadRequired":"false","isStartState":"true","isTerminateState":"false","state":"","tenantId":"pg","uuid":"9d458700-f894-11e8-8eb2-f2801f1b9fd1"}],"tenantId":"pg","uuid":"2b75575a-f84d-11e8-8eb2-f2801f1b9fd1"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.BusinessService' AND uniqueidentifier = 'e08f0fc8b81e33183a57e2d0fdf93aefb2a75b1c10208502e948a55ea39cd673'
);

-- data/Workflow/Workflow.BusinessServiceConfig.json :: Workflow.BusinessServiceConfig entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '22fcc569-d23d-4e85-a2cb-1528123d8c0a'::uuid, 'pg', '9c1639a0d054ead7762c28dc39d4faace7bd3c2beb39dadf044bdd15a3662d5d', 'Workflow.BusinessServiceConfig', '{"code":"NEWTL","isStateLevel":true}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.BusinessServiceConfig' AND uniqueidentifier = '9c1639a0d054ead7762c28dc39d4faace7bd3c2beb39dadf044bdd15a3662d5d'
);

-- data/Workflow/Workflow.BusinessServiceConfig.json :: Workflow.BusinessServiceConfig entry #2
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '7a114c79-20af-4062-b49d-c6b8d8aae969'::uuid, 'pg', '0c5d9c83e755ff20012541233d8dec09a5bded28ac0007b76328de484bf77700', 'Workflow.BusinessServiceConfig', '{"code":"FIRENOC","isStateLevel":true}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.BusinessServiceConfig' AND uniqueidentifier = '0c5d9c83e755ff20012541233d8dec09a5bded28ac0007b76328de484bf77700'
);

-- data/Workflow/Workflow.BusinessServiceMasterConfig.json :: Workflow.BusinessServiceMasterConfig entry #1
INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
SELECT '17b97ed5-b999-4b81-8d13-5cf555d7e025'::uuid, 'pg', 'd8938c2969e6762ef0c589aa16d6f2d528b0eba2d7ac69b356d94e637667215d', 'Workflow.BusinessServiceMasterConfig', '{"active":"true","businessService":"Incident","isStatelevel":"true"}'::jsonb, TRUE, 'system-mdms-seed', 'system-mdms-seed', 1766039437780, 1766039437780
WHERE NOT EXISTS (
  SELECT 1 FROM eg_mdms_data WHERE tenantid = 'pg' AND schemacode = 'Workflow.BusinessServiceMasterConfig' AND uniqueidentifier = 'd8938c2969e6762ef0c589aa16d6f2d528b0eba2d7ac69b356d94e637667215d'
);

COMMIT;

-- Boundary Management tables for template generation
CREATE TABLE IF NOT EXISTS public.eg_bm_generated_template (
    id VARCHAR(64) PRIMARY KEY,
    filestoreid VARCHAR(256),
    status VARCHAR(64),
    tenantid VARCHAR(256) NOT NULL,
    hierarchytype VARCHAR(128) NOT NULL,
    locale VARCHAR(16) DEFAULT 'en_IN',
    createdby VARCHAR(256),
    createdtime BIGINT,
    lastmodifiedby VARCHAR(256),
    lastmodifiedtime BIGINT,
    additionaldetails JSONB,
    referenceid VARCHAR(256)
);

CREATE TABLE IF NOT EXISTS public.eg_bm_processed_template (
    id VARCHAR(64) PRIMARY KEY,
    status VARCHAR(64),
    tenantid VARCHAR(256) NOT NULL,
    hierarchytype VARCHAR(128) NOT NULL,
    filestoreid VARCHAR(256),
    processedfilestoreid VARCHAR(256),
    action VARCHAR(64),
    createdby VARCHAR(256),
    createdtime BIGINT,
    lastmodifiedby VARCHAR(256),
    lastmodifiedtime BIGINT,
    additionaldetails JSONB,
    referenceid VARCHAR(256)
);

CREATE INDEX IF NOT EXISTS idx_bm_gen_template_tenant_hierarchy ON eg_bm_generated_template(tenantid, hierarchytype);
CREATE INDEX IF NOT EXISTS idx_bm_proc_template_tenant_hierarchy ON eg_bm_processed_template(tenantid, hierarchytype);
