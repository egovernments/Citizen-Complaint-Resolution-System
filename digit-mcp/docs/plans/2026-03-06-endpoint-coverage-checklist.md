# Endpoint Coverage Checklist

> Comprehensive audit of every DIGIT API endpoint: whether the data-provider package has a client method, whether it's exposed as a DataProvider resource, and whether it has integration test coverage.

**Legend:**
- ✅ = Done
- ❌ = Missing
- ➖ = N/A (not applicable for this column)
- 🔶 = Partial

---

## Service 1: Authentication (`egov-user`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 1 | AUTH | `/user/oauth/token` | ✅ `login()` | ➖ (infra) | ✅ `before()` hook |
| 2 | USER_SEARCH | `/user/_search` | ✅ `userSearch()` | ❌ | ❌ |
| 3 | USER_CREATE | `/user/users/_createnovalidate` | ✅ `userCreate()` | ❌ | ❌ |
| 4 | USER_UPDATE | `/user/users/_updatenovalidate` | ✅ `userUpdate()` | ❌ | ❌ |

**Workflow context:** User create/update is needed for citizen registration (before PGR) and cross-tenant role assignment. MCP server uses all 3.

---

## Service 2: MDMS v2 (`egov-mdms-service`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 5 | MDMS_SEARCH | `/egov-mdms-service/v2/_search` | ✅ `mdmsSearch()` | ✅ (8 dedicated + 24 generic) | ✅ Full CRUD |
| 6 | MDMS_CREATE | `/egov-mdms-service/v2/_create` | ✅ `mdmsCreate()` | ✅ | ✅ |
| 7 | MDMS_UPDATE | `/egov-mdms-service/v2/_update` | ✅ `mdmsUpdate()` | ✅ | ✅ |
| 8 | MDMS_SCHEMA_SEARCH | `/mdms-v2/schema/v1/_search` | ✅ `mdmsSchemaSearch()` | ❌ | ❌ |
| 9 | MDMS_SCHEMA_CREATE | `/mdms-v2/schema/v1/_create` | ✅ `mdmsSchemaCreate()` | ❌ | ❌ |

**Workflow context:** Schema search/create is needed when bootstrapping a new tenant — schemas must exist before MDMS data records can be created.

---

## Service 3: Boundary Service (`boundary-service`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 10 | BOUNDARY_SEARCH | `/boundary-service/boundary/_search` | ✅ `boundarySearch()` | ✅ (via getOne/update) | ✅ |
| 11 | BOUNDARY_CREATE | `/boundary-service/boundary/_create` | ✅ `boundaryCreate()` | ✅ | ✅ |
| 12 | BOUNDARY_UPDATE | `/boundary-service/boundary/_update` | ✅ `boundaryUpdate()` | ✅ | ✅ |
| 13 | BOUNDARY_DELETE | `/boundary-service/boundary/_delete` | ✅ `boundaryDelete()` | ✅ | ✅ |
| 14 | BOUNDARY_HIERARCHY_SEARCH | `/boundary-service/boundary-hierarchy-definition/_search` | ✅ `boundaryHierarchySearch()` | ❌ | ❌ |
| 15 | BOUNDARY_HIERARCHY_CREATE | `/boundary-service/boundary-hierarchy-definition/_create` | ✅ `boundaryHierarchyCreate()` | ❌ | ❌ |
| 16 | BOUNDARY_RELATIONSHIP_SEARCH | `/boundary-service/boundary-relationships/_search` | ✅ `boundaryRelationshipSearch()` | ✅ (via getList) | ✅ |
| 17 | BOUNDARY_RELATIONSHIP_CREATE | `/boundary-service/boundary-relationships/_create` | ✅ `boundaryRelationshipCreate()` | ✅ (via create) | ✅ |
| 18 | BOUNDARY_RELATIONSHIP_UPDATE | `/boundary-service/boundary-relationships/_update` | ❌ | ❌ | ❌ |
| 19 | BOUNDARY_RELATIONSHIP_DELETE | `/boundary-service/boundary-relationships/_delete` | ✅ `boundaryRelationshipDelete()` | ✅ (via delete) | ✅ |

**Workflow context:** Hierarchy search/create is needed when bootstrapping a new tenant — the hierarchy definition (Country > State > District > City > Ward > Locality) must exist before any boundary entities or relationships.

---

## Service 4: HRMS (`egov-hrms`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 20 | HRMS_EMPLOYEES_SEARCH | `/egov-hrms/employees/_search` | ✅ `employeeSearch()` | ✅ | ✅ |
| 21 | HRMS_EMPLOYEES_CREATE | `/egov-hrms/employees/_create` | ✅ `employeeCreate()` | ✅ | ✅ |
| 22 | HRMS_EMPLOYEES_UPDATE | `/egov-hrms/employees/_update` | ✅ `employeeUpdate()` | ✅ | ✅ |

**Status:** Fully covered.

---

## Service 5: Localization (`egov-localization`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 23 | LOCALIZATION_SEARCH | `/localization/messages/v1/_search` | ✅ `localizationSearch()` | ✅ | ✅ |
| 24 | LOCALIZATION_UPSERT | `/localization/messages/v1/_upsert` | ✅ `localizationUpsert()` | ✅ | ✅ |
| 25 | LOCALIZATION_DELETE | `/localization/messages/v1/_delete` | ✅ `localizationDelete()` | ✅ | ✅ |

**Status:** Fully covered.

---

## Service 6: PGR (`pgr-services`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 26 | PGR_SEARCH | `/pgr-services/v2/request/_search` | ✅ `pgrSearch()` | ✅ | ✅ |
| 27 | PGR_CREATE | `/pgr-services/v2/request/_create` | ✅ `pgrCreate()` | ✅ | ✅ |
| 28 | PGR_UPDATE | `/pgr-services/v2/request/_update` | ✅ `pgrUpdate()` | ✅ | 🔶 Only REJECT action |

**Workflow context:** PGR update supports 6 actions: ASSIGN, REASSIGN, RESOLVE, REJECT, REOPEN, RATE. Only REJECT is tested. A full lifecycle test (create → ASSIGN → RESOLVE → RATE) would cover the rest.

---

## Service 7: Workflow (`egov-workflow-v2`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 29 | WORKFLOW_BUSINESS_SERVICE_SEARCH | `/egov-workflow-v2/egov-wf/businessservice/_search` | ✅ `workflowBusinessServiceSearch()` | ❌ | 🔶 Used in before() |
| 30 | WORKFLOW_BUSINESS_SERVICE_CREATE | `/egov-workflow-v2/egov-wf/businessservice/_create` | ✅ `workflowBusinessServiceCreate()` | ❌ | 🔶 Used in before() |
| 31 | WORKFLOW_PROCESS_SEARCH | `/egov-workflow-v2/egov-wf/process/_search` | ✅ `workflowProcessSearch()` | ❌ | ❌ |

**Workflow context:** Business service search/create is used in the test setup but never tested as a resource. Process search provides the audit trail for complaint lifecycle (who acted, when, what state transitions).

---

## Service 8: Access Control (`egov-accesscontrol`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 32 | ACCESS_ROLES_SEARCH | `/access/v1/roles/_search` | ✅ `accessRolesSearch()` | ❌ | ❌ |
| 33 | ACCESS_ACTIONS_SEARCH | `/access/v1/actions/_search` | ❌ | ❌ | ❌ |

**Workflow context:** Roles search is used to verify employee role assignments. Actions search shows what API endpoints each role can access (debugging permissions).

---

## Service 9: ID Generation (`egov-idgen`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 34 | IDGEN_GENERATE | `/egov-idgen/id/_generate` | ✅ `idgenGenerate()` | ❌ | ❌ |

**Workflow context:** Used to generate formatted IDs (complaint numbers, application numbers). Tests would verify ID format patterns work correctly.

---

## Service 10: Filestore (`egov-filestore`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 35 | FILESTORE_UPLOAD | `/filestore/v1/files` | ❌ | ❌ | ❌ |
| 36 | FILESTORE_URL | `/filestore/v1/files/url` | ✅ `filestoreGetUrl()` | ❌ | ❌ |

**Workflow context:** MCP server has `filestoreUpload()` but data-provider doesn't. Upload is needed for complaint photo attachments and boundary data files.

---

## Service 11: Encryption (`egov-enc-service`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 37 | ENC_ENCRYPT | `/egov-enc-service/crypto/v1/_encrypt` | ✅ `encryptData()` | ❌ | ❌ |
| 38 | ENC_DECRYPT | `/egov-enc-service/crypto/v1/_decrypt` | ✅ `decryptData()` | ❌ | ❌ |

**Workflow context:** Used for PII handling — citizen phone numbers and names are encrypted at rest. A round-trip test (encrypt → decrypt → verify) would validate the service.

---

## Service 12: Location (legacy) (`egov-location`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 39 | LOCATION_BOUNDARY_SEARCH | `/egov-location/location/v11/boundarys/_search` | ❌ | ❌ | ❌ |

**Workflow context:** Legacy boundary service, superseded by boundary-service. MCP server has the method. Low priority — may not even be deployed.

---

## Service 13: Boundary Management (`egov-bndry-mgmnt`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 40 | BNDRY_MGMT_PROCESS | `/egov-bndry-mgmnt/v1/_process` | ❌ | ❌ | ❌ |
| 41 | BNDRY_MGMT_GENERATE | `/egov-bndry-mgmnt/v1/_generate` | ❌ | ❌ | ❌ |
| 42 | BNDRY_MGMT_PROCESS_SEARCH | `/egov-bndry-mgmnt/v1/_process-search` | ❌ | ❌ | ❌ |
| 43 | BNDRY_MGMT_GENERATE_SEARCH | `/egov-bndry-mgmnt/v1/_generate-search` | ❌ | ❌ | ❌ |

**Workflow context:** Used for bulk boundary import via Excel file upload. MCP server has all 4 methods. These work together: upload file → process → generate codes → download results.

---

## Service 14: Inbox (`inbox`)

| # | Endpoint | Path | Client Method | DataProvider Resource | Integration Test |
|---|----------|------|---------------|----------------------|------------------|
| 44 | INBOX_V2_SEARCH | `/inbox/v2/_search` | ❌ | ❌ | ❌ |

**Workflow context:** Unified inbox for employees — shows pending PGR complaints assigned to them. MCP server doesn't have this method either.

---

## Summary Scorecard

| Metric | Count | Total | % |
|--------|-------|-------|---|
| Endpoints with client methods | 36 | 44 | 82% |
| Endpoints with DataProvider resource | 17 | 44 | 39% |
| Endpoints with integration tests | 17 | 44 | 39% |
| Client methods with integration tests | 22 | 36 | 61% |

### Gaps by Priority

**High — Used in real workflows, no test coverage:**

| # | Endpoint | Missing |
|---|----------|---------|
| 2-4 | User search/create/update | Client method ✅, resource ❌, test ❌ |
| 29-31 | Workflow search/create/process | Client method ✅, resource ❌, test ❌ |
| 28 | PGR update (ASSIGN/RESOLVE/RATE) | Client method ✅, resource ✅, test 🔶 |
| 32 | Access roles search | Client method ✅, resource ❌, test ❌ |
| 37-38 | Encrypt/decrypt | Client method ✅, resource ❌, test ❌ |

**Medium — Needed for tenant bootstrap:**

| # | Endpoint | Missing |
|---|----------|---------|
| 8-9 | MDMS schema search/create | Client method ✅, resource ❌, test ❌ |
| 14-15 | Boundary hierarchy search/create | Client method ✅, resource ❌, test ❌ |
| 34 | ID generation | Client method ✅, resource ❌, test ❌ |

**Low — Missing client methods entirely:**

| # | Endpoint | Missing |
|---|----------|---------|
| 18 | Boundary relationship update | Client method ❌ |
| 33 | Access actions search | Client method ❌ |
| 35 | Filestore upload | Client method ❌ |
| 39 | Location boundary search (legacy) | Client method ❌ |
| 40-43 | Boundary management (4 endpoints) | Client method ❌ |
| 44 | Inbox v2 search | Client method ❌ |
