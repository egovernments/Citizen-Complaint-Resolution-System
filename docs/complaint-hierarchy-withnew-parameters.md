# PGR — Complaint Category & Authority Field Implementation Spec

**Feature:** Add `category` and `authority` as optional MIS fields to the PGR complaint type master and API  
**Scope:** MDMS schema, backend (pgr-services), frontend (useServiceDefs hook), MZ seed data  
**Backward compatibility:** Full — Nairobi (ke) and all existing tenants require zero migration  
**API version:** No version bump — additive change to existing v2 API

---

## 1. Context & Decision Record

### Problem
Mozambique (MZ) requires complaints to be tagged with:
- **Category** — the nature of the petition (e.g. `PETITION`, `GRIEVANCE`)
- **Authority** — the receiving authority (e.g. `IGE`)

These are MIS/reporting fields and do NOT affect the complaint workflow.

### Decision
> Do NOT introduce hierarchical masters. Stick with the current flat `ServiceDefs` master.  
> Add `category` and `authority` as **optional** fields to `ServiceDefs`.  
> Add a new `ComplaintCategory` master to enumerate valid category values.  
> Add a new `ComplaintTypeDepartments` master to support many-to-many department mapping (replaces the single `department` string on a per-tenant basis).  
> `department` field in `ServiceDefs` is **kept as-is** for backward compatibility.

### What is NOT in scope
- Workflow changes — category/authority are read-only MIS tags
- v3 API — no versioning needed

---

## 2. MDMS Changes

### 2.1 Update `ServiceDefs` JSON Schema

**File:** `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json`

In the `RAINMAKER-PGR.ServiceDefs` definition object, make two changes:

**a) Change `additionalProperties` from `false` to `true`** (or add the new fields to `properties`).  
Preferred: add the fields explicitly to `properties`.

**b) Add the following two optional properties** (do NOT add them to `required`):

```json
"category": {
  "type": "string",
  "description": "MIS classification of the complaint (e.g. PETITION, GRIEVANCE). Optional. Null means no category."
},
"authority": {
  "type": "string",
  "description": "Receiving authority code (e.g. IGE). Optional. Null means default routing."
}
```

**Full updated `properties` block for `RAINMAKER-PGR.ServiceDefs`:**

```json
"properties": {
  "name":         { "type": "string" },
  "order":        { "type": "number" },
  "active":       { "type": "boolean" },
  "keywords":     { "type": "string" },
  "menuPath":     { "type": "string" },
  "slaHours":     { "type": "number" },
  "department":   { "type": "string" },
  "serviceCode":  { "type": "string" },
  "menuPathName": { "type": "string" },
  "category": {
    "type": "string",
    "description": "MIS complaint category code. Optional."
  },
  "authority": {
    "type": "string",
    "description": "Receiving authority code. Optional."
  }
}
```

`required` array stays unchanged: `["serviceCode","name","keywords","department","slaHours","active"]`  
`additionalProperties` stays `false` (fields are now explicit).

---

### 2.2 Add `ComplaintCategory` Master Schema

**File:** `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json`

Append a new schema entry to the array:

```json
{
  "tenantId": "{tenantid}",
  "code": "RAINMAKER-PGR.ComplaintCategory",
  "description": "Enumeration of complaint categories for MIS tagging (e.g. PETITION, GRIEVANCE).",
  "isActive": true,
  "definition": {
    "type": "object",
    "title": "ComplaintCategory",
    "$schema": "http://json-schema.org/draft-07/schema#",
    "required": ["code", "name", "active"],
    "x-unique": ["code"],
    "properties": {
      "code":        { "type": "string" },
      "name":        { "type": "string" },
      "active":      { "type": "boolean" },
      "description": { "type": "string" }
    },
    "x-ref-schema": [],
    "additionalProperties": false
  }
}
```

---

### 2.3 Add `ComplaintTypeDepartments` Master Schema

**File:** `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json`

Append another schema entry:

```json
{
  "tenantId": "{tenantid}",
  "code": "RAINMAKER-PGR.ComplaintTypeDepartments",
  "description": "Many-to-many mapping of serviceCode to departments. Overrides ServiceDefs.department when present for a tenant.",
  "isActive": true,
  "definition": {
    "type": "object",
    "title": "ComplaintTypeDepartments",
    "$schema": "http://json-schema.org/draft-07/schema#",
    "required": ["serviceCode", "departments"],
    "x-unique": ["serviceCode"],
    "properties": {
      "serviceCode": {
        "type": "string"
      },
      "departments": {
        "type": "array",
        "items": { "type": "string" },
        "minItems": 1
      },
      "primaryDepartment": {
        "type": "string",
        "description": "Used when a single department is needed (e.g. notifications, assignment). Defaults to departments[0] if omitted."
      }
    },
    "x-ref-schema": [],
    "additionalProperties": false
  }
}
```

---

### 2.4 Dev-mode seed data — `ComplaintCategory`

**New file:** `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.ComplaintCategory.json`

```json
[
  {
    "tenantId": "mz",
    "data": {
      "code": "PETITION",
      "name": "Petition",
      "active": true,
      "description": "Formal complaint submitted as a legal petition."
    }
  },
  {
    "tenantId": "mz",
    "data": {
      "code": "GRIEVANCE",
      "name": "Grievance",
      "active": true,
      "description": "General service delivery grievance."
    }
  }
]
```

---

## 3. Backend Changes — `pgr-services`

### 3.1 `Service.java` — Add two optional fields

**File:** `backend/pgr-services/src/main/java/org/egov/pgr/web/models/Service.java`

Add after the `source` field:

```java
@SafeHtml
@JsonProperty("category")
private String category = null;

@SafeHtml
@JsonProperty("authority")
private String authority = null;
```

- Both fields are `null` by default — existing records and existing clients are unaffected.
- `@SafeHtml` follows the pattern of all other string fields in this class.
- No `@NotNull` — these are optional.

---

### 3.2 `PGRConstants.java` — Add new JSONPath constants

**File:** `backend/pgr-services/src/main/java/org/egov/pgr/util/PGRConstants.java`

Add at the bottom of the constants block:

```java
public static final String MDMS_SERVICEDEF_CATEGORY_JSONPATH =
    "$.MdmsRes.RAINMAKER-PGR.ServiceDefs[?(@.serviceCode=='{SERVICEDEF}')].category";

public static final String MDMS_SERVICEDEF_AUTHORITY_JSONPATH =
    "$.MdmsRes.RAINMAKER-PGR.ServiceDefs[?(@.serviceCode=='{SERVICEDEF}')].authority";

public static final String MDMS_COMPLAINT_CATEGORY = "ComplaintCategory";

public static final String MDMS_COMPLAINT_TYPE_DEPARTMENTS = "ComplaintTypeDepartments";

public static final String MDMS_COMPLAINT_TYPE_DEPTS_JSONPATH =
    "$.MdmsRes.RAINMAKER-PGR.ComplaintTypeDepartments[?(@.serviceCode=='{SERVICEDEF}')]";
```

---

### 3.3 `MDMSUtils.java` — Fetch `ComplaintCategory` and `ComplaintTypeDepartments`

**File:** `backend/pgr-services/src/main/java/org/egov/pgr/util/MDMSUtils.java`

In `getPGRModuleRequest()`, add two more `MasterDetail` entries alongside the existing `ServiceDefs` fetch:

```java
private List<ModuleDetail> getPGRModuleRequest() {
    List<MasterDetail> pgrMasterDetails = new ArrayList<>();
    final String filterCode = "$.[?(@.active==true)]";

    pgrMasterDetails.add(MasterDetail.builder().name(MDMS_SERVICEDEF).filter(filterCode).build());

    // NEW: fetch ComplaintCategory master (used for validation and UI rendering)
    pgrMasterDetails.add(MasterDetail.builder().name(MDMS_COMPLAINT_CATEGORY).filter(filterCode).build());

    // NEW: fetch ComplaintTypeDepartments master (optional multi-dept mapping)
    pgrMasterDetails.add(MasterDetail.builder().name(MDMS_COMPLAINT_TYPE_DEPARTMENTS).build());

    ModuleDetail pgrModuleDtls = ModuleDetail.builder()
        .masterDetails(pgrMasterDetails)
        .moduleName(MDMS_MODULE_NAME).build();

    return Collections.singletonList(pgrModuleDtls);
}
```

> **Note:** `ComplaintTypeDepartments` has no active filter because a department mapping record does not have an `active` flag — its presence alone means it applies.

---

### 3.4 `EnrichmentService.java` — Populate `category` and `authority` on create

**File:** `backend/pgr-services/src/main/java/org/egov/pgr/service/EnrichmentService.java`

In `enrichCreateRequest()`, after the existing `service.setServiceRequestId(...)` call, add:

```java
// Enrich category and authority from MDMS ServiceDefs if not already supplied by client
if (service.getCategory() == null || service.getAuthority() == null) {
    enrichCategoryAndAuthority(service, mdmsData);
}
```

Add the helper method to the class:

```java
/**
 * Copies category and authority from the matching ServiceDefs MDMS record onto the
 * Service object. Both fields are optional in MDMS — if absent the fields stay null,
 * which preserves backward-compatible behaviour for tenants that do not use them.
 *
 * @param service   the Service being created
 * @param mdmsData  raw MDMS response object
 */
private void enrichCategoryAndAuthority(Service service, Object mdmsData) {
    String serviceCode = service.getServiceCode();
    try {
        String categoryPath = MDMS_SERVICEDEF_CATEGORY_JSONPATH.replace("{SERVICEDEF}", serviceCode);
        List<String> categories = JsonPath.read(mdmsData, categoryPath);
        if (!CollectionUtils.isEmpty(categories) && service.getCategory() == null) {
            service.setCategory(categories.get(0));
        }

        String authorityPath = MDMS_SERVICEDEF_AUTHORITY_JSONPATH.replace("{SERVICEDEF}", serviceCode);
        List<String> authorities = JsonPath.read(mdmsData, authorityPath);
        if (!CollectionUtils.isEmpty(authorities) && service.getAuthority() == null) {
            service.setAuthority(authorities.get(0));
        }
    } catch (Exception e) {
        log.warn("Could not enrich category/authority for serviceCode={} — fields will be null", serviceCode, e);
    }
}
```

**Important:** `enrichCreateRequest` needs `mdmsData` passed in. Check the call site in `PGRService.java` — if `mdmsData` is already fetched before `enrichmentService.enrichCreateRequest(...)` is called, pass it through. If not, fetch it first and pass the result. Do not call MDMS a second time.

---

### 3.5 `ServiceRequestValidator.java` — Validate `category` against MDMS

**File:** `backend/pgr-services/src/main/java/org/egov/pgr/validator/ServiceRequestValidator.java`

If a `category` value is supplied by the client (i.e. not null), validate it against `RAINMAKER-PGR.ComplaintCategory`:

```java
private void validateCategory(Service service, Object mdmsData) {
    if (service.getCategory() == null) return;

    List<Object> categories = JsonPath.read(
        mdmsData,
        "$.MdmsRes.RAINMAKER-PGR.ComplaintCategory[?(@.code=='" + service.getCategory() + "' && @.active==true)]"
    );
    if (CollectionUtils.isEmpty(categories)) {
        throw new CustomException(
            "INVALID_COMPLAINT_CATEGORY",
            "Complaint category '" + service.getCategory() + "' does not exist or is inactive."
        );
    }
}
```

Call this from the existing `validateServiceDefinition(...)` method or create a dedicated `validateCreate(...)` gate method that calls both.

---

### 3.6 Database — No schema change required

`category` and `authority` are MDMS-derived fields enriched at create time. They are written into the existing `additionaldetails` JSONB column — no migration needed.

At the end of `enrichCategoryAndAuthority`, after resolving both values, merge them into `additionalDetail`:

```java
// Persist category/authority into additionaldetails JSONB — no DB migration needed
Map<String, Object> additional = service.getAdditionalDetail() != null
    ? new ObjectMapper().convertValue(service.getAdditionalDetail(), Map.class)
    : new LinkedHashMap<>();
if (category != null) additional.put("category", category);
if (authority != null) additional.put("authority", authority);
service.setAdditionalDetail(additional);
```

On GET, the `additionaldetails` JSONB is already returned as-is inside `Service.additionalDetail`, so `category` and `authority` are readable by the UI and downstream consumers without any additional mapping.

---

## 4. Frontend Changes

### 4.1 `useServiceDefs` hook

**Files (update all three):**
- `frontend/micro-ui/web/micro-ui-internals/packages/modules/pgr/src/hooks/pgr/useServiceDefs.js`
- `digit-ui-esbuild/packages/libraries/src/hooks/pgr/useServiceDefs.js`
- `digit-ui-v2/src/hooks/useServiceDefs.ts`

The hook already fetches and returns `ServiceDefs` objects. No structural change is needed — the returned objects will automatically include `category` and `authority` once MDMS has them.

**UI rendering rule:** When `category` or `authority` is present on a complaint, render it as a read-only label in the complaint detail view. Do not render the field at all when the value is `null`/`undefined` — this keeps the Nairobi UI unchanged.

Example pattern in the complaint detail component:

```jsx
{complaint.category && (
  <LabelValuePair label={t("PGR_COMPLAINT_CATEGORY")} value={t(`PGR_CATEGORY_${complaint.category}`)} />
)}
{complaint.authority && (
  <LabelValuePair label={t("PGR_AUTHORITY")} value={complaint.authority} />
)}
```

### 4.2 Localisation keys to add (MZ locale file only)

```json
"PGR_COMPLAINT_CATEGORY": "Complaint Category",
"PGR_AUTHORITY": "Authority",
"PGR_CATEGORY_PETITION": "Petition",
"PGR_CATEGORY_GRIEVANCE": "Grievance"
```

---

## 5. MZ Seed Script

**New file:** `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.mz.json`

> Or update the existing MZ ServiceDefs seed file. The script below shows the pattern for each entry that needs `category` and `authority`.

```json
[
  {
    "tenantId": "mz",
    "data": {
      "serviceCode": "NoStreetlight",
      "name": "No Street Light",
      "keywords": "streetlight, light, repair, work, pole, electric, power, repair, damage, fix",
      "department": "Streetlights",
      "slaHours": 336,
      "menuPath": "StreetLights",
      "active": true,
      "order": 1,
      "category": "PETITION",
      "authority": "IGE"
    }
  }
]
```

Repeat the `category` and `authority` values for **every MZ ServiceDefs entry** that should be tagged.  
Entries without `category`/`authority` are valid — the fields are optional.

---

## 6. Backward Compatibility Matrix

| Tenant | ServiceDefs change | API change | DB change | Action required |
|---|---|---|---|---|
| `ke.nairobi` | None — existing records have no `category`/`authority` | `category`/`authority` absent from `additionalDetail` | No change | None |
| `mz` (new) | Add `category` + `authority` to each ServiceDefs record | Fields populated from MDMS on create | Seeded on first deployment | Run seed script post-deploy |
| Any future tenant | Opt-in — add fields to their ServiceDefs MDMS | Same behavior | Same | Nothing — works out of the box |

**Existing API clients** that do not send `category`/`authority` on POST/PUT:
- Fields default to null → MDMS enrichment populates them from ServiceDefs
- If ServiceDefs has no value, they stay null → no error, no behavioral change

---

## 7. File Checklist

| File | Change type |
|---|---|
| `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json` | Modify: add `category`, `authority` to ServiceDefs properties; add `ComplaintCategory` and `ComplaintTypeDepartments` schema entries |
| `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.ComplaintCategory.json` | New file |
| `ansible/nairobi-mdms/mdms/RAINMAKER-PGR/ServiceDefs.json` | No change (Nairobi data) |
| `backend/pgr-services/.../web/models/Service.java` | Modify: add `category` and `authority` fields |
| `backend/pgr-services/.../util/PGRConstants.java` | Modify: add JSONPath constants for category, authority, ComplaintTypeDepartments |
| `backend/pgr-services/.../util/MDMSUtils.java` | Modify: fetch `ComplaintCategory` and `ComplaintTypeDepartments` in `getPGRModuleRequest()` |
| `backend/pgr-services/.../service/EnrichmentService.java` | Modify: enrich `category` and `authority` from MDMS on create |
| `backend/pgr-services/.../validator/ServiceRequestValidator.java` | Modify: validate `category` against `ComplaintCategory` master |
| `backend/pgr-services/.../repository/*.java` | No change — `additionaldetails` JSONB already persisted and returned |
| `frontend/.../hooks/pgr/useServiceDefs.js` (×3) | No structural change; ensure new fields pass through |
| Frontend complaint detail component | Modify: render `category` and `authority` when non-null |
| MZ locale file | Add 4 localisation keys |
| MZ ServiceDefs seed data | New/updated: add `category` + `authority` to each MZ service type |

---

## 8. Testing Checklist

- [ ] POST `/pgr/v2/requests` with a MZ serviceCode → response contains `category: "PETITION"` and `authority: "IGE"`
- [ ] POST `/pgr/v2/requests` with a KE serviceCode → response `category` and `authority` are null
- [ ] POST with an invalid `category` value → returns `INVALID_COMPLAINT_CATEGORY` error
- [ ] POST without `category` field → no error, field is enriched from MDMS
- [ ] GET `/pgr/v2/requests` for existing KE complaints → `additionalDetail` has no `category`/`authority` keys (no regression)
- [ ] MDMS search for `RAINMAKER-PGR.ComplaintCategory` returns seeded MZ records
- [ ] UI on Nairobi: complaint detail page shows no category/authority labels
- [ ] UI on MZ: complaint detail page shows category and authority labels