-- Fix for fresh installs: rename auto-generated constraint names to expected names
-- This is needed because V20170509172805 creates constraints with auto-generated names
-- but V20180731215512 expects specific names

-- Only fix eg_userrole constraints (eg_user_address already has correct names)
ALTER TABLE eg_userrole DROP CONSTRAINT IF EXISTS eg_userrole_userid_tenantid_fkey;
ALTER TABLE eg_userrole ADD CONSTRAINT eg_userrole_userid_fkey FOREIGN KEY (userid, tenantid) REFERENCES eg_user (id, tenantid);
