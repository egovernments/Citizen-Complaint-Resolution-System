-- Add param_order and required_vars columns to template_binding
-- These are JSON arrays stored as TEXT, e.g. '["complaintNo","citizenName","department"]'
ALTER TABLE template_binding ADD COLUMN IF NOT EXISTS param_order TEXT;
ALTER TABLE template_binding ADD COLUMN IF NOT EXISTS required_vars TEXT;
