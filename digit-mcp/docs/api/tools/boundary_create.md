# boundary_create

> Create boundary hierarchy definitions and boundary entities from a flat JSON list, with no Excel file required.

**Group:** `boundary` | **Risk:** `write` | **DIGIT Service:** `boundary-service`

## Description

The `boundary_create` tool provisions a complete boundary structure for a tenant by calling the boundary-service APIs directly. It replaces the traditional Excel-upload workflow used by `egov-bndry-mgmnt` with a simpler JSON-based approach. The tool accepts a flat list of boundaries (each with a code, type, and optional parent) and processes them in three steps.

**Step 1 -- Hierarchy definition.** If `hierarchy_definition` is provided, the tool creates the hierarchy type definition (e.g. Country > State > City > Ward > Locality) on both the city tenant and the state root tenant. The state root copy is required because the DIGIT UI queries boundaries at the state level. If the hierarchy already exists (DUPLICATE error), the tool silently continues. If `hierarchy_definition` is omitted, the tool fetches the existing hierarchy for the tenant and uses its level order.

**Step 2 -- Entity creation.** Boundary entities are created in batches of 50 via `boundaryCreate`. If a batch fails (e.g. due to a duplicate), the tool falls back to creating entities one by one, skipping any that already exist. This makes the tool safe to call repeatedly (idempotent for the entity-creation step).

**Step 3 -- Relationship creation.** Parent-child relationships are created top-down, ordered by hierarchy level. Each boundary is linked to its parent via `boundaryRelationshipCreate`. Duplicates are skipped. This step is what makes the boundaries appear as a tree in `validate_boundary`.

For real-world boundary data (India, Mozambique, etc.), the [DIGIT-Boundaries-OpenData](https://github.com/ChakshuGautam/DIGIT-Boundaries-OpenData) repository provides pre-generated hierarchy definitions and boundary lists in DIGIT-compatible JSON format, organized by country/state/city.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to create boundaries for (e.g. `"pg.citya"`). |
| `boundaries` | array | yes | -- | Flat list of boundaries. Each object has `code` (string, required), `type` (string, required -- must match a hierarchy level), and `parent` (string, optional -- parent boundary code, omit for root level). |
| `hierarchy_type` | string | no | `"ADMIN"` | Hierarchy type name. |
| `hierarchy_definition` | array | no | -- | Ordered list of boundary level names, top-down (e.g. `["Country", "State", "City", "Ward", "Locality"]`). Required if the tenant has no existing hierarchy. If omitted, the existing hierarchy is fetched and reused. |

### Boundary object shape

```json
{
  "code": "WARD_1",
  "type": "Ward",
  "parent": "PG_CITYA"
}
```

- `code` -- unique boundary identifier. Convention: uppercase with underscores.
- `type` -- must exactly match one of the levels in the hierarchy definition.
- `parent` -- the `code` of the parent boundary. Omit or set to `null` for root-level boundaries.

## Response

Returns a JSON object with a summary of created/skipped entities and relationships.

```json
{
  "success": true,
  "tenantId": "pg.citya",
  "hierarchyType": "ADMIN",
  "summary": {
    "entitiesCreated": 5,
    "entitiesSkipped": 0,
    "relationshipsCreated": 5,
    "relationshipsSkipped": 0,
    "errors": 0
  },
  "results": {
    "hierarchy": {
      "action": "created",
      "rootCreated": "pg"
    },
    "entitiesCreated": ["IN", "PG", "PG_CITYA", "WARD_1", "LOC_CITYA_1"],
    "entitiesSkipped": [],
    "relationshipsCreated": ["IN", "PG", "PG_CITYA", "WARD_1", "LOC_CITYA_1"],
    "relationshipsSkipped": [],
    "errors": []
  }
}
```

When re-running on an already-provisioned tenant (idempotent behavior):

```json
{
  "success": true,
  "tenantId": "pg.citya",
  "hierarchyType": "ADMIN",
  "summary": {
    "entitiesCreated": 0,
    "entitiesSkipped": 5,
    "relationshipsCreated": 0,
    "relationshipsSkipped": 5,
    "errors": 0
  },
  "results": {
    "hierarchy": { "action": "already_exists" },
    "entitiesCreated": [],
    "entitiesSkipped": ["IN", "PG", "PG_CITYA", "WARD_1", "LOC_CITYA_1"],
    "relationshipsCreated": [],
    "relationshipsSkipped": ["IN", "PG", "PG_CITYA", "WARD_1", "LOC_CITYA_1"],
    "errors": []
  }
}
```

## Examples

### Basic Usage

Create a minimal boundary tree for a city tenant with one ward and one locality:

```
Tool: boundary_create
Args: {
  "tenant_id": "pg.citya",
  "hierarchy_definition": ["Country", "State", "City", "Ward", "Locality"],
  "boundaries": [
    { "code": "IN", "type": "Country" },
    { "code": "PG", "type": "State", "parent": "IN" },
    { "code": "PG_CITYA", "type": "City", "parent": "PG" },
    { "code": "WARD_1", "type": "Ward", "parent": "PG_CITYA" },
    { "code": "LOC_CITYA_1", "type": "Locality", "parent": "WARD_1" }
  ]
}
```

### Advanced Usage -- using real-world boundary data

Clone the open-data repository, read its JSON files, and pass them directly:

```bash
git clone https://github.com/ChakshuGautam/DIGIT-Boundaries-OpenData /tmp/digit-boundaries
# Read /tmp/digit-boundaries/data/IN/PunjabState/Amritsar/boundaries-flat.json
# Read /tmp/digit-boundaries/data/IN/PunjabState/Amritsar/boundary-relationships.json
```

Then pass the data to the tool:

```
Tool: boundary_create
Args: {
  "tenant_id": "pg.citya",
  "hierarchy_definition": ["Country", "State", "District", "City", "Ward", "Locality"],
  "boundaries": [
    // ... contents of boundaries-flat.json
  ]
}
```

### Advanced Usage -- adding boundaries to an existing hierarchy

If the hierarchy already exists, omit `hierarchy_definition`. The tool will fetch and reuse the existing level order:

```
Tool: boundary_create
Args: {
  "tenant_id": "pg.citya",
  "boundaries": [
    { "code": "WARD_2", "type": "Ward", "parent": "PG_CITYA" },
    { "code": "LOC_CITYA_2", "type": "Locality", "parent": "WARD_2" }
  ]
}
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `No hierarchy definition found for this tenant. Provide hierarchy_definition parameter.` | No existing hierarchy and `hierarchy_definition` was omitted. | Pass `hierarchy_definition` with the ordered list of boundary levels. |
| `Failed to fetch hierarchy: ...` | Boundary-service could not be reached or returned an error. | Verify DIGIT services are running. Provide `hierarchy_definition` as a workaround. |
| Entity creation error (non-DUPLICATE) | A boundary code violates constraints or the API is unreachable. | Check the `errors` array in the response for the specific code and error message. |
| Relationship creation error | Parent boundary does not exist or the type does not match the hierarchy. | Ensure parent codes reference boundaries that are being created in the same call or already exist. Verify `type` values match hierarchy level names exactly. |

## See Also

- [city_setup](city_setup.md) -- higher-level tool that auto-creates boundaries as part of full city tenant provisioning
- [validate_boundary](validate_boundary.md) -- verify boundaries were created correctly
- [boundary_hierarchy_search](boundary_hierarchy_search.md) -- inspect existing hierarchy definitions
- [Guide: City Setup](../../guides/city-setup.md) -- end-to-end guide for setting up a new city tenant
