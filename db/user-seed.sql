-- User Seed Data for DIGIT
-- Creates default admin users for development/testing

-- Insert roles first (if they don't exist)
INSERT INTO eg_role (id, name, code, description, createddate, createdby, lastmodifiedby, lastmodifieddate, tenantid)
SELECT 1, 'Super User', 'SUPERUSER', 'Super User with all permissions', now(), 1, 1, now(), 'pg'
WHERE NOT EXISTS (SELECT 1 FROM eg_role WHERE code = 'SUPERUSER' AND tenantid = 'pg');

INSERT INTO eg_role (id, name, code, description, createddate, createdby, lastmodifiedby, lastmodifieddate, tenantid)
SELECT 2, 'Employee', 'EMPLOYEE', 'Employee role', now(), 1, 1, now(), 'pg'
WHERE NOT EXISTS (SELECT 1 FROM eg_role WHERE code = 'EMPLOYEE' AND tenantid = 'pg');

INSERT INTO eg_role (id, name, code, description, createddate, createdby, lastmodifiedby, lastmodifieddate, tenantid)
SELECT 3, 'Grievance Routing Officer', 'GRO', 'Grievance Routing Officer', now(), 1, 1, now(), 'pg'
WHERE NOT EXISTS (SELECT 1 FROM eg_role WHERE code = 'GRO' AND tenantid = 'pg');

INSERT INTO eg_role (id, name, code, description, createddate, createdby, lastmodifiedby, lastmodifieddate, tenantid)
SELECT 4, 'Department GRO', 'DGRO', 'Department Grievance Routing Officer', now(), 1, 1, now(), 'pg'
WHERE NOT EXISTS (SELECT 1 FROM eg_role WHERE code = 'DGRO' AND tenantid = 'pg');

INSERT INTO eg_role (id, name, code, description, createddate, createdby, lastmodifiedby, lastmodifieddate, tenantid)
SELECT 5, 'Citizen', 'CITIZEN', 'Citizen role', now(), 1, 1, now(), 'pg'
WHERE NOT EXISTS (SELECT 1 FROM eg_role WHERE code = 'CITIZEN' AND tenantid = 'pg');

INSERT INTO eg_role (id, name, code, description, createddate, createdby, lastmodifiedby, lastmodifieddate, tenantid)
SELECT 6, 'PGR Admin', 'PGR-ADMIN', 'PGR Admin role', now(), 1, 1, now(), 'pg'
WHERE NOT EXISTS (SELECT 1 FROM eg_role WHERE code = 'PGR-ADMIN' AND tenantid = 'pg');

-- Update sequence to avoid conflicts
SELECT setval('seq_eg_role', GREATEST((SELECT MAX(id) FROM eg_role), 10));

-- Create ADMIN user (password: eGov@123 - BCrypt hashed)
-- BCrypt hash generated for 'eGov@123'
INSERT INTO eg_user (id, username, password, name, mobilenumber, emailid, active, type, tenantid, uuid, createddate, lastmodifieddate, createdby, lastmodifiedby, gender)
SELECT
    nextval('seq_eg_user'),
    'ADMIN',
    '$2a$10$uheIOutTnD33x7CDqac1k.ysQcgeRkKPk0cVkpPfDzJhLSgkptXkO',
    'System Administrator',
    '9999999999',
    'admin@digit.org',
    true,
    'EMPLOYEE',
    'pg',
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    now(),
    now(),
    1,
    1,
    1
WHERE NOT EXISTS (SELECT 1 FROM eg_user WHERE username = 'ADMIN' AND tenantid = 'pg');

-- Create a test GRO user (password: eGov@123)
INSERT INTO eg_user (id, username, password, name, mobilenumber, emailid, active, type, tenantid, uuid, createddate, lastmodifieddate, createdby, lastmodifiedby, gender)
SELECT
    nextval('seq_eg_user'),
    'GRO',
    '$2a$10$uheIOutTnD33x7CDqac1k.ysQcgeRkKPk0cVkpPfDzJhLSgkptXkO',
    'Grievance Officer',
    '9888888888',
    'gro@digit.org',
    true,
    'EMPLOYEE',
    'pg',
    'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    now(),
    now(),
    1,
    1,
    1
WHERE NOT EXISTS (SELECT 1 FROM eg_user WHERE username = 'GRO' AND tenantid = 'pg');

-- Assign roles to ADMIN user
INSERT INTO eg_userrole (roleid, roleidtenantid, userid, tenantid, lastmodifieddate)
SELECT r.id, 'pg', u.id, 'pg', now()
FROM eg_user u, eg_role r
WHERE u.username = 'ADMIN' AND u.tenantid = 'pg'
  AND r.code = 'SUPERUSER' AND r.tenantid = 'pg'
  AND NOT EXISTS (
    SELECT 1 FROM eg_userrole ur
    WHERE ur.userid = u.id AND ur.roleid = r.id AND ur.tenantid = 'pg'
  );

INSERT INTO eg_userrole (roleid, roleidtenantid, userid, tenantid, lastmodifieddate)
SELECT r.id, 'pg', u.id, 'pg', now()
FROM eg_user u, eg_role r
WHERE u.username = 'ADMIN' AND u.tenantid = 'pg'
  AND r.code = 'EMPLOYEE' AND r.tenantid = 'pg'
  AND NOT EXISTS (
    SELECT 1 FROM eg_userrole ur
    WHERE ur.userid = u.id AND ur.roleid = r.id AND ur.tenantid = 'pg'
  );

INSERT INTO eg_userrole (roleid, roleidtenantid, userid, tenantid, lastmodifieddate)
SELECT r.id, 'pg', u.id, 'pg', now()
FROM eg_user u, eg_role r
WHERE u.username = 'ADMIN' AND u.tenantid = 'pg'
  AND r.code = 'GRO' AND r.tenantid = 'pg'
  AND NOT EXISTS (
    SELECT 1 FROM eg_userrole ur
    WHERE ur.userid = u.id AND ur.roleid = r.id AND ur.tenantid = 'pg'
  );

INSERT INTO eg_userrole (roleid, roleidtenantid, userid, tenantid, lastmodifieddate)
SELECT r.id, 'pg', u.id, 'pg', now()
FROM eg_user u, eg_role r
WHERE u.username = 'ADMIN' AND u.tenantid = 'pg'
  AND r.code = 'DGRO' AND r.tenantid = 'pg'
  AND NOT EXISTS (
    SELECT 1 FROM eg_userrole ur
    WHERE ur.userid = u.id AND ur.roleid = r.id AND ur.tenantid = 'pg'
  );

INSERT INTO eg_userrole (roleid, roleidtenantid, userid, tenantid, lastmodifieddate)
SELECT r.id, 'pg', u.id, 'pg', now()
FROM eg_user u, eg_role r
WHERE u.username = 'ADMIN' AND u.tenantid = 'pg'
  AND r.code = 'PGR-ADMIN' AND r.tenantid = 'pg'
  AND NOT EXISTS (
    SELECT 1 FROM eg_userrole ur
    WHERE ur.userid = u.id AND ur.roleid = r.id AND ur.tenantid = 'pg'
  );

-- Assign roles to GRO user
INSERT INTO eg_userrole (roleid, roleidtenantid, userid, tenantid, lastmodifieddate)
SELECT r.id, 'pg', u.id, 'pg', now()
FROM eg_user u, eg_role r
WHERE u.username = 'GRO' AND u.tenantid = 'pg'
  AND r.code = 'EMPLOYEE' AND r.tenantid = 'pg'
  AND NOT EXISTS (
    SELECT 1 FROM eg_userrole ur
    WHERE ur.userid = u.id AND ur.roleid = r.id AND ur.tenantid = 'pg'
  );

INSERT INTO eg_userrole (roleid, roleidtenantid, userid, tenantid, lastmodifieddate)
SELECT r.id, 'pg', u.id, 'pg', now()
FROM eg_user u, eg_role r
WHERE u.username = 'GRO' AND u.tenantid = 'pg'
  AND r.code = 'GRO' AND r.tenantid = 'pg'
  AND NOT EXISTS (
    SELECT 1 FROM eg_userrole ur
    WHERE ur.userid = u.id AND ur.roleid = r.id AND ur.tenantid = 'pg'
  );

INSERT INTO eg_userrole (roleid, roleidtenantid, userid, tenantid, lastmodifieddate)
SELECT r.id, 'pg', u.id, 'pg', now()
FROM eg_user u, eg_role r
WHERE u.username = 'GRO' AND u.tenantid = 'pg'
  AND r.code = 'DGRO' AND r.tenantid = 'pg'
  AND NOT EXISTS (
    SELECT 1 FROM eg_userrole ur
    WHERE ur.userid = u.id AND ur.roleid = r.id AND ur.tenantid = 'pg'
  );

-- Summary output
DO $$
DECLARE
    user_count INTEGER;
    role_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO user_count FROM eg_user WHERE tenantid = 'pg';
    SELECT COUNT(*) INTO role_count FROM eg_userrole WHERE tenantid = 'pg';
    RAISE NOTICE 'User seed complete: % users, % role assignments', user_count, role_count;
END $$;
