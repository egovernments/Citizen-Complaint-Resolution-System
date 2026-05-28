BEGIN;

-- Localisation :: rainmaker-workbench.WBH_MDMS_MASTER_TRADELICENSE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '1cb9d62c-2800-4674-8d50-d2c5d85db269'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'WBH_MDMS_MASTER_TRADELICENSE', 'TradeLicense', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'WBH_MDMS_MASTER_TRADELICENSE'
);

-- Localisation :: rainmaker-workbench.WBH_MDMS_TRADELICENSE_CALCULATIONTYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '3d24aa56-ec80-46a5-ac9b-a565d082b941'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'WBH_MDMS_TRADELICENSE_CALCULATIONTYPE', 'CalculationType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'WBH_MDMS_TRADELICENSE_CALCULATIONTYPE'
);

-- Localisation :: rainmaker-workbench.SCHEMA_TRADELICENSE_CALCULATIONTYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '7d3237b1-9667-4105-9f07-b8c9bb04c8e3'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'SCHEMA_TRADELICENSE_CALCULATIONTYPE', 'CalculationType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'SCHEMA_TRADELICENSE_CALCULATIONTYPE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_CALCULATIONTYPE_ACCESSORY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'e672b84d-de12-4779-8d73-51f1b11c7140'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_CALCULATIONTYPE_ACCESSORY', 'accessory', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_CALCULATIONTYPE_ACCESSORY'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_CALCULATIONTYPE_FINANCIALYEAR.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '9ca8ad30-cbc4-4a3d-a79b-7cb699486d20'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_CALCULATIONTYPE_FINANCIALYEAR', 'financialYear', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_CALCULATIONTYPE_FINANCIALYEAR'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_CALCULATIONTYPE_ACTIVE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'db7e236f-d8f9-462e-962f-aa1ca6654351'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_CALCULATIONTYPE_ACTIVE', 'active', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_CALCULATIONTYPE_ACTIVE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_CALCULATIONTYPE_TRADETYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'a9039698-16a8-4bb5-ad29-07ec9d96b854'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_CALCULATIONTYPE_TRADETYPE', 'tradeType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_CALCULATIONTYPE_TRADETYPE'
);

-- Localisation :: rainmaker-workbench.WBH_MDMS_TRADELICENSE_TRADETYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '58ca58d7-4a23-4377-b5eb-26b027125612'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'WBH_MDMS_TRADELICENSE_TRADETYPE', 'TradeType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'WBH_MDMS_TRADELICENSE_TRADETYPE'
);

-- Localisation :: rainmaker-workbench.SCHEMA_TRADELICENSE_TRADETYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '7401cae9-bc18-4132-8f1a-22f559a71a51'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'SCHEMA_TRADELICENSE_TRADETYPE', 'TradeType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'SCHEMA_TRADELICENSE_TRADETYPE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADETYPE_VALIDITYPERIOD.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'fe2eec61-6edd-489e-b0b2-72899ce2cfd4'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADETYPE_VALIDITYPERIOD', 'validityPeriod', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADETYPE_VALIDITYPERIOD'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADETYPE_ACTIVE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'aed31778-357a-42bf-bdfd-e87adc6efd63'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADETYPE_ACTIVE', 'active', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADETYPE_ACTIVE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADETYPE_NAME.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '98ee80f7-93f4-4763-ba46-4a80ea33f5da'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADETYPE_NAME', 'name', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADETYPE_NAME'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADETYPE_CODE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '51247705-385f-4191-9988-17aa16d766eb'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADETYPE_CODE', 'code', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADETYPE_CODE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADETYPE_APPLICATIONTYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '4eaeb47f-e297-4a91-a5e6-b21d5bd3e4eb'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADETYPE_APPLICATIONTYPE', 'applicationType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADETYPE_APPLICATIONTYPE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADETYPE_VERIFICATIONDOCUMENT.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'f94022fb-8055-4eb4-b8ce-ed110e624249'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADETYPE_VERIFICATIONDOCUMENT', 'verificationDocument', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADETYPE_VERIFICATIONDOCUMENT'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADETYPE_DOCUMENTLIST.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '1de44c1b-cda9-4d75-a5df-beefd92f8a17'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADETYPE_DOCUMENTLIST', 'documentList', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADETYPE_DOCUMENTLIST'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADETYPE_APPLICATIONDOCUMENT.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '434ebe42-6d00-4be3-8f5e-c97c0faba416'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADETYPE_APPLICATIONDOCUMENT', 'applicationDocument', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADETYPE_APPLICATIONDOCUMENT'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADETYPE_TYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '86ae1b08-39ea-4f54-9e6b-00951481b80e'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADETYPE_TYPE', 'type', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADETYPE_TYPE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADETYPE_UOM.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '82793434-eaa3-4234-9317-7783743cc8d6'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADETYPE_UOM', 'uom', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADETYPE_UOM'
);

-- Localisation :: rainmaker-workbench.WBH_MDMS_TRADELICENSE_ACCESSORIESCATEGORY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '1ba5474c-a703-42f0-82bb-109c9b81828c'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'WBH_MDMS_TRADELICENSE_ACCESSORIESCATEGORY', 'AccessoriesCategory', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'WBH_MDMS_TRADELICENSE_ACCESSORIESCATEGORY'
);

-- Localisation :: rainmaker-workbench.SCHEMA_TRADELICENSE_ACCESSORIESCATEGORY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '9f4907dd-3621-4dcc-ae36-3d204abaf1b9'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'SCHEMA_TRADELICENSE_ACCESSORIESCATEGORY', 'AccessoriesCategory', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'SCHEMA_TRADELICENSE_ACCESSORIESCATEGORY'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_ACCESSORIESCATEGORY_ACTIVE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'b84b698b-25a8-469a-92ed-3bc89cc5f11c'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_ACCESSORIESCATEGORY_ACTIVE', 'active', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_ACCESSORIESCATEGORY_ACTIVE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_ACCESSORIESCATEGORY_CODE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'cf89dbe4-9882-4fdd-8a3e-5556655ee809'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_ACCESSORIESCATEGORY_CODE', 'code', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_ACCESSORIESCATEGORY_CODE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_ACCESSORIESCATEGORY_UOM.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'f4c1961f-449c-4747-9205-e7063085c1de'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_ACCESSORIESCATEGORY_UOM', 'uom', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_ACCESSORIESCATEGORY_UOM'
);

-- Localisation :: rainmaker-workbench.WBH_MDMS_TRADELICENSE_COMMONFIELDSCONFIG.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '33492b12-ad97-4916-a5db-787dbd46bf1f'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'WBH_MDMS_TRADELICENSE_COMMONFIELDSCONFIG', 'CommonFieldsConfig', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'WBH_MDMS_TRADELICENSE_COMMONFIELDSCONFIG'
);

-- Localisation :: rainmaker-workbench.SCHEMA_TRADELICENSE_COMMONFIELDSCONFIG.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '9dc5b21f-ee2f-478c-a43d-8e1e3952a50c'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'SCHEMA_TRADELICENSE_COMMONFIELDSCONFIG', 'CommonFieldsConfig', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'SCHEMA_TRADELICENSE_COMMONFIELDSCONFIG'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_BODY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '6a161a71-a8fa-4dea-bd38-445ad9aa82c9'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_BODY', 'body', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_BODY'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_HEADER.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '628d7784-0038-4335-aac6-8422221ba159'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_HEADER', 'header', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_HEADER'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_HIDEINEMPLOYEE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '35c0276b-8a69-4965-b8e8-9ff7ecbaad1d'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_HIDEINEMPLOYEE', 'hideInEmployee', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_HIDEINEMPLOYEE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_HEADERCAPTION.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'f89a4bd0-4647-49d5-b871-b43591bfb92b'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_HEADERCAPTION', 'headerCaption', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_HEADERCAPTION'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_KEY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '076cd703-c5be-4816-a027-c87d0d09dbcc'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_KEY', 'key', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_KEY'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_SUBMITBARLABEL.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '2295d05e-ffe8-48bd-946d-a545bbaa6d79'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_SUBMITBARLABEL', 'submitBarLabel', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_SUBMITBARLABEL'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_NEXTSTEP.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '4e1cf5ba-8f25-4943-9428-b412dda5d92c'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_NEXTSTEP', 'nextStep', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_NEXTSTEP'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_CARDTEXT.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'b68b9a81-915d-4188-877d-8c9c8b73dbc2'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_CARDTEXT', 'cardText', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_CARDTEXT'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_SKIPTEXT.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'ec4b44fd-6d04-43ac-bba0-ce811091709c'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_SKIPTEXT', 'skipText', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_SKIPTEXT'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_ROUTE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '20595eb6-758a-4fdb-8882-4751810ef197'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_ROUTE', 'route', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_ROUTE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_COMPONENT.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '9b99d7a4-fcf4-4b4c-8614-916b8410e3e6'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_COMPONENT', 'component', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_COMPONENT'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_TYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '9077c61b-cb20-477e-b7c0-56c9f6304865'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_TYPE', 'type', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_TYPE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_TEXTS.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'a7ff1d11-c8ba-4094-affb-9cf79e4acc52'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_TEXTS', 'texts', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_TEXTS'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_ISMANDATORY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '1d354347-d39b-4c54-bddc-d0f936058085'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_ISMANDATORY', 'isMandatory', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_ISMANDATORY'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_HEAD.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '10508235-82ba-453c-aeff-26cd528db509'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_HEAD', 'head', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_HEAD'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_COMMONFIELDSCONFIG_WITHOUTLABEL.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '601da028-113c-48ff-a6b9-7040c6d91cf3'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_COMMONFIELDSCONFIG_WITHOUTLABEL', 'withoutLabel', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_COMMONFIELDSCONFIG_WITHOUTLABEL'
);

-- Localisation :: rainmaker-workbench.WBH_MDMS_TRADELICENSE_DOCUMENTOBJ.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '0dee605b-d2a8-49ad-b13b-efcbf8883d32'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'WBH_MDMS_TRADELICENSE_DOCUMENTOBJ', 'documentObj', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'WBH_MDMS_TRADELICENSE_DOCUMENTOBJ'
);

-- Localisation :: rainmaker-workbench.SCHEMA_TRADELICENSE_DOCUMENTOBJ.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '86383aee-e47a-4fba-adc8-91275d25821c'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'SCHEMA_TRADELICENSE_DOCUMENTOBJ', 'documentObj', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'SCHEMA_TRADELICENSE_DOCUMENTOBJ'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_DOCUMENTOBJ_ALLOWEDDOCS.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'af6d172f-e41e-497e-9435-142a0b0c8038'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_DOCUMENTOBJ_ALLOWEDDOCS', 'allowedDocs', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_DOCUMENTOBJ_ALLOWEDDOCS'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_DOCUMENTOBJ_REQUIRED.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '52617b05-0598-4837-bd21-48bed3cf1ba0'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_DOCUMENTOBJ_REQUIRED', 'required', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_DOCUMENTOBJ_REQUIRED'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_DOCUMENTOBJ_APPLICATIONTYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '4549daa0-efd2-4551-841a-78e9acfd6d11'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_DOCUMENTOBJ_APPLICATIONTYPE', 'applicationType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_DOCUMENTOBJ_APPLICATIONTYPE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_DOCUMENTOBJ_DOCUMENTTYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '7842ee29-8ab6-4070-a988-9a89d2158d95'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_DOCUMENTOBJ_DOCUMENTTYPE', 'documentType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_DOCUMENTOBJ_DOCUMENTTYPE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_DOCUMENTOBJ_TRADETYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '9c93d668-0ed5-4f4f-986b-c1d2f5af7724'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_DOCUMENTOBJ_TRADETYPE', 'tradeType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_DOCUMENTOBJ_TRADETYPE'
);

-- Localisation :: rainmaker-workbench.WBH_MDMS_TRADELICENSE_REMINDERPERIODS.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'c9cc1b43-c558-4ff9-82c4-86e1730c035e'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'WBH_MDMS_TRADELICENSE_REMINDERPERIODS', 'ReminderPeriods', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'WBH_MDMS_TRADELICENSE_REMINDERPERIODS'
);

-- Localisation :: rainmaker-workbench.SCHEMA_TRADELICENSE_REMINDERPERIODS.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '5f7f4e4e-0e66-49de-ad54-2b963a5df2c7'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'SCHEMA_TRADELICENSE_REMINDERPERIODS', 'ReminderPeriods', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'SCHEMA_TRADELICENSE_REMINDERPERIODS'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_REMINDERPERIODS_TENANTID.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '90a80ac4-0929-4307-97c6-91c143f17533'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_REMINDERPERIODS_TENANTID', 'tenantId', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_REMINDERPERIODS_TENANTID'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_REMINDERPERIODS_REMINDERINTERVAL.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'cfa2b33e-568d-48f9-a39c-3d6ec6cdca12'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_REMINDERPERIODS_REMINDERINTERVAL', 'reminderInterval', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_REMINDERPERIODS_REMINDERINTERVAL'
);

-- Localisation :: rainmaker-workbench.WBH_MDMS_TRADELICENSE_PENALTY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'e52bbbf8-bd0c-48b8-a652-230011228a78'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'WBH_MDMS_TRADELICENSE_PENALTY', 'Penalty', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'WBH_MDMS_TRADELICENSE_PENALTY'
);

-- Localisation :: rainmaker-workbench.SCHEMA_TRADELICENSE_PENALTY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'c0166034-b852-44f0-97f9-e9c22c7d46e0'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'SCHEMA_TRADELICENSE_PENALTY', 'Penalty', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'SCHEMA_TRADELICENSE_PENALTY'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_PENALTY_RATE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '84538a69-6e66-423e-bba3-767302516e72'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_PENALTY_RATE', 'rate', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_PENALTY_RATE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_PENALTY_FLATAMOUNT.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'aaa6ae3b-e276-4ccf-b4de-8be6e4a1d377'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_PENALTY_FLATAMOUNT', 'flatAmount', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_PENALTY_FLATAMOUNT'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_PENALTY_STARTINGDAY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'f0809869-a6b3-42d5-943f-74be021fa1ff'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_PENALTY_STARTINGDAY', 'startingDay', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_PENALTY_STARTINGDAY'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_PENALTY_FROMFY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '2b68e634-a81d-42f8-a768-8f818525df9b'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_PENALTY_FROMFY', 'fromFY', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_PENALTY_FROMFY'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_PENALTY_MINAMOUNT.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '38f83441-29a1-47c6-941c-7895f4efdd06'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_PENALTY_MINAMOUNT', 'minAmount', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_PENALTY_MINAMOUNT'
);

-- Localisation :: rainmaker-workbench.WBH_MDMS_TRADELICENSE_DOCUMENTS.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '4dc94320-9f8d-400f-8713-334436e38c34'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'WBH_MDMS_TRADELICENSE_DOCUMENTS', 'Documents', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'WBH_MDMS_TRADELICENSE_DOCUMENTS'
);

-- Localisation :: rainmaker-workbench.SCHEMA_TRADELICENSE_DOCUMENTS.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '7c225e3a-7342-40f2-9d67-90489785e9f6'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'SCHEMA_TRADELICENSE_DOCUMENTS', 'Documents', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'SCHEMA_TRADELICENSE_DOCUMENTS'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_DOCUMENTS_ACTIVE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '237fcacf-affc-412c-ad61-613b3213a126'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_DOCUMENTS_ACTIVE', 'active', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_DOCUMENTS_ACTIVE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_DOCUMENTS_REQUIRED.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'dd5b6305-8c3e-490b-8913-dc32586915bc'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_DOCUMENTS_REQUIRED', 'required', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_DOCUMENTS_REQUIRED'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_DOCUMENTS_CODE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '952853af-08fa-44f4-855a-181b254982f3'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_DOCUMENTS_CODE', 'code', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_DOCUMENTS_CODE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_DOCUMENTS_DROPDOWNDATA.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '90717eb0-116f-4137-845b-1dbd3eca8564'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_DOCUMENTS_DROPDOWNDATA', 'dropdownData', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_DOCUMENTS_DROPDOWNDATA'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_DOCUMENTS_DOCUMENTTYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '30500c12-c7fe-41b2-966a-095c86a0ffbf'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_DOCUMENTS_DOCUMENTTYPE', 'documentType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_DOCUMENTS_DOCUMENTTYPE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_DOCUMENTS_DESCRIPTION.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '25e54b8b-472b-49d8-9568-2e6d2af9b5ee'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_DOCUMENTS_DESCRIPTION', 'description', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_DOCUMENTS_DESCRIPTION'
);

-- Localisation :: rainmaker-workbench.WBH_MDMS_TRADELICENSE_APPLICATIONTYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '9ee3eacb-3c0e-4698-9b74-c0c602492e18'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'WBH_MDMS_TRADELICENSE_APPLICATIONTYPE', 'ApplicationType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'WBH_MDMS_TRADELICENSE_APPLICATIONTYPE'
);

-- Localisation :: rainmaker-workbench.SCHEMA_TRADELICENSE_APPLICATIONTYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '5da00d40-5ed8-4ea2-992d-c5168fc4b9ac'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'SCHEMA_TRADELICENSE_APPLICATIONTYPE', 'ApplicationType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'SCHEMA_TRADELICENSE_APPLICATIONTYPE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_APPLICATIONTYPE_CODE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'afe327ea-aafe-4258-8bfe-9b2770515144'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_APPLICATIONTYPE_CODE', 'code', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_APPLICATIONTYPE_CODE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_APPLICATIONTYPE_ACTIVE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'ccd41d14-fcec-4538-890f-56183b6d03ca'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_APPLICATIONTYPE_ACTIVE', 'active', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_APPLICATIONTYPE_ACTIVE'
);

-- Localisation :: rainmaker-workbench.WBH_MDMS_TRADELICENSE_TRADERENEWAL.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '11d82cdc-8191-4f62-a809-51eb5db2e2f9'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'WBH_MDMS_TRADELICENSE_TRADERENEWAL', 'TradeRenewal', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'WBH_MDMS_TRADELICENSE_TRADERENEWAL'
);

-- Localisation :: rainmaker-workbench.SCHEMA_TRADELICENSE_TRADERENEWAL.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '596459ea-8dc6-47fe-a0d8-e5000b864ff5'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'SCHEMA_TRADELICENSE_TRADERENEWAL', 'TradeRenewal', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'SCHEMA_TRADELICENSE_TRADERENEWAL'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADERENEWAL_RENEWALPERIOD.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'ac937710-a635-4b90-beaf-313cc591d579'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADERENEWAL_RENEWALPERIOD', 'renewalPeriod', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADERENEWAL_RENEWALPERIOD'
);

-- Localisation :: rainmaker-workbench.WBH_MDMS_TRADELICENSE_REBATE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '88b75b82-b1d2-4a03-848a-efdd7083145e'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'WBH_MDMS_TRADELICENSE_REBATE', 'Rebate', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'WBH_MDMS_TRADELICENSE_REBATE'
);

-- Localisation :: rainmaker-workbench.SCHEMA_TRADELICENSE_REBATE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '424b8ec9-b4a3-4a06-ab5f-6feddd53d23d'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'SCHEMA_TRADELICENSE_REBATE', 'Rebate', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'SCHEMA_TRADELICENSE_REBATE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_REBATE_RATE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '45c1894b-b03b-4cbb-b6d0-5311f74d6e6f'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_REBATE_RATE', 'rate', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_REBATE_RATE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_REBATE_FLATAMOUNT.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '8c41f068-c13a-4065-a53a-4c9137e3781b'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_REBATE_FLATAMOUNT', 'flatAmount', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_REBATE_FLATAMOUNT'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_REBATE_ENDINGDAY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '9a289ebc-1bb0-496f-8cb9-444a5dfbeee3'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_REBATE_ENDINGDAY', 'endingDay', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_REBATE_ENDINGDAY'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_REBATE_FROMFY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '59853486-eaeb-4a12-a58d-df10d10d675b'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_REBATE_FROMFY', 'fromFY', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_REBATE_FROMFY'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_REBATE_MAXAMOUNT.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '54bf6d1e-b10d-40b0-a1cb-90c6349d2efa'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_REBATE_MAXAMOUNT', 'maxAmount', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_REBATE_MAXAMOUNT'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADELICENSE_ALLOWEDDOCS.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '365046c4-be4c-4789-be90-e432ef78f279'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADELICENSE_ALLOWEDDOCS', 'allowedDocs', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADELICENSE_ALLOWEDDOCS'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADELICENSE_BODY.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'acc93b4b-a4d4-4243-b7e7-1be38bb3568e'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADELICENSE_BODY', 'body', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADELICENSE_BODY'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADELICENSE_APPLICATIONTYPE.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'aff819bb-80c7-4ea9-85c8-ef4a27f1c10a'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADELICENSE_APPLICATIONTYPE', 'applicationType', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADELICENSE_APPLICATIONTYPE'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADELICENSE_DOCUMENTLIST.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'acd4c0e9-ea0d-4cce-b660-6858c5c20c28'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADELICENSE_DOCUMENTLIST', 'documentList', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADELICENSE_DOCUMENTLIST'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADELICENSE_DROPDOWNDATA.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT '1ab03683-e3f3-4d10-914c-443cb969b27b'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADELICENSE_DROPDOWNDATA', 'dropdownData', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADELICENSE_DROPDOWNDATA'
);

-- Localisation :: rainmaker-workbench.TRADELICENSE_TRADELICENSE_APPLICATIONDOCUMENT.en_IN
INSERT INTO message (id, tenantid, locale, module, code, message, createdby, createddate, lastmodifiedby, lastmodifieddate)
SELECT 'b6a96571-24a3-4f8d-af77-0de1a0e140f5'::uuid, 'pg', 'en_IN', 'rainmaker-workbench', 'TRADELICENSE_TRADELICENSE_APPLICATIONDOCUMENT', 'applicationDocument', 1, now(), 1, now()
WHERE NOT EXISTS (
  SELECT 1 FROM message WHERE tenantid = 'pg' AND locale = 'en_IN' AND module = 'rainmaker-workbench' AND code = 'TRADELICENSE_TRADELICENSE_APPLICATIONDOCUMENT'
);

COMMIT;
