# API Reference

> Complete reference for all 60 DIGIT MCP Server tools, grouped by domain.

Tools are organized into 14 groups. Only `core` and `docs` are enabled by default — use [`enable_tools`](tools/enable_tools.md) to unlock additional groups.

---

## Core (always enabled)

| Tool | Risk | Description |
|------|------|-------------|
| [init](tools/init.md) | write | Initialize a session with intent-based group auto-enable |
| [session_checkpoint](tools/session_checkpoint.md) | write | Record progress checkpoint |
| [discover_tools](tools/discover_tools.md) | read | List all tools and their groups |
| [enable_tools](tools/enable_tools.md) | read | Enable/disable tool groups on demand |
| [configure](tools/configure.md) | read | Authenticate with a DIGIT environment |
| [get_environment_info](tools/get_environment_info.md) | read | Show current environment config |
| [mdms_get_tenants](tools/mdms_get_tenants.md) | read | List all tenants from MDMS |
| [health_check](tools/health_check.md) | read | Probe all DIGIT services |

## MDMS & Tenants (`mdms`)

| Tool | Risk | Description |
|------|------|-------------|
| [validate_tenant](tools/validate_tenant.md) | read | Check if a tenant code exists |
| [mdms_search](tools/mdms_search.md) | read | Search MDMS v2 records by schema code |
| [mdms_create](tools/mdms_create.md) | write | Create a new MDMS v2 record |
| [mdms_schema_search](tools/mdms_schema_search.md) | read | Search MDMS schema definitions |
| [mdms_schema_create](tools/mdms_schema_create.md) | write | Register a new MDMS schema |
| [tenant_bootstrap](tools/tenant_bootstrap.md) | write | Bootstrap a new state-level tenant root |
| [city_setup](tools/city_setup.md) | write | Set up a city tenant with PGR prerequisites |
| [tenant_cleanup](tools/tenant_cleanup.md) | write | Soft-delete all MDMS data for a tenant |

## Boundaries (`boundary`)

| Tool | Risk | Description |
|------|------|-------------|
| [validate_boundary](tools/validate_boundary.md) | read | Validate boundary hierarchy setup |
| [boundary_hierarchy_search](tools/boundary_hierarchy_search.md) | read | Search boundary hierarchy definitions |
| [boundary_create](tools/boundary_create.md) | write | Create boundaries from JSON |
| [boundary_mgmt_process](tools/boundary_mgmt_process.md) | write | Process boundary data via management service |
| [boundary_mgmt_search](tools/boundary_mgmt_search.md) | read | Search processed boundary data |
| [boundary_mgmt_generate](tools/boundary_mgmt_generate.md) | write | Generate boundary codes |
| [boundary_mgmt_download](tools/boundary_mgmt_download.md) | read | Download generated boundary codes |

## Master Data (`masters`)

| Tool | Risk | Description |
|------|------|-------------|
| [validate_departments](tools/validate_departments.md) | read | Validate department records |
| [validate_designations](tools/validate_designations.md) | read | Validate designation records |
| [validate_complaint_types](tools/validate_complaint_types.md) | read | Validate PGR service definitions |

## Employees (`employees`)

| Tool | Risk | Description |
|------|------|-------------|
| [validate_employees](tools/validate_employees.md) | read | Validate HRMS employee setup |
| [employee_create](tools/employee_create.md) | write | Create a new HRMS employee |
| [employee_update](tools/employee_update.md) | write | Update an existing employee |

## User Management (part of `admin`)

| Tool | Risk | Description |
|------|------|-------------|
| [user_search](tools/user_search.md) | read | Search platform users |
| [user_create](tools/user_create.md) | write | Create a new user |
| [user_role_add](tools/user_role_add.md) | write | Add cross-tenant roles to a user |

## Localization (`localization`)

| Tool | Risk | Description |
|------|------|-------------|
| [localization_search](tools/localization_search.md) | read | Search UI label translations |
| [localization_upsert](tools/localization_upsert.md) | write | Create or update UI labels |

## PGR & Workflow (`pgr`)

| Tool | Risk | Description |
|------|------|-------------|
| [pgr_search](tools/pgr_search.md) | read | Search PGR complaints |
| [pgr_create](tools/pgr_create.md) | write | Create a new complaint |
| [pgr_update](tools/pgr_update.md) | write | Update complaint via workflow action |
| [workflow_business_services](tools/workflow_business_services.md) | read | Search workflow state machine definitions |
| [workflow_process_search](tools/workflow_process_search.md) | read | Search workflow audit trail |
| [workflow_create](tools/workflow_create.md) | write | Create workflow definitions |

## Administration (`admin`)

| Tool | Risk | Description |
|------|------|-------------|
| [filestore_get_urls](tools/filestore_get_urls.md) | read | Get download URLs for stored files |
| [filestore_upload](tools/filestore_upload.md) | write | Upload a file to filestore |
| [access_roles_search](tools/access_roles_search.md) | read | Search access control roles |
| [access_actions_search](tools/access_actions_search.md) | read | Search role permissions |

## ID Generation (`idgen`)

| Tool | Risk | Description |
|------|------|-------------|
| [idgen_generate](tools/idgen_generate.md) | write | Generate unique formatted IDs |

## Location (`location`)

| Tool | Risk | Description |
|------|------|-------------|
| [location_search](tools/location_search.md) | read | Search geographic boundaries (legacy) |

## Encryption (`encryption`)

| Tool | Risk | Description |
|------|------|-------------|
| [encrypt_data](tools/encrypt_data.md) | write | Encrypt sensitive data |
| [decrypt_data](tools/decrypt_data.md) | write | Decrypt encrypted data |

## Documentation (`docs`)

| Tool | Risk | Description |
|------|------|-------------|
| [docs_search](tools/docs_search.md) | read | Search DIGIT documentation |
| [docs_get](tools/docs_get.md) | read | Fetch a documentation page |
| [api_catalog](tools/api_catalog.md) | read | Get OpenAPI 3.0 API catalog |

## Monitoring (`monitoring`)

| Tool | Risk | Description |
|------|------|-------------|
| [kafka_lag](tools/kafka_lag.md) | read | Check Kafka consumer group lag |
| [persister_errors](tools/persister_errors.md) | read | Scan persister error logs |
| [db_counts](tools/db_counts.md) | read | Get database table row counts |
| [persister_monitor](tools/persister_monitor.md) | read | Comprehensive persister health check |

## Tracing (`tracing`)

| Tool | Risk | Description |
|------|------|-------------|
| [tracing_health](tools/tracing_health.md) | read | Check tracing infrastructure health |
| [trace_search](tools/trace_search.md) | read | Search distributed traces |
| [trace_get](tools/trace_get.md) | read | Get full trace details |
| [trace_debug](tools/trace_debug.md) | read | One-call API failure debugger |
| [trace_slow](tools/trace_slow.md) | read | Find slow traces |
