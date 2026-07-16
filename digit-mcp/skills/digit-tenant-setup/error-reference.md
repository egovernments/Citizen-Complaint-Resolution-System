# DIGIT Tenant Setup — Error Reference

Common errors during tenant setup and their fixes.

| Error | Cause | Fix |
|-------|-------|-----|
| Schema definition not found | Schema not registered at target tenant root | `mdms_schema_create(tenant_id="<root>", code="<schema>", copy_from_tenant="pg")` |
| extraneous key [menuPath] / [menuPathName] | Leftover from the old ServiceDefs model | Drop both. Grouping is now the tree: set the leaf's `parentCode` to a CATEGORY node in `RAINMAKER-PGR.ComplaintHierarchy` |
| extraneous key [description] | ComplaintHierarchy row includes unsupported field | Remove `description` from the row data |
| Unable to create ids | IdFormat records missing at tenant root | Run `tenant_bootstrap(target_tenant="<root>")` to seed IdFormat |
| ACCESSCONTROL-ROLES has 0 records | Roles not bootstrapped | Seed roles via `mdms_create` or re-run `tenant_bootstrap` |
| businessService PGR not found | Workflow not registered for tenant | `workflow_create(tenant_id="<root>", copy_from_tenant="pg.citya")` |
| User is not authorized (APPLY) | User's roles not scoped to target tenant | Authenticate as tenant employee, or `user_role_add(tenant_id="<root>")` |
| Failed to parse mdms response for service: X | Leaf complaint type missing at state root | `mdms_create` the leaf row in `RAINMAKER-PGR.ComplaintHierarchy` at the root tenant (not just city) |
| userName=null on employee create | Known HRMS bug in `hrms-boundary-0a4e737` | Retry; if persistent, the HRMS image needs updating |
| loginTenantId = "pg" after employee login | Employee's mobile number already existed as a pg user | Use a different, unique mobile number for the employee |
| keywords must be string, got array | keywords field sent as JSON array | Use plain string: `"road,pothole"` not `["road","pothole"]` |
| Tracer exception on ASSIGN | Passed explicit assignees UUIDs | Omit `assignees` parameter — let PGR auto-route |
