-- User Schema DDL - Combined from DIGIT-OSS egov-user migrations
-- Source: https://github.com/egovernments/DIGIT-OSS/tree/master/core-services/egov-user/src/main/resources/db/migration/ddl

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create sequences
CREATE SEQUENCE IF NOT EXISTS seq_eg_user START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS seq_eg_user_address START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE IF NOT EXISTS seq_eg_role START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

-- Create user table
CREATE TABLE IF NOT EXISTS eg_user (
    id bigint NOT NULL,
    title character varying(8),
    salutation character varying(5),
    dob timestamp,
    locale character varying(16),
    username character varying(64) NOT NULL,
    password character varying(64) NOT NULL,
    pwdexpirydate timestamp DEFAULT CURRENT_TIMESTAMP,
    mobilenumber character varying(50),
    altcontactnumber character varying(50),
    emailid character varying(128),
    createddate timestamp,
    lastmodifieddate timestamp,
    createdby bigint,
    lastmodifiedby bigint,
    active boolean,
    name character varying(100),
    gender smallint,
    pan character varying(10),
    aadhaarnumber character varying(20),
    type character varying(50),
    version numeric DEFAULT 0,
    guardian character varying(100),
    guardianrelation character varying(32),
    signature character varying(36),
    accountlocked boolean DEFAULT false,
    accountlockeddate timestamp,
    bloodgroup character varying(32),
    photo character varying(36),
    identificationmark character varying(300),
    tenantid character varying(256) NOT NULL,
    uuid character varying(64),
    alternatemobilenumber character varying(50),
    CONSTRAINT eg_user_pkey PRIMARY KEY (id)
);

-- Create user address table
CREATE TABLE IF NOT EXISTS eg_user_address (
    id bigint NOT NULL,
    type character varying(32),
    address character varying(300),
    city character varying(300),
    pincode character varying(10),
    userid bigint NOT NULL,
    tenantid character varying(256) NOT NULL,
    CONSTRAINT eg_user_address_pkey PRIMARY KEY (id)
);

-- Create role table
CREATE TABLE IF NOT EXISTS eg_role (
    id bigint NOT NULL,
    name character varying(64) NOT NULL,
    code character varying(50) NOT NULL,
    description character varying(256),
    createddate timestamp DEFAULT CURRENT_TIMESTAMP,
    createdby bigint,
    lastmodifiedby bigint,
    lastmodifieddate timestamp DEFAULT CURRENT_TIMESTAMP,
    version numeric DEFAULT 0,
    tenantid character varying(256) NOT NULL,
    CONSTRAINT eg_role_pkey PRIMARY KEY (id)
);

-- Create user role table (v1)
CREATE TABLE IF NOT EXISTS eg_userrole_v1 (
    user_id bigint NOT NULL,
    role_code character varying(64) NOT NULL,
    role_tenantid character varying(256) NOT NULL,
    user_tenantid character varying(256) NOT NULL,
    lastmodifieddate timestamp DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_eg_userrole_v1 PRIMARY KEY (user_id, role_code, role_tenantid, user_tenantid)
);

-- Create indices
CREATE INDEX IF NOT EXISTS idx_eg_user_username ON eg_user(username);
CREATE INDEX IF NOT EXISTS idx_eg_user_tenantid ON eg_user(tenantid);
CREATE INDEX IF NOT EXISTS idx_eg_user_uuid ON eg_user(uuid);
CREATE INDEX IF NOT EXISTS idx_eg_user_mobilenumber ON eg_user(mobilenumber);
CREATE INDEX IF NOT EXISTS idx_eg_userrole_v1_userid ON eg_userrole_v1(user_id);
CREATE INDEX IF NOT EXISTS idx_eg_userrole_v1_rolecode ON eg_userrole_v1(role_code);

-- Add unique constraints (ignore if exists)
DO $$ BEGIN
    ALTER TABLE eg_user ADD CONSTRAINT uk_eg_user_username_tenant_type UNIQUE (username, tenantid, type);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE eg_role ADD CONSTRAINT uk_eg_role_code_tenantid UNIQUE (code, tenantid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Insert default roles
INSERT INTO eg_role (id, name, code, description, tenantid, createddate, lastmodifieddate)
SELECT nextval('seq_eg_role'), 'Super User', 'SUPERUSER', 'Super User', 'pg', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM eg_role WHERE code = 'SUPERUSER' AND tenantid = 'pg');

INSERT INTO eg_role (id, name, code, description, tenantid, createddate, lastmodifieddate)
SELECT nextval('seq_eg_role'), 'Employee', 'EMPLOYEE', 'Employee', 'pg', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM eg_role WHERE code = 'EMPLOYEE' AND tenantid = 'pg');

INSERT INTO eg_role (id, name, code, description, tenantid, createddate, lastmodifieddate)
SELECT nextval('seq_eg_role'), 'Citizen', 'CITIZEN', 'Citizen', 'pg', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM eg_role WHERE code = 'CITIZEN' AND tenantid = 'pg');

INSERT INTO eg_role (id, name, code, description, tenantid, createddate, lastmodifieddate)
SELECT nextval('seq_eg_role'), 'PGR Admin', 'PGR-ADMIN', 'PGR Admin', 'pg.citya', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM eg_role WHERE code = 'PGR-ADMIN' AND tenantid = 'pg.citya');

INSERT INTO eg_role (id, name, code, description, tenantid, createddate, lastmodifieddate)
SELECT nextval('seq_eg_role'), 'GRO', 'GRO', 'Grievance Routing Officer', 'pg.citya', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM eg_role WHERE code = 'GRO' AND tenantid = 'pg.citya');

-- Create a default admin user
INSERT INTO eg_user (id, username, password, name, mobilenumber, type, tenantid, active, uuid, createddate, lastmodifieddate)
SELECT nextval('seq_eg_user'), 'ADMIN', '$2a$10$uheIOutTnD33x7CDqac1De2Ls9Qb9xLwNRvp0i5.LNLmPvlWducWm', 'Admin User', '9999999999', 'EMPLOYEE', 'pg', true, gen_random_uuid()::text, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM eg_user WHERE username = 'ADMIN' AND tenantid = 'pg' AND type = 'EMPLOYEE');

-- Assign roles to admin user
INSERT INTO eg_userrole_v1 (user_id, role_code, role_tenantid, user_tenantid, lastmodifieddate)
SELECT u.id, 'SUPERUSER', 'pg', 'pg', NOW()
FROM eg_user u WHERE u.username = 'ADMIN' AND u.tenantid = 'pg'
AND NOT EXISTS (SELECT 1 FROM eg_userrole_v1 WHERE user_id = u.id AND role_code = 'SUPERUSER');

INSERT INTO eg_userrole_v1 (user_id, role_code, role_tenantid, user_tenantid, lastmodifieddate)
SELECT u.id, 'EMPLOYEE', 'pg', 'pg', NOW()
FROM eg_user u WHERE u.username = 'ADMIN' AND u.tenantid = 'pg'
AND NOT EXISTS (SELECT 1 FROM eg_userrole_v1 WHERE user_id = u.id AND role_code = 'EMPLOYEE');

INSERT INTO eg_userrole_v1 (user_id, role_code, role_tenantid, user_tenantid, lastmodifieddate)
SELECT u.id, 'PGR-ADMIN', 'pg.citya', 'pg', NOW()
FROM eg_user u WHERE u.username = 'ADMIN' AND u.tenantid = 'pg'
AND NOT EXISTS (SELECT 1 FROM eg_userrole_v1 WHERE user_id = u.id AND role_code = 'PGR-ADMIN');

INSERT INTO eg_userrole_v1 (user_id, role_code, role_tenantid, user_tenantid, lastmodifieddate)
SELECT u.id, 'GRO', 'pg.citya', 'pg', NOW()
FROM eg_user u WHERE u.username = 'ADMIN' AND u.tenantid = 'pg'
AND NOT EXISTS (SELECT 1 FROM eg_userrole_v1 WHERE user_id = u.id AND role_code = 'GRO');
