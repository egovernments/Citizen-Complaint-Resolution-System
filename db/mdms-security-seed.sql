-- DataSecurity MDMS configs extracted from seed.sql
-- Required by: egov-user (uses enc-client which needs DataSecurity.SecurityPolicy at startup)
-- This seed MUST run before egov-user starts due to @PostConstruct in enc-client

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
